import { readFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { and, eq, inArray } from "drizzle-orm";
import {
  auditLog,
  itEquipment,
  itEquipmentDocuments,
  itEquipmentTypes,
  users,
} from "../../src/db/schema";
import { E2E_ADMIN_EMAIL, testDb } from "../helpers/db";
import { ADMIN_NAME, ADMIN_STATE, expectToast, fetchHref, openDialog, pageAs } from "./helpers";

// Klassisches pdf-parse (1.x) — Text-Extraktion für die Protokoll-Vorlagen
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse/lib/pdf-parse.js") as (
  buffer: Buffer
) => Promise<{ text: string; numpages: number }>;

/**
 * IT-Management (/it-management): fünf Reiter, Ausstattung, Arten,
 * Protokolle und CSV-Austausch. Jeder Test arbeitet mit eigens angelegten
 * Personen, Arten und Geräten (eindeutige Namen/IDs) und räumt sie ab.
 * Der CSV-Import löscht Geräte, die in der Datei fehlen — deshalb enthält die
 * Importdatei stets alle vorhandenen Geräte bis auf das eigene Testgerät.
 */

const CSV_HEADER = [
  "Geräte-ID",
  "Geräte-ID neu (optional)",
  "Mitarbeiter-E-Mail",
  "Mitarbeiter/in (nur Info)",
  "Ausstattungsart",
  "Seriennummer",
  "Übernahme am",
  "Rückgabe am",
  "Zusatzinformationen",
  "Status (nur Info)",
];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Reiter über seine Beschriftung — der Zähler dahinter ist optional. */
function tab(page: Page, label: string, count?: number): Locator {
  const suffix = count === undefined ? "(\\s*\\d+)?" : `\\s*${count}`;
  return page.getByRole("tab", {
    name: new RegExp(`^${escapeRegExp(label)}${suffix}$`),
  });
}

/** Reiter anklicken — mit Wiederholung, falls die Hydration noch läuft. */
async function clickTab(page: Page, label: string): Promise<void> {
  const target = tab(page, label);
  await expect(async () => {
    await target.click();
    await expect(target).toHaveAttribute("aria-selected", "true", {
      timeout: 2_000,
    });
  }).toPass({ timeout: 20_000 });
}

function rowWith(page: Page, text: string): Locator {
  return page.getByRole("row").filter({ hasText: text });
}

/** Zeile eines Geräts — exakt über die Zelle mit der Geräte-ID. */
function deviceRow(page: Page, deviceId: string): Locator {
  return page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: deviceId, exact: true }) });
}

function dialogWith(page: Page, title: string): Locator {
  return page.getByRole("dialog").filter({ hasText: title });
}

/** Download über einen Button auslösen und die Datei einlesen. */
async function download(
  page: Page,
  trigger: Locator
): Promise<{ filename: string; body: Buffer }> {
  const [file] = await Promise.all([
    page.waitForEvent("download"),
    trigger.click(),
  ]);
  return {
    filename: file.suggestedFilename(),
    body: await readFile(await file.path()),
  };
}

/** Nächste freie Geräte-ID — gleiche Regel wie suggestNextDeviceId. */
function nextDeviceId(existing: string[], year: number): string {
  const highest = existing.reduce((max, id) => {
    const match = id.trim().match(/^SA-IT-\d{4}-(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `SA-IT-${year}-${String(highest + 1).padStart(2, "0")}`;
}

/** Semikolon-CSV mit Anführungszeichen einlesen (wie der Import der App). */
function parseCsv(text: string): string[][] {
  const input = text.startsWith("﻿") ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ";") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") field += char;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** CSV im Exportformat schreiben: BOM, Semikolon, CRLF, alles in Quotes. */
function toCsv(rows: string[][]): string {
  return (
    "﻿" +
    rows
      .map((row) =>
        row.map((value) => `"${value.replaceAll('"', '""')}"`).join(";")
      )
      .join("\r\n")
  );
}

async function adminUserId(): Promise<string> {
  const [admin] = await testDb()
    .select()
    .from(users)
    .where(eq(users.email, E2E_ADMIN_EMAIL));
  return admin.id;
}

/** Eigene Person für die IT-Tests (aktiv, ohne Clerk). */
async function createEmployee(ts: number) {
  const [user] = await testDb()
    .insert(users)
    .values({
      email: `e2e-it-${ts}@stefanai.de`,
      firstName: "Ida",
      lastName: `IT${ts}`,
      role: "mitarbeiter",
      status: "aktiv",
      annualVacationDays: 30,
    })
    .returning();
  return { ...user, name: `Ida IT${ts}` };
}

async function createType(name: string) {
  const [type] = await testDb()
    .insert(itEquipmentTypes)
    .values({ name, sortOrder: 900 })
    .returning();
  return type;
}

async function insertEquipment(values: {
  userId: string;
  typeId: string;
  deviceId: string;
  handoverDate: string;
  returnDate?: string | null;
  serialNumber?: string | null;
  notes?: string | null;
}) {
  const [item] = await testDb()
    .insert(itEquipment)
    .values({ ...values, createdById: await adminUserId() })
    .returning();
  return item;
}

async function readEquipment(deviceId: string) {
  const [item] = await testDb()
    .select()
    .from(itEquipment)
    .where(eq(itEquipment.deviceId, deviceId));
  return item;
}

/** Geräte, Protokolle, Arten und Personen der Tests entfernen. */
async function cleanup(opts: { userIds?: string[]; typeIds?: string[] }) {
  const db = testDb();
  const userIds = opts.userIds ?? [];
  const typeIds = opts.typeIds ?? [];
  if (userIds.length > 0) {
    await db.delete(itEquipment).where(inArray(itEquipment.userId, userIds));
    await db
      .delete(itEquipmentDocuments)
      .where(inArray(itEquipmentDocuments.userId, userIds));
  }
  if (typeIds.length > 0) {
    await db.delete(itEquipment).where(inArray(itEquipment.typeId, typeIds));
    await db
      .delete(itEquipmentTypes)
      .where(inArray(itEquipmentTypes.id, typeIds));
  }
  if (userIds.length > 0)
    await db.delete(users).where(inArray(users.id, userIds));
}

/** Minimales PDF — der Server prüft Typ und Größe, nicht den Inhalt. */
function pdfBuffer(label: string): Buffer {
  return Buffer.from(`%PDF-1.4\n% ${label}\n%%EOF\n`, "latin1");
}

/** 1×1-PNG */
const PNG_BUFFER = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

test.describe("IT-Management", () => {
  // Mehrschrittige Abläufe gegen `next dev` (Kompilieren beim ersten Aufruf)
  test.describe.configure({ timeout: 120_000 });

  test("Alle fünf Reiter mit Zählern und Inhalten", async ({ browser }) => {
    const db = testDb();
    const [equipment, allUsers, types] = await Promise.all([
      db.select().from(itEquipment),
      db.select().from(users),
      db.select().from(itEquipmentTypes),
    ]);
    const inUse = equipment.filter((e) => e.returnDate === null).length;

    const admin = await pageAs(browser, ADMIN_STATE);
    await admin.goto("/it-management");
    await expect(
      admin.getByRole("heading", { name: "IT-Management", exact: true })
    ).toBeVisible();
    await expect(tab(admin, "Im Einsatz", inUse)).toBeVisible();
    await expect(
      tab(admin, "Zurückgegeben", equipment.length - inUse)
    ).toBeVisible();
    await expect(tab(admin, "Mitarbeitende", allUsers.length)).toBeVisible();
    await expect(tab(admin, "Ausstattungsarten", types.length)).toBeVisible();
    await expect(tab(admin, "Export & Import")).toBeVisible();

    // Im Einsatz (voreingestellt) — mit Anlegen-Button
    await expect(tab(admin, "Im Einsatz")).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await expect(
      admin.getByText("Aktuell ausgegebene Ausstattung — sortiert nach Geräte-ID.")
    ).toBeVisible();
    await expect(
      admin.getByRole("button", { name: "Ausstattung erfassen" })
    ).toBeVisible();

    // Zurückgegeben — ohne Anlegen-Button
    await clickTab(admin, "Zurückgegeben");
    await expect(
      admin.getByText(
        "Bereits zurückgegebene Ausstattung — bleibt als Nachweis erhalten."
      )
    ).toBeVisible();
    await expect(
      admin.getByRole("button", { name: "Ausstattung erfassen" })
    ).toHaveCount(0);

    // Mitarbeitende — je Person Vorlagen und Protokolle
    await clickTab(admin, "Mitarbeitende");
    await expect(
      admin.getByText("Die Ausstattung wird gesammelt übergeben")
    ).toBeVisible();
    await expect(rowWith(admin, ADMIN_NAME)).toBeVisible();
    await expect(
      admin.getByRole("columnheader", { name: "Vorlagen (PDF)" })
    ).toBeVisible();

    // Ausstattungsarten — die Seed-Arten sind gelistet
    await clickTab(admin, "Ausstattungsarten");
    await expect(
      admin.getByText(
        "Bestimmen die Auswahl beim Erfassen von Ausstattung — sortiert nach Reihenfolge."
      )
    ).toBeVisible();
    await expect(
      admin.getByRole("button", { name: "Neue Ausstattungsart" })
    ).toBeVisible();

    // Export & Import — ohne Datei ist "Datei prüfen" gesperrt
    await clickTab(admin, "Export & Import");
    await expect(
      admin.getByRole("heading", { name: "Exportieren", exact: true })
    ).toBeVisible();
    await expect(
      admin.getByRole("heading", { name: "Importieren", exact: true })
    ).toBeVisible();
    await expect(
      admin.getByRole("button", { name: "Liste als CSV herunterladen" })
    ).toBeVisible();
    await expect(
      admin.getByRole("button", { name: "Datei prüfen" })
    ).toBeDisabled();

    // Zurück zum ersten Reiter
    await clickTab(admin, "Im Einsatz");
    await expect(
      admin.getByRole("button", { name: "Ausstattung erfassen" })
    ).toBeVisible();
  });

  test("Ausstattung erfassen (ID-Vorschlag), bearbeiten, Rückgabe erfassen/zurücknehmen, löschen", async ({
    browser,
  }) => {
    const ts = Date.now();
    const employee = await createEmployee(ts);
    const typeName = `E2E-Gerät ${ts}`;
    const type = await createType(typeName);
    const title = `${typeName} — ${employee.name}`;
    const overrideId = `E2E-${String(ts).slice(-6)}-B`;
    const admin = await pageAs(browser, ADMIN_STATE);

    try {
      const existingIds = (
        await testDb().select({ deviceId: itEquipment.deviceId }).from(itEquipment)
      ).map((e) => e.deviceId);
      const year = new Date().getFullYear();
      const suggestedId = nextDeviceId(existingIds, year);

      await admin.goto("/it-management");
      const createButton = admin.getByRole("button", {
        name: "Ausstattung erfassen",
      });
      const createDialog = dialogWith(admin, "Ausstattung erfassen");

      // 1. Gerät: vorgeschlagene Geräte-ID übernehmen
      await openDialog(createButton, createDialog);
      await expect(
        createDialog.getByLabel("Geräte-ID", { exact: true })
      ).toHaveValue(suggestedId);
      await createDialog
        .getByLabel("Mitarbeiter/in", { exact: true })
        .selectOption({ label: employee.name });
      await createDialog
        .getByLabel("Ausstattung", { exact: true })
        .selectOption({ label: typeName });
      await createDialog
        .getByLabel("Seriennummer (optional)", { exact: true })
        .fill(`SN-${ts}-A`);
      await createDialog
        .getByLabel("Übernahme am", { exact: true })
        .fill("2026-09-01");
      await createDialog
        .getByLabel("Zusatzinformationen (optional)", { exact: true })
        .fill("E2E: Erstausstattung");
      await createDialog
        .getByRole("button", { name: "Ausstattung speichern" })
        .click();
      await expectToast(admin, "Ausstattung erfasst.");
      await expect(createDialog).toBeHidden();

      expect(await readEquipment(suggestedId)).toMatchObject({
        userId: employee.id,
        typeId: type.id,
        serialNumber: `SN-${ts}-A`,
        handoverDate: "2026-09-01",
        returnDate: null,
        notes: "E2E: Erstausstattung",
      });
      const rowA = deviceRow(admin, suggestedId);
      await expect(rowA).toContainText(employee.name);
      await expect(rowA).toContainText(typeName);
      await expect(rowA).toContainText("01.09.2026");
      await expect(rowA.getByText("im Einsatz", { exact: true })).toBeVisible();

      // 2. Gerät: der Vorschlag zählt weiter, die ID wird überschrieben
      await openDialog(createButton, createDialog);
      await expect(
        createDialog.getByLabel("Geräte-ID", { exact: true })
      ).toHaveValue(nextDeviceId([...existingIds, suggestedId], year));
      await createDialog
        .getByLabel("Geräte-ID", { exact: true })
        .fill(overrideId);
      await createDialog
        .getByLabel("Mitarbeiter/in", { exact: true })
        .selectOption({ label: employee.name });
      await createDialog
        .getByLabel("Ausstattung", { exact: true })
        .selectOption({ label: typeName });
      await createDialog
        .getByLabel("Übernahme am", { exact: true })
        .fill("2026-09-01");
      await createDialog
        .getByRole("button", { name: "Ausstattung speichern" })
        .click();
      await expect(createDialog).toBeHidden();
      await expect
        .poll(async () => (await readEquipment(overrideId))?.serialNumber)
        .toBeNull();
      const rowB = deviceRow(admin, overrideId);
      await expect(rowB).toBeVisible();

      // Bearbeiten
      const editDialog = dialogWith(admin, title);
      await openDialog(rowA.getByRole("button", { name: "Bearbeiten" }), editDialog);
      await expect(
        editDialog.getByLabel("Geräte-ID", { exact: true })
      ).toHaveValue(suggestedId);
      await editDialog
        .getByLabel("Seriennummer (optional)", { exact: true })
        .fill(`SN-${ts}-A2`);
      await editDialog
        .getByLabel("Zusatzinformationen (optional)", { exact: true })
        .fill("E2E: Akku getauscht");
      await editDialog.getByRole("button", { name: "Speichern" }).click();
      await expectToast(admin, "Ausstattung aktualisiert.");
      await expect(editDialog).toBeHidden();
      await expect(rowA).toContainText(`SN-${ts}-A2`);
      expect(await readEquipment(suggestedId)).toMatchObject({
        serialNumber: `SN-${ts}-A2`,
        notes: "E2E: Akku getauscht",
      });

      // Rückgabe erfassen
      const returnDialog = dialogWith(admin, "Rückgabe erfassen");
      await openDialog(
        rowB.getByRole("button", { name: "Rückgabe erfassen" }),
        returnDialog
      );
      await expect(returnDialog).toContainText(
        `„${typeName}“ von ${employee.name} — übernommen am 01.09.2026.`
      );
      await returnDialog
        .getByLabel("Rückgabe am", { exact: true })
        .fill("2026-09-30");
      await returnDialog
        .getByRole("button", { name: "Rückgabe speichern" })
        .click();
      await expectToast(admin, "Rückgabe erfasst.");
      await expect(returnDialog).toBeHidden();
      await expect(rowB).toHaveCount(0);
      expect((await readEquipment(overrideId)).returnDate).toBe("2026-09-30");

      // Im Reiter "Zurückgegeben": Rückgabe zurücknehmen
      await clickTab(admin, "Zurückgegeben");
      await expect(rowB).toContainText("30.09.2026");
      await expect(
        rowB.getByText("zurückgegeben", { exact: true })
      ).toBeVisible();
      await rowB.getByRole("button", { name: "Rückgabe zurücknehmen" }).click();
      await expectToast(admin, "Ausstattung gilt wieder als im Einsatz.");
      await expect(rowB).toHaveCount(0);
      await expect
        .poll(async () => (await readEquipment(overrideId)).returnDate)
        .toBeNull();

      await clickTab(admin, "Im Einsatz");
      await expect(rowB.getByText("im Einsatz", { exact: true })).toBeVisible();

      // Löschen — "Abbrechen" behält das Gerät
      const confirm = dialogWith(admin, "Ausstattung löschen?");
      await rowB.getByRole("button", { name: "Löschen" }).click();
      await expect(confirm).toContainText(`„${title}“`);
      await confirm.getByRole("button", { name: "Abbrechen" }).click();
      await expect(confirm).toBeHidden();
      await expect(rowB).toBeVisible();

      for (const [deviceId, row] of [
        [overrideId, rowB],
        [suggestedId, rowA],
      ] as const) {
        await row.getByRole("button", { name: "Löschen" }).click();
        await confirm.getByRole("button", { name: "Endgültig löschen" }).click();
        await expectToast(admin, "Ausstattung gelöscht.");
        await expect(confirm).toBeHidden();
        await expect(row).toHaveCount(0);
        await expect
          .poll(async () => (await readEquipment(deviceId)) === undefined)
          .toBe(true);
      }
    } finally {
      await cleanup({ userIds: [employee.id], typeIds: [type.id] });
    }
  });

  test("Ausstattungsarten: anlegen, bearbeiten, aus- und einblenden, löschen", async ({
    browser,
  }) => {
    const db = testDb();
    const ts = Date.now();
    const name = `E2E-Art ${ts}`;
    const renamed = `E2E-Art geändert ${ts}`;
    const readType = async (typeName: string) =>
      (
        await db
          .select()
          .from(itEquipmentTypes)
          .where(eq(itEquipmentTypes.name, typeName))
      )[0];
    const admin = await pageAs(browser, ADMIN_STATE);

    try {
      await admin.goto("/it-management");
      await clickTab(admin, "Ausstattungsarten");

      // Anlegen
      const createDialog = dialogWith(admin, "Ausstattungsart anlegen");
      await openDialog(
        admin.getByRole("button", { name: "Neue Ausstattungsart" }),
        createDialog
      );
      await createDialog.getByLabel("Bezeichnung", { exact: true }).fill(name);
      await createDialog.getByLabel("Reihenfolge", { exact: true }).fill("910");
      await createDialog.getByRole("button", { name: "Art hinzufügen" }).click();
      await expectToast(admin, "Ausstattungsart angelegt.");
      await expect(createDialog).toBeHidden();

      const row = rowWith(admin, name);
      await expect(row.getByRole("cell").nth(0)).toHaveText("910");
      await expect(row.getByRole("cell").nth(2)).toHaveText("0");
      await expect(row.getByText("sichtbar", { exact: true })).toBeVisible();
      expect(await readType(name)).toMatchObject({ sortOrder: 910, active: true });

      // Bearbeiten
      const editDialog = dialogWith(admin, "Ausstattungsart bearbeiten");
      await openDialog(row.getByRole("button", { name: "Bearbeiten" }), editDialog);
      await expect(
        editDialog.getByLabel("Bezeichnung", { exact: true })
      ).toHaveValue(name);
      await editDialog
        .getByLabel("Bezeichnung", { exact: true })
        .fill(renamed);
      await editDialog.getByLabel("Reihenfolge", { exact: true }).fill("920");
      await editDialog.getByRole("button", { name: "Speichern" }).click();
      await expectToast(admin, "Ausstattungsart aktualisiert.");
      await expect(editDialog).toBeHidden();

      const renamedRow = rowWith(admin, renamed);
      await expect(renamedRow.getByRole("cell").nth(0)).toHaveText("920");
      expect(await readType(name)).toBeUndefined();
      expect(await readType(renamed)).toMatchObject({ sortOrder: 920 });

      // Ausblenden — die Art steht beim Erfassen nicht mehr zur Auswahl
      await renamedRow.getByRole("button", { name: "Ausblenden" }).click();
      await expectToast(admin, "Ausstattungsart ausgeblendet.");
      await expect(
        renamedRow.getByText("ausgeblendet", { exact: true })
      ).toBeVisible();
      await expect
        .poll(async () => (await readType(renamed)).active)
        .toBe(false);

      await clickTab(admin, "Im Einsatz");
      const equipmentDialog = dialogWith(admin, "Ausstattung erfassen");
      await openDialog(
        admin.getByRole("button", { name: "Ausstattung erfassen" }),
        equipmentDialog
      );
      const typeSelect = equipmentDialog.getByLabel("Ausstattung", {
        exact: true,
      });
      await expect(
        typeSelect.locator("option", { hasText: renamed })
      ).toHaveCount(0);
      await equipmentDialog.getByRole("button", { name: "Abbrechen" }).click();
      await expect(equipmentDialog).toBeHidden();

      // Einblenden
      await clickTab(admin, "Ausstattungsarten");
      await renamedRow.getByRole("button", { name: "Einblenden" }).click();
      await expectToast(admin, "Ausstattungsart eingeblendet.");
      await expect(
        renamedRow.getByText("sichtbar", { exact: true })
      ).toBeVisible();
      await expect
        .poll(async () => (await readType(renamed)).active)
        .toBe(true);

      // Löschen — "Abbrechen" behält die Art
      const confirm = dialogWith(admin, "Ausstattungsart löschen?");
      await renamedRow.getByRole("button", { name: "Löschen" }).click();
      await expect(confirm).toContainText(`„${renamed}“`);
      await confirm.getByRole("button", { name: "Abbrechen" }).click();
      await expect(confirm).toBeHidden();
      await expect(renamedRow).toBeVisible();

      await renamedRow.getByRole("button", { name: "Löschen" }).click();
      await confirm.getByRole("button", { name: "Endgültig löschen" }).click();
      await expectToast(admin, "Ausstattungsart gelöscht.");
      await expect(confirm).toBeHidden();
      await expect(renamedRow).toHaveCount(0);
      expect(await readType(renamed)).toBeUndefined();
    } finally {
      await db
        .delete(itEquipmentTypes)
        .where(inArray(itEquipmentTypes.name, [name, renamed]));
    }
  });

  test("Verwendete Ausstattungsart lässt sich nicht löschen", async ({
    browser,
  }) => {
    const ts = Date.now();
    const short = String(ts).slice(-6);
    const employee = await createEmployee(ts);
    const usedType = await createType(`E2E-Art belegt ${ts}`);
    const raceType = await createType(`E2E-Art später belegt ${ts}`);
    await insertEquipment({
      userId: employee.id,
      typeId: usedType.id,
      deviceId: `E2E-${short}-USED`,
      handoverDate: "2026-09-01",
    });
    const admin = await pageAs(browser, ADMIN_STATE);

    try {
      await admin.goto("/it-management");
      await clickTab(admin, "Ausstattungsarten");
      await expect(
        admin.getByText(
          "Verwendete Arten lassen sich nicht löschen, nur ausblenden — so bleibt die Historie lesbar."
        )
      ).toBeVisible();

      // Verwendete Art: Zähler 1, kein Löschen — nur Aus-/Einblenden und
      // Bearbeiten
      const usedRow = rowWith(admin, usedType.name);
      await expect(usedRow.getByRole("cell").nth(2)).toHaveText("1");
      await expect(
        usedRow.getByRole("button", { name: "Ausblenden" })
      ).toBeVisible();
      await expect(
        usedRow.getByRole("button", { name: "Bearbeiten" })
      ).toBeVisible();
      await expect(usedRow.getByRole("button", { name: "Löschen" })).toHaveCount(
        0
      );

      // Auch wenn die Liste veraltet ist, lehnt der Server das Löschen ab:
      // Die Art wird erst nach dem Laden der Seite verwendet.
      const raceRow = rowWith(admin, raceType.name);
      await expect(raceRow.getByRole("cell").nth(2)).toHaveText("0");
      await insertEquipment({
        userId: employee.id,
        typeId: raceType.id,
        deviceId: `E2E-${short}-RACE`,
        handoverDate: "2026-09-01",
      });
      const confirm = dialogWith(admin, "Ausstattungsart löschen?");
      await raceRow.getByRole("button", { name: "Löschen" }).click();
      await confirm.getByRole("button", { name: "Endgültig löschen" }).click();
      await expect(
        admin.getByText(
          /wird noch verwendet und kann nicht gelöscht werden — bitte stattdessen ausblenden\.$/
        )
      ).toBeVisible();
      // Der Dialog bleibt bei einem Fehler offen
      await expect(confirm).toBeVisible();
      await confirm.getByRole("button", { name: "Abbrechen" }).click();
      await expect(confirm).toBeHidden();
      expect(
        await testDb()
          .select()
          .from(itEquipmentTypes)
          .where(eq(itEquipmentTypes.id, raceType.id))
      ).toHaveLength(1);

      // Nach dem Neuladen ist auch hier kein Löschen mehr angeboten
      await admin.reload();
      await clickTab(admin, "Ausstattungsarten");
      await expect(raceRow.getByRole("cell").nth(2)).toHaveText("1");
      await expect(raceRow.getByRole("button", { name: "Löschen" })).toHaveCount(
        0
      );
    } finally {
      await cleanup({
        userIds: [employee.id],
        typeIds: [usedType.id, raceType.id],
      });
    }
  });

  test("Protokoll-Vorlagen „Übergabe“ und „Rücknahme“ als PDF, inaktiv ohne Ausstattung", async ({
    browser,
  }) => {
    const ts = Date.now();
    const short = String(ts).slice(-6);
    const employee = await createEmployee(ts);
    const type = await createType(`E2E-Art Vorlage ${ts}`);
    const admin = await pageAs(browser, ADMIN_STATE);

    try {
      await admin.goto("/it-management");
      await clickTab(admin, "Mitarbeitende");
      const row = rowWith(admin, employee.name);
      const handover = row.getByRole("button", { name: "Übergabe", exact: true });
      const takeBack = row.getByRole("button", {
        name: "Rücknahme",
        exact: true,
      });

      // Ohne Ausstattung sind beide Vorlagen gesperrt
      await expect(row.getByRole("cell").nth(1)).toHaveText("0");
      await expect(handover).toBeDisabled();
      await expect(handover).toHaveAttribute(
        "title",
        "Keine Ausstattung im Einsatz."
      );
      await expect(takeBack).toBeDisabled();
      await expect(takeBack).toHaveAttribute(
        "title",
        "Keine Ausstattung erfasst."
      );

      // Ein Gerät im Einsatz, eines bereits zurückgegeben
      const inUse = await insertEquipment({
        userId: employee.id,
        typeId: type.id,
        deviceId: `E2E-${short}-1`,
        handoverDate: "2026-09-01",
      });
      await insertEquipment({
        userId: employee.id,
        typeId: type.id,
        deviceId: `E2E-${short}-2`,
        handoverDate: "2026-08-03",
        returnDate: "2026-09-15",
      });
      await admin.reload();
      await clickTab(admin, "Mitarbeitende");
      await expect(row.getByRole("cell").nth(1)).toHaveText("1");
      await expect(handover).toBeEnabled();
      await expect(takeBack).toBeEnabled();

      // Übergabe: nur die Ausstattung im Einsatz
      const handoverPdf = await download(admin, handover);
      expect(handoverPdf.filename).toMatch(
        new RegExp(`^Uebergabeprotokoll_Ida-IT${ts}_\\d{4}-\\d{2}-\\d{2}\\.pdf$`)
      );
      expect(handoverPdf.body.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      const handoverText = (await pdfParse(handoverPdf.body)).text;
      expect(handoverText).toContain("Übergabeprotokoll");
      expect(handoverText).toContain(employee.name);
      expect(handoverText).toMatch(/1 Position(?!en)/);

      // Rücknahme: alle erfassten Geräte samt Rückgabedatum
      const takeBackPdf = await download(admin, takeBack);
      expect(takeBackPdf.filename).toMatch(
        new RegExp(`^Ruecknahmeprotokoll_Ida-IT${ts}_\\d{4}-\\d{2}-\\d{2}\\.pdf$`)
      );
      const takeBackText = (await pdfParse(takeBackPdf.body)).text;
      expect(takeBackText).toContain("Rücknahmeprotokoll");
      expect(takeBackText).toContain(employee.name);
      expect(takeBackText).toContain("2 Positionen");
      expect(takeBackText).toContain("15.09.2026");

      // Ist nichts mehr im Einsatz, ist nur noch die Rücknahme möglich
      await testDb()
        .update(itEquipment)
        .set({ returnDate: "2026-09-30" })
        .where(eq(itEquipment.id, inUse.id));
      await admin.reload();
      await clickTab(admin, "Mitarbeitende");
      await expect(row.getByRole("cell").nth(1)).toHaveText("0");
      await expect(handover).toBeDisabled();
      await expect(takeBack).toBeEnabled();
      const refused = await admin.request.get(
        `/api/exports/it-protokoll?mitarbeiter=${employee.id}&art=uebergabe`
      );
      expect(refused.status()).toBe(400);
      expect(await refused.json()).toEqual({
        fehler: `Für ${employee.name} ist keine Ausstattung im Einsatz.`,
      });
    } finally {
      await cleanup({ userIds: [employee.id], typeIds: [type.id] });
    }
  });

  test("Protokolle hochladen, ersetzen, herunterladen und löschen", async ({
    browser,
  }) => {
    test.skip(
      !process.env.BLOB_READ_WRITE_TOKEN,
      "BLOB_READ_WRITE_TOKEN nicht gesetzt — Protokoll-Upload wird übersprungen."
    );
    const db = testDb();
    const ts = Date.now();
    const employee = await createEmployee(ts);
    const firstName = `uebergabe-${ts}.pdf`;
    const firstPdf = pdfBuffer(`Übergabe ${ts}`);
    const signedName = `uebergabe-${ts}-unterschrieben.pdf`;
    const signedPdf = pdfBuffer(`Übergabe unterschrieben ${ts}`);
    const returnName = `ruecknahme-${ts}.png`;
    const readDocs = (kind: "uebergabe" | "ruecknahme") =>
      db
        .select()
        .from(itEquipmentDocuments)
        .where(
          and(
            eq(itEquipmentDocuments.userId, employee.id),
            eq(itEquipmentDocuments.kind, kind)
          )
        );
    const admin = await pageAs(browser, ADMIN_STATE);

    try {
      await admin.goto("/it-management");
      await clickTab(admin, "Mitarbeitende");
      const row = rowWith(admin, employee.name);
      const handoverCell = row.getByRole("cell").nth(3);
      const returnCell = row.getByRole("cell").nth(4);

      // Übergabeprotokoll hochladen
      const uploadDialog = dialogWith(admin, "Übergabeprotokoll hochladen");
      await openDialog(
        handoverCell.getByRole("button", { name: "Übergabeprotokoll hochladen" }),
        uploadDialog
      );
      await uploadDialog.getByLabel("Datei", { exact: true }).setInputFiles({
        name: firstName,
        mimeType: "application/pdf",
        buffer: firstPdf,
      });
      await uploadDialog.getByRole("button", { name: "Hochladen" }).click();
      await expectToast(admin, "Übergabeprotokoll gespeichert.");
      await expect(uploadDialog).toBeHidden();

      const firstLink = handoverCell.getByRole("link", { name: firstName });
      await expect(firstLink).toBeVisible();
      const firstRes = await fetchHref(admin, firstLink);
      expect(firstRes.status()).toBe(200);
      expect(firstRes.headers()["content-type"]).toContain("application/pdf");
      expect(Buffer.compare(await firstRes.body(), firstPdf)).toBe(0);
      const [firstDoc] = await readDocs("uebergabe");
      expect(firstDoc).toMatchObject({ filename: firstName });

      // Ersetzen — die alte Datei verschwindet
      const replaceDialog = dialogWith(admin, "Übergabeprotokoll ersetzen");
      await openDialog(
        handoverCell.getByRole("button", { name: "Übergabeprotokoll ersetzen" }),
        replaceDialog
      );
      await expect(replaceDialog).toContainText(`„${firstName}“`);
      await replaceDialog.getByLabel("Datei", { exact: true }).setInputFiles({
        name: signedName,
        mimeType: "application/pdf",
        buffer: signedPdf,
      });
      await replaceDialog.getByRole("button", { name: "Ersetzen" }).click();
      await expectToast(admin, "Übergabeprotokoll ersetzt.");
      await expect(replaceDialog).toBeHidden();

      const signedLink = handoverCell.getByRole("link", { name: signedName });
      await expect(signedLink).toBeVisible();
      await expect(handoverCell.getByRole("link", { name: firstName })).toHaveCount(0);
      const signedRes = await fetchHref(admin, signedLink);
      expect(signedRes.status()).toBe(200);
      expect(Buffer.compare(await signedRes.body(), signedPdf)).toBe(0);
      const afterReplace = await readDocs("uebergabe");
      expect(afterReplace).toHaveLength(1);
      expect(afterReplace[0].filename).toBe(signedName);
      expect(
        await db
          .select()
          .from(auditLog)
          .where(
            and(eq(auditLog.objectId, firstDoc.id), eq(auditLog.action, "ersetzt"))
          )
      ).toHaveLength(1);

      // Rücknahmeprotokoll als Bild hochladen
      const returnUpload = dialogWith(admin, "Rücknahmeprotokoll hochladen");
      await openDialog(
        returnCell.getByRole("button", { name: "Rücknahmeprotokoll hochladen" }),
        returnUpload
      );
      await returnUpload.getByLabel("Datei", { exact: true }).setInputFiles({
        name: returnName,
        mimeType: "image/png",
        buffer: PNG_BUFFER,
      });
      await returnUpload.getByRole("button", { name: "Hochladen" }).click();
      await expectToast(admin, "Rücknahmeprotokoll gespeichert.");
      await expect(returnUpload).toBeHidden();
      const returnLink = returnCell.getByRole("link", { name: returnName });
      const returnRes = await fetchHref(admin, returnLink);
      expect(returnRes.status()).toBe(200);
      expect(returnRes.headers()["content-type"]).toContain("image/png");
      expect(Buffer.compare(await returnRes.body(), PNG_BUFFER)).toBe(0);

      // Übergabeprotokoll löschen — erst abbrechen, dann bestätigen
      const deleteHandover = dialogWith(admin, "Übergabeprotokoll löschen?");
      await handoverCell.getByRole("button", { name: "Löschen" }).click();
      await expect(deleteHandover).toContainText(`„${signedName}“`);
      await deleteHandover.getByRole("button", { name: "Abbrechen" }).click();
      await expect(deleteHandover).toBeHidden();
      await expect(signedLink).toBeVisible();

      await handoverCell.getByRole("button", { name: "Löschen" }).click();
      await deleteHandover
        .getByRole("button", { name: "Endgültig löschen" })
        .click();
      await expectToast(admin, "Übergabeprotokoll gelöscht.");
      await expect(deleteHandover).toBeHidden();
      await expect(signedLink).toHaveCount(0);
      await expect(
        handoverCell.getByRole("button", { name: "Übergabeprotokoll hochladen" })
      ).toBeVisible();
      await expect.poll(async () => (await readDocs("uebergabe")).length).toBe(0);

      // Rücknahmeprotokoll löschen
      const deleteReturn = dialogWith(admin, "Rücknahmeprotokoll löschen?");
      await returnCell.getByRole("button", { name: "Löschen" }).click();
      await deleteReturn
        .getByRole("button", { name: "Endgültig löschen" })
        .click();
      await expectToast(admin, "Rücknahmeprotokoll gelöscht.");
      await expect(deleteReturn).toBeHidden();
      await expect(returnLink).toHaveCount(0);
      await expect
        .poll(async () => (await readDocs("ruecknahme")).length)
        .toBe(0);
    } finally {
      await cleanup({ userIds: [employee.id] });
    }
  });

  test("CSV exportieren, geändert importieren: prüfen, Vorschau, anwenden", async ({
    browser,
  }) => {
    const db = testDb();
    const ts = Date.now();
    const short = String(ts).slice(-6);
    const employee = await createEmployee(ts);
    const typeName = `E2E-Art Import ${ts}`;
    const type = await createType(typeName);
    const updatedId = `E2E-${short}-UPD`;
    const removedId = `E2E-${short}-DEL`;
    const createdId = `E2E-${short}-NEW`;
    await insertEquipment({
      userId: employee.id,
      typeId: type.id,
      deviceId: updatedId,
      serialNumber: `SN-${short}-U`,
      handoverDate: "2026-09-01",
      notes: "E2E: vor dem Import",
    });
    await insertEquipment({
      userId: employee.id,
      typeId: type.id,
      deviceId: removedId,
      handoverDate: "2026-08-03",
      returnDate: "2026-09-15",
    });
    const admin = await pageAs(browser, ADMIN_STATE);

    try {
      await admin.goto("/it-management");
      await clickTab(admin, "Export & Import");

      // Export: alle Geräte der Datenbank, Kopfzeile als Import-Vorlage
      const exported = await download(
        admin,
        admin.getByRole("button", { name: "Liste als CSV herunterladen" })
      );
      expect(exported.filename).toMatch(
        /^IT-Ausstattung_\d{4}-\d{2}-\d{2}\.csv$/
      );
      const csv = exported.body.toString("utf8");
      expect(csv.charCodeAt(0)).toBe(0xfeff);
      const table = parseCsv(csv);
      expect(table[0]).toEqual(CSV_HEADER);
      const allIds = (
        await db.select({ deviceId: itEquipment.deviceId }).from(itEquipment)
      ).map((e) => e.deviceId);
      expect(table.slice(1).map((r) => r[0]).sort()).toEqual([...allIds].sort());
      expect(table.find((r) => r[0] === updatedId)).toEqual([
        updatedId,
        "",
        employee.email,
        employee.name,
        typeName,
        `SN-${short}-U`,
        "01.09.2026",
        "",
        "E2E: vor dem Import",
        "im Einsatz",
      ]);
      expect(table.find((r) => r[0] === removedId)).toEqual([
        removedId,
        "",
        employee.email,
        employee.name,
        typeName,
        "",
        "03.08.2026",
        "15.09.2026",
        "",
        "zurückgegeben",
      ]);

      // Datei ändern: ein Gerät aktualisieren, eines weglassen (wird
      // gelöscht), eines neu anlegen — alle übrigen Geräte bleiben enthalten
      const notesColumn = CSV_HEADER.indexOf("Zusatzinformationen");
      const modified = [
        table[0],
        ...table
          .slice(1)
          .filter((r) => r[0] !== removedId)
          .map((r) =>
            r[0] === updatedId
              ? r.map((value, i) =>
                  i === notesColumn ? "E2E: per Import geändert" : value
                )
              : r
          ),
        [
          createdId,
          "",
          employee.email,
          "",
          typeName,
          `SN-${short}-N`,
          "15.09.2026",
          "",
          "E2E: per Import angelegt",
          "",
        ],
      ];
      const fileInput = admin.locator("#equipment-import-file");
      const check = admin.getByRole("button", { name: "Datei prüfen" });

      // Eine Datei ohne .csv-Endung wird mit Hinweis abgelehnt
      await fileInput.setInputFiles({
        name: `it-import-${ts}.txt`,
        mimeType: "text/plain",
        buffer: Buffer.from(toCsv(modified), "utf8"),
      });
      await check.click();
      await expect(
        admin.getByText("Die Datei wurde nicht übernommen")
      ).toBeVisible();
      await expect(
        admin.getByRole("listitem").filter({ hasText: "ist keine CSV-Datei" })
      ).toBeVisible();
      await expect(
        admin.getByRole("button", { name: "Import jetzt anwenden" })
      ).toHaveCount(0);

      await fileInput.setInputFiles({
        name: `it-import-${ts}.csv`,
        mimeType: "text/csv",
        buffer: Buffer.from(toCsv(modified), "utf8"),
      });
      // Eine neue Datei verwirft die alten Hinweise
      await expect(
        admin.getByText("Die Datei wurde nicht übernommen")
      ).toHaveCount(0);

      // Schritt 1: prüfen — Vorschau ohne Änderung an der Datenbank
      await expect(check).toBeEnabled();
      await check.click();
      const createdLine = admin.getByText(/^Neu angelegt: \d+$/);
      const updatedLine = admin.getByText(/^Aktualisiert: \d+$/);
      const removedLine = admin.getByText(/^Gelöscht: \d+$/);
      await expect(createdLine).toHaveText("Neu angelegt: 1");
      await expect(createdLine.locator("xpath=..")).toContainText(createdId);
      await expect(updatedLine.locator("xpath=..")).toContainText(updatedId);
      await expect(removedLine).toHaveText("Gelöscht: 1");
      await expect(removedLine.locator("xpath=..")).toContainText(removedId);
      await expect(admin.getByText(/^Unverändert: \d+$/)).toBeVisible();
      await expect(
        admin.getByText("Ein Gerät fehlt in der Datei und wird endgültig gelöscht.")
      ).toBeVisible();
      expect(await readEquipment(removedId)).toBeDefined();
      expect(await readEquipment(createdId)).toBeUndefined();
      expect((await readEquipment(updatedId)).notes).toBe("E2E: vor dem Import");

      // Schritt 2: anwenden
      await admin.getByRole("button", { name: "Import jetzt anwenden" }).click();
      await expect(
        admin.getByText(/^Import übernommen: 1 neu, \d+ aktualisiert, 1 gelöscht\.$/)
      ).toBeVisible();
      await expect(
        admin.getByRole("button", { name: "Import jetzt anwenden" })
      ).toHaveCount(0);
      await expect(admin.getByRole("button", { name: "Datei prüfen" })).toBeDisabled();

      expect(await readEquipment(removedId)).toBeUndefined();
      expect((await readEquipment(updatedId)).notes).toBe(
        "E2E: per Import geändert"
      );
      expect(await readEquipment(createdId)).toMatchObject({
        userId: employee.id,
        typeId: type.id,
        serialNumber: `SN-${short}-N`,
        handoverDate: "2026-09-15",
        returnDate: null,
        notes: "E2E: per Import angelegt",
      });
      // Alle übrigen Geräte sind unverändert vorhanden
      const remaining = (
        await db.select({ deviceId: itEquipment.deviceId }).from(itEquipment)
      ).map((e) => e.deviceId);
      expect([...remaining].sort()).toEqual(
        [...allIds.filter((id) => id !== removedId), createdId].sort()
      );

      // Die Liste zeigt das neue Gerät im Einsatz
      await clickTab(admin, "Im Einsatz");
      await expect(deviceRow(admin, createdId)).toContainText(employee.name);
      await expect(deviceRow(admin, removedId)).toHaveCount(0);
    } finally {
      await cleanup({ userIds: [employee.id], typeIds: [type.id] });
    }
  });
});
