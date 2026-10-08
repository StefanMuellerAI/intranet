import { expect, test, type Locator, type Page } from "@playwright/test";
import { and, eq, inArray } from "drizzle-orm";
import { auditLog, employeeDocuments, users } from "../../src/db/schema";
import { E2E_ADMIN_EMAIL, E2E_USER_EMAIL, testDb } from "../helpers/db";
import {
  ADMIN_NAME,
  ADMIN_STATE,
  USER_NAME,
  expectToast,
  fetchHref,
  openDialog,
  pageAs,
} from "./helpers";

/**
 * Mitarbeitende (/mitarbeitende): Status-Reiter, Einladung, Bearbeiten-Dialog
 * und Dokumente. Alle Tests arbeiten auf eigens angelegten Personen mit
 * eindeutiger E-Mail-Adresse; die beiden Seed-User werden nur gelesen.
 */

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

/** Person direkt in der Test-DB anlegen (ohne Clerk-Einladung). */
async function createUser(values: {
  email: string;
  firstName: string;
  lastName: string;
  status: "eingeladen" | "aktiv" | "deaktiviert";
}) {
  const [user] = await testDb()
    .insert(users)
    .values({ ...values, role: "mitarbeiter", annualVacationDays: 30 })
    .returning();
  return user;
}

async function readUser(id: string) {
  const [user] = await testDb().select().from(users).where(eq(users.id, id));
  return user;
}

async function deleteUsers(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = testDb();
  await db
    .delete(employeeDocuments)
    .where(inArray(employeeDocuments.userId, ids));
  await db.delete(users).where(inArray(users.id, ids));
}

/** Minimales PDF — der Server prüft Typ und Größe, nicht den Inhalt. */
function pdfBuffer(label: string): Buffer {
  return Buffer.from(`%PDF-1.4\n% ${label}\n%%EOF\n`, "latin1");
}

test.describe("Mitarbeitende", () => {
  // Mehrschrittige Abläufe gegen `next dev` (Kompilieren beim ersten Aufruf)
  test.describe.configure({ timeout: 120_000 });

  test("Status-Reiter Alle, Aktiv, Eingeladen und Deaktiviert", async ({
    browser,
  }) => {
    const ts = Date.now();
    const active = await createUser({
      email: `e2e-reiter-aktiv-${ts}@stefanai.de`,
      firstName: "Anna",
      lastName: `Aktiv${ts}`,
      status: "aktiv",
    });
    const invited = await createUser({
      email: `e2e-reiter-eingeladen-${ts}@stefanai.de`,
      firstName: "Ines",
      lastName: `Eingeladen${ts}`,
      status: "eingeladen",
    });
    const deactivated = await createUser({
      email: `e2e-reiter-deaktiviert-${ts}@stefanai.de`,
      firstName: "Dora",
      lastName: `Deaktiviert${ts}`,
      status: "deaktiviert",
    });

    try {
      // Erwartete Zähler aus der Datenbank
      const all = await testDb().select({ status: users.status }).from(users);
      const count = (status: string) =>
        all.filter((u) => u.status === status).length;

      const admin = await pageAs(browser, ADMIN_STATE);
      await admin.goto("/mitarbeitende");
      await expect(
        admin.getByRole("heading", { name: "Mitarbeitende", exact: true })
      ).toBeVisible();
      await expect(tab(admin, "Alle", all.length)).toBeVisible();
      await expect(tab(admin, "Aktiv", count("aktiv"))).toBeVisible();
      await expect(tab(admin, "Eingeladen", count("eingeladen"))).toBeVisible();
      await expect(
        tab(admin, "Deaktiviert", count("deaktiviert"))
      ).toBeVisible();

      // "Alle" ist voreingestellt und zeigt jeden Status
      await expect(tab(admin, "Alle")).toHaveAttribute("aria-selected", "true");
      for (const user of [active, invited, deactivated])
        await expect(rowWith(admin, user.email)).toBeVisible();

      // Aktiv
      await clickTab(admin, "Aktiv");
      await expect(
        admin.getByText("Angemeldete Mitarbeitende mit Zugang zum Intranet.")
      ).toBeVisible();
      await expect(
        rowWith(admin, active.email).getByText("Aktiv", { exact: true })
      ).toBeVisible();
      await expect(rowWith(admin, invited.email)).toHaveCount(0);
      await expect(rowWith(admin, deactivated.email)).toHaveCount(0);

      // Eingeladen — mit "Einladung erneut senden"
      await clickTab(admin, "Eingeladen");
      await expect(
        admin.getByText(
          "Einladung versendet, aber noch keine Anmeldung erfolgt"
        )
      ).toBeVisible();
      const invitedRow = rowWith(admin, invited.email);
      await expect(
        invitedRow.getByText("Eingeladen", { exact: true })
      ).toBeVisible();
      await expect(
        invitedRow.getByRole("button", { name: "Einladung erneut senden" })
      ).toBeVisible();
      await expect(rowWith(admin, active.email)).toHaveCount(0);
      await expect(rowWith(admin, deactivated.email)).toHaveCount(0);

      // Deaktiviert — mit "Reaktivieren" statt "Deaktivieren"
      await clickTab(admin, "Deaktiviert");
      await expect(
        admin.getByText(
          "Login gesperrt (Offboarding) — Anträge und Dokumente bleiben erhalten."
        )
      ).toBeVisible();
      const deactivatedRow = rowWith(admin, deactivated.email);
      await expect(
        deactivatedRow.getByText("Deaktiviert", { exact: true })
      ).toBeVisible();
      await expect(
        deactivatedRow.getByRole("button", { name: "Reaktivieren" })
      ).toBeVisible();
      await expect(
        deactivatedRow.getByRole("button", { name: "Deaktivieren" })
      ).toHaveCount(0);
      await expect(rowWith(admin, active.email)).toHaveCount(0);
      await expect(rowWith(admin, invited.email)).toHaveCount(0);

      // Zurück zu "Alle"
      await clickTab(admin, "Alle");
      for (const user of [active, invited, deactivated])
        await expect(rowWith(admin, user.email)).toBeVisible();
    } finally {
      await deleteUsers([active.id, invited.id, deactivated.id]);
    }
  });

  test("Einladung: Abbrechen verwirft, Einladen legt an, erneut senden", async ({
    browser,
  }) => {
    const db = testDb();
    const ts = Date.now();
    const email = `e2e-einladung-${ts}@stefanai.de`;
    const admin = await pageAs(browser, ADMIN_STATE);

    try {
      await admin.goto("/mitarbeitende");
      const inviteButton = admin.getByRole("button", {
        name: "Mitarbeiter/in einladen",
      });
      const dialog = admin
        .getByRole("dialog")
        .filter({ hasText: "Neue/n Mitarbeiter/in einladen" });

      // "Abbrechen" schließt den Dialog, ohne etwas anzulegen
      await openDialog(inviteButton, dialog);
      await dialog.locator("#firstName").fill("Ina");
      await dialog.locator("#lastName").fill(`Einladung${ts}`);
      await dialog.locator("#email").fill(email);
      await dialog.getByRole("button", { name: "Abbrechen" }).click();
      await expect(dialog).toBeHidden();
      expect(
        await db.select().from(users).where(eq(users.email, email))
      ).toHaveLength(0);

      // Beim erneuten Öffnen sind die Felder leer
      await openDialog(inviteButton, dialog);
      await expect(dialog.locator("#email")).toHaveValue("");

      await dialog.locator("#firstName").fill("Ina");
      await dialog.locator("#lastName").fill(`Einladung${ts}`);
      await dialog.locator("#email").fill(email);
      await dialog.locator("#annualVacationDays").fill("28");
      // Eintritt weit in der Zukunft: Anmeldung erst ab diesem Tag
      await dialog.locator("#invite-entry-date").fill("2030-01-07");
      await dialog.locator("#entryYearVacationDays").fill("5");
      await dialog.locator("#invite-birth-date").fill("1992-07-15");
      await dialog.getByRole("button", { name: "Einladen", exact: true }).click();
      await expectToast(admin, "Einladung versendet.");
      await expect(dialog).toBeHidden();

      const [invited] = await db
        .select()
        .from(users)
        .where(eq(users.email, email));
      expect(invited).toMatchObject({
        firstName: "Ina",
        lastName: `Einladung${ts}`,
        status: "eingeladen",
        role: "mitarbeiter",
        annualVacationDays: 28,
        entryDate: "2030-01-07",
        entryYearVacationDays: 5,
        birthDate: "1992-07-15",
      });

      // Im Reiter "Eingeladen" erneut senden
      await clickTab(admin, "Eingeladen");
      const row = rowWith(admin, email);
      await expect(row.getByText("Eingeladen", { exact: true })).toBeVisible();
      await expect(row.getByText("ab 07.01.2030")).toBeVisible();
      await expect(row.getByText("15.07.1992")).toBeVisible();
      await row
        .getByRole("button", { name: "Einladung erneut senden" })
        .click();
      await expectToast(admin, "Einladung erneut versendet.");
      await expect
        .poll(
          async () =>
            (
              await db
                .select()
                .from(auditLog)
                .where(
                  and(
                    eq(auditLog.objectId, invited.id),
                    eq(auditLog.action, "einladung_erneut_versendet")
                  )
                )
            ).length
        )
        .toBe(1);
      // Status bleibt "eingeladen"
      expect((await readUser(invited.id)).status).toBe("eingeladen");
    } finally {
      const created = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email));
      await deleteUsers(created.map((u) => u.id));
    }
  });

  test("Bearbeiten: Urlaubskonto, Eintritt, Geburtsdatum, Vorgesetzte, Geschäftsführung", async ({
    browser,
  }) => {
    const db = testDb();
    const ts = Date.now();
    const [adminUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, E2E_ADMIN_EMAIL));
    const [employee] = await db
      .select()
      .from(users)
      .where(eq(users.email, E2E_USER_EMAIL));
    const user = await createUser({
      email: `e2e-bearbeiten-${ts}@stefanai.de`,
      firstName: "Berta",
      lastName: `Bearbeiten${ts}`,
      status: "aktiv",
    });
    const name = `Berta Bearbeiten${ts}`;
    const admin = await pageAs(browser, ADMIN_STATE);

    try {
      await admin.goto("/mitarbeitende");
      const row = rowWith(admin, user.email);
      const dialog = admin
        .getByRole("dialog")
        .filter({ hasText: `${name} bearbeiten` });
      await openDialog(row.getByRole("button", { name: "Bearbeiten" }), dialog);
      await expect(
        dialog.getByText("Jeder Abschnitt wird einzeln gespeichert.")
      ).toBeVisible();

      const section = (title: string) =>
        dialog
          .locator("section")
          .filter({ has: admin.getByRole("heading", { name: title, exact: true }) });

      // Urlaubskonto
      const vacation = section("Urlaubskonto");
      await vacation.getByLabel("Jahresanspruch (Tage)").fill("27.5");
      await vacation.getByLabel("Übertrag Vorjahr (Tage)").fill("2");
      await vacation.getByRole("button", { name: "Speichern" }).click();
      await expectToast(admin, "Urlaubskonto aktualisiert.");
      await expect
        .poll(() => readUser(user.id))
        .toMatchObject({ annualVacationDays: 27.5, vacationCarryoverDays: 2 });

      // Eintritt mit Resturlaub im Eintrittsjahr
      const entry = section("Eintritt");
      await entry
        .getByLabel("Eintrittsdatum", { exact: true })
        .fill("2024-04-01");
      await entry
        .getByLabel("Resturlaub im Eintrittsjahr (Tage)")
        .fill("18");
      await entry.getByRole("button", { name: "Speichern" }).click();
      await expectToast(admin, "Eintritt gespeichert.");
      await expect
        .poll(() => readUser(user.id))
        .toMatchObject({ entryDate: "2024-04-01", entryYearVacationDays: 18 });

      // Geburtsdatum
      const birthday = section("Geburtsdatum");
      await birthday
        .getByLabel("Geburtsdatum (wird im Kalender ohne Jahr angezeigt)")
        .fill("1988-11-23");
      await birthday.getByRole("button", { name: "Speichern" }).click();
      await expectToast(admin, "Geburtsdatum gespeichert.");
      await expect
        .poll(async () => (await readUser(user.id)).birthDate)
        .toBe("1988-11-23");

      // Vorgesetzte
      const supervisors = section("Vorgesetzte");
      await supervisors
        .getByLabel("Fachliche/r Vorgesetzte/r")
        .selectOption({ label: ADMIN_NAME });
      await supervisors
        .getByLabel("Disziplinarische/r Vorgesetzte/r")
        .selectOption({ label: USER_NAME });
      await supervisors.getByRole("button", { name: "Speichern" }).click();
      await expectToast(admin, "Vorgesetzte gespeichert.");
      await expect
        .poll(() => readUser(user.id))
        .toMatchObject({
          technicalSupervisorId: adminUser.id,
          disciplinarySupervisorId: employee.id,
          isManagingDirector: false,
        });

      // "Geschäftsführung" blendet die Auswahlfelder aus und leert die
      // Zuordnung beim Speichern
      const managingDirector = supervisors.getByRole("checkbox", {
        name: "Geschäftsführung",
      });
      await expect(managingDirector).not.toBeChecked();
      await managingDirector.click();
      await expect(managingDirector).toBeChecked();
      await expect(
        supervisors.getByText("Geschäftsführung — keine Vorgesetzten-Zuordnung.")
      ).toBeVisible();
      await expect(
        supervisors.getByLabel("Fachliche/r Vorgesetzte/r")
      ).toHaveCount(0);
      await expect(
        supervisors.getByLabel("Disziplinarische/r Vorgesetzte/r")
      ).toHaveCount(0);
      await supervisors.getByRole("button", { name: "Speichern" }).click();
      await expect
        .poll(() => readUser(user.id))
        .toMatchObject({
          isManagingDirector: true,
          technicalSupervisorId: null,
          disciplinarySupervisorId: null,
        });

      // "Schließen" beendet den Dialog — die Tabelle zeigt alle Änderungen
      await dialog.getByRole("button", { name: "Schließen" }).click();
      await expect(dialog).toBeHidden();
      await expect(row.getByText("GF", { exact: true })).toBeVisible();
      await expect(
        row.getByText("Geschäftsführung", { exact: true })
      ).toBeVisible();
      await expect(row.getByText("27.5 + 2 T")).toBeVisible();
      await expect(row.getByText("01.04.2024")).toBeVisible();
      await expect(row.getByText("23.11.1988")).toBeVisible();
    } finally {
      await deleteUsers([user.id]);
    }
  });

  test("Dokumente: bei der Einladung und nachträglich hochladen, herunterladen, löschen", async ({
    browser,
  }) => {
    test.skip(
      !process.env.BLOB_READ_WRITE_TOKEN,
      "BLOB_READ_WRITE_TOKEN nicht gesetzt — Dokumenten-Upload wird übersprungen."
    );
    const db = testDb();
    const ts = Date.now();
    const email = `e2e-dokumente-${ts}@stefanai.de`;
    const name = `Doris Dokumente${ts}`;
    const contractName = `arbeitsvertrag-${ts}.pdf`;
    const contract = pdfBuffer(`Arbeitsvertrag ${ts}`);
    const certificateName = `bescheinigung-${ts}.pdf`;
    const certificateTitle = `Bescheinigung ${ts}`;
    const certificate = pdfBuffer(`Bescheinigung ${ts}`);
    const admin = await pageAs(browser, ADMIN_STATE);

    try {
      // Einladung mit Arbeitsvertrag
      await admin.goto("/mitarbeitende");
      const inviteDialog = admin
        .getByRole("dialog")
        .filter({ hasText: "Neue/n Mitarbeiter/in einladen" });
      await openDialog(
        admin.getByRole("button", { name: "Mitarbeiter/in einladen" }),
        inviteDialog
      );
      await inviteDialog.locator("#firstName").fill("Doris");
      await inviteDialog.locator("#lastName").fill(`Dokumente${ts}`);
      await inviteDialog.locator("#email").fill(email);
      await inviteDialog.locator("#invite-entry-date").fill("2026-01-01");
      await inviteDialog.locator("#invite-documents").setInputFiles({
        name: contractName,
        mimeType: "application/pdf",
        buffer: contract,
      });
      await inviteDialog
        .locator("#invite-document-category")
        .selectOption({ label: "Arbeitsvertrag" });
      await inviteDialog
        .getByRole("button", { name: "Einladen", exact: true })
        .click();
      await expectToast(admin, "Einladung versendet.");
      await expect(inviteDialog).toBeHidden();

      const [user] = await db.select().from(users).where(eq(users.email, email));
      const readDocs = () =>
        db
          .select()
          .from(employeeDocuments)
          .where(eq(employeeDocuments.userId, user.id));
      expect(await readDocs()).toEqual([
        expect.objectContaining({
          filename: contractName,
          category: "arbeitsvertrag",
          contentType: "application/pdf",
          sizeBytes: contract.length,
        }),
      ]);

      // Dokumente-Dialog: Download des Arbeitsvertrags
      const row = rowWith(admin, email);
      await expect(row.getByRole("cell").nth(7)).toHaveText("1");
      const docsDialog = admin
        .getByRole("dialog")
        .filter({ hasText: `Dokumente — ${name}` });
      await openDialog(row.getByRole("button", { name: "Dokumente" }), docsDialog);
      const contractLink = docsDialog.getByRole("link", { name: contractName });
      await expect(contractLink).toBeVisible();
      await expect(docsDialog.getByText(/^Arbeitsvertrag · /)).toBeVisible();
      const contractRes = await fetchHref(admin, contractLink);
      expect(contractRes.status()).toBe(200);
      expect(contractRes.headers()["content-type"]).toContain("application/pdf");
      expect(contractRes.headers()["content-disposition"]).toContain(
        `filename="${contractName}"`
      );
      expect(Buffer.compare(await contractRes.body(), contract)).toBe(0);

      // Nachträglicher Upload mit Kategorie und Titel
      await docsDialog.locator(`#doc-files-${user.id}`).setInputFiles({
        name: certificateName,
        mimeType: "application/pdf",
        buffer: certificate,
      });
      await docsDialog
        .locator(`#doc-category-${user.id}`)
        .selectOption({ label: "Bescheinigung" });
      await docsDialog.locator(`#doc-title-${user.id}`).fill(certificateTitle);
      await docsDialog.getByRole("button", { name: "Hochladen" }).click();
      await expectToast(admin, "Dokument(e) verschlüsselt gespeichert.");
      const certificateLink = docsDialog.getByRole("link", {
        name: certificateTitle,
      });
      await expect(certificateLink).toBeVisible();
      const certificateRes = await fetchHref(admin, certificateLink);
      expect(certificateRes.status()).toBe(200);
      expect(Buffer.compare(await certificateRes.body(), certificate)).toBe(0);
      await expect.poll(async () => (await readDocs()).length).toBe(2);
      expect(
        (await readDocs()).find((d) => d.filename === certificateName)
      ).toMatchObject({ category: "bescheinigung", title: certificateTitle });

      // Löschen — "Abbrechen" behält das Dokument
      const certificateItem = docsDialog.locator("li", {
        hasText: certificateTitle,
      });
      const confirm = admin
        .getByRole("dialog")
        .filter({ hasText: "Dokument löschen?" });
      await certificateItem.getByRole("button", { name: "Löschen" }).click();
      await expect(confirm).toContainText(`„${certificateName}“`);
      await confirm.getByRole("button", { name: "Abbrechen" }).click();
      await expect(confirm).toBeHidden();
      await expect(certificateLink).toBeVisible();
      expect(await readDocs()).toHaveLength(2);

      // Löschen bestätigen — beide Dokumente
      await certificateItem.getByRole("button", { name: "Löschen" }).click();
      await confirm.getByRole("button", { name: "Endgültig löschen" }).click();
      await expectToast(admin, "Dokument gelöscht.");
      await expect(confirm).toBeHidden();
      await expect(certificateLink).toHaveCount(0);
      await expect.poll(async () => (await readDocs()).length).toBe(1);

      await docsDialog
        .locator("li", { hasText: contractName })
        .getByRole("button", { name: "Löschen" })
        .click();
      await confirm.getByRole("button", { name: "Endgültig löschen" }).click();
      await expect(confirm).toBeHidden();
      await expect(
        docsDialog.getByText("Noch keine Dokumente hinterlegt.")
      ).toBeVisible();
      await expect.poll(async () => (await readDocs()).length).toBe(0);

      await docsDialog.getByRole("button", { name: "Schließen" }).click();
      await expect(docsDialog).toBeHidden();
      await expect(row.getByRole("cell").nth(7)).toHaveText("0");
    } finally {
      const created = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email));
      await deleteUsers(created.map((u) => u.id));
    }
  });
});
