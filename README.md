# StefanAI Mitarbeiter-Intranet

Internes Mitarbeiterportal der StefanAI Solutions GmbH für Urlaubsanträge,
Workation-Anträge (gemäß Workation-Richtlinie), Reisekostenabrechnungen
(gemäß Reisekostenrichtlinie und Excel-Formular) und Krankmeldungen —
inkl. Freigabe-Workflow, E-Mail-Benachrichtigungen (Brevo), n8n-Webhooks
und REST-API für KI-gestützte Freigaben.

## Tech-Stack

| Komponente | Technologie |
|---|---|
| Framework | Next.js (App Router, TypeScript), Tailwind CSS, shadcn/ui |
| Hosting | Vercel, Region `fra1` (siehe `vercel.json`) |
| Authentifizierung | Clerk (Passwort + Client Trust, Allowlist `@stefanai.de`) |
| Datenbank | Neon PostgreSQL (EU Frankfurt), Drizzle ORM |
| Datei-Storage | Vercel Blob (Store-Region `fra1`), Auslieferung nur über signierte URLs |
| E-Mail | Brevo API, Absender `intranet@stefanai.de` |
| Automatisierung | n8n über HMAC-signierte Webhooks mit Retry |

## Lokale Entwicklung

```bash
npm install
cp .env.example .env.local   # Werte eintragen (siehe Kommentare in der Datei)
npm run db:migrate           # Schema in die Datenbank einspielen
npm run db:seed              # Settings (Sätze) + Admin-User anlegen
npm run dev
```

Ohne `BREVO_API_KEY` werden E-Mails nur in der Konsole geloggt (Dev-Modus).

## Tests

```bash
npm test
```

Die Vitest-Suite deckt die Abnahmekriterien der Berechnungslogik ab,
u. a. Beispiel C der Kurzanleitung (drei Tage, Hotelfrühstück an beiden
Morgen, Kundenessen am vollen Tag → exakt 33,60 €), die Kappung der
Kürzung beim Grundsatz (nie negativ) sowie die Workation-Validierungen
(30 Arbeitstage/Jahr, 20 am Stück, Vorlauf 4/8 Wochen).

## Betrieb / Admin-Kurzdoku

### Einrichtung externer Dienste (einmalig)

1. **Neon**: Projekt in Region *EU (Frankfurt)* anlegen, `DATABASE_URL`
   (pooled) übernehmen, `npm run db:migrate && npm run db:seed`.
2. **Clerk**: Anwendung anlegen; E-Mail+Passwort aktivieren; *Client Trust*
   (E-Mail-Code bei neuen Geräten) aktivieren; unter *Restrictions* die
   Allowlist auf `stefanai.de` setzen; Invitations aktivieren.
   Für den persönlichen MCP-Zugang (Claude/Cursor): unter *OAuth Applications*
   **Dynamic Client Registration** aktivieren und Default-Scopes
   `openid`, `profile`, `email` setzen.
3. **Vercel**: Projekt verbinden, Domain `intra.stefanai.de` hinzufügen
   (DNS-Eintrag beim Domain-Hoster Google setzen), Umgebungsvariablen aus
   `.env.example` hinterlegen. Blob-Store in Region `fra1` erstellen.
4. **Brevo**: Absender-Domain `stefanai.de` verifizieren (Brevo-DKIM-Einträge
   im DNS, SPF-Eintrag um Brevo erweitern — zusätzlich zu Google), danach
   DMARC prüfen. In Google Workspace `intranet@` als Postfach oder
   Alias/Gruppe anlegen, damit Antworten und Bounces ankommen.
5. **Cron**: `vercel.json` enthält den Cron `/api/cron/webhooks` für
   Webhook-Wiederholungen; `CRON_SECRET` setzen. Der Takt ist bewusst auf
   werktags 05:00–19:59 UTC alle 30 Min. begrenzt (deutsche Arbeitszeit,
   ganzjährig): Neon suspendiert die Compute nach 5 Min. Leerlauf, ein
   dichterer Takt hält sie rund um die Uhr wach und verbraucht das
   Compute-Kontingent allein im Leerlauf. Zustellungen, die außerhalb des
   Fensters fällig werden, gehen nicht verloren — sie werden beim nächsten
   Lauf nachgeholt.

### Laufender Betrieb

- **Mitarbeitende einladen**: Menü *Mitarbeitende* → Name, E-Mail
  (`@stefanai.de`), Jahresurlaubsanspruch, Eintrittsdatum und Resturlaub im
  Eintrittsjahr (alle Pflichtfelder) → Einladung wird per Brevo versendet und
  kann jederzeit erneut versendet werden.
- **Eintritt vor dem ersten Arbeitstag**: Neue Mitarbeitende lassen sich
  jederzeit vorab anlegen. Die Anmeldung ist bis zum Eintrittsdatum gesperrt
  (Hinweis im Login und in der Einladungsmail); der Zugang gilt bis dahin als
  „Eingeladen". Im Eintrittsjahr steht ausschließlich der hinterlegte
  Resturlaub zur Verfügung, ab dem Folgejahr der volle Jahresanspruch inkl.
  Übertrag. Urlaub vor dem Eintrittsdatum wird abgelehnt. Eintrittsdatum und
  Resturlaub sind unter *Mitarbeitende → Bearbeiten → Eintritt* pflegbar;
  Bestandsmitarbeitende ohne Eintrittsdatum behalten in jedem Jahr den
  Jahresanspruch.
- **Vertretung**: Menü *Einstellungen → Vertretung* — Toggle mit optionalem
  Zeitraum (automatisches Ende). Die Vertretung erhält dieselben
  Benachrichtigungen wie der Admin (außer Krankmeldungen) und darf keine
  eigenen Anträge genehmigen.
- **Sätze**: Menü *Einstellungen → Reisekosten-Sätze* — alle Werte aus dem
  Blatt „Sätze" ohne Code-Änderung anpassbar, inkl. freiwilligem
  Tageszuschlag (Standard 0 €).
- **n8n-Webhooks**: Menü *Einstellungen → n8n-Webhooks* — URL + Secret pro
  Kategorie/Ereignis. Signatur: `X-StefanAI-Signature` = HMAC-SHA256 über
  den JSON-Body mit dem Secret. 3 Zustellversuche (sofort, danach +1 min,
  +5 min, +30 min Backoff). Der erste Versuch läuft immer sofort; die
  Wiederholungen holt der Cron im 30-Minuten-Takt nach, außerhalb der
  Cron-Zeiten entsprechend später. Zustell-Log in der Oberfläche.
- **API-Keys**: Menü *Einstellungen → API-Keys* — Klartext wird nur einmalig
  angezeigt; Keys sind jederzeit widerrufbar.
- **Exporte**: Menü *Einstellungen → Reisekosten-Export* — genehmigte
  Abrechnungen pro Monat als CSV/PDF mit getrenntem Ausweis (steuerfreie
  Pauschale / pauschal versteuerter Zuschlag / Beleg-Erstattungen).
- **Löschbericht**: Menü *Einstellungen → Aufbewahrungsfristen* — Bericht
  „löschbare Datensätze" (Reisekosten 8 Jahre, Krankmeldungen 5 Jahre,
  Urlaub/Workation 3 Jahre; konfigurierbar). Es wird nichts automatisch
  gelöscht.
- **IT-Ausstattung**: Menü *IT-Management* (nur Admin) — je Gerät eine selbst
  vergebene **Geräte-ID** (Pflichtfeld, nur Ziffern, Buchstaben und
  Bindestriche, projektweit eindeutig). Das Anlegen-Formular schlägt die
  nächste ID im Nummernkreis `SA-IT-<Jahr>-<lfd. Nummer>` vor; die Nummer
  zählt über den Jahreswechsel hinweg weiter (auf `SA-IT-2025-03` folgt
  `SA-IT-2026-04`) und wird auch nach einer Rückgabe nicht neu vergeben. Der
  Vorschlag lässt sich überschreiben. Dazu kommen Mitarbeiter/in,
  Ausstattungsart, optionale Seriennummer, Zusatzinformationen sowie
  Übernahme- und Rückgabedatum. Reiter *Im Einsatz* und *Zurückgegeben*
  trennen nach Rückgabedatum; der Reiter *Ausstattungsarten* pflegt die
  Auswahlliste (Startwerte: Laptop, Maus, Kopfhörer, Peripherie, Rucksack,
  Koffer). Bereits verwendete Arten lassen sich nur ausblenden, nicht
  löschen.
- **Übergabeprotokolle**: Reiter *Mitarbeitende* im IT-Management — da die
  Ausstattung gesammelt übergeben wird, gibt es je Person genau ein
  Übergabe- und ein Rücknahmeprotokoll. Ein neuer Upload ersetzt das
  bisherige Dokument. Deaktivierte Zugänge bleiben gelistet, damit sich das
  Rücknahmeprotokoll beim Offboarding noch hinterlegen lässt. Die Spalte
  *Vorlagen (PDF)* liefert ausgefüllte Protokolle mit Briefkopf zum
  Ausdrucken und Unterschreiben: die Übergabe mit der Ausstattung im
  Einsatz, die Rücknahme mit allen erfassten Geräten samt Rückgabedaten
  (offene Daten als Leerfeld zum Handausfüllen). Jeder Abruf wird
  auditiert.
- **Seminar- und Beratungsberichte**: Menü *Berichte* — alle Mitarbeitenden
  halten nach einer Veranstaltung Kunde, Art (Seminar/Beratung), Titel, Datum,
  Dauer in Tagen (0,5er-Schritte), was gut und was nicht gut lief, geplante
  Verbesserungen sowie das Teilnehmenden-Feedback von 1 bis 5 fest (**5 = sehr
  gut**). Bewusst ohne Freigabe-Workflow: Berichte werden abgeliefert, nicht
  genehmigt; die eigenen Berichte bleiben jederzeit bearbeit- und löschbar.
  Das Kundenfeld ist Freitext mit Vorschlägen aus den Faktura-Kunden und
  bereits erfassten Berichten, damit Schreibweisen nicht auseinanderlaufen.
  Der Reiter *Alle Berichte* steht dem ganzen Team offen: dort sind die
  Berichte aller Mitarbeitenden lesbar, mit Filter nach Mitarbeiter/in, Art
  und Zeitraum sowie umschaltbarer Sortierung nach Datum oder Mitarbeiter/in
  (die Auswahl steht in der URL und ist damit teilbar). Fremde Berichte sind
  ausschließlich lesbar — bearbeiten und löschen darf sie nur, wer sie
  verfasst hat. Der Reiter *Zitate* bleibt dem Admin vorbehalten.
- **Zitate von Teilnehmenden**: Reiter *Zitate* im Menü *Berichte* — je Bericht
  lassen sich bis zu 20 Zitate sammeln. Es wird **ausschließlich der Wortlaut**
  erfasst, bewusst ohne Namensfeld, damit die Zitate anonym bleiben. Der Admin
  gibt einzelne Zitate für die Website frei und lädt die freigegebenen als CSV
  herunter (Semikolon, UTF-8 mit BOM, öffnet direkt in Excel); jeder Export
  wird auditiert. Ändert jemand den Wortlaut eines bereits freigegebenen
  Zitats, fällt die Freigabe automatisch zurück und muss erneut erteilt werden.
  Beim Löschen eines Berichts verschwinden auch seine Zitate — der
  Löschdialog weist vorher aus, wie viele davon freigegeben sind.
- **Ausstattungsliste als CSV**: Reiter *Export & Import* im IT-Management —
  Export aller Geräte (Semikolon, UTF-8 mit BOM, öffnet direkt in Excel);
  dieselbe Datei dient als Import-Vorlage. Der Import gleicht über die
  Spalte *Geräte-ID* ab: bekannte IDs werden aktualisiert, neue Zeilen
  angelegt, in der Datei fehlende Geräte gelöscht. Umbenennen läuft über die
  Spalte *Geräte-ID neu (optional)*; ein Ringtausch zweier IDs in einem
  Durchgang wird abgelehnt. Vor dem Schreiben erscheint immer eine Vorschau,
  Fehler werden mit Zeilennummer gemeldet und der Import greift ganz oder
  gar nicht. Übergabeprotokolle sind nicht betroffen, da sie an der Person
  hängen.

## Freigabe-API (v1)

Authentifizierung: `Authorization: Bearer <API-Key>` (Erstellung siehe oben).
Rate Limit: 60 Anfragen/Minute je Key. Alle Aktionen erscheinen im Audit-Log
mit Kennzeichnung „API" und dem verwendeten Key.

| Methode | Pfad | Beschreibung |
|---|---|---|
| GET | `/api/v1/requests?status=pending&type=vacation\|workation\|expense` | Offene Anträge inkl. Formulardaten |
| GET | `/api/v1/requests/{id}` | Einzelvorgang inkl. Historie |
| POST | `/api/v1/requests/{id}/approve` | Genehmigen |
| POST | `/api/v1/requests/{id}/reject` | Beanstanden, Body: `{ "comment": "…" }` (Pflicht) |
| GET | `/api/v1/absences` | Krankmeldungen und genehmigte Abwesenheiten (nur lesend) |

## Persönlicher MCP-Zugang (Claude / Cursor)

Jeder Mitarbeitende kann unter **Mein Konto** die MCP-Server-URL
(`{APP_BASE_URL}/mcp`) kopieren und in Claude oder Cursor als Remote-MCP
hinterlegen. Die Authentifizierung läuft über Clerk OAuth 2.1 (PKCE): beim
ersten Connect erscheint der Intranet-Login. Danach agieren die Tools nur im
Namen des angemeldeten Users (eigene Anträge erstellen/listen/zurückziehen).
HR-Dokumente und Freigaben fremder Anträge sind nicht freigegeben.

Voraussetzung in Clerk: Dynamic Client Registration + Default-Scopes
(siehe Einrichtung oben). Die bestehende Freigabe-API (`/api/v1` + Admin-Keys)
bleibt davon getrennt.

## Datenschutz (Kurzüberblick)

- Alle Dienste in EU-Region (Neon Frankfurt, Vercel/Blob `fra1`, Brevo EU);
  AV-Verträge mit Vercel, Clerk, Neon, Brevo abschließen (Aufgabe
  Auftraggeber; Liste der Subdienste = diese vier plus Google DNS/Workspace).
- Krankmeldungen: nur Zeitraum und Typ; kein AU-Upload, Hinweistext gegen
  Diagnose-Angaben, Sichtbarkeit für Dritte nur „abwesend".
- Zugriffskontrolle serverseitig in der Datenzugriffsschicht; Belege nur
  über authentifizierte bzw. signierte, ablaufende URLs.
- Übergabe- und Rücknahmeprotokolle der IT-Ausstattung liegen wie
  Personaldokumente AES-256-GCM-verschlüsselt im Blob-Store; entschlüsselt
  wird ausschließlich in `/api/it-dokumente/[id]`, und zwar nur für Admins.
  Jeder Abruf wird im Audit-Log protokolliert. Die Protokolle hängen an der
  Person (je eines für Übergabe und Rücknahme); ein neuer Upload löscht die
  bisherige Datei endgültig und wird als „ersetzt" auditiert.
- Der CSV-Export der Ausstattungsliste enthält Namen und E-Mail-Adressen und
  ist deshalb nur für Admins abrufbar; jeder Export wird auditiert.
- Audit-Log append-only; Backups über Neon Point-in-Time-Recovery
  (Wiederherstellung: Neon Console → Branch/Restore auf Zeitpunkt,
  `DATABASE_URL` umhängen).
