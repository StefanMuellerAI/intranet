import { readFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import {
  apiKeys,
  deputyAssignments,
  expenseReports,
  settings,
  users,
  webhookConfigs,
} from "../../src/db/schema";
import { E2E_USER_EMAIL, testDb } from "../helpers/db";
import { ADMIN_STATE, USER_NAME, expectToast, pageAs } from "./helpers";

// Klassisches pdf-parse (1.x) — Text-Extraktion für die Export-PDFs
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse/lib/pdf-parse.js") as (
  buffer: Buffer
) => Promise<{ text: string; numpages: number }>;

/**
 * Einstellungen (/einstellungen): Sätze, Kontingente, Fristen, Vertretung,
 * Webhooks, API-Keys und Reisekosten-Export. Alle Tests teilen sich die
 * Settings-Zeile mit den übrigen Specs — geänderte Werte werden deshalb
 * über die Oberfläche zurückgesetzt und zusätzlich im finally-Block direkt
 * in der Datenbank wiederhergestellt.
 */

/** Eurobetrag aus Cent wie im Formular (Komma, zwei Nachkommastellen). */
const euro = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

async function readSettings() {
  const [row] = await testDb()
    .select()
    .from(settings)
    .where(eq(settings.id, 1));
  return row;
}

/**
 * Wartet, bis React das Element hydriert hat — erst dann hängen die
 * Event-Handler. Klicks davor landen bei Client-Formularen ins Leere.
 */
async function waitForHydration(locator: Locator): Promise<void> {
  await expect
    .poll(
      () =>
        locator.evaluate(
          (el) => Object.keys(el).some((key) => key.startsWith("__reactProps$")),
          undefined,
          { timeout: 2_000 }
        ),
      { timeout: 20_000 }
    )
    .toBe(true);
}

/** Formular der Einstellungen-Seite, das das Feld mit dieser ID enthält. */
function formWith(page: Page, fieldId: string): Locator {
  return page.locator("form", { has: page.locator(`#${fieldId}`) });
}

test.describe("Einstellungen", () => {
  // Mehrschrittige Abläufe gegen `next dev` (Kompilieren beim ersten Aufruf)
  test.describe.configure({ timeout: 120_000 });

  test("Reisekosten-Sätze speichern und wiederherstellen", async ({
    browser,
  }) => {
    const before = await readSettings();
    const admin = await pageAs(browser, ADMIN_STATE);

    const fields = [
      ["rateFullDay", "rateFullDayCents", 2950],
      ["ratePartialDay", "ratePartialDayCents", 1475],
      ["rateReductionBreakfast", "rateReductionBreakfastCents", 590],
      ["rateReductionLunch", "rateReductionLunchCents", 1180],
      ["rateReductionDinner", "rateReductionDinnerCents", 1190],
      ["rateKm", "rateKmCents", 35],
      ["ratePassengerKm", "ratePassengerKmCents", 3],
      ["employerDailySupplement", "employerDailySupplementCents", 250],
    ] as const;

    try {
      await admin.goto("/einstellungen");
      const save = formWith(admin, "rateFullDay").getByRole("button", {
        name: "Speichern",
      });
      await waitForHydration(save);

      for (const [id, , cents] of fields)
        await admin.locator(`#${id}`).fill(euro(cents));
      await save.click();
      await expectToast(admin, "Sätze gespeichert.");

      await expect
        .poll(async () => (await readSettings()).rateFullDayCents)
        .toBe(2950);
      const saved = await readSettings();
      for (const [, column, cents] of fields) expect(saved[column]).toBe(cents);

      // Nach dem Neuladen zeigt das Formular die gespeicherten Werte
      await admin.reload();
      await expect(admin.locator("#rateFullDay")).toHaveValue("29,50");
      await expect(admin.locator("#employerDailySupplement")).toHaveValue(
        "2,50"
      );

      // Ursprüngliche Werte über die Oberfläche zurückschreiben
      await waitForHydration(save);
      for (const [id, column] of fields)
        await admin.locator(`#${id}`).fill(euro(before[column]));
      await save.click();
      await expect
        .poll(async () => (await readSettings()).rateFullDayCents)
        .toBe(before.rateFullDayCents);
      const restored = await readSettings();
      for (const [, column] of fields)
        expect(restored[column]).toBe(before[column]);
    } finally {
      await testDb()
        .update(settings)
        .set(
          Object.fromEntries(fields.map(([, column]) => [column, before[column]]))
        )
        .where(eq(settings.id, 1));
    }
  });

  test("Provisionssätze speichern und wiederherstellen", async ({
    browser,
  }) => {
    const before = await readSettings();
    const admin = await pageAs(browser, ADMIN_STATE);

    try {
      await admin.goto("/einstellungen");
      const save = formWith(admin, "commissionHalfDay").getByRole("button", {
        name: "Speichern",
      });
      await waitForHydration(save);

      await admin.locator("#commissionHalfDay").fill("55,00");
      await admin.locator("#commissionFullDay").fill("80,50");
      await admin.locator("#commissionTwoDay").fill("110,00");
      await admin.locator("#commissionConsultingPercent").fill("4,5");
      await save.click();
      await expectToast(admin, "Provisionssätze gespeichert.");

      await expect
        .poll(async () => (await readSettings()).commissionHalfDayCents)
        .toBe(5500);
      expect(await readSettings()).toMatchObject({
        commissionHalfDayCents: 5500,
        commissionFullDayCents: 8050,
        commissionTwoDayCents: 11000,
        commissionConsultingPercent: 4.5,
      });

      await admin.reload();
      await expect(admin.locator("#commissionFullDay")).toHaveValue("80,50");
      await expect(admin.locator("#commissionConsultingPercent")).toHaveValue(
        "4,5"
      );

      // Zurücksetzen über die Oberfläche
      await waitForHydration(save);
      await admin
        .locator("#commissionHalfDay")
        .fill(euro(before.commissionHalfDayCents));
      await admin
        .locator("#commissionFullDay")
        .fill(euro(before.commissionFullDayCents));
      await admin
        .locator("#commissionTwoDay")
        .fill(euro(before.commissionTwoDayCents));
      await admin
        .locator("#commissionConsultingPercent")
        .fill(String(before.commissionConsultingPercent).replace(".", ","));
      await save.click();
      await expect
        .poll(async () => (await readSettings()).commissionHalfDayCents)
        .toBe(before.commissionHalfDayCents);
      expect(await readSettings()).toMatchObject({
        commissionFullDayCents: before.commissionFullDayCents,
        commissionTwoDayCents: before.commissionTwoDayCents,
        commissionConsultingPercent: before.commissionConsultingPercent,
      });
    } finally {
      await testDb()
        .update(settings)
        .set({
          commissionHalfDayCents: before.commissionHalfDayCents,
          commissionFullDayCents: before.commissionFullDayCents,
          commissionTwoDayCents: before.commissionTwoDayCents,
          commissionConsultingPercent: before.commissionConsultingPercent,
        })
        .where(eq(settings.id, 1));
    }
  });

  test("Aufbewahrungsfristen speichern und wiederherstellen", async ({
    browser,
  }) => {
    const before = await readSettings();
    const admin = await pageAs(browser, ADMIN_STATE);

    try {
      await admin.goto("/einstellungen");
      const save = admin.getByRole("button", { name: "Fristen speichern" });
      await waitForHydration(save);

      await admin.locator("#retentionExpenseYears").fill("9");
      await admin.locator("#retentionSickLeaveYears").fill("6");
      await admin.locator("#retentionRequestYears").fill("4");
      await save.click();
      await expectToast(admin, "Fristen gespeichert.");

      await expect
        .poll(async () => (await readSettings()).retentionExpenseYears)
        .toBe(9);
      expect(await readSettings()).toMatchObject({
        retentionSickLeaveYears: 6,
        retentionRequestYears: 4,
      });

      await admin.reload();
      await expect(admin.locator("#retentionSickLeaveYears")).toHaveValue("6");

      // Zurücksetzen über die Oberfläche
      await waitForHydration(save);
      await admin
        .locator("#retentionExpenseYears")
        .fill(String(before.retentionExpenseYears));
      await admin
        .locator("#retentionSickLeaveYears")
        .fill(String(before.retentionSickLeaveYears));
      await admin
        .locator("#retentionRequestYears")
        .fill(String(before.retentionRequestYears));
      await save.click();
      await expect
        .poll(async () => (await readSettings()).retentionExpenseYears)
        .toBe(before.retentionExpenseYears);
      expect(await readSettings()).toMatchObject({
        retentionSickLeaveYears: before.retentionSickLeaveYears,
        retentionRequestYears: before.retentionRequestYears,
      });
    } finally {
      await testDb()
        .update(settings)
        .set({
          retentionExpenseYears: before.retentionExpenseYears,
          retentionSickLeaveYears: before.retentionSickLeaveYears,
          retentionRequestYears: before.retentionRequestYears,
        })
        .where(eq(settings.id, 1));
    }
  });

  test("Kontingente inklusive Workation-Feldern speichern", async ({
    browser,
  }) => {
    const before = await readSettings();
    const admin = await pageAs(browser, ADMIN_STATE);

    try {
      await admin.goto("/einstellungen");
      const save = formWith(admin, "defaultAnnualVacationDays").getByRole(
        "button",
        { name: "Speichern" }
      );
      await waitForHydration(save);

      await admin.locator("#defaultAnnualVacationDays").fill("29.5");
      await admin.locator("#workationYearlyLimitDays").fill("25");
      await admin.locator("#workationConsecutiveLimitDays").fill("15");
      await save.click();
      await expectToast(admin, "Kontingente gespeichert.");

      await expect
        .poll(async () => (await readSettings()).workationYearlyLimitDays)
        .toBe(25);
      expect(await readSettings()).toMatchObject({
        defaultAnnualVacationDays: 29.5,
        workationConsecutiveLimitDays: 15,
      });

      await admin.reload();
      await expect(admin.locator("#workationYearlyLimitDays")).toHaveValue(
        "25"
      );
      await expect(
        admin.locator("#workationConsecutiveLimitDays")
      ).toHaveValue("15");

      // Zurücksetzen über die Oberfläche
      await waitForHydration(save);
      await admin
        .locator("#defaultAnnualVacationDays")
        .fill(String(before.defaultAnnualVacationDays));
      await admin
        .locator("#workationYearlyLimitDays")
        .fill(String(before.workationYearlyLimitDays));
      await admin
        .locator("#workationConsecutiveLimitDays")
        .fill(String(before.workationConsecutiveLimitDays));
      await save.click();
      await expect
        .poll(async () => (await readSettings()).workationYearlyLimitDays)
        .toBe(before.workationYearlyLimitDays);
      expect(await readSettings()).toMatchObject({
        defaultAnnualVacationDays: before.defaultAnnualVacationDays,
        workationConsecutiveLimitDays: before.workationConsecutiveLimitDays,
      });
    } finally {
      await testDb()
        .update(settings)
        .set({
          defaultAnnualVacationDays: before.defaultAnnualVacationDays,
          workationYearlyLimitDays: before.workationYearlyLimitDays,
          workationConsecutiveLimitDays: before.workationConsecutiveLimitDays,
        })
        .where(eq(settings.id, 1));
    }
  });

  test("Vertretung mit Zeitraum aktivieren und wieder entziehen", async ({
    browser,
  }) => {
    const db = testDb();
    const [employee] = await db
      .select()
      .from(users)
      .where(eq(users.email, E2E_USER_EMAIL));
    const activeBefore = await db
      .select()
      .from(deputyAssignments)
      .where(eq(deputyAssignments.active, true));
    const admin = await pageAs(browser, ADMIN_STATE);

    try {
      await admin.goto("/einstellungen");
      const activate = admin.getByRole("button", {
        name: "Vertretung aktivieren",
      });
      await waitForHydration(activate);

      // Zeitraum in der Zukunft: die Vertretung wirkt erst ab dem Start
      await admin.locator("#deputy-user").selectOption({ label: USER_NAME });
      await admin.locator("#deputy-start").fill("2030-01-07");
      await admin.locator("#deputy-end").fill("2030-01-18");
      await activate.click();
      await expectToast(admin, "Vertretung aktiviert.");

      await expect(admin.getByText("Aktive Vertretung:")).toContainText(
        `${USER_NAME} (07.01.2030 bis 18.01.2030)`
      );
      const active = await db
        .select()
        .from(deputyAssignments)
        .where(eq(deputyAssignments.active, true));
      expect(active).toHaveLength(1);
      expect(active[0]).toMatchObject({
        userId: employee.id,
        startsOn: "2030-01-07",
        endsOn: "2030-01-18",
      });

      // Entziehen
      await admin.getByRole("button", { name: "Vertretung entziehen" }).click();
      await expectToast(admin, "Vertretung entzogen.");
      await expect(
        admin.getByText("Aktuell ist keine Vertretung aktiv.")
      ).toBeVisible();
      await expect(
        admin.getByRole("button", { name: "Vertretung entziehen" })
      ).toHaveCount(0);
      expect(
        await db
          .select()
          .from(deputyAssignments)
          .where(eq(deputyAssignments.active, true))
      ).toHaveLength(0);
    } finally {
      // Vorherigen Zustand wiederherstellen (in der Regel: keine Vertretung)
      await db
        .update(deputyAssignments)
        .set({ active: false })
        .where(eq(deputyAssignments.active, true));
      if (activeBefore.length > 0)
        await db
          .update(deputyAssignments)
          .set({ active: true })
          .where(
            inArray(
              deputyAssignments.id,
              activeBefore.map((a) => a.id)
            )
          );
    }
  });

  test("Webhook anlegen, deaktivieren, aktivieren und löschen", async ({
    browser,
  }) => {
    const db = testDb();
    // .invalid löst nie auf — falls doch zugestellt würde, scheitert es sofort
    const url = `https://n8n.e2e.invalid/webhook/einstellungen-${Date.now()}`;
    const admin = await pageAs(browser, ADMIN_STATE);
    const readWebhook = async () =>
      (await db.select().from(webhookConfigs).where(eq(webhookConfigs.url, url)))[0];

    try {
      await admin.goto("/einstellungen");
      const addForm = admin.locator("form", {
        has: admin.locator('input[name="secret"]'),
      });
      const add = addForm.getByRole("button", { name: "Hinzufügen" });
      await waitForHydration(add);

      // Kategorie/Ereignis, das im weiteren Testlauf nicht ausgelöst wird
      await addForm.locator('select[name="category"]').selectOption("provision");
      // Jede Ereignis-Option ist wählbar (inkl. der Krankmeldungs-Ereignisse)
      const eventSelect = addForm.locator('select[name="event"]');
      await eventSelect.selectOption({ label: "gemeldet (Krankmeldung)" });
      await expect(eventSelect).toHaveValue("gemeldet");
      await eventSelect.selectOption("storniert");
      await addForm.locator('input[name="url"]').fill(url);
      await addForm
        .locator('input[name="secret"]')
        .fill("e2e-webhook-secret-0123456789");
      await add.click();
      await expectToast(admin, "Webhook angelegt.");

      const row = admin.getByRole("row").filter({ hasText: url });
      await expect(row).toBeVisible();
      await expect(row.getByText("provision", { exact: true })).toBeVisible();
      await expect(row.getByText("storniert", { exact: true })).toBeVisible();
      await expect(row.getByText("aktiv", { exact: true })).toBeVisible();
      expect(await readWebhook()).toMatchObject({
        category: "provision",
        event: "storniert",
        active: true,
        secret: "e2e-webhook-secret-0123456789",
      });

      // Deaktivieren
      await row.getByRole("button", { name: "Deaktivieren", exact: true }).click();
      await expectToast(admin, "Webhook deaktiviert.");
      await expect(row.getByText("inaktiv", { exact: true })).toBeVisible();
      await expect.poll(async () => (await readWebhook()).active).toBe(false);

      // Aktivieren
      await row.getByRole("button", { name: "Aktivieren", exact: true }).click();
      await expectToast(admin, "Webhook aktiviert.");
      await expect(row.getByText("aktiv", { exact: true })).toBeVisible();
      await expect.poll(async () => (await readWebhook()).active).toBe(true);

      // Löschen — "Abbrechen" behält den Webhook
      const confirm = admin
        .getByRole("dialog")
        .filter({ hasText: "Webhook löschen?" });
      await row.getByRole("button", { name: "Löschen", exact: true }).click();
      await expect(confirm).toBeVisible();
      await confirm.getByRole("button", { name: "Abbrechen" }).click();
      await expect(confirm).toBeHidden();
      await expect(row).toBeVisible();
      expect(await readWebhook()).toBeDefined();

      // Löschen bestätigen
      await row.getByRole("button", { name: "Löschen", exact: true }).click();
      await confirm.getByRole("button", { name: "Endgültig löschen" }).click();
      await expectToast(admin, "Webhook gelöscht.");
      await expect(confirm).toBeHidden();
      await expect(row).toHaveCount(0);
      expect(await readWebhook()).toBeUndefined();
    } finally {
      await db.delete(webhookConfigs).where(eq(webhookConfigs.url, url));
    }
  });

  test("API-Keys mit Umfang „Lesen + Freigeben“ und „Website“: kopieren und widerrufen", async ({
    browser,
  }) => {
    const db = testDb();
    const ts = Date.now();
    const fullKeyName = `E2E-Key Freigaben ${ts}`;
    const websiteKeyName = `E2E-Key Website ${ts}`;
    const admin = await pageAs(browser, ADMIN_STATE);
    await admin
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
    const readKey = async (name: string) =>
      (await db.select().from(apiKeys).where(eq(apiKeys.name, name)))[0];
    const bearer = (key: string) => ({
      headers: { authorization: `Bearer ${key}` },
    });

    try {
      await admin.goto("/einstellungen");
      const create = admin.getByRole("button", { name: "Key erzeugen" });
      await waitForHydration(create);
      const keyBox = admin.locator("code.block");

      // Key "Lesen + Freigeben" — der Hinweis folgt der Auswahl
      await admin.locator("#key-name").fill(fullKeyName);
      await admin
        .locator("#key-scope")
        .selectOption({ label: "Lesen + Freigeben" });
      await expect(
        admin.getByText("Zusätzlich Freigaben auslösen", { exact: true })
      ).toBeVisible();
      await create.click();
      await expectToast(admin, "API-Key erstellt.");
      await expect(keyBox).toHaveText(/^sk_stefanai_[0-9a-f]{64}$/);
      const fullKey = (await keyBox.innerText()).trim();

      // "Kopieren" legt den Klartext-Key in die Zwischenablage
      await admin
        .getByRole("button", { name: "Kopieren", exact: true })
        .click();
      await expectToast(admin, "In die Zwischenablage kopiert.");
      await expect
        .poll(() => admin.evaluate(() => navigator.clipboard.readText()))
        .toBe(fullKey);

      const fullItem = admin.locator("li", { hasText: fullKeyName });
      await expect(fullItem).toContainText("Lesen + Freigeben");
      expect(await readKey(fullKeyName)).toMatchObject({
        scope: "full",
        revokedAt: null,
        keyPrefix: fullKey.slice(0, 16),
      });
      // Der Key erreicht die Freigabe-API
      expect(
        (await admin.request.get("/api/v1/requests", bearer(fullKey))).status()
      ).toBe(200);

      // Key "Website (nur Zitate)"
      await admin.locator("#key-name").fill(websiteKeyName);
      await admin
        .locator("#key-scope")
        .selectOption({ label: "Website (nur Zitate)" });
      await expect(
        admin.getByText(
          "Nur freigegebene Zitate — kein Zugriff auf HR- oder Faktura-Daten",
          { exact: true }
        )
      ).toBeVisible();
      await create.click();
      await expect(keyBox).not.toHaveText(fullKey);
      await expect(keyBox).toHaveText(/^sk_stefanai_[0-9a-f]{64}$/);
      const websiteKey = (await keyBox.innerText()).trim();

      const websiteItem = admin.locator("li", { hasText: websiteKeyName });
      await expect(websiteItem).toContainText("Website (nur Zitate)");
      expect(await readKey(websiteKeyName)).toMatchObject({ scope: "website" });
      // Nur die Zitate-Schnittstelle ist erreichbar
      expect(
        (
          await admin.request.get("/api/v1/website/zitate", bearer(websiteKey))
        ).status()
      ).toBe(200);
      expect(
        (await admin.request.get("/api/v1/requests", bearer(websiteKey))).status()
      ).toBe(403);

      // Widerrufen — "Abbrechen" lässt den Key aktiv
      const confirm = admin
        .getByRole("dialog")
        .filter({ hasText: "API-Key widerrufen?" });
      await fullItem.getByRole("button", { name: "Widerrufen" }).click();
      await expect(confirm).toContainText(
        `„${fullKeyName}“ funktioniert danach nicht mehr.`
      );
      await confirm.getByRole("button", { name: "Abbrechen" }).click();
      await expect(confirm).toBeHidden();
      expect((await readKey(fullKeyName)).revokedAt).toBeNull();

      // Widerrufen bestätigen
      await fullItem.getByRole("button", { name: "Widerrufen" }).click();
      await confirm
        .getByRole("button", { name: "Endgültig widerrufen" })
        .click();
      await expectToast(admin, "API-Key widerrufen.");
      await expect(confirm).toBeHidden();
      await expect(fullItem).toContainText("widerrufen");
      await expect(
        fullItem.getByRole("button", { name: "Widerrufen" })
      ).toHaveCount(0);
      expect((await readKey(fullKeyName)).revokedAt).not.toBeNull();
      expect(
        (await admin.request.get("/api/v1/requests", bearer(fullKey))).status()
      ).toBe(401);

      // Website-Key ebenfalls widerrufen
      await websiteItem.getByRole("button", { name: "Widerrufen" }).click();
      await confirm
        .getByRole("button", { name: "Endgültig widerrufen" })
        .click();
      await expect(confirm).toBeHidden();
      await expect(
        websiteItem.getByRole("button", { name: "Widerrufen" })
      ).toHaveCount(0);
      expect(
        (
          await admin.request.get("/api/v1/website/zitate", bearer(websiteKey))
        ).status()
      ).toBe(401);
    } finally {
      await db
        .delete(apiKeys)
        .where(inArray(apiKeys.name, [fullKeyName, websiteKeyName]));
    }
  });

  test("Reisekosten-Export: CSV und PDF für einen Monat herunterladen", async ({
    browser,
  }) => {
    const db = testDb();
    const ts = Date.now();
    // Monat weit in der Zukunft — enthält nur die hier angelegte Abrechnung
    const month = "2031-03";
    const [traveller] = await db
      .insert(users)
      .values({
        email: `e2e-export-${ts}@stefanai.de`,
        firstName: "Ella",
        lastName: "Export",
        role: "mitarbeiter",
        status: "aktiv",
        annualVacationDays: 30,
      })
      .returning();
    const [report] = await db
      .insert(expenseReports)
      .values({
        userId: traveller.id,
        status: "genehmigt",
        destination: "Hamburg",
        customerPurpose: `E2E-Export ${ts}`,
        departureDate: "2031-03-10",
        departureTime: "07:30",
        returnDate: "2031-03-12",
        returnTime: "19:00",
        mealAllowanceCents: 5600,
        transportCents: 12345,
        totalCents: 17945,
        decidedAt: new Date(),
      })
      .returning();
    const admin = await pageAs(browser, ADMIN_STATE);

    try {
      await admin.goto("/einstellungen");
      const exportForm = admin.locator('form[action="/api/exports/expenses"]');
      const monthInput = exportForm.locator("#export-month");
      await waitForHydration(monthInput);
      await monthInput.fill(month);
      await expect(monthInput).toHaveValue(month);

      // CSV — der Button sendet das GET-Formular ab, der Server liefert
      // einen Anhang
      const [csvDownload] = await Promise.all([
        admin.waitForEvent("download"),
        exportForm.getByRole("button", { name: "CSV herunterladen" }).click(),
      ]);
      expect(csvDownload.suggestedFilename()).toBe(`Reisekosten-${month}.csv`);
      const csv = (await readFile(await csvDownload.path())).toString("utf8");
      expect(csv.charCodeAt(0)).toBe(0xfeff);
      const lines = csv.slice(1).split("\r\n");
      expect(lines[0]).toBe(
        [
          "Mitarbeiter/in",
          "Reiseziel",
          "Kunde/Anlass",
          "Abreise",
          "Rückkehr",
          "Verpflegungspauschale steuerfrei (EUR)",
          "Arbeitgeber-Zuschlag pauschal versteuert (EUR)",
          "Beleg-Erstattungen (EUR)",
          "Gesamterstattung (EUR)",
          "Vorgangs-ID",
        ].join(";")
      );
      expect(lines).toContain(
        [
          "Ella Export",
          "Hamburg",
          `E2E-Export ${ts}`,
          "10.03.2031",
          "12.03.2031",
          "56,00",
          "0,00",
          "123,45",
          "179,45",
          report.id,
        ]
          .map((v) => `"${v}"`)
          .join(";")
      );

      // PDF
      const [pdfDownload] = await Promise.all([
        admin.waitForEvent("download"),
        exportForm.getByRole("button", { name: "PDF herunterladen" }).click(),
      ]);
      expect(pdfDownload.suggestedFilename()).toBe(`Reisekosten-${month}.pdf`);
      const pdf = await readFile(await pdfDownload.path());
      expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      const { text } = await pdfParse(pdf);
      expect(text).toContain(`Reisekosten-Export ${month}`);
      expect(text).toContain("Ella Export");

      // Antworten der Export-URLs (Status und Header)
      const csvRes = await admin.request.get(
        `/api/exports/expenses?monat=${month}&format=csv`
      );
      expect(csvRes.status()).toBe(200);
      expect(csvRes.headers()["content-type"]).toContain("text/csv");
      expect(csvRes.headers()["content-disposition"]).toContain(
        `filename="Reisekosten-${month}.csv"`
      );
      const pdfRes = await admin.request.get(
        `/api/exports/expenses?monat=${month}&format=pdf`
      );
      expect(pdfRes.status()).toBe(200);
      expect(pdfRes.headers()["content-type"]).toContain("application/pdf");
    } finally {
      await db.delete(expenseReports).where(eq(expenseReports.id, report.id));
      await db.delete(users).where(eq(users.id, traveller.id));
    }
  });
});
