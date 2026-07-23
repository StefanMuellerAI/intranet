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
5. **Cron**: `vercel.json` enthält den Cron `/api/cron/webhooks` (alle 5 Min.)
   für Webhook-Wiederholungen; `CRON_SECRET` setzen.

### Laufender Betrieb

- **Mitarbeitende einladen**: Menü *Mitarbeitende* → Name, E-Mail
  (`@stefanai.de`) und Jahresurlaubsanspruch (Pflichtfeld) → Einladung wird
  per Brevo versendet und kann jederzeit erneut versendet werden.
- **Vertretung**: Menü *Einstellungen → Vertretung* — Toggle mit optionalem
  Zeitraum (automatisches Ende). Die Vertretung erhält dieselben
  Benachrichtigungen wie der Admin (außer Krankmeldungen) und darf keine
  eigenen Anträge genehmigen.
- **Sätze**: Menü *Einstellungen → Reisekosten-Sätze* — alle Werte aus dem
  Blatt „Sätze" ohne Code-Änderung anpassbar, inkl. freiwilligem
  Tageszuschlag (Standard 0 €).
- **n8n-Webhooks**: Menü *Einstellungen → n8n-Webhooks* — URL + Secret pro
  Kategorie/Ereignis. Signatur: `X-StefanAI-Signature` = HMAC-SHA256 über
  den JSON-Body mit dem Secret. 3 Zustellversuche (sofort, +1 min, +5 min,
  +30 min via Cron), Zustell-Log in der Oberfläche.
- **API-Keys**: Menü *Einstellungen → API-Keys* — Klartext wird nur einmalig
  angezeigt; Keys sind jederzeit widerrufbar.
- **Exporte**: Menü *Einstellungen → Reisekosten-Export* — genehmigte
  Abrechnungen pro Monat als CSV/PDF mit getrenntem Ausweis (steuerfreie
  Pauschale / pauschal versteuerter Zuschlag / Beleg-Erstattungen).
- **Löschbericht**: Menü *Einstellungen → Aufbewahrungsfristen* — Bericht
  „löschbare Datensätze" (Reisekosten 8 Jahre, Krankmeldungen 5 Jahre,
  Urlaub/Workation 3 Jahre; konfigurierbar). Es wird nichts automatisch
  gelöscht.

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
- Audit-Log append-only; Backups über Neon Point-in-Time-Recovery
  (Wiederherstellung: Neon Console → Branch/Restore auf Zeitpunkt,
  `DATABASE_URL` umhängen).
