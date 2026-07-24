import { expect, test, type Locator, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { fakturaCustomers } from "../../src/db/schema";
import { testDb } from "../helpers/db";
import { ADMIN_STATE, USER_NAME, USER_STATE, pageAs } from "./helpers";

// Klassisches pdf-parse (1.x) — Text- und Seitenzahl-Extraktion für PDFs
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse/lib/pdf-parse.js") as (
  buffer: Buffer
) => Promise<{ text: string; numpages: number }>;

/**
 * Der Jetzt-Zeitpunkt ist über FAKTURA_TEST_NOW fixiert:
 * Freitag, 24.07.2026, 12:00 Europe/Berlin → laufende Woche KW 30/2026
 * (Mo 20.07.–Fr 24.07.); KW 29 (13.–17.07.) ist abgeschlossen und freigebbar.
 */
const KUNDE = "E2E Kunde GmbH";
const PROJEKT = `${KUNDE} – Webseite`;
const LIMIT_PROJEKT = `${KUNDE} – Support`;

/**
 * Klickt einen Dialog-Trigger, bis der Dialog sichtbar ist — direkt nach
 * einer Navigation kann der erste Klick sonst vor der React-Hydration landen.
 */
async function openDialog(trigger: Locator, dialogMarker: Locator) {
  await expect(async () => {
    await trigger.click();
    await expect(dialogMarker).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

/** Öffnet ein Select (mit Hydration-Retry) und wählt eine Option. */
async function selectOption(
  page: Page,
  triggerText: string,
  optionName: string
) {
  await expect(async () => {
    await page.getByText(triggerText, { exact: true }).click();
    await expect(
      page.getByRole("option", { name: optionName }).first()
    ).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await page.getByRole("option", { name: optionName }).first().click();
}

async function bookEntry(
  page: Page,
  opts: {
    project: string;
    date?: string;
    hours: string;
    description: string;
  }
) {
  await page.goto("/faktura");
  await openDialog(
    page.getByTestId("neue-buchung"),
    page.getByText("Neue Zeitbuchung")
  );
  await page.getByText("Projekt wählen").click();
  await page.getByRole("option", { name: opts.project }).click();
  if (opts.date) await page.locator("#entry-date").fill(opts.date);
  await page.locator("#entry-duration").fill(opts.hours);
  await page.locator("#entry-description").fill(opts.description);
  await page.getByRole("button", { name: "Buchung speichern" }).click();
}

async function downloadPdf(
  page: Page,
  row: Locator
): Promise<{ text: string; numpages: number; raw: Buffer }> {
  // Der Download ist ein als <a> gerenderter Button (role="button")
  const href = await row
    .getByRole("button", { name: "PDF herunterladen" })
    .getAttribute("href");
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/pdf");
  const raw = await res.body();
  const parsed = await pdfParse(raw);
  return { ...parsed, raw };
}

test.describe("Faktura — projektbezogene Zeiterfassung", () => {
  test("Admin legt Kunde und Projekte an (inkl. Monatslimit)", async ({
    browser,
  }) => {
    const admin = await pageAs(browser, ADMIN_STATE);
    await admin.goto("/faktura/kunden");

    // Kunde mit Anschrift und Ansprechpartnerin (erscheint auf dem PDF)
    await admin.locator("#new-customer-name").fill(KUNDE);
    await admin.locator("#new-customer-address").fill("Musterweg 12, 50823 Köln");
    await admin.locator("#new-customer-contact").fill("Petra Muster");
    await admin.getByRole("button", { name: "Kunde anlegen" }).click();
    await expect(admin.getByText("Kunde angelegt.")).toBeVisible();

    // Projekt ohne Limit
    const card = admin.locator('[data-slot="card"]', { hasText: KUNDE }).first();
    await card.getByLabel("Neues Projekt").fill("Webseite");
    await card.getByRole("button", { name: "Projekt anlegen" }).click();
    await expect(admin.getByText("Projekt angelegt.").first()).toBeVisible();
    // Warten, bis der Router-Refresh das Projekt zeigt UND React das
    // Formular zurückgesetzt hat — sonst löscht der verzögerte Form-Reset
    // die frisch eingetippten Werte des zweiten Projekts wieder.
    await expect(card.getByText("Monat: 0,00 h · kein Limit")).toBeVisible();
    await expect(card.getByLabel("Neues Projekt")).toHaveValue("");

    // Projekt mit Monatslimit 1 h — für die Limit-Warnung
    await card.getByLabel("Neues Projekt").fill("Support");
    await card.getByLabel("Monatslimit (h, optional)").fill("1");
    await card.getByRole("button", { name: "Projekt anlegen" }).click();
    await expect(admin.getByText("Monat: 0,00 / 1,00 h")).toBeVisible();
  });

  test("Freitags-Erinnerung erscheint und verschwindet mit der ersten Buchung", async ({
    browser,
  }) => {
    const employee = await pageAs(browser, USER_STATE);

    // Heute ist (fixiert) Freitag und es existiert noch keine Buchung
    await employee.goto("/dashboard");
    await expect(employee.getByTestId("freitags-erinnerung")).toBeVisible();

    await employee.getByRole("link", { name: "Jetzt Zeiten buchen" }).click();
    await expect(employee).toHaveURL(/\/faktura$/);
    await openDialog(
      employee.getByTestId("neue-buchung"),
      employee.getByText("Neue Zeitbuchung")
    );
    await employee.getByText("Projekt wählen").click();
    await employee.getByRole("option", { name: PROJEKT }).click();
    await employee.locator("#entry-duration").fill("2");
    await employee
      .locator("#entry-description")
      .fill("Landingpage umgesetzt");
    await employee.getByRole("button", { name: "Buchung speichern" }).click();
    await expect(
      employee.getByText("Buchung gespeichert.").first()
    ).toBeVisible();
    await expect(employee.getByText("Landingpage umgesetzt")).toBeVisible();

    // Bearbeiten: Dauer 2 → 2,5 — Tagessumme folgt
    await openDialog(
      employee.getByRole("button", { name: "Bearbeiten" }),
      employee.getByText("Buchung bearbeiten")
    );
    await employee.locator("#entry-duration").fill("2,5");
    await employee
      .getByRole("button", { name: "Änderungen speichern" })
      .click();
    await expect(employee.getByText("Buchung aktualisiert.")).toBeVisible();
    await expect(
      employee.getByText("Tagessumme: 2,50 h")
    ).toBeVisible();

    // Erinnerung ist mit der ersten Buchung verschwunden
    await employee.goto("/dashboard");
    await expect(employee.getByTestId("freitags-erinnerung")).toHaveCount(0);
  });

  test("Buchungsfenster: Zukunft, Vorwoche und Wochenende werden serverseitig abgelehnt", async ({
    browser,
  }) => {
    const employee = await pageAs(browser, USER_STATE);
    const attempt = async (date: string) => {
      await bookEntry(employee, {
        project: PROJEKT,
        date,
        hours: "1",
        description: "Ungültiger Versuch",
      });
    };

    // Montag der Folgewoche → Zukunft
    await attempt("2026-07-27");
    await expect(
      employee.getByText("Buchungen in der Zukunft sind nicht möglich.")
    ).toBeVisible();

    // Mittwoch der Vorwoche (KW 29) → außerhalb der laufenden KW
    await attempt("2026-07-15");
    await expect(
      employee.getByText(/außerhalb der laufenden Kalenderwoche/)
    ).toBeVisible();

    // Sonntag → Wochenende mit Hinweis auf Werktag der Folgewoche
    await attempt("2026-07-19");
    await expect(
      employee.getByText(/Werktag der Folgewoche/)
    ).toBeVisible();

    // Nichts davon wurde gespeichert
    await employee.goto("/faktura");
    await expect(employee.getByText("Ungültiger Versuch")).toHaveCount(0);
  });

  test("Typsicheres Dauer-Feld: '2h' blockiert der Browser vor dem Absenden", async ({
    browser,
  }) => {
    const employee = await pageAs(browser, USER_STATE);
    await employee.goto("/faktura");
    await openDialog(
      employee.getByTestId("neue-buchung"),
      employee.getByText("Neue Zeitbuchung")
    );
    await employee.getByText("Projekt wählen").click();
    await employee.getByRole("option", { name: PROJEKT }).click();
    await employee.locator("#entry-duration").fill("2h");
    await employee.locator("#entry-description").fill("Pattern-Check");
    await employee.getByRole("button", { name: "Buchung speichern" }).click();

    // Constraint-Validierung greift: Feld invalid, kein Request, kein Eintrag
    await expect(employee.locator("#entry-duration:invalid")).toHaveCount(1);
    await expect(employee.getByText("Buchung gespeichert.")).toHaveCount(0);
    await employee.goto("/faktura");
    await expect(employee.getByText("Pattern-Check")).toHaveCount(0);
  });

  test("Monatslimit: zweistufige Warnung mit Trotzdem-buchen und Überbuchungs-Markierung", async ({
    browser,
  }) => {
    const employee = await pageAs(browser, USER_STATE);

    // 1 h auf das Projekt mit Limit 1 h → Limit exakt erreicht → Warnung
    await bookEntry(employee, {
      project: LIMIT_PROJEKT,
      hours: "1",
      description: "Support-Ticket 1",
    });
    await expect(
      employee.getByText("Hinweis vor dem Speichern")
    ).toBeVisible();
    await expect(employee.getByText(/Monatslimit des Projekts erreicht/)).toBeVisible();

    // Zweite Stufe: Trotzdem buchen
    await employee.getByRole("button", { name: "Trotzdem buchen" }).click();
    await expect(
      employee.getByText("Buchung gespeichert.").first()
    ).toBeVisible();

    // Weitere 0,25 h → Limit überschritten → nach Bestätigung als Überbuchung markiert
    await bookEntry(employee, {
      project: LIMIT_PROJEKT,
      hours: "0,25",
      description: "Support-Ticket 2",
    });
    await expect(
      employee.getByText(/Monatslimit des Projekts überschritten/)
    ).toBeVisible();
    await employee.getByRole("button", { name: "Trotzdem buchen" }).click();
    await expect(
      employee.getByText("Buchung gespeichert.").first()
    ).toBeVisible();
    await expect(
      employee
        .locator("li", { hasText: "Support-Ticket 2" })
        .locator('[data-slot="badge"]', { hasText: "Überbuchung" })
    ).toBeVisible();
    await expect(
      employee
        .locator("li", { hasText: "Support-Ticket 1" })
        .locator('[data-slot="badge"]', { hasText: "Überbuchung" })
    ).toHaveCount(0);
  });

  test("RBAC: Mitarbeitende sehen weder Admin-Bereiche noch fremde Buchungen", async ({
    browser,
  }) => {
    const admin = await pageAs(browser, ADMIN_STATE);
    const employee = await pageAs(browser, USER_STATE);

    // Admin bucht eigene Zeit — für Max unsichtbar
    await bookEntry(admin, {
      project: PROJEKT,
      hours: "1",
      description: "Admin-Eigenbuchung",
    });
    await expect(admin.getByText("Buchung gespeichert.").first()).toBeVisible();

    await employee.goto("/faktura");
    await expect(employee.getByText("Admin-Eigenbuchung")).toHaveCount(0);
    // Keine Faktura-Unternavigation für Mitarbeitende
    await expect(
      employee.getByRole("link", { name: "Kunden & Projekte" })
    ).toHaveCount(0);

    // Direkter Aufruf der Admin-Seiten liefert keine Admin-Inhalte
    for (const [url, marker] of [
      ["/faktura/freigabe", "Wochenfreigabe"],
      ["/faktura/kunden", "Neuen Kunden anlegen"],
      ["/faktura/export", "Export je Kunde und Zeitraum"],
    ] as const) {
      await employee.goto(url);
      await expect(employee.getByText(marker)).toHaveCount(0);
    }

    // Admin-geschützte APIs lehnen Mitarbeitende ab
    const [customer] = await testDb()
      .select()
      .from(fakturaCustomers)
      .where(eq(fakturaCustomers.name, KUNDE));
    const csv = await employee.request.get(
      `/api/exports/faktura?kunde=${customer.id}&von=2026-07-01&bis=2026-07-31`
    );
    expect(csv.status()).toBe(403);
  });

  test("Admin-Flow: Nacherfassung, Freigabeübersicht, Freigabe, Korrektur mit Historie, Schreibschutz", async ({
    browser,
  }) => {
    const admin = await pageAs(browser, ADMIN_STATE);
    const employee = await pageAs(browser, USER_STATE);

    // Laufende KW 30: Überbuchung sichtbar, Freigabe gesperrt (nicht abgeschlossen)
    await admin.goto("/faktura/freigabe?jahr=2026&kw=30");
    await expect(admin.getByText("1 Überbuchung(en)").first()).toBeVisible();
    await expect(
      admin.getByText("Woche noch nicht abgeschlossen")
    ).toBeVisible();
    await expect(
      admin.getByRole("button", { name: "Woche freigeben" })
    ).toBeDisabled();

    // Nacherfassung zweier Buchungen in der abgeschlossenen KW 29 für Max
    await admin.goto("/faktura/freigabe?jahr=2026&kw=29");
    for (const [date, hours, description] of [
      ["2026-07-15", "3", "Nacherfassung KW 29"],
      ["2026-07-16", "2", "Review KW 29"],
    ] as const) {
      await openDialog(
        admin.getByRole("button", { name: "Buchung anlegen" }),
        admin.getByText("Buchung für Mitarbeiter/in anlegen")
      );
      await admin.getByText("Mitarbeiter/in wählen").click();
      await admin.getByRole("option", { name: USER_NAME }).click();
      await admin.getByText("Projekt wählen").click();
      await admin.getByRole("option", { name: PROJEKT }).click();
      await admin.locator("#admin-entry-date").fill(date);
      await admin.locator("#admin-entry-duration").fill(hours);
      await admin.locator("#admin-entry-description").fill(description);
      await admin.getByRole("button", { name: "Speichern" }).click();
      await expect(admin.getByText("Buchung angelegt.").first()).toBeVisible();
      await expect(admin.getByText(description)).toBeVisible();
    }

    // Freigabe der abgeschlossenen Woche
    await admin.getByRole("button", { name: "Woche freigeben" }).click();
    await expect(
      admin.getByText(
        "Woche freigegeben — alle Buchungen sind jetzt schreibgeschützt."
      )
    ).toBeVisible();
    await expect(
      admin.locator('[data-slot="badge"]', { hasText: /^freigegeben$/ }).first()
    ).toBeVisible();

    // Nachträgliche Korrektur (3 → 4 h) verlangt eine Pflichtbegründung
    await openDialog(
      admin
        .locator("li", { hasText: "Nacherfassung KW 29" })
        .getByRole("button", { name: "Bearbeiten" }),
      admin.getByText("Buchung anpassen")
    );
    await expect(
      admin.getByText("Begründung (Pflicht — Woche/Buchung bereits freigegeben)")
    ).toBeVisible();
    await admin.locator("#admin-entry-duration").fill("4");
    await admin
      .locator("#admin-entry-reason")
      .fill("Kundenabstimmung: Aufwand nachgemeldet");
    await admin.getByRole("button", { name: "Speichern" }).click();
    await expect(admin.getByText("Buchung angepasst.")).toBeVisible();

    // Audit-Historie der Buchung (FA-7.4)
    await openDialog(
      admin
        .locator("li", { hasText: "Nacherfassung KW 29" })
        .getByRole("button", { name: "Historie" }),
      admin.getByText("Historie der Buchung")
    );
    await expect(admin.getByText(/admin_korrigiert — Erika Admin/)).toBeVisible();
    await expect(admin.getByText(/admin_angelegt — Erika Admin/)).toBeVisible();
    await expect(
      admin.getByText(/Kundenabstimmung: Aufwand nachgemeldet/).first()
    ).toBeVisible();
    await admin.keyboard.press("Escape");

    // Mitarbeitersicht: Woche schreibgeschützt, keine Bearbeitung möglich
    await employee.goto("/faktura?jahr=2026&kw=29");
    await expect(
      employee.getByText("Woche freigegeben — Buchungen schreibgeschützt")
    ).toBeVisible();
    await expect(employee.getByText("Nacherfassung KW 29")).toBeVisible();
    await expect(
      employee.getByRole("button", { name: "Bearbeiten" })
    ).toHaveCount(0);
  });

  test("Stundenzettel: PDF-Inhalt, Entwurfs-Wasserzeichen, Ausblenden → Version n+1, CSV-Kennzeichnung", async ({
    browser,
  }) => {
    const admin = await pageAs(browser, ADMIN_STATE);
    const employee = await pageAs(browser, USER_STATE);

    // Finaler Stundenzettel für die freigegebene KW 29
    await admin.goto("/faktura/export");
    await selectOption(admin, "Kunde wählen", KUNDE);
    await selectOption(admin, "Kalendermonat (Standard)", "Kalenderwoche");
    await admin.locator("#export-week-year").fill("2026");
    await admin.locator("#export-week-no").fill("29");
    await admin
      .getByRole("button", { name: "Stundenzettel (PDF) erzeugen" })
      .click();
    await expect(
      admin.getByText(/Stundenzettel SZ-2026-\d{4} v1 erzeugt\./)
    ).toBeVisible();

    // PDF-Inhaltsprüfung Version 1 (4 h + 2 h = 6 h)
    await admin.reload();
    const v1 = await downloadPdf(
      admin,
      admin
        .getByRole("row")
        .filter({ hasText: "v1" })
        .filter({ hasText: "13.07.2026 – 19.07.2026" })
    );
    expect(v1.numpages).toBe(1);
    expect(v1.text).toContain("Stundenzettel");
    expect(v1.text).toContain(KUNDE);
    expect(v1.text).toContain("Musterweg 12, 50823 Köln");
    expect(v1.text).toContain("Petra Muster");
    expect(v1.text).toContain("Version 1");
    expect(v1.text).toContain("Nacherfassung KW 29");
    expect(v1.text).toContain("Review KW 29");
    expect(v1.text).toContain("Zwischensumme Webseite");
    expect(v1.text).toContain("Gesamtsumme über alle Projekte");
    expect(v1.text).toContain("6,00");
    expect(v1.text).toContain("Ort, Datum, Unterschrift Kunde");
    expect(v1.text).toContain("Unterschrift StefanAI Solutions GmbH");
    // Footer-Pflichtangaben (FA-6.5) und Seitennummerierung
    expect(v1.text).toContain("HRB 128408, Amtsgericht Köln");
    expect(v1.text).toContain("USt-IdNr. DE463775332");
    expect(v1.text).toContain("Seite 1 von 1");
    expect(v1.text).not.toContain("ENTWURF");
    // Logo ist als Bild-XObject eingebettet
    expect(v1.raw.toString("latin1")).toContain("/Image");

    // Mitarbeitende erhalten das PDF nicht (RBAC auf der Proxy-Route)
    const v1Row = admin.getByRole("row").filter({ hasText: /v1/ }).first();
    const href = await v1Row
      .getByRole("button", { name: "PDF herunterladen" })
      .getAttribute("href");
    expect((await employee.request.get(href!)).status()).toBe(403);

    // Juli enthält offene Buchungen (KW 30) → nur Entwurf mit Wasserzeichen
    // (nach dem Reload gilt wieder der Standard-Zeitraum Kalendermonat Juli)
    await selectOption(admin, "Kunde wählen", KUNDE);
    await admin
      .getByRole("button", { name: "Stundenzettel (PDF) erzeugen" })
      .click();
    await expect(
      admin.getByText(/Entwurf SZ-2026-\d{4} v1 erzeugt — Zeitraum enthält/)
    ).toBeVisible();
    await admin.reload();
    await expect(
      admin.locator('[data-slot="badge"]', { hasText: "Entwurf" })
    ).toBeVisible();
    const draft = await downloadPdf(
      admin,
      admin.getByRole("row").filter({ hasText: "01.07.2026 – 31.07.2026" })
    );
    // pdf-parse extrahiert den rotierten Wasserzeichen-Text mit
    // Zeilenumbrüchen/Artefakten — daher toleranter Regex-Vergleich
    expect(draft.text).toMatch(/ENTWURF[\s\S]{0,6}–[\s\S]{0,6}nicht[\s\S]{0,6}freigegeben/);

    // Ausblenden einer Buchung markiert den Stundenzettel als veraltet
    await admin.goto("/faktura/freigabe?jahr=2026&kw=29");
    await admin
      .locator("li", { hasText: "Review KW 29" })
      .getByRole("button", { name: "Ausblenden" })
      .click();
    await expect(
      admin.getByText("Buchung für den Stundenzettel ausgeblendet.")
    ).toBeVisible();

    await admin.goto("/faktura/export");
    await expect(
      admin.locator('[data-slot="badge"]', { hasText: "veraltet" }).first()
    ).toBeVisible();

    // Neuexport → Version 2 mit korrigierter Summe (nur noch 4 h)
    await selectOption(admin, "Kunde wählen", KUNDE);
    await selectOption(admin, "Kalendermonat (Standard)", "Kalenderwoche");
    await admin.locator("#export-week-year").fill("2026");
    await admin.locator("#export-week-no").fill("29");
    await admin
      .getByRole("button", { name: "Stundenzettel (PDF) erzeugen" })
      .click();
    await expect(
      admin.getByText(/Stundenzettel SZ-2026-\d{4} v2 erzeugt\./)
    ).toBeVisible();
    await admin.reload();
    const v2 = await downloadPdf(
      admin,
      admin.getByRole("row").filter({ hasText: "v2" })
    );
    expect(v2.text).toContain("Version 2");
    expect(v2.text).toContain("Nacherfassung KW 29");
    expect(v2.text).not.toContain("Review KW 29");
    expect(v2.text).toContain("4,00");

    // CSV enthält auch die ausgeblendete Buchung — klar gekennzeichnet
    const [customer] = await testDb()
      .select()
      .from(fakturaCustomers)
      .where(eq(fakturaCustomers.name, KUNDE));
    const csvRes = await admin.request.get(
      `/api/exports/faktura?kunde=${customer.id}&von=2026-07-13&bis=2026-07-19`
    );
    expect(csvRes.status()).toBe(200);
    const csv = (await csvRes.body()).toString("utf-8");
    expect(csv).toContain("Review KW 29");
    expect(csv).toContain("nein (ausgeblendet)");
    expect(csv).toContain("Nacherfassung KW 29");
    expect(csv).toContain('"freigegeben"');
  });

  test("Smoke-Regression: Bestandsmodule bleiben erreichbar", async ({
    browser,
  }) => {
    const employee = await pageAs(browser, USER_STATE);
    await employee.goto("/dashboard");
    await expect(
      employee.getByRole("link", { name: "Faktura" })
    ).toBeVisible();
    await employee.goto("/urlaub");
    await expect(employee.getByText(/Urlaub/).first()).toBeVisible();
    await employee.goto("/reisekosten");
    await expect(employee.getByText(/Reisekosten/).first()).toBeVisible();
  });
});
