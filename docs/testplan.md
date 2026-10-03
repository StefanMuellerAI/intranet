# Testplan: Jede Funktion und jeder Button getestet

Stand: 03.10.2026 · Basis: Commit `7b15fdb` (main)

Dieser Plan beschreibt den Ist-Zustand der Testabdeckung, die gefundenen
Lücken und Fehler und den Weg zu einer vollständigen Abdeckung. Abschnitt 5
ist gleichzeitig die Checkliste, an der die Umsetzung abgehakt wird.

---

## 1. Ausgangslage

### 1.1 Vorhandenes Test-Setup

| Ebene | Werkzeug | Umfang heute | Läuft gegen |
|---|---|---|---|
| Unit | Vitest (Projekt `unit`) | 21 Dateien, 251 Tests, alle grün | reine Funktionen, teils DB-Mock |
| Integration | Vitest (Projekt `integration`) | 9 Dateien, ca. 100 Tests | Neon-Test-Branch (`.env.test`) |
| E2E | Playwright, nur „Desktop Chrome“ | 11 Specs, 41 Tests (1 übersprungen) plus Login-Setup | `next dev` + Clerk-Dev-Instanz + Neon-Test-Branch |
| Komponenten | – | **nicht vorhanden** (keine `*.test.tsx`, kein Testing Library) | – |
| CI | `.github/workflows/test.yml` | Lint → Unit → Migration → Integration → E2E | – |

### 1.2 Kennzahlen

| Kennzahl | Wert |
|---|---|
| Zeilenabdeckung Unit-Tests (gemessen, `vitest --coverage`) | **11 %** gesamt, `src/lib` 27 % |
| `src/lib`-Dateien ohne jede Unit-Abdeckung | 28 von 54 |
| Seiten, Komponenten, Server-Actions (Unit) | 0 % |
| Server-Actions gesamt | 96 |
| … davon direkt getestet (Integration/Unit) | **0** |
| … davon wenigstens im Happy Path über E2E ausgelöst | 38 |
| … von keinem Test je ausgeführt | **58** |
| Bedienelemente (Buttons, Dialog-Trigger, Toggles, Links, Uploads) | ca. 300 |
| … davon in E2E tatsächlich angeklickt | ca. 30 % (Administration: 21 von ~116) |
| API-Routen | 23, davon 8 ganz ohne Test |
| MCP-Tools | 11, davon 0 getestet |
| Seiten, die kein Test je aufruft | `/it-management`, `/kalender`, `/organigramm`, `/dokumente`, `/konto` |

Integrations- und E2E-Tests ließen sich in der Analyse-Umgebung nicht
ausführen (keine `.env.test`, kein Neon/Clerk). Deren Abdeckung ist daher aus
dem Code abgeleitet, nicht gemessen.

### 1.3 Strukturelle Ursachen

1. **Server-Actions haben keine eigenen Tests.** Integrationstests rufen nur
   Lib-Funktionen oder Route-Handler auf; es gibt kein Mocking für
   `requireUser`/`requireAdmin`. Rollenprüfungen, Validierung und
   Seiteneffekte der Actions sind damit nur indirekt (oder gar nicht) geprüft.
2. **Keine Komponententests.** Client-Logik (Zeilen hinzufügen/entfernen,
   Live-Berechnungen, disabled-Zustände, Dialoge) ist nur über E2E
   erreichbar und dort größtenteils nicht bedient.
3. **E2E springt per `goto`.** Navigations-Buttons, „… beantragen“-Header,
   „Details“-Links und Sidebar werden nie geklickt.
4. **Nur Happy Paths.** Zurückziehen, Korrigieren, Löschen, Bearbeiten,
   Einblenden und alle Fehlerpfade fehlen in weiten Teilen.
5. **Keine Abdeckungsmessung über alle Ebenen** und keine
   Mindestschwellen in CI. Neue Buttons/Actions fallen nicht auf.

---

## 2. Gefundene Fehler und Auffälligkeiten

Diese Punkte werden in Phase 1 **zuerst mit einem fehlschlagenden Test
belegt und dann behoben**.

| # | Befund | Ort | Schwere | Status |
|---|---|---|---|---|
| F1 | SSRF-Schutz greift bei IPv6 nicht: `new URL(...).hostname` liefert `[::1]` mit Klammern, die Prüfungen auf `::1`, `fe80:`, `fc/fd` matchen nie. `https://[::1]/`, `[fd00::1]`, `[::ffff:7f00:1]` werden als Webhook-Ziel akzeptiert. | `src/lib/webhooks.ts` (`isPrivateHost`) | hoch (Security; nur Admin kann Webhooks anlegen) | nachgeprüft |
| F2 | Korrektur eines Urlaubsantrags prüft den Resturlaub nicht (beim Anlegen schon). Eine Korrektur kann den Anspruch überschreiten. | `src/lib/requests/vacation.ts` (`resubmitVacationRequestForUser`) | mittel | nachgeprüft |
| F3 | `closeSickLeave` hat keine Statusprüfung – bereits abgeschlossene Meldungen lassen sich erneut „abschließen“/überschreiben. Die Logik dupliziert zudem `closeSickLeaveForUser` (nur von MCP genutzt). | `src/app/(app)/krankmeldung/actions.ts` | mittel | nachgeprüft |
| F4 | `correctSickLeave` prüft nicht „Ende ≥ Beginn“. | `src/app/(app)/krankmeldung/actions.ts` | niedrig | gemeldet, prüfen |
| F5 | `/api/exports/faktura` fängt den `UserError` „Kunde nicht gefunden“ nicht ab → 500 statt 404. | `src/app/api/exports/faktura/route.ts` | niedrig | nachgeprüft |
| F6 | `/api/dokumente/[id]` und `/api/it-dokumente/[id]` prüfen Existenz (404) vor Berechtigung (403) und verraten so gültige IDs. | beide Routen | niedrig (UUIDs) | nachgeprüft |
| F7 | `deleteSeminarReportAction` läuft ohne `runAction` – Fehler erreichen die UI ungefangen. | `src/app/(app)/berichte/actions.ts` | niedrig | gemeldet, prüfen |
| F8 | Sidebar-Badge „Freigaben“ zählt Provisionen mit, die Dashboard-Karte „Offene Freigaben“ nicht. | `src/app/(app)/layout.tsx` vs. `dashboard/page.tsx` | niedrig | gemeldet, prüfen |
| F9 | `AdminEntryDialog` schließt sich, bevor das Ergebnis da ist – bei Fehler sind die Eingaben verloren. | `src/components/faktura/freigabe-admin.tsx` | UX | gemeldet, prüfen |
| F10 | Nicht atomar: Dokument/Protokoll wird im Blob gelöscht, bevor die DB aktualisiert ist (Ersetzen/Löschen). | `mitarbeitende/actions.ts`, `it-management/actions.ts` | niedrig | gemeldet, prüfen |

**Fragliches Verhalten – vor dem Testen fachlich festlegen:**

- `updateRetention`: ungültige/0-Werte fallen still auf Standard zurück, negative Werte werden akzeptiert.
- `updateQuotas`: leere Felder werden als 0 gespeichert.
- `setDeputy`: kein Server-Check auf existierende/aktive Person, sich selbst oder „Ende vor Beginn“.
- `update*`/`delete*` in Inhalte: unbekannte ID ist ein stiller No-op, schreibt aber trotzdem einen Audit-Eintrag.
- Webhook „Löschen“ und API-Key „Widerrufen“ ohne Bestätigungsdialog.

**Toter Code – löschen statt testen:** `assertOwnResource` (`mcp-auth.ts`),
`getProjectMonthSaldo` (`faktura/limit.ts`), `customerIdOfProject`
(`faktura/stundenzettel.ts`).

---

## 3. Zielbild und Definition of Done

### 3.1 Aufgabenteilung der Testebenen

| Ebene | Prüft | Beispiele |
|---|---|---|
| **Unit** | reine Funktionen, Berechnungen, Parser, Formatierung | Verpflegungspauschale, CSV-Bau, Krypto, SSRF-Prüfung |
| **Integration** | jede Server-Action und jede API-Route mit echter Test-DB: Happy Path, Rollen, Validierung, Statusübergänge, Seiteneffekte (Audit, Mail, Webhook, Historie) | `withdrawWorkationRequest` als Fremder → Fehler |
| **Komponente** (neu) | Client-Logik einzelner Komponenten mit gemockten Actions | „Position hinzufügen“, „Trotzdem buchen“, disabled-Zustände |
| **E2E** | jeder Button wird im echten System mindestens einmal geklickt und seine sichtbare Wirkung geprüft | Klickpfad Sidebar → Formular → Freigabe |

### 3.2 Definition of Done

- **Funktion (`src/lib`)**: jede exportierte Funktion hat mindestens einen
  direkten Test; jeder `throw`-/Fehlerzweig ist getestet.
- **Server-Action**: Integrationstest für (1) Happy Path inkl. DB-Zustand und
  Audit, (2) falsche Rolle bzw. fremder Eigentümer, (3) Validierungsfehler,
  (4) unzulässiger Status, (5) „nicht gefunden“ – soweit der Zweig existiert.
- **API-Route**: jeder Statuscode-Zweig (200/304/400/401/403/404/409/429/5xx)
  hat einen Test.
- **Button**: E2E-Test klickt ihn und prüft die Wirkung (Toast, Status-Badge,
  URL, Download, DB-Zustand) **und** die ausgelöste Action/Route erfüllt die
  DoD oben. Reine Client-Buttons (Zeile hinzufügen, Kopieren, Tabs) dürfen
  statt E2E über einen Komponententest abgedeckt sein, wenn der umgebende
  Flow in E2E läuft.
- **Bedingte Buttons** (nur für Rolle X/Status Y): je ein Test „sichtbar“ und
  „nicht sichtbar“.

### 3.3 Bewusst ausgenommen

`src/components/ui/**` (shadcn-Primitive), Konstanten/Typen in
`src/db/schema.ts`, `src/lib/utils.ts` (`cn`), Labels/Konstanten-Dateien.

---

## 4. Phasenplan

### Phase 0 – Fundament

- [ ] **Lokale Test-DB**: Postgres per Docker plus Neon-HTTP-Proxy
      (`neonConfig.fetchEndpoint` aus einer Env-Variable in `src/db/index.ts`
      und `tests/helpers/db.ts`). Damit laufen Integrationstests lokal, in
      Cloud-Sessions und optional in CI ohne geteilte Neon-DB.
- [ ] **Action-Test-Harness** `tests/helpers/actions.ts`:
  - `vi.mock("@/lib/auth")` mit umschaltbarem aktuellem User (`asUser(seed.admin)`, `asUser(seed.employee)`, `asUser(null)`); die echten `requireAdmin`/`requireApprover`-Regeln bleiben erhalten.
  - Mocks für `next/cache` (`revalidatePath`), `next/navigation` (`redirect` wirft einen prüfbaren Marker), `@vercel/blob` (In-Memory `put`/`del`/`fetch`), `@clerk/nextjs/server` (Invitations, ban/unban).
  - Mail-Spy auf `sendMail` und Webhook-Spy, um Empfänger und Payload zu prüfen.
  - `formData({...})`-Helfer.
- [ ] **Komponententests einführen**: Vitest-Projekt `component` mit
      `happy-dom`, `@testing-library/react`, `@testing-library/user-event`;
      Muster `src/**/*.test.tsx`.
- [ ] **Seed erweitern**: Vertretung, deaktivierter User, User vor Eintritt,
      Faktura-Grunddaten, IT-Arten. `resetDb` leert auch `it_equipment_types`.
- [ ] **Playwright**: zusätzliches Projekt „Mobile“ (z. B. Pixel 7) nur für
      die Navigations-Spec; Helfer `clickNav(page, label)`; Clipboard-
      Berechtigung im Kontext; Download-Helfer.
- [ ] **Coverage zusammenführen**: Unit + Integration + Komponente in einem
      Report (`vitest --coverage` über alle Projekte), Report als CI-Artifact.

### Phase 1 – Gefundene Fehler mit Test zuerst beheben

- [ ] F1 IPv6-SSRF (Unit-Tests für `[::1]`, `[fd00::1]`, `[fe80::1]`, `[::ffff:127.0.0.1]`, `[::]`), danach Klammern entfernen und IPv4-mapped prüfen
- [ ] F2 Resturlaub beim Korrigieren (Integration)
- [ ] F3/F4 Krankmeldung: Status- und Datumsprüfung; Web-Action auf `closeSickLeaveForUser` umstellen
- [ ] F5 Faktura-Export 404
- [ ] F6 Reihenfolge 403 vor 404 (bzw. einheitlich 404)
- [ ] F7–F10 nach fachlicher Bestätigung
- [ ] Toten Code entfernen

### Phase 2 – Alle 96 Server-Actions (Integration)

Je Action-Datei eine Testdatei unter `tests/integration/actions/`. Fälle je
Action siehe Checkliste 5.1. Priorität: Datenzugriff und Geld zuerst
(Anträge, Mitarbeitende/Dokumente, IT-Import, Einstellungen), dann Faktura,
Berichte, Inhalte.

### Phase 3 – API-Routen und MCP (Integration)

Alle Statuspfade aus Checkliste 5.2, insbesondere die sensiblen Downloads
(Belege, Arbeitsverträge, IT-Protokolle) und alle 11 MCP-Tools über einen
Fake-`McpServer`, der die registrierten Handler einsammelt.

### Phase 4 – Lib-Lücken (Unit/Integration)

Checkliste 5.3. Dazu reine Logik aus Seiten in `src/lib` herausziehen, wo
sie heute untestbar in Komponenten steckt (Organigramm-Layout,
Kalender-Parameter, Dashboard-Zähler).

### Phase 5 – Komponententests

Checkliste 5.4: alle Client-Komponenten mit eigener Logik.

### Phase 6 – E2E: jeder Button mindestens einmal

Checkliste 5.5, seitenweise. Navigation grundsätzlich per Klick statt `goto`
(ein `goto` nur noch als Einstieg pro Test).

### Phase 7 – Absichern, dass es so bleibt

- [ ] **Interaktions-Matrix** `tests/interaction-matrix.ts`: jedes
      Bedienelement mit Seite, Label, Datei und abdeckendem Test.
- [ ] **Meta-Test**, der die `.tsx`-Dateien nach `<Button`, Dialog-Triggern,
      `ConfirmDialog`/`DeleteDialog`/`FormDialog`/`VisibilityToggle` und
      Submit-Labels durchsucht und fehlschlägt, wenn ein Element in der Matrix
      fehlt. Neue Buttons ohne Test fallen so im PR auf.
- [ ] **Coverage-Schwellen** in `vitest.config.ts` (zunächst ≥ 90 % Zeilen /
      85 % Branches für `src/lib/**`, `src/app/**/actions.ts`,
      `src/app/api/**`), in CI erzwungen und schrittweise angehoben.
- [ ] Optional: **E2E-Coverage** (Next-Server mit `NODE_V8_COVERAGE`,
      Browser über Playwright-Chromium-Coverage, Zusammenführung mit
      `monocart-coverage-reports`), um sichtbar zu machen, welcher
      Client-Code nur E2E-seitig läuft.
- [ ] CI-Workflow um Komponententests, Mobile-Projekt und Coverage-Report
      erweitern.

### Umfang (Schätzung)

| Phase | neue Testfälle (ca.) | Aufwand (Personentage, grob) |
|---|---|---|
| 0 Fundament | – | 1–2 |
| 1 Fehler | 20 | 0,5–1 |
| 2 Server-Actions | 350–400 | 4–6 |
| 3 API + MCP | 90 | 2 |
| 4 Lib | 80 | 1–2 |
| 5 Komponenten | 90 | 2–3 |
| 6 E2E | 45 neue Szenarien | 4–6 |
| 7 Absicherung | – | 1 |
| **Summe** | **≈ 700** | **≈ 16–23** |

---

## 5. Checklisten

Legende: heute = was bereits existiert (E2E = Happy Path per UI). Alle
Actions bekommen zusätzlich den Rollen-/Eigentümer-Test aus der DoD; er ist
nicht in jeder Zeile wiederholt.

### 5.1 Server-Actions (Integration)

#### Anträge (24)

| Action | heute | neu |
|---|---|---|
| `submitVacationRequest` | E2E (inkl. Resturlaub überschritten) | Ende < Beginn, 0 Arbeitstage serverseitig, vor Eintrittsdatum, Halbtage, Vertretung per Select, Mail an Admin + Vertretung, Webhook |
| `resubmitVacationRequest` | E2E (aus beanstandet) | aus zurückgezogen, fremder Antrag, falscher Status, **Resturlaub (F2)**, Historien-Snapshot |
| `withdrawVacationRequest` | E2E (aus eingereicht) | aus beanstandet, fremder Antrag, genehmigt → Fehler |
| `deleteVacationRequest` | E2E | fremder Antrag, Status ≠ zurückgezogen |
| `requestVacationCancellation` | E2E | fremder Antrag, Status ≠ genehmigt, Benachrichtigung |
| `submitWorkationRequest` | E2E (EU) | 20/30-Tage-Limit serverseitig, fehlende Erklärungen, Drittstaat/8 Wochen, Ende < Beginn |
| `resubmitWorkationRequest` | ✗ | Happy Path, fremd, Status, Limits |
| `withdrawWorkationRequest` | ✗ | Happy Path, fremd, Status |
| `deleteWorkationRequest` | ✗ | Happy Path, fremd, Status |
| `updateWorkationAdminFields` | ✗ | A1-Status EU/Nicht-EU, ungültiger A1-Wert, Vertretung abgelehnt, MA abgelehnt |
| `submitExpenseReport` | E2E (minimal), IDOR-Lib-Test | fehlendes Payload, Rückkehr ≤ Abreise, Verpflegung/Pkw/Positionen, Beleg-Upload verschlüsselt, unzulässiger MIME-Typ, Größenlimit |
| `resubmitExpenseReport` | ✗ | Happy Path, eigene Belege übernehmen, **fremde Belege nicht**, Status |
| `withdrawExpenseReport` | ✗ | Happy Path, fremd, Status |
| `deleteExpenseReport` | ✗ | Happy Path inkl. Blob-Löschung, fremd, Status |
| `submitCommissionClaim` | E2E (Schulung) | Beratung mit Betrag, ungültiger Betrag, Neukunde, abweichendes Format |
| `resubmitCommissionClaim` | ✗ | Happy Path, fremd, Status |
| `withdrawCommissionClaim` | ✗ | Happy Path, fremd, Status |
| `deleteCommissionClaim` | ✗ | Happy Path, fremd, Status |
| `updateCommissionAdminFields` | ✗ | Override vs. berechnet, Vermittlungsprovision, ungültiger Betrag, Vertretung/MA abgelehnt |
| `submitSickLeave` | E2E | mit Ende, „Kind krank“, Validierung, Mail nur an Admin (nicht Vertretung) |
| `closeSickLeave` | E2E | **bereits abgeschlossen (F3)**, Ende < Beginn, leer, fremd, Admin schließt fremde |
| `correctSickLeave` | ✗ | Happy Path, MA abgelehnt, **Ende < Beginn (F4)** |
| `approveAction` | E2E alle Typen | MA ohne Vertretung abgelehnt, abgelaufene Vertretung, eigener Antrag, Provision ohne Endbetrag, Storno bestätigen |
| `rejectAction` | E2E (nur Urlaub) | Workation/Reisekosten/Provision, Storno ablehnen → genehmigt, leerer Kommentar, eigener Antrag, nicht offen |

#### Einstellungen (11)

| Action | heute | neu |
|---|---|---|
| `updateQuotas` | E2E (nur Jahresurlaub) | alle Felder, leer/negativ (Verhalten festlegen) |
| `updateRates` | ✗ | Happy Path, Komma-Beträge, negativ/NaN |
| `updateCommissionRates` | ✗ | Prozent < 0 / > 100 / NaN, Beträge |
| `updateRetention` | ✗ | Happy Path, 0/negativ/ungültig |
| `setDeputy` | E2E (ohne Zeitraum) | mit Zeitraum, Ablösung bestehender Vertretung, unbekannte/deaktivierte Person, sich selbst, Ende < Beginn |
| `clearDeputy` | E2E | MA abgelehnt |
| `addWebhook` | ✗ | Happy Path, ungültige Kategorie/Ereignis, Secret < 16, unsichere URL inkl. IPv6 |
| `toggleWebhook` | ✗ | an/aus, nicht gefunden |
| `deleteWebhook` | ✗ | Happy Path, nicht gefunden |
| `createApiKey` | E2E (readonly) | Umfang `full`/`website`, ungültiger Umfang → readonly, leerer Name, nur Hash gespeichert |
| `revokeApiKey` | E2E | doppelter Widerruf, MA abgelehnt |

#### Mitarbeitende (9)

| Action | heute | neu |
|---|---|---|
| `inviteUser` | E2E (Erfolg, fremde Domain) | doppelte E-Mail, Zod-Fehler (Resturlaub, Geburtsdatum in Zukunft, Jahresurlaub < 0,5), mit Dokumenten, Clerk-Fehler-Fallback, Einladungsmail |
| `resendInvitation` | ✗ | Happy Path, Status ≠ eingeladen, nicht gefunden |
| `updateUserVacation` | ✗ | Happy Path, negativ, ungültiger Übertrag, unbekannter User |
| `updateUserEntry` | ✗ | Happy Path, Format, Resturlaub Pflicht bei Eintritt, Leeren |
| `updateUserBirthday` | ✗ | Happy Path, Zukunft, Leeren |
| `updateUserSupervisors` | ✗ | Happy Path, sich selbst, unbekannt, Geschäftsführung leert Zuordnung |
| `setUserStatus` | E2E | Selbstdeaktivierung, Clerk ban/unban (Mock), Clerk-Fehler, nicht gefunden |
| `uploadEmployeeDocuments` | ✗ | Happy Path (Blob enthält nur Ciphertext), Typ, > 10 MB, Kategorie, mehrere Dateien, User fehlt |
| `deleteEmployeeDocument` | ✗ | Happy Path, nicht gefunden |

#### Inhalte (16)

Für jede der vier Entitäten (Hilfreiche Links, Neuigkeiten, Teamevents,
Sales-Nachrichten) je `create`/`update`/`toggle`/`delete`:

| Entität | heute | neu |
|---|---|---|
| Hilfreiche Links | E2E: anlegen, ausblenden | bearbeiten, einblenden, löschen, ungültige URL/Reihenfolge über Action, unbekannte ID |
| Neuigkeiten | E2E: anlegen, ausblenden | bearbeiten, einblenden, löschen, leere Felder, unbekannte ID |
| Teamevents | ✗ | alle vier Actions, Ende < Beginn |
| Sales-Nachrichten | E2E: anlegen, ausblenden | bearbeiten, einblenden, löschen, unbekannte Person, Volumen-Fehler |
| `dismissSalesNews` (Dashboard) | E2E | unbekannte Meldung, doppeltes Schließen, betrifft nur eigenen User |

#### IT-Management (13) – heute komplett ✗

| Action | neu |
|---|---|
| `createEquipment` | Happy Path, Person/Art fehlt, doppelte Geräte-ID |
| `updateEquipment` | Happy Path, Duplikat (eigene ID erlaubt), Neuzuordnung |
| `markEquipmentReturned` | Happy Path, leeres Datum, Rückgabe vor Übernahme |
| `undoEquipmentReturn` | Happy Path |
| `deleteEquipment` | Happy Path, Audit |
| `uploadHandoverProtocol` | Upload, Ersetzen (Audit „ersetzt“), unbekannte Art/Person, 0 oder 2 Dateien, Typ/Größe |
| `deleteHandoverProtocol` | Happy Path, nicht gefunden |
| `analyzeEquipmentImport` | keine Datei, falsche Endung, > 1 MB, Vorschau korrekt |
| `applyEquipmentImport` | anlegen/ändern/umbenennen/**löschen fehlender Geräte**, alles-oder-nichts bei Fehler, Audit |
| `createEquipmentType` | Happy Path, doppelter Name |
| `updateEquipmentType` | Happy Path, Duplikat |
| `toggleEquipmentType` | an/aus |
| `deleteEquipmentType` | unbenutzt löschbar, **verwendet → Fehler** |

#### Faktura (17)

| Action | heute | neu |
|---|---|---|
| `createEntryAction` | E2E + Lib | Action-Ebene: Rollen, Warnung > 10 h, Maximum 24 h, Projektlaufzeit, inaktiver Kunde |
| `updateEntryAction` | E2E + Lib | Warnungen beim Bearbeiten, Projekt-/Datumswechsel (alter Kunde „veraltet“) |
| `deleteEntryAction` | Lib | Action-Ebene, fremde Buchung, freigegebene Woche |
| `generateTimesheetAction` | E2E + Lib | keine sichtbaren Buchungen, ungültiger Zeitraum, Nummernfolge |
| `approveWeekAction` | E2E + Lib | MA abgelehnt, laufende/leere Woche |
| `revokeWeekAction` | Lib | Action-Ebene, ohne Begründung, nicht freigegeben, Stundenzettel „veraltet“ |
| `adminCreateEntryAction` | E2E + Lib | Wochenende/Zukunft, freigegebene Woche ohne Begründung, unbekannter MA, Benachrichtigung |
| `adminUpdateEntryAction` | E2E + Lib | Zweig `admin_geaendert` (offene Buchung) |
| `adminDeleteEntryAction` | Lib (mit Begründung) | ohne Begründung bei freigegebener Buchung |
| `setEntryVisibilityAction` | E2E (aus) | einblenden, unveränderter Zustand |
| `getEntryHistoryAction` | E2E | Integration: Reihenfolge, MA abgelehnt |
| `createCustomerAction` | E2E + Lib | Duplikat |
| `updateCustomerAction` | ✗ | Happy Path, Duplikat, nicht gefunden |
| `toggleCustomerActiveAction` | ✗ | an/aus, inaktiver Kunde blockiert Buchung |
| `createProjectAction` | E2E + Lib | Laufzeit, Limit mit Komma / 0,25-h-Raster, Duplikat |
| `updateProjectAction` | ✗ | Happy Path, Validierung |
| `toggleProjectActiveAction` | Lib (nur aus) | aktivieren |

#### Berichte (5)

| Action | heute | neu |
|---|---|---|
| `submitSeminarReport` | E2E + Lib | fehlendes/ungültiges Payload, Zod-Fehler, Redirect |
| `updateSeminarReportAction` | E2E (eigener) + Lib | Admin korrigiert fremden Bericht, fremde MA abgelehnt |
| `deleteSeminarReportAction` | Lib | Action-Ebene, fremd (auch Admin) abgelehnt, Fehlerbehandlung (F7) |
| `updateQuoteTextAction` | Lib | Action-Ebene, MA abgelehnt, leer/zu lang |
| `toggleQuoteWebsiteApproval` | E2E (freigeben) + Lib | zurückziehen, MA abgelehnt, unbekanntes Zitat |

### 5.2 API-Routen und MCP (Integration)

| Route | heute getestet | neu |
|---|---|---|
| `GET /api/v1/requests` | 401 (alle Varianten), 403 Website, 429, 200, Filter | 401 Ersteller ohne Admin-Rolle, 200 readonly, Statusabbildung, Reisekosten mit Positionen |
| `GET /api/v1/requests/[id]` | 200 Urlaub, 404, 403 Website | 401, Reisekosten-Zweig, nicht-leere Historie |
| `POST …/[id]/approve` | 200, 403, 400 (Vier-Augen, nicht offen, Provision), 404 | 401, Storno per API, Workation/Reisekosten |
| `POST …/[id]/reject` | 200, Storno, 400 leerer Kommentar | **401, 403 readonly/Website, 404**, ungültiges JSON, 400 eigener Antrag/nicht offen |
| `GET /api/v1/absences` | 200, Krankheitsart nur full, 401, 403 | 429, `storno_beantragt` enthalten |
| `GET /api/v1/faktura/freigaben` | 401, Liste, Detail, 400, 403 | 200 readonly, Status „leer“/„widerrufen“ |
| `POST /api/v1/faktura/freigaben/freigeben` | 200, 409, 400 JSON, 403 Website | 401, 403 readonly, 400 jahr/kw, 409 leer/bereits freigegeben |
| `GET/OPTIONS /api/v1/website/zitate` | umfassend | 429, CORS bei 401 |
| `GET /api/cron/webhooks` | umfassend | Backoff nach 1./2. Fehlversuch |
| `GET /api/receipts/[id]` | signierte URL (200/403/404) | **Session-Pfad**: Eigentümer, Admin, Vertretung bei offenem/abgeschlossenem Bericht, fremde MA, ohne Session; 502; 500; Audit |
| `GET /api/dokumente/[id]` | ✗ | Eigentümer, Admin, fremde MA 403, ohne Session, 404, 502, 500, Audit, F6 |
| `GET /api/it-dokumente/[id]` | ✗ | Admin, MA 403, 404, 502, 500, Audit, F6 |
| `GET /api/exports/expenses` | ✗ | 403, 400 Monat, CSV-Inhalt, PDF, Monatsgrenze über Rückkehrdatum |
| `GET /api/exports/it-ausstattung` | ✗ | 403, 200 CSV, Audit |
| `GET /api/exports/it-protokoll` | ✗ | 403, 400 Art, 404 Person, 400 ohne Geräte, Übergabe nur Geräte im Einsatz, Audit |
| `GET /api/exports/faktura` | 403, 200 | 400 Parameter, **404 unbekannter Kunde (F5)** |
| `GET /api/exports/berichte-zitate` | 403 | 200 Admin, CSV-Inhalt, Audit |
| `GET /api/faktura/stundenzettel/[id]` | 200 Admin, 403 MA | 403 ohne Session, 404, 502 |
| `GET /workation/[id]/pdf` | 200 Eigentümer | 401, 404 fremd/unbekannt (IDOR), 400 nicht genehmigt, 200 Admin |
| `GET/POST/DELETE /mcp` | ✗ | 401 ohne Token, 200 mit gültigem Token |
| `/.well-known/oauth-*` (2 Routen) | ✗ | 200, Inhalt, OPTIONS |

**MCP-Tools** (alle ✗, Test über Fake-Server mit gemocktem `resolveUserFromMcpAuth`):

- [ ] `get_my_profile`
- [ ] `list_my_requests`
- [ ] `get_my_request` (inkl. fremder Antrag → nicht gefunden)
- [ ] `create_vacation_request`
- [ ] `create_workation_request`
- [ ] `create_expense_report`
- [ ] `create_commission_claim`
- [ ] `create_sick_leave`
- [ ] `withdraw_my_request`
- [ ] `resubmit_my_request`
- [ ] `close_my_sick_leave`
- [ ] `resolveUserFromMcpAuth`: kein Token, unbekannt, deaktiviert, vor Eintritt
- [ ] Fehlerabbildung `withUser`/`errorResult`

### 5.3 Lib-Funktionen (Unit/Integration)

- [ ] `expenses/export.tsx`: `receiptReimbursementCents`, `buildExpensesCsv` (getrennter Ausweis Pauschale/Zuschlag/Belege), `buildExpensesPdf` (Inhalt via `pdf-parse`)
- [ ] `document-crypto.ts`: Hin-/Rückweg, falscher Schlüssel, falsche Key-Version, fehlender/zu kurzer Schlüssel, manipulierter Tag, zu kurzes Payload
- [ ] `user-error.ts` `runAction`: `UserError`, `ZodError`, generischer Fehler
- [ ] `webhooks.ts`: IPv6/IPv4-mapped (F1), `dispatchWebhookEvent` mit aktiver Config (sofortige Zustellung), `attemptDelivery` Backoff/Netzwerkfehler/fehlende Config/bereits erfolgreich
- [ ] `mail.ts`: Brevo-Pfad (gemocktes `fetch`), Fehlerantwort, HTML-Escaping, Produktion ohne Key
- [ ] `notifications.ts` (7 Funktionen): Empfänger (Admin + aktive Vertretung, nicht bei Krankmeldung, inaktive Admins nicht), Betreff/Inhalt, Einladung vor Eintritt
- [ ] `auth.ts`: `resolveAccess` (unverifizierte E-Mail, fremde Domain, ohne Einladung, deaktiviert, vor Eintritt, Erst-Verknüpfung), `getActiveDeputy` Zeitfenster, `isApprover`, `requireApprover`, `requireAdmin`
- [ ] `absences.ts` `getCalendarAbsences`: Krank → „abwesend“ für Nicht-Admins (Datenschutz), Geburtstag 29.02., Teamevents, offene Krankmeldung
- [ ] `retention.ts`: Stichtage je Kategorie
- [ ] `settings.ts`: Anlage bei fehlender Zeile, Rate-Mapper
- [ ] `history.ts`: Snapshot-Versionierung, `getHistory`
- [ ] `requests/query.ts`: `getMyProfile`, `listMyRequests`, `getMyRequest` (Eigentümerprüfung)
- [ ] `requests/sick-leave.ts` `closeSickLeaveForUser`
- [ ] `faktura/stammdaten.ts`: `updateCustomer`, `setCustomerActive`, `updateProject`, `projectInputSchema`
- [ ] `faktura/buchungen.ts`: Regeln aus `validateEntry` (> 10 h, 24 h, Laufzeit, inaktiver Kunde), Race-Fälle bei Update/Delete
- [ ] `faktura/freigabe.ts`: `revokeWeekApproval` Fehler, `listRecentWeeks` Status, `getWeekOverview` mehrere Kunden
- [ ] `faktura/export.ts`: `buildFakturaCsv` Escaping, Kennzeichnung „soft-delete“
- [ ] `faktura/stundenzettel*.ts`: Fehlerpfade `generateTimesheet`, mehrseitiges PDF
- [ ] `seminar-reports-store.ts`: `listCustomerSuggestions`, `listMySeminarReports`, `listQuotesForAdmin`, `setQuoteWebsiteApproved` nicht gefunden
- [ ] `it-equipment-store.ts`: `getImportContext`, `getEquipmentExportRows`
- [ ] `workation/pdf.tsx`: Inhalt des Genehmigungs-PDFs
- [ ] Neu herausgezogen und getestet: Organigramm-Layout (Zyklen, „Ohne Zuordnung“), Kalender-Parameter (Fallback, Jahreswechsel), Zähler offener Freigaben (F8)

### 5.4 Komponententests

- [ ] `vacation-form`: Tage-Vorschau, Halbtags-Checkboxen, Überschneidungshinweis, Submit disabled bei 0 Tagen
- [ ] `workation-form`: Drittstaat-Badge, manuelle Arbeitstage, Warnungen/Fehler, Submit nur mit allen 7 Erklärungen
- [ ] `expense-form`: „Zeilen aus Reisezeitraum erzeugen“, Mahlzeiten-Kürzung live, „Position hinzufügen“/„Entfernen“ in allen drei Belegblöcken, Pkw-Summe, Auslandshinweis, Belegs-Größenmeldung, Submit-Payload
- [ ] `commission-form`: Felder je Art (Schulung/Beratung), Neukunden-Hinweis, Vorschau, disabled ohne Format
- [ ] `bericht-form`: Zitat hinzufügen bis 20 (danach disabled), entfernen, Frage Pflicht sobald Zitat, Feedback Pflicht
- [ ] `approval-buttons`: „Beanstandung senden“ disabled ohne Text, Storno-Beschriftungen, Vier-Augen-Hinweis
- [ ] `delete-request-button`: „Abbrechen“ ruft keine Action, Bestätigung schon
- [ ] `faktura/zeiterfassung`: Warnung → „Trotzdem buchen“ (neu und bearbeiten), Löschen mit `confirm()` abgebrochen/bestätigt
- [ ] `faktura/freigabe-admin`: Löschen mit `prompt()` (Abbruch, leere Pflichtbegründung), Widerrufen-Dialog, Verhalten bei Fehler (F9)
- [ ] `faktura/export-admin`: Moduswechsel Monat/Woche/frei, disabled-Logik, CSV-URL
- [ ] `faktura/kunden-admin`: Speichern/Aktiv-Toggle je Kunde und Projekt
- [ ] `berichte/zitate-admin`: Tabs, Website-Schalter, Bearbeiten, Kopieren (Clipboard-Mock)
- [ ] `berichte/berichte-filter`: Parameter-Aufbau, Zurücksetzen
- [ ] `settings-panels`: Key kopieren, Vertretung aktivieren/entziehen, Webhook-Aktionen
- [ ] `admin-ui`: `FormDialog`, `PanelDialog`, `DeleteDialog`, `ConfirmDialog`, `VisibilityToggle` generisch
- [ ] `user-admin`: Tab-Filter, „Geschäftsführung“ blendet Vorgesetzte aus, Upload-Felder
- [ ] `content-admin`: Dialoge je Reiter
- [ ] `it-equipment-admin`: ID-Vorschlag, „Import jetzt anwenden“ erst nach Prüfung, Vorlagen-Buttons disabled
- [ ] `sidebar`: Mobilmenü öffnen/schließen, Link schließt Menü, aktiver Link, Badge
- [ ] `copy-mcp-url-button`, `dashboard-sales-news` (Schließen, Fehler-Toast)

### 5.5 E2E – Buttons je Seite

Nur die heute fehlenden Interaktionen. Jede Zeile wird geklickt und ihre
Wirkung geprüft.

**Navigation und Zugang** (neu: `navigation.spec.ts`, `zugang.spec.ts`)
- [ ] Sidebar: alle 16 Links per Klick (Admin, MA, aktive Vertretung), aktiver Zustand, Badge-Zahl „Freigaben“
- [ ] „Abmelden“ in der Sidebar und im Sperrbildschirm
- [ ] Mobilmenü öffnen/schließen (Projekt „Mobile“)
- [ ] Sperrbildschirme „Kein Zugang“ (deaktiviert) und „noch nicht freigeschaltet“ (vor Eintritt)
- [ ] Direktaufruf aller Admin-Seiten als MA: `/einstellungen`, `/mitarbeitende`, `/it-management`, `/inhalte`, `/faktura/*`, `/berichte/zitate`
- [ ] Startseite leitet Angemeldete auf `/dashboard`
- [ ] Header-Buttons: „Urlaub beantragen“, „Workation beantragen“, „Abrechnung erstellen“, „Anspruch einreichen“, „Krank melden“, „Bericht erfassen“
- [ ] „Details“-Links in allen Listen

**Dashboard** (neu: `dashboard.spec.ts`)
- [ ] Werte der Karten Resturlaub und Workation-Kontingent
- [ ] Schnellzugriff (5 Links), „Zum Kalender“, Briefing-Text
- [ ] Karte „Offene Freigaben“ mit Links (Admin), „Meine letzten Anträge“
- [ ] Hilfreicher Link öffnet extern (`target=_blank`), Leerzustände

**Kalender, Organigramm, Dokumente, Konto** (neu)
- [ ] Monats-/Jahresansicht, vor/zurück inkl. Jahreswechsel, Legende je Rolle, Krankheit für MA als „abwesend“
- [ ] Organigramm zeigt Hierarchie, eigener Knoten hervorgehoben
- [ ] Dokument herunterladen (eigenes), Leerzustand
- [ ] „URL kopieren“ (Clipboard-Inhalt prüfen)

**Urlaub** (erweitern)
- [ ] Halbtags-Checkboxen, Vertretung per Select, Bemerkung
- [ ] Zurückziehen aus „beanstandet“, Korrigieren aus „zurückgezogen“
- [ ] Überschneidungshinweis
- [ ] „Abbrechen“ im Löschdialog

**Workation** (erweitern)
- [ ] Drittstaat (8-Wochen-Hinweis), manuelle Arbeitstage, Visum „gültig bis“
- [ ] Zurückziehen, Korrigieren, Löschen
- [ ] Button „Genehmigungs-PDF herunterladen“ klicken

**Reisekosten** (erweitern)
- [ ] Zeilen erzeugen, Mahlzeiten ankreuzen, Abwesenheit wählen
- [ ] Position hinzufügen/entfernen in allen drei Blöcken, Pkw-km und Mitnahme, Auslands-Checkbox
- [ ] Beleg-Upload (leeren Spec füllen; Blob-Token in CI-Secrets oder Blob-Fake)
- [ ] Beleg-Link in den Details öffnen
- [ ] Zurückziehen, Korrigieren, Löschen

**Provision** (erweitern)
- [ ] Beratung mit Nettoauftragswert, Neukunde, Einheit, Anzahl Trainings, Bemerkung
- [ ] Zurückziehen, Korrigieren, Löschen
- [ ] Admin pflegt „Finaler Provisionsbetrag“/„Vermittlungsprovision“ → „Beträge speichern“ → Genehmigen

**Krankmeldung** (erweitern)
- [ ] mit „Voraussichtliches Ende“, Typ „Kind krank“
- [ ] Admin: „Korrektur speichern“

**Freigaben** (erweitern)
- [ ] Beanstanden für Workation, Reisekosten, Provision
- [ ] „Storno ablehnen“
- [ ] Workation-Adminfelder → „Felder speichern“ (Vertretung sieht sie nicht)

**Einstellungen** (neu: `einstellungen.spec.ts`)
- [ ] Reisekosten-Sätze, Provisionssätze, Aufbewahrungsfristen speichern
- [ ] Kontingente: Workation-Felder
- [ ] Vertretung mit Zeitraum
- [ ] Webhook hinzufügen, deaktivieren, aktivieren, löschen
- [ ] API-Key mit Umfang „Lesen + Freigeben“ und „Website“, „Kopieren“
- [ ] Reisekosten-Export „CSV herunterladen“ und „PDF herunterladen“

**Mitarbeitende** (erweitern)
- [ ] Tabs Aktiv/Eingeladen/Deaktiviert
- [ ] Bearbeiten: Urlaubskonto, Eintritt, Geburtsdatum, Vorgesetzte, „Geschäftsführung“, „Schließen“
- [ ] Dokumente: hochladen, herunterladen, löschen
- [ ] „Einladung erneut senden“, Einladung mit Dokument, „Abbrechen“

**Inhalte** (erweitern)
- [ ] Teamevents: anlegen, bearbeiten, aus-/einblenden, löschen
- [ ] In allen Reitern: Bearbeiten, Einblenden, Löschen

**IT-Management** (neu: `it-management.spec.ts`)
- [ ] Alle 5 Reiter
- [ ] Ausstattung erfassen (ID-Vorschlag), bearbeiten, Rückgabe erfassen/zurücknehmen, löschen
- [ ] Arten anlegen, bearbeiten, aus-/einblenden, löschen (verwendet → gesperrt)
- [ ] Protokolle hochladen, ersetzen, herunterladen, löschen (Übergabe und Rücknahme)
- [ ] Vorlagen-PDF „Übergabe“/„Rücknahme“ (inkl. disabled-Zustände)
- [ ] „Liste als CSV herunterladen“, „Datei prüfen“, „Import jetzt anwenden“

**Faktura** (erweitern)
- [ ] „← Vorwoche“, „Folgewoche →“, „Aktuelle Woche“, FakturaNav, WeekNav
- [ ] MA: „Löschen“ (Dialog bestätigen/abbrechen), „Trotzdem buchen“ beim Bearbeiten
- [ ] Kunde/Projekt bearbeiten, „Inaktiv setzen“/„Aktivieren“, Projektlaufzeit
- [ ] „Freigabe widerrufen“ → „Widerrufen“
- [ ] Admin „Löschen“ (Begründung), „Einblenden“
- [ ] Export: Modi Monat und „Freier Zeitraum“, „Rohdaten-Export (CSV)“ klicken, „PDF herunterladen“ klicken

**Berichte** (erweitern)
- [ ] BerichteNav, „Details“
- [ ] Filter Art und Zeitraum, „Zurücksetzen“, Sortierung „Mitarbeiter/in“
- [ ] Zitat entfernen, Limit 20
- [ ] Bericht löschen (bestätigen/abbrechen), Admin korrigiert fremden Bericht
- [ ] Zitate: Tabs, Wortlaut bearbeiten, kopieren, Freigabe zurückziehen, „Freigegebene als CSV“ als Admin

---

## 6. Empfohlene Reihenfolge

1. Phase 0 (ohne Fundament keine Action-Tests)
2. Phase 1 (Fehler)
3. Phase 2 und 3 mit Priorität auf: Downloads/Dokumente, Rollenprüfungen
   aller Actions, IDOR auf allen Detailseiten, Reisekosten-Export, IT-Import,
   MCP
4. Phase 6 (E2E-Buttons) parallel zu Phase 5 (Komponenten)
5. Phase 4 (restliche Lib-Lücken)
6. Phase 7 (Matrix und CI-Schwellen) – danach bleibt die Abdeckung stabil

## 7. Offene Entscheidungen

1. **Test-DB**: lokaler Postgres + Neon-HTTP-Proxy einführen (empfohlen)
   oder weiter nur Neon-Test-Branch?
2. **Zugangsdaten für E2E** in dieser Cloud-Umgebung (Clerk-Dev-Keys,
   optional Blob-Token) – sonst laufen E2E-Tests nur in CI.
3. **Komponententests** mit Testing Library + happy-dom einführen (neue
   devDependencies)?
4. **Fehler F1–F10** im Zuge der Tests beheben oder getrennt?
5. **Fachliches Soll** für die Punkte unter „Fragliches Verhalten“ in
   Abschnitt 2.
