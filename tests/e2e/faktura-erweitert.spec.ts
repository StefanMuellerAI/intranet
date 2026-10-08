import { readFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import {
  auditLog,
  fakturaCustomers,
  fakturaProjects,
  fakturaTimeEntries,
  fakturaTimesheets,
  fakturaWeekApprovals,
  users,
  type FakturaWeekApproval,
} from "../../src/db/schema";
import { E2E_ADMIN_EMAIL, E2E_USER_EMAIL, testDb } from "../helpers/db";
import {
  ADMIN_STATE,
  USER_NAME,
  USER_STATE,
  expectToast,
  fetchHref,
  openDialog,
  pageAs,
  selectOption,
} from "./helpers";

// Klassisches pdf-parse (1.x) — Text-Extraktion für PDFs
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse/lib/pdf-parse.js") as (
  buffer: Buffer
) => Promise<{ text: string; numpages: number }>;

/**
 * Erweiterte Faktura-Abdeckung (Testplan 5.5, Zeile „Faktura").
 *
 * Jetzt ist über FAKTURA_TEST_NOW fixiert: Freitag, 24.07.2026 → laufende
 * KW 30/2026. Diese Datei läuft alphabetisch VOR faktura.spec.ts und teilt
 * sich mit ihr die Datenbank. Deshalb gilt:
 * - eigene Kunden/Projekte mit Zeitstempel, nie die von faktura.spec.ts;
 * - KW 29 und KW 30 werden nie freigegeben/widerrufen — der Freigabe-Workflow
 *   läuft in KW 26/2026 (22.–26.06.), die faktura.spec.ts nicht berührt;
 * - afterAll entfernt alle eigenen Buchungen, Stundenzettel, Projekte und
 *   Kunden und stellt die Freigabe der KW 26 auf den Ausgangszustand zurück.
 *   (faktura.spec.ts erwartet u. a., dass Max in KW 30 noch nichts gebucht
 *   hat, genau eine Überbuchung in KW 30 und genau einen Entwurf im Archiv.)
 */

const TS = Date.now();
const MAIN_CUSTOMER = `E2E Erweitert ${TS}`;
const STAMM_CUSTOMER = `E2E Stamm ${TS}`;
const EXPORT_CUSTOMER = `E2E Export ${TS}`;
/** Dateinamen-Normalisierung wie normalizeForFilename (nur ASCII + Leerzeichen) */
const EXPORT_FILE_PART = EXPORT_CUSTOMER.replace(/[^A-Za-z0-9._-]+/g, "-");

const APPROVAL_WEEK = {
  isoYear: 2026,
  isoWeek: 26,
  monday: "2026-06-22",
  sunday: "2026-06-28",
};

interface Ctx {
  adminId: string;
  employeeId: string;
  customerIds: string[];
  mainCustomerId: string;
  stammCustomerId: string;
  exportCustomerId: string;
  buchungProjectId: string;
  limitProjectId: string;
  freigabeProjectId: string;
  stammProjectId: string;
  exportProjectId: string;
  /** Freigabezeile der KW 26 vor dem Lauf (null = keine Zeile) */
  originalApproval: FakturaWeekApproval | null;
  approvalCaptured: boolean;
}

const ctx: Partial<Ctx> & { customerIds: string[] } = { customerIds: [] };

function must<K extends keyof Ctx>(key: K): Ctx[K] {
  const value = ctx[key];
  if (value === undefined) throw new Error(`Testdaten fehlen: ${key}`);
  return value as Ctx[K];
}

async function userIdByEmail(email: string): Promise<string> {
  const [row] = await testDb()
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email));
  if (!row) throw new Error(`User ${email} fehlt in der Test-DB`);
  return row.id;
}

async function insertCustomer(name: string, address?: string) {
  const [row] = await testDb()
    .insert(fakturaCustomers)
    .values({ name, address: address ?? null })
    .returning();
  ctx.customerIds.push(row.id);
  return row;
}

async function insertProject(
  customerId: string,
  name: string,
  monthlyLimitMinutes: number | null = null
) {
  const [row] = await testDb()
    .insert(fakturaProjects)
    .values({ customerId, name, monthlyLimitMinutes })
    .returning();
  return row;
}

async function insertEntry(v: {
  projectId: string;
  entryDate: string;
  minutes: number;
  description: string;
  status?: "offen" | "freigegeben";
}) {
  const employeeId = must("employeeId");
  const [row] = await testDb()
    .insert(fakturaTimeEntries)
    .values({
      userId: employeeId,
      projectId: v.projectId,
      entryDate: v.entryDate,
      durationMinutes: v.minutes,
      description: v.description,
      status: v.status ?? "offen",
      createdById: employeeId,
      updatedById: employeeId,
    })
    .returning();
  return row;
}

async function getEntry(id: string) {
  const [row] = await testDb()
    .select()
    .from(fakturaTimeEntries)
    .where(eq(fakturaTimeEntries.id, id));
  return row;
}

async function getApproval(): Promise<FakturaWeekApproval | null> {
  const [row] = await testDb()
    .select()
    .from(fakturaWeekApprovals)
    .where(
      and(
        eq(fakturaWeekApprovals.isoYear, APPROVAL_WEEK.isoYear),
        eq(fakturaWeekApprovals.isoWeek, APPROVAL_WEEK.isoWeek)
      )
    );
  return row ?? null;
}

/** Freigabezeile und Buchungsstatus der KW 26 auf den Ausgangszustand bringen. */
async function restoreApproval(original: FakturaWeekApproval | null) {
  const db = testDb();
  const where = and(
    eq(fakturaWeekApprovals.isoYear, APPROVAL_WEEK.isoYear),
    eq(fakturaWeekApprovals.isoWeek, APPROVAL_WEEK.isoWeek)
  );
  if (!original) {
    await db.delete(fakturaWeekApprovals).where(where);
    return;
  }
  await db
    .update(fakturaWeekApprovals)
    .set({
      status: original.status,
      approvedAt: original.approvedAt,
      approvedById: original.approvedById,
      revokeReason: original.revokeReason,
      updatedAt: original.updatedAt,
    })
    .where(where);
  // Eine freigegebene Woche hat ausschließlich freigegebene Buchungen
  await db
    .update(fakturaTimeEntries)
    .set({ status: original.status === "freigegeben" ? "freigegeben" : "offen" })
    .where(
      and(
        eq(fakturaTimeEntries.deleted, false),
        gte(fakturaTimeEntries.entryDate, APPROVAL_WEEK.monday),
        lte(fakturaTimeEntries.entryDate, APPROVAL_WEEK.sunday)
      )
    );
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

/** Löst einen Download aus und liefert URL, Dateiname und Inhalt. */
async function captureDownload(page: Page, trigger: () => Promise<void>) {
  const downloadPromise = page.waitForEvent("download");
  await trigger();
  const download = await downloadPromise;
  const path = await download.path();
  return {
    url: new URL(download.url()),
    filename: download.suggestedFilename(),
    content: await readFile(path),
  };
}

function csvText(content: Buffer): string {
  return content.toString("utf-8").replace(/^﻿/, "");
}

/** Öffnet als Mitarbeiter/in „Zeit buchen" und klappt die Projektauswahl auf. */
async function openEmployeeProjectList(employee: Page) {
  await employee.goto("/faktura");
  await openDialog(
    employee.getByTestId("neue-buchung"),
    employee.getByText("Neue Zeitbuchung")
  );
  await employee.getByTestId("projekt-auswahl").click();
  // Eine bekannte, aktive Option abwarten → Liste ist vollständig gerendert
  await expect(
    employee.getByRole("option", { name: `${MAIN_CUSTOMER} – Buchung` })
  ).toBeVisible();
}

test.describe("Faktura — erweiterte Bedienung", () => {
  test.beforeAll(async () => {
    ctx.adminId = await userIdByEmail(E2E_ADMIN_EMAIL);
    ctx.employeeId = await userIdByEmail(E2E_USER_EMAIL);

    const main = await insertCustomer(MAIN_CUSTOMER);
    ctx.mainCustomerId = main.id;
    ctx.buchungProjectId = (await insertProject(main.id, "Buchung")).id;
    // Monatslimit 2 h — für „Trotzdem buchen" beim Bearbeiten
    ctx.limitProjectId = (await insertProject(main.id, "Limit", 120)).id;
    ctx.freigabeProjectId = (await insertProject(main.id, "Freigabe")).id;

    const stamm = await insertCustomer(STAMM_CUSTOMER);
    ctx.stammCustomerId = stamm.id;
    ctx.stammProjectId = (await insertProject(stamm.id, "Wartung")).id;

    const exp = await insertCustomer(EXPORT_CUSTOMER, "Exportweg 1, 50667 Köln");
    ctx.exportCustomerId = exp.id;
    ctx.exportProjectId = (await insertProject(exp.id, "Reporting")).id;

    // Ausgangszustand der KW 26 sichern (andere Specs könnten sie berühren)
    ctx.originalApproval = await getApproval();
    ctx.approvalCaptured = true;
  });

  test.afterAll(async () => {
    const db = testDb();
    const customerIds = ctx.customerIds;
    if (customerIds.length > 0) {
      const projects = await db
        .select({ id: fakturaProjects.id })
        .from(fakturaProjects)
        .where(inArray(fakturaProjects.customerId, customerIds));
      const projectIds = projects.map((p) => p.id);
      await db
        .delete(fakturaTimesheets)
        .where(inArray(fakturaTimesheets.customerId, customerIds));
      if (projectIds.length > 0)
        await db
          .delete(fakturaTimeEntries)
          .where(inArray(fakturaTimeEntries.projectId, projectIds));
      await db
        .delete(fakturaProjects)
        .where(inArray(fakturaProjects.customerId, customerIds));
      await db
        .delete(fakturaCustomers)
        .where(inArray(fakturaCustomers.id, customerIds));
    }
    if (ctx.approvalCaptured)
      await restoreApproval(ctx.originalApproval ?? null);
  });

  test("Wochennavigation: ← Vorwoche, Folgewoche → und Aktuelle Woche", async ({
    browser,
  }) => {
    const employee = await pageAs(browser, USER_STATE);
    await employee.goto("/faktura");
    const main = employee.getByRole("main");

    // Laufende Woche: kein Vorwärtsblättern, kein „Aktuelle Woche"
    await expect(
      main.getByText("KW 30/2026 (20.07.2026 – 24.07.2026)")
    ).toBeVisible();
    await expect(main.getByRole("button", { name: "Folgewoche →" })).toHaveCount(0);
    await expect(main.getByRole("button", { name: "Aktuelle Woche" })).toHaveCount(0);

    await main.getByRole("button", { name: "← Vorwoche" }).click();
    await expect(employee).toHaveURL(/\/faktura\?jahr=2026&kw=29$/);
    await expect(
      main.getByText("KW 29/2026 (13.07.2026 – 17.07.2026)")
    ).toBeVisible();
    await expect(
      main.getByText("Das Buchungsfenster für diese Woche ist geschlossen.")
    ).toBeVisible();

    await main.getByRole("button", { name: "← Vorwoche" }).click();
    await expect(employee).toHaveURL(/\/faktura\?jahr=2026&kw=28$/);
    await expect(
      main.getByText("KW 28/2026 (06.07.2026 – 10.07.2026)")
    ).toBeVisible();

    await main.getByRole("button", { name: "Folgewoche →" }).click();
    await expect(employee).toHaveURL(/\/faktura\?jahr=2026&kw=29$/);
    await expect(
      main.getByText("KW 29/2026 (13.07.2026 – 17.07.2026)")
    ).toBeVisible();

    await main.getByRole("button", { name: "Aktuelle Woche" }).click();
    await expect(employee).toHaveURL(/\/faktura$/);
    await expect(
      main.getByText("KW 30/2026 (20.07.2026 – 24.07.2026)")
    ).toBeVisible();
    await expect(
      main.getByText("Das Buchungsfenster für diese Woche ist geschlossen.")
    ).toHaveCount(0);

    // Jahreswechsel: KW 1/2026 beginnt am 29.12.2025, Vorwoche ist KW 52/2025
    await employee.goto("/faktura?jahr=2026&kw=1");
    await expect(
      main.getByText("KW 01/2026 (29.12.2025 – 02.01.2026)")
    ).toBeVisible();
    await expect(main.getByRole("button", { name: "← Vorwoche" })).toHaveAttribute(
      "href",
      "/faktura?jahr=2025&kw=52"
    );
    await expect(
      main.getByRole("button", { name: "Folgewoche →" })
    ).toHaveAttribute("href", "/faktura?jahr=2026&kw=2");
    await main.getByRole("button", { name: "← Vorwoche" }).click();
    await expect(employee).toHaveURL(/\/faktura\?jahr=2025&kw=52$/);
    await expect(
      main.getByText("KW 52/2025 (22.12.2025 – 26.12.2025)")
    ).toBeVisible();
  });

  test("FakturaNav und WeekNav führen durch die Admin-Bereiche", async ({
    browser,
  }) => {
    const admin = await pageAs(browser, ADMIN_STATE);
    await admin.goto("/faktura");
    const main = admin.getByRole("main");
    await expect(
      main.getByRole("heading", { name: "Zeiterfassung", level: 1 })
    ).toBeVisible();

    await main.getByRole("link", { name: "Freigabe", exact: true }).click();
    await expect(admin).toHaveURL(/\/faktura\/freigabe$/);
    await expect(
      main.getByRole("heading", { name: "Wochenfreigabe", level: 1 })
    ).toBeVisible();
    // Standard: zuletzt abgeschlossene Woche (KW 29)
    await expect(
      main.getByText("KW 29/2026 (13.07.2026 – 17.07.2026)")
    ).toBeVisible();

    // WeekNav: die letzten acht Wochen KW 30 … KW 23
    for (let kw = 23; kw <= 30; kw++)
      await expect(
        main.getByRole("button", { name: new RegExp(`^KW ${kw}/2026`) })
      ).toBeVisible();

    await main.getByRole("button", { name: /^KW 26\/2026/ }).click();
    await expect(admin).toHaveURL(/\/faktura\/freigabe\?jahr=2026&kw=26$/);
    await expect(
      main.getByText("KW 26/2026 (22.06.2026 – 26.06.2026)")
    ).toBeVisible();

    await main.getByRole("button", { name: /^KW 30\/2026/ }).click();
    await expect(admin).toHaveURL(/\/faktura\/freigabe\?jahr=2026&kw=30$/);
    await expect(
      main.getByText("KW 30/2026 (20.07.2026 – 24.07.2026)")
    ).toBeVisible();

    await main.getByRole("link", { name: "Kunden & Projekte", exact: true }).click();
    await expect(admin).toHaveURL(/\/faktura\/kunden$/);
    await expect(
      main.getByRole("heading", { name: "Kunden & Projekte", level: 1 })
    ).toBeVisible();

    await main
      .getByRole("link", { name: "Export & Stundenzettel", exact: true })
      .click();
    await expect(admin).toHaveURL(/\/faktura\/export$/);
    await expect(
      main.getByRole("heading", { name: "Export & Stundenzettel", level: 1 })
    ).toBeVisible();

    await main.getByRole("link", { name: "Zeiterfassung", exact: true }).click();
    await expect(admin).toHaveURL(/\/faktura$/);
    await expect(
      main.getByRole("heading", { name: "Zeiterfassung", level: 1 })
    ).toBeVisible();
  });

  test("Mitarbeiter/in löscht eigene offene Buchung — Abbrechen behält sie, Bestätigen löscht", async ({
    browser,
  }) => {
    const description = `Löschtest ${TS}`;
    const entry = await insertEntry({
      projectId: must("buchungProjectId"),
      entryDate: "2026-07-21",
      minutes: 75,
      description,
    });

    const employee = await pageAs(browser, USER_STATE);
    await employee.goto("/faktura");
    const item = employee.locator("li", { hasText: description });
    await expect(item).toContainText("1,25 h");
    const deleteButton = item.getByRole("button", { name: "Löschen" });
    await waitForHydration(deleteButton);

    // Abbrechen im Bestätigungsdialog: Buchung bleibt
    const messages: string[] = [];
    employee.once("dialog", async (dialog) => {
      messages.push(dialog.message());
      await dialog.dismiss();
    });
    await deleteButton.click();
    await expect.poll(() => messages).toEqual(["Buchung wirklich löschen?"]);
    await expect(item).toBeVisible();
    expect((await getEntry(entry.id)).deleted).toBe(false);

    // Bestätigen: Soft-Delete
    employee.once("dialog", (dialog) => dialog.accept());
    await deleteButton.click();
    await expectToast(employee, "Buchung gelöscht.");
    await expect(item).toHaveCount(0);
    await expect.poll(async () => (await getEntry(entry.id)).deleted).toBe(true);

    const [audit] = await testDb()
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.objectId, entry.id), eq(auditLog.action, "geloescht"))
      );
    expect(audit?.actorLabel).toBe(USER_NAME);
  });

  test("Bearbeiten über das Monatslimit: Hinweis und „Trotzdem buchen“", async ({
    browser,
  }) => {
    const description = `Limit-Bearbeitung ${TS}`;
    // 1 h auf ein Projekt mit 2 h Monatslimit — noch ohne Warnung
    const entry = await insertEntry({
      projectId: must("limitProjectId"),
      entryDate: "2026-07-22",
      minutes: 60,
      description,
    });

    const employee = await pageAs(browser, USER_STATE);
    await employee.goto("/faktura");
    const item = employee.locator("li", { hasText: description });
    await expect(item).toContainText("1,00 h");

    const dialog = employee.getByRole("dialog");
    await openDialog(item.getByRole("button", { name: "Bearbeiten" }), dialog);
    await expect(dialog.getByText("Buchung bearbeiten")).toBeVisible();
    await expect(dialog.locator("#entry-duration")).toHaveValue("1,00");

    // Erste Stufe: Speichern liefert die Limit-Warnung statt zu speichern
    await dialog.locator("#entry-duration").fill("2,5");
    await dialog.getByRole("button", { name: "Änderungen speichern" }).click();
    await expect(dialog.getByText("Hinweis vor dem Speichern")).toBeVisible();
    await expect(
      dialog.getByText(
        "Monatslimit des Projekts überschritten: Mit dieser Buchung sind 2,50 von 2,00 Stunden im Monat gebucht."
      )
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Änderungen speichern" })
    ).toHaveCount(0);
    expect((await getEntry(entry.id)).durationMinutes).toBe(60);

    // Zweite Stufe: Trotzdem buchen → gespeichert und als Überbuchung markiert
    await dialog.getByRole("button", { name: "Trotzdem buchen" }).click();
    await expectToast(employee, "Buchung aktualisiert.");
    await expect(dialog).toBeHidden();
    await expect(item).toContainText("2,50 h");
    await expect(
      item.locator('[data-slot="badge"]', { hasText: "Überbuchung" })
    ).toBeVisible();
    await expect
      .poll(async () => {
        const row = await getEntry(entry.id);
        return { minutes: row.durationMinutes, overbooked: row.overbooked };
      })
      .toEqual({ minutes: 150, overbooked: true });
  });

  test("Kunden & Projekte: bearbeiten, Projektlaufzeit, Inaktiv setzen und Aktivieren", async ({
    browser,
  }) => {
    test.setTimeout(150_000);
    const customerId = must("stammCustomerId");
    const projectId = must("stammProjectId");
    const newCustomerName = `${STAMM_CUSTOMER} AG`;
    const newProjectName = "Wartung 2026";
    const projectLabel = `${newCustomerName} – ${newProjectName}`;

    const admin = await pageAs(browser, ADMIN_STATE);
    const employee = await pageAs(browser, USER_STATE);
    await admin.goto("/faktura/kunden");

    const card = admin.locator('[data-slot="card"]', {
      has: admin.locator(`#customer-name-${customerId}`),
    });
    const customerForm = card.locator("form", {
      has: admin.locator(`#customer-name-${customerId}`),
    });
    const customerBadge = card.locator(
      '[data-slot="card-title"] [data-slot="badge"]'
    );
    const projectRow = card.locator("li", {
      has: admin.locator(`#project-name-${projectId}`),
    });
    const projectBadge = projectRow.locator('[data-slot="badge"]').first();

    // --- Kunde bearbeiten und speichern ---
    const customerSave = customerForm.getByRole("button", { name: "Speichern" });
    await waitForHydration(customerSave);
    await admin.locator(`#customer-name-${customerId}`).fill(newCustomerName);
    await admin
      .locator(`#customer-address-${customerId}`)
      .fill("Domkloster 4, 50667 Köln");
    await admin.locator(`#customer-contact-${customerId}`).fill("Dora Kontakt");
    await customerSave.click();
    await expectToast(admin, "Kunde aktualisiert.");
    await expect(card.locator('[data-slot="card-title"]')).toContainText(
      newCustomerName
    );
    await expect
      .poll(async () => {
        const [row] = await testDb()
          .select()
          .from(fakturaCustomers)
          .where(eq(fakturaCustomers.id, customerId));
        return [row.name, row.address, row.contactPerson];
      })
      .toEqual([newCustomerName, "Domkloster 4, 50667 Köln", "Dora Kontakt"]);

    // --- Projektlaufzeit: Ende vor Beginn wird abgelehnt ---
    const projectForm = projectRow.locator("form");
    const projectSave = projectRow.getByRole("button", { name: "Speichern" });
    await admin.locator(`#project-from-${projectId}`).fill("2026-07-31");
    await admin.locator(`#project-to-${projectId}`).fill("2026-07-01");
    await projectSave.click();
    await expectToast(
      admin,
      "Das Laufzeitende darf nicht vor dem Laufzeitbeginn liegen."
    );
    // Erst weitertippen, wenn die Action samt evtl. Formular-Reset durch ist
    await expect(projectForm).toHaveAttribute("aria-busy", "false");
    const [unchanged] = await testDb()
      .select()
      .from(fakturaProjects)
      .where(eq(fakturaProjects.id, projectId));
    expect([unchanged.validFrom, unchanged.validTo]).toEqual([null, null]);

    // --- Projekt bearbeiten: Name, Laufzeit, Monatslimit ---
    await admin.locator(`#project-name-${projectId}`).fill(newProjectName);
    await admin.locator(`#project-from-${projectId}`).fill("2026-07-01");
    await admin.locator(`#project-to-${projectId}`).fill("2026-07-22");
    await admin.locator(`#project-limit-${projectId}`).fill("40");
    await projectSave.click();
    await expectToast(admin, "Projekt aktualisiert.");
    await expect(projectRow.locator("p.font-medium")).toHaveText(newProjectName);
    await expect(projectRow.getByText("Monat: 0,00 / 40,00 h")).toBeVisible();
    await expect
      .poll(async () => {
        const [row] = await testDb()
          .select()
          .from(fakturaProjects)
          .where(eq(fakturaProjects.id, projectId));
        return [row.name, row.validFrom, row.validTo, row.monthlyLimitMinutes];
      })
      .toEqual([newProjectName, "2026-07-01", "2026-07-22", 2400]);

    // Die Laufzeit greift: Buchung am 24.07. liegt nach dem Laufzeitende
    await employee.goto("/faktura");
    await openDialog(
      employee.getByTestId("neue-buchung"),
      employee.getByText("Neue Zeitbuchung")
    );
    await employee.getByTestId("projekt-auswahl").click();
    await employee.getByRole("option", { name: projectLabel }).click();
    await employee.locator("#entry-duration").fill("1");
    await employee.locator("#entry-description").fill(`Laufzeittest ${TS}`);
    await employee.getByRole("button", { name: "Buchung speichern" }).click();
    await expectToast(
      employee,
      "Das Buchungsdatum liegt außerhalb der Projektlaufzeit (01.07.2026 bis 22.07.2026). Bitte ein Datum innerhalb der Laufzeit wählen oder den Admin kontaktieren."
    );
    const booked = await testDb()
      .select({ id: fakturaTimeEntries.id })
      .from(fakturaTimeEntries)
      .where(eq(fakturaTimeEntries.projectId, projectId));
    expect(booked).toHaveLength(0);

    // --- Projekt inaktiv setzen: verschwindet aus der Buchungsauswahl ---
    await expect(projectBadge).toHaveText("aktiv");
    await projectRow.getByRole("button", { name: "Inaktiv setzen" }).click();
    await expectToast(admin, "Projekt inaktiv gesetzt.");
    await expect(projectBadge).toHaveText("inaktiv");
    await expect(
      projectRow.getByRole("button", { name: "Aktivieren" })
    ).toBeVisible();

    await openEmployeeProjectList(employee);
    await expect(
      employee.getByRole("option", { name: projectLabel })
    ).toHaveCount(0);

    await projectRow.getByRole("button", { name: "Aktivieren" }).click();
    await expectToast(admin, "Projekt aktiviert.");
    await expect(projectBadge).toHaveText("aktiv");

    // --- Kunde inaktiv setzen: alle seine Projekte sind nicht mehr buchbar ---
    await expect(customerBadge).toHaveText("aktiv");
    await customerForm.getByRole("button", { name: "Inaktiv setzen" }).click();
    await expectToast(
      admin,
      "Kunde inaktiv gesetzt — Bestandsbuchungen bleiben erhalten."
    );
    await expect(customerBadge).toHaveText("inaktiv");

    await openEmployeeProjectList(employee);
    await expect(
      employee.getByRole("option", { name: projectLabel })
    ).toHaveCount(0);

    await customerForm.getByRole("button", { name: "Aktivieren" }).click();
    await expectToast(admin, "Kunde aktiviert.");
    await expect(customerBadge).toHaveText("aktiv");

    // Nach beiden Aktivierungen ist das Projekt wieder auswählbar
    await openEmployeeProjectList(employee);
    await expect(
      employee.getByRole("option", { name: projectLabel })
    ).toBeVisible();

    const [customerRow] = await testDb()
      .select()
      .from(fakturaCustomers)
      .where(eq(fakturaCustomers.id, customerId));
    const [projectRowDb] = await testDb()
      .select()
      .from(fakturaProjects)
      .where(eq(fakturaProjects.id, projectId));
    expect(customerRow.active).toBe(true);
    expect(projectRowDb.active).toBe(true);
  });

  test("Freigabe KW 26: Ausblenden/Einblenden, Löschen mit Begründung, Freigabe widerrufen", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const originallyApproved =
      ctx.originalApproval?.status === "freigegeben";
    const status = originallyApproved ? "freigegeben" : "offen";
    const visibleDesc = `Freigabe-Sichtbarkeit ${TS}`;
    const deleteDesc = `Freigabe-Löschung ${TS}`;
    const entryA = await insertEntry({
      projectId: must("freigabeProjectId"),
      entryDate: "2026-06-23",
      minutes: 120,
      description: visibleDesc,
      status,
    });
    const entryB = await insertEntry({
      projectId: must("freigabeProjectId"),
      entryDate: "2026-06-24",
      minutes: 60,
      description: deleteDesc,
      status,
    });
    const deleteReason = `Doppelt erfasst ${TS}`;
    const revokeReason = `Nachträgliche Korrektur ${TS}`;

    const admin = await pageAs(browser, ADMIN_STATE);
    await admin.goto("/faktura/freigabe?jahr=2026&kw=26");
    const main = admin.getByRole("main");
    await expect(
      main.getByText("KW 26/2026 (22.06.2026 – 26.06.2026)")
    ).toBeVisible();
    await waitForHydration(main.getByRole("button", { name: "Buchung anlegen" }));

    const itemA = main.locator("li", { hasText: visibleDesc });
    const itemB = main.locator("li", { hasText: deleteDesc });
    const badgeOf = (item: Locator, text: string) =>
      item.locator('[data-slot="badge"]', { hasText: new RegExp(`^${text}$`) });

    // --- Woche freigeben (falls nicht schon durch eine andere Spec geschehen) ---
    if (!originallyApproved) {
      const approve = main.getByRole("button", { name: "Woche freigeben" });
      await expect(approve).toBeEnabled();
      await approve.click();
      await expectToast(
        admin,
        "Woche freigegeben — alle Buchungen sind jetzt schreibgeschützt."
      );
    }
    await expect(badgeOf(itemA, "freigegeben")).toBeVisible();
    await expect(
      main.getByRole("button", { name: "Freigabe widerrufen" })
    ).toBeVisible();

    // --- Ausblenden → Einblenden ---
    await itemA.getByRole("button", { name: "Ausblenden" }).click();
    await expectToast(admin, "Buchung für den Stundenzettel ausgeblendet.");
    await expect(badgeOf(itemA, "ausgeblendet")).toBeVisible();
    await itemA.getByRole("button", { name: "Einblenden" }).click();
    await expectToast(admin, "Buchung wieder eingeblendet.");
    await expect(badgeOf(itemA, "ausgeblendet")).toHaveCount(0);
    await expect(itemA.getByRole("button", { name: "Ausblenden" })).toBeVisible();
    await expect
      .poll(async () => (await getEntry(entryA.id)).visibleOnTimesheet)
      .toBe(true);
    const visibilityAudit = await testDb()
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.objectId, entryA.id));
    expect(visibilityAudit.map((a) => a.action)).toEqual(
      expect.arrayContaining(["ausgeblendet", "eingeblendet"])
    );

    // --- Admin-Löschen einer freigegebenen Buchung (Pflichtbegründung) ---
    const deleteButton = itemB.getByRole("button", { name: "Löschen" });
    const prompts: string[] = [];

    // Abbrechen im Prompt: nichts passiert
    admin.once("dialog", async (dialog) => {
      prompts.push(dialog.message());
      await dialog.dismiss();
    });
    await deleteButton.click();
    await expect.poll(() => prompts.length).toBe(1);
    expect(prompts[0]).toBe(
      "Begründung für die Löschung (Pflicht, Buchung ist freigegeben):"
    );
    await expect(itemB).toBeVisible();

    // Leere Begründung: Fehlermeldung, Buchung bleibt
    admin.once("dialog", (dialog) => dialog.accept(""));
    await deleteButton.click();
    await expectToast(admin, "Begründung erforderlich.");
    await expect(itemB).toBeVisible();
    expect((await getEntry(entryB.id)).deleted).toBe(false);

    // Mit Begründung: Soft-Delete
    admin.once("dialog", (dialog) => dialog.accept(deleteReason));
    await deleteButton.click();
    await expectToast(admin, "Buchung gelöscht (Soft-Delete).");
    await expect(itemB).toHaveCount(0);
    await expect.poll(async () => (await getEntry(entryB.id)).deleted).toBe(true);
    const [deleteAudit] = await testDb()
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.objectId, entryB.id),
          eq(auditLog.action, "admin_geloescht")
        )
      );
    expect(
      (deleteAudit?.details as { begruendung?: string } | null)?.begruendung
    ).toBe(deleteReason);

    // --- Freigabe widerrufen → Begründung → Widerrufen ---
    await openDialog(
      main.getByRole("button", { name: "Freigabe widerrufen" }),
      admin.locator("#revoke-reason")
    );
    await admin.locator("#revoke-reason").fill(revokeReason);
    await admin.getByRole("button", { name: "Widerrufen", exact: true }).click();
    await expectToast(admin, "Freigabe widerrufen.");
    await expect(
      main.locator('[data-slot="badge"]', { hasText: /^Freigabe widerrufen$/ })
    ).toBeVisible();
    await expect(main.getByText(`Widerrufen: ${revokeReason}`)).toBeVisible();
    await expect(badgeOf(itemA, "offen")).toBeVisible();
    await expect(
      main.getByRole("button", { name: "Freigabe widerrufen" })
    ).toHaveCount(0);
    await expect(
      main.getByRole("button", { name: "Woche freigeben" })
    ).toBeEnabled();

    await expect
      .poll(async () => {
        const approval = await getApproval();
        return [approval?.status, approval?.revokeReason];
      })
      .toEqual(["widerrufen", revokeReason]);
    expect((await getEntry(entryA.id)).status).toBe("offen");

    // --- Admin-Löschen einer offenen Buchung: Begründung optional ---
    const deleteOpen = itemA.getByRole("button", { name: "Löschen" });
    const openPrompts: string[] = [];
    // Abbrechen bricht auch bei offenen Buchungen ab
    admin.once("dialog", async (dialog) => {
      openPrompts.push(dialog.message());
      await dialog.dismiss();
    });
    await deleteOpen.click();
    await expect.poll(() => openPrompts).toEqual(["Begründung (optional):"]);
    await expect(itemA).toBeVisible();
    expect((await getEntry(entryA.id)).deleted).toBe(false);

    // Leere Begründung genügt
    admin.once("dialog", (dialog) => dialog.accept(""));
    await deleteOpen.click();
    await expectToast(admin, "Buchung gelöscht (Soft-Delete).");
    await expect(itemA).toHaveCount(0);
    await expect.poll(async () => (await getEntry(entryA.id)).deleted).toBe(true);
  });

  test("Export: Monat und Freier Zeitraum — CSV-Download und PDF herunterladen", async ({
    browser,
  }) => {
    test.setTimeout(150_000);
    const customerId = must("exportCustomerId");
    const projectId = must("exportProjectId");
    await insertEntry({
      projectId,
      entryDate: "2026-06-09",
      minutes: 120,
      description: "Juni-Workshop A",
    });
    await insertEntry({
      projectId,
      entryDate: "2026-06-17",
      minutes: 90,
      description: "Juni-Workshop B",
    });
    await insertEntry({
      projectId,
      entryDate: "2026-05-29",
      minutes: 60,
      description: "Mai-Vorbereitung",
    });

    const findSheet = async (from: string, to: string) => {
      const [row] = await testDb()
        .select()
        .from(fakturaTimesheets)
        .where(
          and(
            eq(fakturaTimesheets.customerId, customerId),
            eq(fakturaTimesheets.periodFrom, from),
            eq(fakturaTimesheets.periodTo, to)
          )
        )
        .orderBy(desc(fakturaTimesheets.version));
      return row;
    };

    const admin = await pageAs(browser, ADMIN_STATE);
    await admin.goto("/faktura/export");
    const csvButton = admin.getByRole("button", {
      name: "Rohdaten-Export (CSV)",
    });
    const pdfButton = admin.getByRole("button", {
      name: "Stundenzettel (PDF) erzeugen",
    });

    // Ohne Kunde sind beide Aktionen gesperrt
    await expect(csvButton).toBeDisabled();
    await expect(pdfButton).toBeDisabled();
    await selectOption(admin, "Kunde wählen", EXPORT_CUSTOMER);

    // --- Modus Monat (Standard): Juni 2026 ---
    await expect(admin.locator("#export-month")).toHaveValue("2026-07");
    await admin.locator("#export-month").fill("2026-06");
    await expect(csvButton).toBeEnabled();

    const monthCsv = await captureDownload(admin, () => csvButton.click());
    expect(monthCsv.url.pathname).toBe("/api/exports/faktura");
    expect(monthCsv.url.searchParams.get("kunde")).toBe(customerId);
    expect(monthCsv.url.searchParams.get("von")).toBe("2026-06-01");
    expect(monthCsv.url.searchParams.get("bis")).toBe("2026-06-30");
    expect(monthCsv.filename).toBe(`Faktura_${EXPORT_FILE_PART}_2026-06.csv`);
    const monthText = csvText(monthCsv.content);
    expect(monthText.split("\r\n")[0]).toBe(
      "Datum;Kalenderwoche;Mitarbeiter/in;Kunde;Projekt;Tätigkeit;Dauer (h);Status;Im Stundenzettel sichtbar;Überbuchung;Gelöscht;Erstellt am;Zuletzt geändert am;Buchungs-ID"
    );
    expect(monthText).toContain(
      `"09.06.2026";"KW 24/2026";"${USER_NAME}";"${EXPORT_CUSTOMER}";"Reporting";"Juni-Workshop A";"2,00";"offen";"ja";"nein";"nein"`
    );
    expect(monthText).toContain(
      `"17.06.2026";"KW 25/2026";"${USER_NAME}";"${EXPORT_CUSTOMER}";"Reporting";"Juni-Workshop B";"1,50";"offen"`
    );
    expect(monthText).not.toContain("Mai-Vorbereitung");

    // Antwort der Route direkt prüfen (Header)
    const monthResponse = await admin.request.get(monthCsv.url.toString());
    expect(monthResponse.status()).toBe(200);
    expect(monthResponse.headers()["content-type"]).toContain("text/csv");
    expect(monthResponse.headers()["content-disposition"]).toBe(
      `attachment; filename="Faktura_${EXPORT_FILE_PART}_2026-06.csv"`
    );

    // Stundenzettel für den Monat — offene Buchungen → Entwurf
    // (großzügige Timeouts: der erste PDF-Render kompiliert im Dev-Server)
    await pdfButton.click();
    await expect(
      admin
        .getByText(
          /^Entwurf SZ-\d{4}-\d{4} v1 erzeugt — Zeitraum enthält nicht freigegebene Buchungen \(Wasserzeichen\)\.$/
        )
        .first()
    ).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(() => findSheet("2026-06-01", "2026-06-30"), { timeout: 30_000 })
      .toBeTruthy();
    const monthSheet = await findSheet("2026-06-01", "2026-06-30");
    expect(monthSheet.isDraft).toBe(true);
    expect(monthSheet.version).toBe(1);

    // --- Modus Freier Zeitraum ---
    await selectOption(admin, "Kalendermonat (Standard)", "Freier Zeitraum");
    await expect(admin.locator("#export-month")).toHaveCount(0);
    await expect(csvButton).toBeDisabled();
    await expect(pdfButton).toBeDisabled();
    await admin.locator("#export-from").fill("2026-06-08");
    await expect(csvButton).toBeDisabled();
    // Ende vor Beginn bleibt gesperrt
    await admin.locator("#export-to").fill("2026-06-05");
    await expect(csvButton).toBeDisabled();
    await admin.locator("#export-to").fill("2026-06-12");
    await expect(csvButton).toBeEnabled();
    await expect(pdfButton).toBeEnabled();

    const freeCsv = await captureDownload(admin, () => csvButton.click());
    expect(freeCsv.url.pathname).toBe("/api/exports/faktura");
    expect(freeCsv.url.searchParams.get("kunde")).toBe(customerId);
    expect(freeCsv.url.searchParams.get("von")).toBe("2026-06-08");
    expect(freeCsv.url.searchParams.get("bis")).toBe("2026-06-12");
    expect(freeCsv.filename).toBe(
      `Faktura_${EXPORT_FILE_PART}_2026-06-08_2026-06-12.csv`
    );
    const freeText = csvText(freeCsv.content);
    expect(freeText).toContain("Juni-Workshop A");
    expect(freeText).not.toContain("Juni-Workshop B");
    expect(freeText).not.toContain("Mai-Vorbereitung");

    await pdfButton.click();
    await expect
      .poll(() => findSheet("2026-06-08", "2026-06-12"), { timeout: 30_000 })
      .toBeTruthy();
    const freeSheet = await findSheet("2026-06-08", "2026-06-12");
    expect(freeSheet.isDraft).toBe(true);
    expect(freeSheet.docNumber).not.toBe(monthSheet.docNumber);

    // --- Archiv: „PDF herunterladen" ---
    await admin.reload();
    const monthRow = admin
      .getByRole("row")
      .filter({ hasText: EXPORT_CUSTOMER })
      .filter({ hasText: "01.06.2026 – 30.06.2026" });
    await expect(monthRow).toHaveCount(1);
    await expect(monthRow).toContainText(`${monthSheet.docNumber} · v1`);
    await expect(
      monthRow.locator('[data-slot="badge"]', { hasText: "Entwurf" })
    ).toBeVisible();

    const pdf = await captureDownload(admin, () =>
      monthRow.getByRole("button", { name: "PDF herunterladen" }).click()
    );
    expect(pdf.url.pathname).toBe(`/api/faktura/stundenzettel/${monthSheet.id}`);
    expect(pdf.filename).toBe(
      `Stundenzettel_${EXPORT_FILE_PART}_2026-06_v1.pdf`
    );
    expect(pdf.content.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const parsed = await pdfParse(pdf.content);
    expect(parsed.text).toContain(EXPORT_CUSTOMER);
    expect(parsed.text).toContain("Juni-Workshop A");
    expect(parsed.text).toContain("Juni-Workshop B");
    expect(parsed.text).toContain("Zwischensumme Reporting");
    expect(parsed.text).toContain("3,50");
    expect(parsed.text).not.toContain("Mai-Vorbereitung");
    expect(parsed.text).toMatch(
      /ENTWURF[\s\S]{0,6}–[\s\S]{0,6}nicht[\s\S]{0,6}freigegeben/
    );

    // Proxy-Route des frei gewählten Zeitraums: Header der Antwort
    const freeRow = admin
      .getByRole("row")
      .filter({ hasText: EXPORT_CUSTOMER })
      .filter({ hasText: "08.06.2026 – 12.06.2026" });
    await expect(freeRow).toHaveCount(1);
    const freeResponse = await fetchHref(
      admin,
      freeRow.getByRole("button", { name: "PDF herunterladen" })
    );
    expect(freeResponse.status()).toBe(200);
    expect(freeResponse.headers()["content-type"]).toContain("application/pdf");
    expect(freeResponse.headers()["content-disposition"]).toBe(
      `attachment; filename="Stundenzettel_${EXPORT_FILE_PART}_2026-06-08_2026-06-12_v1.pdf"`
    );
    expect(freeResponse.headers()["x-dokumentnummer"]).toBe(freeSheet.docNumber);
    expect(freeResponse.headers()["x-version"]).toBe("1");
    expect(freeResponse.headers()["x-sha256"]).toBe(freeSheet.sha256);
  });
});
