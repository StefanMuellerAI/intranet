import { expect, test, type Locator, type Page } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import {
  helpfulLinks,
  newsItems,
  salesNews,
  teamEvents,
  users,
} from "../../src/db/schema";
import { E2E_ADMIN_EMAIL, E2E_USER_EMAIL, testDb } from "../helpers/db";
import {
  ADMIN_NAME,
  ADMIN_STATE,
  USER_NAME,
  expectToast,
  openDialog,
  pageAs,
} from "./helpers";

/**
 * Inhalte (/inhalte), ergänzend zu inhalte.spec.ts: Teamevents vollständig,
 * in den übrigen Reitern Bearbeiten, Wieder-Einblenden und Löschen. Jeder
 * Test legt eigene Einträge mit eindeutigem Titel an und räumt sie wieder
 * ab — ausgeblendete oder gelöschte Einträge anderer Specs bleiben unberührt.
 */

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Reiter anklicken — mit Wiederholung, falls die Hydration noch läuft. */
async function clickTab(page: Page, label: string): Promise<void> {
  const tab = page.getByRole("tab", {
    name: new RegExp(`^${escapeRegExp(label)}(\\s*\\d+)?$`),
  });
  await expect(async () => {
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true", {
      timeout: 2_000,
    });
  }).toPass({ timeout: 20_000 });
}

/**
 * Wartet, bis React das Element hydriert hat — erst dann hängen die
 * Event-Handler (für Klicks, die keinen Dialog öffnen).
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

function rowWith(page: Page, text: string): Locator {
  return page.getByRole("row").filter({ hasText: text });
}

function dialogWith(page: Page, title: string): Locator {
  return page.getByRole("dialog").filter({ hasText: title });
}

async function userByEmail(email: string) {
  const [user] = await testDb()
    .select()
    .from(users)
    .where(eq(users.email, email));
  return user;
}

/**
 * Aus- und wieder Einblenden über das Auge in der Zeile; prüft Badge und
 * Datenbank nach jedem Schritt.
 */
async function hideAndShow(
  page: Page,
  row: Locator,
  messages: { hidden: string; shown: string },
  readActive: () => Promise<boolean>
): Promise<void> {
  await row.getByRole("button", { name: "Ausblenden" }).click();
  await expectToast(page, messages.hidden);
  await expect(row.getByText("ausgeblendet", { exact: true })).toBeVisible();
  await expect.poll(readActive).toBe(false);

  await row.getByRole("button", { name: "Einblenden" }).click();
  await expectToast(page, messages.shown);
  await expect(row.getByText("sichtbar", { exact: true })).toBeVisible();
  await expect.poll(readActive).toBe(true);
}

/**
 * Löschen über den Bestätigungsdialog: zuerst "Abbrechen" (Eintrag bleibt),
 * dann "Endgültig löschen".
 */
async function deleteWithConfirmation(
  page: Page,
  row: Locator,
  opts: { dialogTitle: string; itemTitle: string; successMessage: string },
  readExists: () => Promise<boolean>
): Promise<void> {
  const confirm = dialogWith(page, opts.dialogTitle);

  await row.getByRole("button", { name: "Löschen" }).click();
  await expect(confirm).toContainText(`„${opts.itemTitle}“`);
  await confirm.getByRole("button", { name: "Abbrechen" }).click();
  await expect(confirm).toBeHidden();
  await expect(row).toBeVisible();
  expect(await readExists()).toBe(true);

  await row.getByRole("button", { name: "Löschen" }).click();
  await confirm.getByRole("button", { name: "Endgültig löschen" }).click();
  await expectToast(page, opts.successMessage);
  await expect(confirm).toBeHidden();
  await expect(row).toHaveCount(0);
  await expect.poll(readExists).toBe(false);
}

test.describe("Inhalte — Bearbeiten, Einblenden, Löschen", () => {
  // Mehrschrittige Abläufe gegen `next dev` (Kompilieren beim ersten Aufruf)
  test.describe.configure({ timeout: 120_000 });

  test("Teamevents: anlegen, bearbeiten, aus- und einblenden, löschen", async ({
    browser,
  }) => {
    const db = testDb();
    const ts = Date.now();
    const title = `E2E-Teamevent ${ts}`;
    const renamed = `E2E-Teamevent verschoben ${ts}`;
    const readEvent = async (eventTitle: string) =>
      (
        await db
          .select()
          .from(teamEvents)
          .where(eq(teamEvents.title, eventTitle))
      )[0];
    const admin = await pageAs(browser, ADMIN_STATE);

    try {
      await admin.goto("/inhalte");
      await clickTab(admin, "Teamevents");
      await expect(
        admin.getByText(
          "Erscheinen ganztägig im Abwesenheitskalender und im Kurzbriefing."
        )
      ).toBeVisible();

      // Anlegen (zweitägig, in der Zukunft — vergangene Events blendet die
      // Liste automatisch aus)
      const createDialog = dialogWith(admin, "Teamevent anlegen");
      await openDialog(
        admin.getByRole("button", { name: "Neues Teamevent" }),
        createDialog
      );
      await createDialog.getByLabel("Titel", { exact: true }).fill(title);
      await createDialog
        .getByLabel("Startdatum", { exact: true })
        .fill("2030-06-12");
      await createDialog
        .getByLabel("Enddatum (optional)", { exact: true })
        .fill("2030-06-13");
      await createDialog
        .getByRole("button", { name: "Teamevent hinzufügen" })
        .click();
      await expectToast(admin, "Teamevent angelegt.");
      await expect(createDialog).toBeHidden();

      const row = rowWith(admin, title);
      await expect(row).toContainText("12.06.2030 – 13.06.2030");
      await expect(row.getByText("sichtbar", { exact: true })).toBeVisible();
      expect(await readEvent(title)).toMatchObject({
        startDate: "2030-06-12",
        endDate: "2030-06-13",
        active: true,
      });

      // Bearbeiten — Ende vor Beginn wird abgelehnt, der Dialog bleibt offen
      const editDialog = dialogWith(admin, "Teamevent bearbeiten");
      await openDialog(row.getByRole("button", { name: "Bearbeiten" }), editDialog);
      await expect(
        editDialog.getByLabel("Titel", { exact: true })
      ).toHaveValue(title);
      await expect(
        editDialog.getByLabel("Startdatum", { exact: true })
      ).toHaveValue("2030-06-12");
      await editDialog.getByLabel("Titel", { exact: true }).fill(renamed);
      await editDialog
        .getByLabel("Enddatum (optional)", { exact: true })
        .fill("2030-06-10");
      await editDialog.getByRole("button", { name: "Speichern" }).click();
      await expectToast(
        admin,
        "Das Enddatum darf nicht vor dem Startdatum liegen."
      );
      await expect(editDialog).toBeVisible();
      expect((await readEvent(title))?.endDate).toBe("2030-06-13");

      // Gültig speichern: ohne Enddatum wird das Event eintägig
      await editDialog.getByLabel("Titel", { exact: true }).fill(renamed);
      await editDialog
        .getByLabel("Startdatum", { exact: true })
        .fill("2030-06-12");
      await editDialog
        .getByLabel("Enddatum (optional)", { exact: true })
        .fill("");
      await editDialog.getByRole("button", { name: "Speichern" }).click();
      await expectToast(admin, "Teamevent aktualisiert.");
      await expect(editDialog).toBeHidden();

      const renamedRow = rowWith(admin, renamed);
      await expect(renamedRow.getByRole("cell").nth(1)).toHaveText(
        "12.06.2030"
      );
      expect(await readEvent(title)).toBeUndefined();
      expect(await readEvent(renamed)).toMatchObject({
        startDate: "2030-06-12",
        endDate: "2030-06-12",
      });

      // Aus- und wieder einblenden
      await hideAndShow(
        admin,
        renamedRow,
        { hidden: "Teamevent ausgeblendet.", shown: "Teamevent eingeblendet." },
        async () => (await readEvent(renamed)).active
      );

      // Löschen mit Bestätigung
      await deleteWithConfirmation(
        admin,
        renamedRow,
        {
          dialogTitle: "Teamevent löschen?",
          itemTitle: renamed,
          successMessage: "Teamevent gelöscht.",
        },
        async () => (await readEvent(renamed)) !== undefined
      );
    } finally {
      await db
        .delete(teamEvents)
        .where(inArray(teamEvents.title, [title, renamed]));
    }
  });

  test("Hilfreiche Links: wieder einblenden, bearbeiten, löschen", async ({
    browser,
  }) => {
    const db = testDb();
    const ts = Date.now();
    const title = `E2E-Link ${ts}`;
    const renamed = `E2E-Link geändert ${ts}`;
    const [link] = await db
      .insert(helpfulLinks)
      .values({
        title,
        url: `https://e2e.example.com/start-${ts}`,
        description: "Ursprüngliche Beschreibung",
        sortOrder: 90,
      })
      .returning();
    const readLink = async () =>
      (
        await db
          .select()
          .from(helpfulLinks)
          .where(eq(helpfulLinks.id, link.id))
      )[0];
    const admin = await pageAs(browser, ADMIN_STATE);

    try {
      await admin.goto("/inhalte");
      // "Hilfreiche Links" ist der voreingestellte Reiter
      const row = rowWith(admin, title);
      await expect(row).toContainText(`https://e2e.example.com/start-${ts}`);
      await waitForHydration(row.getByRole("button", { name: "Ausblenden" }));

      await hideAndShow(
        admin,
        row,
        { hidden: "Link ausgeblendet.", shown: "Link eingeblendet." },
        async () => (await readLink()).active
      );

      // Bearbeiten — Felder sind mit den gespeicherten Werten vorbelegt
      const editDialog = dialogWith(admin, "Link bearbeiten");
      await openDialog(row.getByRole("button", { name: "Bearbeiten" }), editDialog);
      await expect(editDialog.getByLabel("Titel", { exact: true })).toHaveValue(
        title
      );
      await expect(
        editDialog.getByLabel("Reihenfolge", { exact: true })
      ).toHaveValue("90");
      await editDialog.getByLabel("Titel", { exact: true }).fill(renamed);
      await editDialog
        .getByLabel("URL", { exact: true })
        .fill(`https://e2e.example.com/neu-${ts}`);
      await editDialog
        .getByLabel("Beschreibung (optional)", { exact: true })
        .fill("Geänderte Beschreibung");
      await editDialog.getByLabel("Reihenfolge", { exact: true }).fill("91");
      await editDialog.getByRole("button", { name: "Speichern" }).click();
      await expectToast(admin, "Link aktualisiert.");
      await expect(editDialog).toBeHidden();

      const renamedRow = rowWith(admin, renamed);
      await expect(renamedRow).toContainText(`https://e2e.example.com/neu-${ts}`);
      await expect(renamedRow).toContainText("Geänderte Beschreibung");
      await expect(renamedRow.getByRole("cell").first()).toHaveText("91");
      expect(await readLink()).toMatchObject({
        title: renamed,
        url: `https://e2e.example.com/neu-${ts}`,
        description: "Geänderte Beschreibung",
        sortOrder: 91,
        active: true,
      });

      await deleteWithConfirmation(
        admin,
        renamedRow,
        {
          dialogTitle: "Link löschen?",
          itemTitle: renamed,
          successMessage: "Link gelöscht.",
        },
        async () => (await readLink()) !== undefined
      );
    } finally {
      await db.delete(helpfulLinks).where(eq(helpfulLinks.id, link.id));
    }
  });

  test("Neuigkeiten: wieder einblenden, bearbeiten, löschen", async ({
    browser,
  }) => {
    const db = testDb();
    const ts = Date.now();
    const title = `E2E-Neuigkeit ${ts}`;
    const renamed = `E2E-Neuigkeit geändert ${ts}`;
    const adminUser = await userByEmail(E2E_ADMIN_EMAIL);
    const [item] = await db
      .insert(newsItems)
      .values({
        title,
        body: "Ursprünglicher Text für den Ticker.",
        createdById: adminUser.id,
      })
      .returning();
    const readItem = async () =>
      (await db.select().from(newsItems).where(eq(newsItems.id, item.id)))[0];
    const admin = await pageAs(browser, ADMIN_STATE);

    try {
      await admin.goto("/inhalte");
      await clickTab(admin, "Neuigkeiten");
      const row = rowWith(admin, title);
      await expect(row).toContainText("Ursprünglicher Text für den Ticker.");

      await hideAndShow(
        admin,
        row,
        { hidden: "Neuigkeit ausgeblendet.", shown: "Neuigkeit eingeblendet." },
        async () => (await readItem()).active
      );

      const editDialog = dialogWith(admin, "Neuigkeit bearbeiten");
      await openDialog(row.getByRole("button", { name: "Bearbeiten" }), editDialog);
      await expect(
        editDialog.getByLabel("Nachricht", { exact: true })
      ).toHaveValue("Ursprünglicher Text für den Ticker.");
      await editDialog.getByLabel("Titel", { exact: true }).fill(renamed);
      await editDialog
        .getByLabel("Nachricht", { exact: true })
        .fill("Geänderter Text für den Ticker.");
      await editDialog.getByRole("button", { name: "Speichern" }).click();
      await expectToast(admin, "Neuigkeit aktualisiert.");
      await expect(editDialog).toBeHidden();

      const renamedRow = rowWith(admin, renamed);
      await expect(renamedRow).toContainText("Geänderter Text für den Ticker.");
      expect(await readItem()).toMatchObject({
        title: renamed,
        body: "Geänderter Text für den Ticker.",
        active: true,
      });

      await deleteWithConfirmation(
        admin,
        renamedRow,
        {
          dialogTitle: "Neuigkeit löschen?",
          itemTitle: renamed,
          successMessage: "Neuigkeit gelöscht.",
        },
        async () => (await readItem()) !== undefined
      );
    } finally {
      await db.delete(newsItems).where(eq(newsItems.id, item.id));
    }
  });

  test("Sales-Nachrichten: wieder einblenden, bearbeiten, löschen", async ({
    browser,
  }) => {
    const db = testDb();
    const ts = Date.now();
    const customer = `E2E-Sales ${ts} GmbH`;
    const renamed = `E2E-Sales geändert ${ts} AG`;
    const adminUser = await userByEmail(E2E_ADMIN_EMAIL);
    const employee = await userByEmail(E2E_USER_EMAIL);
    const [item] = await db
      .insert(salesNews)
      .values({
        customerName: customer,
        volumeCents: 1_250_050,
        soldById: adminUser.id,
        deliveryStart: "2030-02-01",
        deliveryEnd: "2030-02-28",
        createdById: adminUser.id,
      })
      .returning();
    const readItem = async () =>
      (await db.select().from(salesNews).where(eq(salesNews.id, item.id)))[0];
    const admin = await pageAs(browser, ADMIN_STATE);

    try {
      await admin.goto("/inhalte");
      await clickTab(admin, "Sales-Nachrichten");
      const row = rowWith(admin, customer);
      await expect(row).toContainText("12.500,50 €");
      await expect(row).toContainText(ADMIN_NAME);
      await expect(row).toContainText("01.02.2030 – 28.02.2030");

      await hideAndShow(
        admin,
        row,
        {
          hidden: "Sales-Nachricht ausgeblendet.",
          shown: "Sales-Nachricht eingeblendet.",
        },
        async () => (await readItem()).active
      );

      const editDialog = dialogWith(admin, "Sales-Nachricht bearbeiten");
      await openDialog(row.getByRole("button", { name: "Bearbeiten" }), editDialog);
      await expect(
        editDialog.getByLabel("Volumen (€)", { exact: true })
      ).toHaveValue("12500.5");
      await editDialog
        .getByLabel("Kundenname", { exact: true })
        .fill(renamed);
      await editDialog
        .getByLabel("Volumen (€)", { exact: true })
        .fill("9999.99");
      await editDialog
        .getByLabel("Ursächliche/r Mitarbeiter/in", { exact: true })
        .selectOption({ label: USER_NAME });
      await editDialog
        .getByLabel("Leistungsbeginn (vsl.)", { exact: true })
        .fill("2030-03-02");
      // Leeres Ende: eintägige Leistung
      await editDialog
        .getByLabel("Leistungsende (optional)", { exact: true })
        .fill("");
      await editDialog.getByRole("button", { name: "Speichern" }).click();
      await expectToast(admin, "Sales-Nachricht aktualisiert.");
      await expect(editDialog).toBeHidden();

      const renamedRow = rowWith(admin, renamed);
      await expect(renamedRow).toContainText("9.999,99 €");
      await expect(renamedRow).toContainText(USER_NAME);
      await expect(renamedRow.getByRole("cell").nth(3)).toHaveText(
        "02.03.2030"
      );
      expect(await readItem()).toMatchObject({
        customerName: renamed,
        volumeCents: 999_999,
        soldById: employee.id,
        deliveryStart: "2030-03-02",
        deliveryEnd: "2030-03-02",
        active: true,
      });

      await deleteWithConfirmation(
        admin,
        renamedRow,
        {
          dialogTitle: "Sales-Nachricht löschen?",
          itemTitle: renamed,
          successMessage: "Sales-Nachricht gelöscht.",
        },
        async () => (await readItem()) !== undefined
      );
    } finally {
      await db.delete(salesNews).where(eq(salesNews.id, item.id));
    }
  });
});
