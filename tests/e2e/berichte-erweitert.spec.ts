import {
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  auditLog,
  seminarReportQuotes,
  seminarReports,
  users,
} from "../../src/db/schema";
import { E2E_ADMIN_EMAIL, E2E_USER_EMAIL, testDb } from "../helpers/db";
import {
  ADMIN_NAME,
  ADMIN_STATE,
  USER_NAME,
  USER_STATE,
  expectToast,
  fetchHref,
  openDialog,
  pageAs,
} from "./helpers";

/**
 * Erweiterte Abdeckung der Seminar- und Beratungsberichte (Testplan 5.5,
 * Zeile „Berichte"). Alle Berichte werden mit Zeitstempel direkt in der
 * Test-DB angelegt und in afterAll wieder entfernt — die Datei läuft
 * alphabetisch vor berichte.spec.ts und teilt sich mit ihr die Datenbank.
 */

const TS = Date.now();
const BASE_URL = process.env.APP_BASE_URL ?? "http://localhost:3100";

const ids: { admin?: string; employee?: string; reports: string[] } = {
  reports: [],
};

async function userIdByEmail(email: string): Promise<string> {
  const [row] = await testDb()
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email));
  if (!row) throw new Error(`User ${email} fehlt in der Test-DB`);
  return row.id;
}

function idOf(key: "admin" | "employee"): string {
  const id = ids[key];
  if (!id) throw new Error(`Testdaten fehlen: ${key}`);
  return id;
}

interface ReportSeed {
  owner: "admin" | "employee";
  title: string;
  kind?: "seminar" | "beratung";
  customerName?: string;
  eventDate?: string;
  quoteQuestion?: string | null;
  quotes?: { text: string; approved?: boolean }[];
}

/** Bericht samt Zitaten direkt in der Test-DB anlegen. */
async function insertReport(seed: ReportSeed) {
  const db = testDb();
  const [report] = await db
    .insert(seminarReports)
    .values({
      userId: idOf(seed.owner),
      kind: seed.kind ?? "seminar",
      customerName: seed.customerName ?? "Haufe Akademie",
      title: seed.title,
      eventDate: seed.eventDate ?? "2026-05-20",
      durationDays: 1,
      whatWentWell: "Gute Mitarbeit.",
      whatWentBadly: "Zu wenig Pausen.",
      improvements: "Mehr Pausen einplanen.",
      feedbackRating: 4,
      quoteQuestion:
        seed.quoteQuestion === undefined
          ? seed.quotes?.length
            ? "Was nehmen Sie mit?"
            : null
          : seed.quoteQuestion,
    })
    .returning();
  ids.reports.push(report.id);

  const quoteIds: string[] = [];
  for (const [position, quote] of (seed.quotes ?? []).entries()) {
    const [row] = await db
      .insert(seminarReportQuotes)
      .values({
        reportId: report.id,
        position,
        quote: quote.text,
        websiteApproved: quote.approved ?? false,
      })
      .returning();
    quoteIds.push(row.id);
  }
  return { report, quoteIds };
}

async function quotesOf(reportId: string) {
  return testDb()
    .select()
    .from(seminarReportQuotes)
    .where(eq(seminarReportQuotes.reportId, reportId))
    .orderBy(asc(seminarReportQuotes.position));
}

/** Wartet, bis React das Element hydriert hat (Klicks davor gehen ins Leere). */
async function waitForHydration(locator: Locator): Promise<void> {
  await expect
    .poll(
      () =>
        locator.evaluate((el) =>
          Object.keys(el).some((key) => key.startsWith("__reactProps$"))
        ),
      { timeout: 20_000, message: "React-Hydration abwarten" }
    )
    .toBe(true);
}

/** Base-UI-Select über seinen Trigger öffnen (mit Hydration-Retry) und Option wählen. */
async function chooseOption(page: Page, trigger: Locator, option: string) {
  const item = page.getByRole("option", { name: option, exact: true });
  await expect(async () => {
    await trigger.click();
    await expect(item).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await item.click();
}

/** Reiter anklicken, bis er aktiv ist (der erste Klick kann vor der Hydration landen). */
async function selectTab(tab: Locator) {
  await expect(async () => {
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true", {
      timeout: 2_000,
    });
  }).toPass({ timeout: 20_000 });
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Admin-Seite mit Zwischenablage-Rechten (für „Zitat kopieren"). */
async function adminPageWithClipboard(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    storageState: ADMIN_STATE,
    baseURL: BASE_URL,
    permissions: ["clipboard-read", "clipboard-write"],
  });
  return context.newPage();
}

test.describe("Berichte — erweiterte Bedienung", () => {
  test.beforeAll(async () => {
    ids.admin = await userIdByEmail(E2E_ADMIN_EMAIL);
    ids.employee = await userIdByEmail(E2E_USER_EMAIL);
  });

  test.afterAll(async () => {
    // Zitate laufen über onDelete: "cascade" mit
    if (ids.reports.length > 0)
      await testDb()
        .delete(seminarReports)
        .where(inArray(seminarReports.id, ids.reports));
  });

  test("BerichteNav: Meine Berichte, Alle Berichte und Zitate (Admin)", async ({
    browser,
  }) => {
    const admin = await pageAs(browser, ADMIN_STATE);
    await admin.goto("/berichte");
    const main = admin.getByRole("main");
    await expect(
      main.getByRole("heading", { name: "Berichte", exact: true, level: 1 })
    ).toBeVisible();

    await main.getByRole("link", { name: "Alle Berichte", exact: true }).click();
    await expect(admin).toHaveURL(/\/berichte\/alle$/);
    await expect(
      main.getByRole("heading", { name: "Alle Berichte", level: 1 })
    ).toBeVisible();

    await main.getByRole("link", { name: "Zitate", exact: true }).click();
    await expect(admin).toHaveURL(/\/berichte\/zitate$/);
    await expect(
      main.getByRole("heading", { name: "Zitate", exact: true, level: 1 })
    ).toBeVisible();

    await main.getByRole("link", { name: "Meine Berichte", exact: true }).click();
    await expect(admin).toHaveURL(/\/berichte$/);
    await expect(
      main.getByRole("heading", { name: "Berichte", exact: true, level: 1 })
    ).toBeVisible();
  });

  test("„Details“ führt aus beiden Übersichten zum Bericht", async ({
    browser,
  }) => {
    const title = `E2E-Details ${TS}`;
    const { report } = await insertReport({ owner: "employee", title });
    const detailUrl = new RegExp(`/berichte/${report.id}$`);

    const employee = await pageAs(browser, USER_STATE);
    await employee.goto("/berichte");
    const main = employee.getByRole("main");

    // Aus „Meine Berichte"
    await main
      .getByRole("row")
      .filter({ hasText: title })
      .getByRole("link", { name: "Details" })
      .click();
    await expect(employee).toHaveURL(detailUrl);
    await expect(
      main.getByRole("heading", { name: title, level: 1 })
    ).toBeVisible();

    // Aus „Alle Berichte" (über die BerichteNav erreicht)
    await main.getByRole("link", { name: "Alle Berichte", exact: true }).click();
    await expect(employee).toHaveURL(/\/berichte\/alle$/);
    const row = main.getByRole("row").filter({ hasText: title });
    await expect(row).toContainText(USER_NAME);
    await row.getByRole("link", { name: "Details" }).click();
    await expect(employee).toHaveURL(detailUrl);
    await expect(
      main.getByRole("heading", { name: title, level: 1 })
    ).toBeVisible();

    // Zurück zur eigenen Übersicht
    await main.getByRole("link", { name: "Meine Berichte", exact: true }).click();
    await expect(employee).toHaveURL(/\/berichte$/);
    await expect(main.getByRole("row").filter({ hasText: title })).toBeVisible();
  });

  test("Alle Berichte: Filter Zeitraum und Art, Zurücksetzen, Sortierung nach Mitarbeiter/in", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const tag = `Filter-${TS}`;
    const beratung = `${tag} Beratung`;
    const seminar = `${tag} Seminar`;
    const adminReport = `${tag} Admin`;
    await insertReport({
      owner: "employee",
      title: beratung,
      kind: "beratung",
      eventDate: "2025-03-10",
    });
    await insertReport({
      owner: "employee",
      title: seminar,
      kind: "seminar",
      eventDate: "2025-03-12",
    });
    await insertReport({
      owner: "admin",
      title: adminReport,
      kind: "seminar",
      eventDate: "2025-03-11",
    });

    const admin = await pageAs(browser, ADMIN_STATE);
    await admin.goto("/berichte/alle");
    const main = admin.getByRole("main");
    const form = main.locator('form[method="get"]');
    const artSelect = form.getByRole("combobox").nth(1);
    const myRows = main.getByRole("row").filter({ hasText: tag });
    const titlesInOrder = (...titles: string[]) =>
      titles.map((t) => new RegExp(escapeRegExp(t)));

    await expect(myRows).toHaveCount(3);

    // --- Zeitraum ---
    await main.locator("#von").fill("2025-03-11");
    await main.locator("#bis").fill("2025-03-11");
    await form.getByRole("button", { name: "Filtern" }).click();
    await expect(admin).toHaveURL(/von=2025-03-11&bis=2025-03-11/);
    await expect(myRows).toHaveText(titlesInOrder(adminReport));
    await expect(myRows).toContainText(ADMIN_NAME);

    // --- Art (zusammen mit einem breiteren Zeitraum) ---
    await chooseOption(admin, artSelect, "Beratung");
    await expect(form.locator('input[name="art"]')).toHaveValue("beratung");
    await main.locator("#von").fill("2025-03-10");
    await main.locator("#bis").fill("2025-03-12");
    await form.getByRole("button", { name: "Filtern" }).click();
    await expect(admin).toHaveURL(/art=beratung/);
    await expect(admin).toHaveURL(/von=2025-03-10&bis=2025-03-12/);
    await expect(myRows).toHaveText(titlesInOrder(beratung));
    await expect(myRows).toContainText("Beratung");

    // --- Zurücksetzen ---
    await form.getByRole("button", { name: "Zurücksetzen" }).click();
    await expect(admin).toHaveURL(/\/berichte\/alle$/);
    await expect(myRows).toHaveCount(3);
    await expect(main.locator("#von")).toHaveValue("");
    await expect(main.locator("#bis")).toHaveValue("");

    // --- Sortierung: Standard Datum absteigend, dann nach Mitarbeiter/in ---
    // Art ausdrücklich auf „Alle" — der Select-Zustand übersteht die
    // clientseitige Navigation von „Zurücksetzen".
    await chooseOption(admin, artSelect, "Alle");
    await expect(form.locator('input[name="art"]')).toHaveValue("");
    await main.locator("#von").fill("2025-03-10");
    await main.locator("#bis").fill("2025-03-12");
    await form.getByRole("button", { name: "Filtern" }).click();
    await expect(admin).toHaveURL(/von=2025-03-10&bis=2025-03-12/);
    await expect(admin).toHaveURL(/sortierung=datum_neu/);
    await expect(myRows).toHaveText(
      titlesInOrder(seminar, adminReport, beratung)
    );

    await main.getByRole("link", { name: /^Mitarbeiter\/in/ }).click();
    await expect(admin).toHaveURL(/sortierung=mitarbeiter/);
    // Filter bleiben beim Umsortieren erhalten
    await expect(admin).toHaveURL(/von=2025-03-10/);
    await expect(admin).toHaveURL(/bis=2025-03-12/);
    await expect(
      main.getByRole("link", { name: "Mitarbeiter/in ▲" })
    ).toBeVisible();
    // „Erika Admin" vor „Max Mitarbeiter", je Person neueste zuerst
    await expect(myRows).toHaveText(
      titlesInOrder(adminReport, seminar, beratung)
    );
  });

  test("Zitat im Formular entfernen und speichern", async ({ browser }) => {
    const title = `E2E-Zitat-entfernen ${TS}`;
    const quotes = [
      `Erstes Zitat ${TS}`,
      `Zweites Zitat ${TS}`,
      `Drittes Zitat ${TS}`,
    ];
    const { report, quoteIds } = await insertReport({
      owner: "employee",
      title,
      quotes: quotes.map((text) => ({ text })),
    });

    const employee = await pageAs(browser, USER_STATE);
    await employee.goto(`/berichte/${report.id}`);
    const main = employee.getByRole("main");
    const quoteBox = (n: number) =>
      main.getByRole("textbox", { name: `Zitat ${n}`, exact: true });

    await waitForHydration(quoteBox(1));
    await expect(quoteBox(2)).toHaveValue(quotes[1]);
    await expect(main.getByText("3 von höchstens 20 Zitaten")).toBeVisible();

    await main
      .getByRole("button", { name: "Zitat 2 entfernen", exact: true })
      .click();
    // Die Zeilen rücken nach: das dritte Zitat steht jetzt an Position 2
    await expect(quoteBox(1)).toHaveValue(quotes[0]);
    await expect(quoteBox(2)).toHaveValue(quotes[2]);
    await expect(quoteBox(3)).toHaveCount(0);
    await expect(main.getByText("2 von höchstens 20 Zitaten")).toBeVisible();

    await main.getByRole("button", { name: "Änderungen speichern" }).click();
    await expectToast(employee, "Bericht aktualisiert.");
    await expect(
      main.getByText("Zitate von Teilnehmenden (2)", { exact: true })
    ).toBeVisible();
    await expect(main.getByText(`„${quotes[1]}“`)).toHaveCount(0);

    const stored = await quotesOf(report.id);
    expect(stored.map((q) => q.quote)).toEqual([quotes[0], quotes[2]]);
    // Verbleibende Zitate behalten ihre Id (Abgleich statt Neuanlage)
    expect(stored.map((q) => q.id)).toEqual([quoteIds[0], quoteIds[2]]);
  });

  test("Limit: Nach 20 Zitaten ist „Zitat hinzufügen“ gesperrt", async ({
    browser,
  }) => {
    const employee = await pageAs(browser, USER_STATE);
    await employee.goto("/berichte");
    const main = employee.getByRole("main");
    await main.getByRole("button", { name: "Bericht erfassen" }).click();
    await expect(employee).toHaveURL(/\/berichte\/neu$/);

    const add = main.getByRole("button", { name: "Zitat hinzufügen" });
    const quoteBox = (n: number) =>
      main.getByRole("textbox", { name: `Zitat ${n}`, exact: true });
    await waitForHydration(add);
    await expect(quoteBox(1)).toBeVisible();

    for (let n = 2; n <= 20; n++) {
      await expect(add).toBeEnabled();
      await add.click();
      await expect(quoteBox(n)).toBeVisible();
    }
    await expect(add).toBeDisabled();
    await expect(quoteBox(21)).toHaveCount(0);
    // Gezählt werden nur ausgefüllte Zeilen
    await expect(main.getByText("0 von höchstens 20 Zitaten")).toBeVisible();
    await quoteBox(20).fill("Zwanzigstes Zitat");
    await expect(main.getByText("1 von höchstens 20 Zitaten")).toBeVisible();

    // Eine Zeile entfernen gibt den Button wieder frei
    await main
      .getByRole("button", { name: "Zitat 20 entfernen", exact: true })
      .click();
    await expect(quoteBox(20)).toHaveCount(0);
    await expect(add).toBeEnabled();
    await expect(main.getByText("0 von höchstens 20 Zitaten")).toBeVisible();
  });

  test("Eigenen Bericht löschen: Abbrechen behält ihn, Bestätigen löscht ihn", async ({
    browser,
  }) => {
    const title = `E2E-Löschen ${TS}`;
    const { report } = await insertReport({
      owner: "employee",
      title,
      quotes: [
        { text: `Freigegebenes Zitat ${TS}`, approved: true },
        { text: `Offenes Zitat ${TS}` },
      ],
    });
    const reportExists = async () =>
      (
        await testDb()
          .select({ id: seminarReports.id })
          .from(seminarReports)
          .where(eq(seminarReports.id, report.id))
      ).length;

    const employee = await pageAs(browser, USER_STATE);
    await employee.goto(`/berichte/${report.id}`);
    const main = employee.getByRole("main");
    const dialog = employee.getByRole("dialog");
    const trigger = main.getByRole("button", { name: "Endgültig löschen" });

    // Abbrechen
    await openDialog(trigger, dialog);
    await expect(dialog.getByText("Endgültig löschen?")).toBeVisible();
    await expect(dialog).toContainText(
      "Der Bericht und alle 2 Zitate werden endgültig gelöscht — darunter 1 bereits für die Website freigegebene."
    );
    await dialog.getByRole("button", { name: "Abbrechen" }).click();
    await expect(dialog).toBeHidden();
    await expect(employee).toHaveURL(new RegExp(`/berichte/${report.id}$`));
    expect(await reportExists()).toBe(1);

    // Bestätigen
    await openDialog(trigger, dialog);
    await dialog.getByRole("button", { name: "Endgültig löschen" }).click();
    await expect(employee).toHaveURL(/\/berichte$/);
    await expect(main.getByRole("row").filter({ hasText: title })).toHaveCount(0);
    await expect.poll(reportExists).toBe(0);
    expect(await quotesOf(report.id)).toHaveLength(0);
  });

  test("Admin korrigiert einen fremden Bericht und speichert", async ({
    browser,
  }) => {
    const title = `E2E-Fremdbericht ${TS}`;
    const correctedTitle = `${title} (korrigiert)`;
    const quote = `5/5 Sehr gut erklärt ${TS}`;
    const correctedQuote = `Sehr gut erklärt ${TS}`;
    const { report, quoteIds } = await insertReport({
      owner: "employee",
      title,
      quotes: [{ text: quote, approved: true }],
    });

    const admin = await pageAs(browser, ADMIN_STATE);
    await admin.goto(`/berichte/${report.id}`);
    const main = admin.getByRole("main");
    await expect(
      main.getByText("Bericht bearbeiten", { exact: true })
    ).toBeVisible();
    await expect(
      main.getByText(
        `Bericht von ${USER_NAME} — als Admin können Sie ihn nachträglich anpassen`
      )
    ).toBeVisible();
    // Löschen bleibt der verfassenden Person vorbehalten
    await expect(
      main.getByRole("button", { name: "Endgültig löschen" })
    ).toHaveCount(0);

    const quoteBox = main.getByRole("textbox", { name: "Zitat 1", exact: true });
    await waitForHydration(quoteBox);
    await main.locator("#title").fill(correctedTitle);
    await quoteBox.fill(correctedQuote);
    await main.getByRole("button", { name: "Änderungen speichern" }).click();
    await expectToast(admin, "Bericht aktualisiert.");
    await expect(
      main.getByRole("heading", { name: correctedTitle, level: 1 })
    ).toBeVisible();
    await expect(main.getByText(`„${correctedQuote}“`)).toBeVisible();
    // Die Korrektur des Admins lässt die Website-Freigabe bestehen
    await expect(main.getByText("für Website freigegeben")).toBeVisible();

    const [stored] = await testDb()
      .select()
      .from(seminarReports)
      .where(eq(seminarReports.id, report.id));
    expect(stored.title).toBe(correctedTitle);
    expect(stored.userId).toBe(idOf("employee"));
    const [storedQuote] = await quotesOf(report.id);
    expect(storedQuote.id).toBe(quoteIds[0]);
    expect(storedQuote.quote).toBe(correctedQuote);
    expect(storedQuote.websiteApproved).toBe(true);

    const [audit] = await testDb()
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.objectId, report.id),
          eq(auditLog.action, "aktualisiert")
        )
      );
    expect(audit?.actorLabel).toBe(ADMIN_NAME);
    expect((audit?.details as { als_admin?: boolean } | null)?.als_admin).toBe(
      true
    );
  });

  test("Zitatverwaltung: Reiter, Wortlaut bearbeiten, kopieren, CSV-Export und Freigabe zurückziehen", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const title = `E2E-Zitate ${TS}`;
    const customer = `Zitatkunde ${TS}`;
    const question = `Was war für Sie am wertvollsten? ${TS}`;
    const approvedQuote = `Freigegeben und hilfreich ${TS}`;
    const openQuote = `Noch ungeprüft ${TS}`;
    const editedQuote = `Neu formuliert ${TS}`;
    const { quoteIds } = await insertReport({
      owner: "employee",
      title,
      kind: "beratung",
      customerName: customer,
      eventDate: "2026-04-14",
      quoteQuestion: question,
      quotes: [{ text: approvedQuote, approved: true }, { text: openQuote }],
    });
    const quoteRow = async (id: string) => {
      const [row] = await testDb()
        .select()
        .from(seminarReportQuotes)
        .where(eq(seminarReportQuotes.id, id));
      return row;
    };

    const admin = await adminPageWithClipboard(browser);
    await admin.goto("/berichte/zitate");
    const main = admin.getByRole("main");
    const rowOf = (text: string) =>
      main.getByRole("row").filter({ hasText: text });
    const tab = (name: RegExp) => main.getByRole("tab", { name });

    // --- Reiter Alle / Freigegeben / Offen ---
    await expect(tab(/^Alle/)).toHaveAttribute("aria-selected", "true");
    await expect(rowOf(approvedQuote)).toBeVisible();
    await expect(rowOf(openQuote)).toBeVisible();
    await expect(rowOf(approvedQuote)).toContainText(`Frage: ${question}`);

    await selectTab(tab(/^Freigegeben/));
    await expect(rowOf(approvedQuote)).toBeVisible();
    await expect(rowOf(openQuote)).toHaveCount(0);

    await selectTab(tab(/^Offen/));
    await expect(rowOf(openQuote)).toBeVisible();
    await expect(rowOf(approvedQuote)).toHaveCount(0);

    await selectTab(tab(/^Alle/));
    await expect(rowOf(approvedQuote)).toBeVisible();
    await expect(rowOf(openQuote)).toBeVisible();

    // --- Zitat kopieren ---
    await rowOf(approvedQuote)
      .getByRole("button", { name: "Zitat kopieren" })
      .click();
    await expectToast(admin, "Zitat kopiert.");
    expect(await admin.evaluate(() => navigator.clipboard.readText())).toBe(
      approvedQuote
    );

    // --- Wortlaut bearbeiten ---
    const dialog = admin.getByRole("dialog");
    await openDialog(
      rowOf(openQuote).getByRole("button", { name: "Bearbeiten" }),
      dialog
    );
    await expect(dialog.getByText("Zitat bearbeiten")).toBeVisible();
    await expect(dialog.getByLabel("Wortlaut")).toHaveValue(openQuote);
    await dialog.getByLabel("Wortlaut").fill(editedQuote);
    await dialog.getByRole("button", { name: "Speichern" }).click();
    await expectToast(admin, "Zitat aktualisiert.");
    await expect(dialog).toBeHidden();
    await expect(rowOf(editedQuote)).toBeVisible();
    await expect(rowOf(openQuote)).toHaveCount(0);
    expect((await quoteRow(quoteIds[1])).quote).toBe(editedQuote);

    // --- „Freigegebene als CSV" ---
    const csvLink = main.getByRole("button", { name: "Freigegebene als CSV" });
    await expect(csvLink).toHaveAttribute("href", "/api/exports/berichte-zitate");
    const readCsv = async () => {
      const response = await fetchHref(admin, csvLink);
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toContain("text/csv");
      expect(response.headers()["content-disposition"]).toMatch(
        /^attachment; filename="Zitate_freigegeben_\d{4}-\d{2}-\d{2}\.csv"$/
      );
      return (await response.body()).toString("utf-8").replace(/^﻿/, "");
    };
    const csv = await readCsv();
    const [header, ...lines] = csv.split("\r\n");
    expect(header).toBe("Zitat;Art;Veranstaltung;Kunde;Datum;Mitarbeiter/in;Frage");
    expect(lines).toContain(
      `"${approvedQuote}";"Beratung";"${title}";"${customer}";"14.04.2026";"${USER_NAME}";"${question}"`
    );
    expect(csv).not.toContain(editedQuote);

    // --- Website-Freigabe über den Schalter zurückziehen ---
    const toggle = rowOf(approvedQuote).getByRole("switch");
    await expect(toggle).toBeChecked();
    await expect(toggle).toHaveAccessibleName(
      "Freigabe für die Website zurückziehen"
    );
    await toggle.click();
    await expectToast(admin, "Freigabe zurückgezogen.");
    await expect(toggle).not.toBeChecked();
    await expect(toggle).toHaveAccessibleName("Für die Website freigeben");
    await expect
      .poll(async () => (await quoteRow(quoteIds[0])).websiteApproved)
      .toBe(false);

    await selectTab(tab(/^Freigegeben/));
    await expect(rowOf(approvedQuote)).toHaveCount(0);
    expect(await readCsv()).not.toContain(approvedQuote);
  });
});
