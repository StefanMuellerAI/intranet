import {
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";
import { eq } from "drizzle-orm";
import { users, vacationRequests } from "../../src/db/schema";
import { E2E_ADMIN_EMAIL, E2E_USER_EMAIL, testDb } from "../helpers/db";
import {
  ADMIN_NAME,
  ADMIN_STATE,
  USER_STATE,
  openDialog,
  pageAs,
  statusBadge,
} from "./helpers";

/*
 * Ergänzt urlaub.spec.ts um die übrigen Bedienelemente der Urlaubsseiten
 * (Testplan 5.5 „Urlaub“). Alle Zeiträume liegen in 2027, damit der
 * Urlaubsanspruch 2026, den urlaub.spec.ts prüft, unberührt bleibt; es wird
 * kein Urlaub des Mitarbeiters genehmigt.
 */

const pages: Page[] = [];

async function open(browser: Browser, state: string): Promise<Page> {
  const page = await pageAs(browser, state);
  pages.push(page);
  return page;
}

test.afterEach(async () => {
  for (const page of pages.splice(0))
    await page.context().close().catch(() => {});
});

async function userId(email: string): Promise<string> {
  const [user] = await testDb()
    .select()
    .from(users)
    .where(eq(users.email, email));
  if (!user) throw new Error(`Test-User ${email} fehlt in der Datenbank.`);
  return user.id;
}

/** Wartet, bis React das Element hydriert hat (Event-Handler sind aktiv). */
async function expectHydrated(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(
      () =>
        locator.evaluate((el) =>
          Object.keys(el).some((key) => key.startsWith("__reactProps$"))
        ),
      { timeout: 30_000 }
    )
    .toBe(true);
}

/** Wert eines <dt>/<dd>-Paars in den Antragsdaten. */
function detail(scope: Page | Locator, label: string): Locator {
  return scope.locator(`div:has(> dt:text-is("${label}")) > dd`);
}

/**
 * Halbe Tage als Muster — die Anzeige nutzt je nach Stand „4.5“ oder das
 * deutsche „4,5“.
 */
function daysPattern(days: number): string {
  return String(days).replace(".", "[.,]");
}

/** Vorschau „N Urlaubstage …“ im Formular (verankert, damit 5 ≠ 4,5). */
function dayPreview(page: Page, days: number): Locator {
  return page.getByText(
    new RegExp(
      `^${daysPattern(days)} Urlaubstage \\(ohne Wochenenden und Feiertage NRW\\)$`
    )
  );
}

/** Wert „Urlaubstage“ in den Antragsdaten. */
function daysValue(days: number): RegExp {
  return new RegExp(`^${daysPattern(days)}$`);
}

/** Öffnet eine Base-UI-Auswahl und wählt eine Option. */
async function chooseOption(
  page: Page,
  combobox: Locator,
  option: string
): Promise<void> {
  const item = page.getByRole("option", { name: option, exact: true }).first();
  await expectHydrated(combobox);
  await expect(async () => {
    if (!(await item.isVisible())) await combobox.click();
    await expect(item).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await item.click();
  await expect(item).toBeHidden();
}

function deleteTrigger(page: Page): Locator {
  return page
    .getByRole("main")
    .getByRole("button", { name: "Endgültig löschen" });
}

test.describe("Urlaub — erweiterte Bedienelemente", () => {
  test.describe.configure({ timeout: 120_000 });

  test("Halbtage ändern die Vorschau; Vertretung per Auswahl, Bemerkung und Überschneidungshinweis", async ({
    browser,
  }) => {
    const db = testDb();
    const adminId = await userId(E2E_ADMIN_EMAIL);
    const employeeId = await userId(E2E_USER_EMAIL);
    // Genehmigter Urlaub des Admins im selben Zeitraum (Mo 10.05. – Fr 14.05.2027)
    await db.insert(vacationRequests).values({
      userId: adminId,
      status: "genehmigt",
      startDate: "2027-05-10",
      endDate: "2027-05-14",
      days: 5,
      decidedById: employeeId,
      decidedAt: new Date(),
    });
    const note = `Familienfeier E2E-${Date.now()}`;

    const employee = await open(browser, USER_STATE);
    await employee.goto("/urlaub");
    await employee.getByRole("button", { name: "Urlaub beantragen" }).click();
    await expect(employee).toHaveURL(/\/urlaub\/neu$/, { timeout: 30_000 });

    const startDate = employee.locator("#startDate");
    await expectHydrated(startDate);
    await startDate.fill("2027-05-10");
    await employee.locator("#endDate").fill("2027-05-14");
    await expect(dayPreview(employee, 5)).toBeVisible();

    // Überschneidungshinweis mit dem genehmigten Urlaub des Admins
    await expect(
      employee.getByText("Überschneidung mit Abwesenheiten anderer", {
        exact: true,
      })
    ).toBeVisible();
    await expect(
      employee
        .getByText(`${ADMIN_NAME}: Urlaub (10.05.2027 bis 14.05.2027)`, {
          exact: true,
        })
        .first()
    ).toBeVisible();

    // Halbtags-Checkboxen ändern die Tagesvorschau
    const firstHalf = employee.getByRole("checkbox", {
      name: "Erster Tag nur halber Tag",
    });
    const lastHalf = employee.getByRole("checkbox", {
      name: "Letzter Tag nur halber Tag",
    });
    await firstHalf.click();
    await expect(firstHalf).toBeChecked();
    await expect(dayPreview(employee, 4.5)).toBeVisible();
    await lastHalf.click();
    await expect(lastHalf).toBeChecked();
    await expect(dayPreview(employee, 4)).toBeVisible();
    await firstHalf.click();
    await expect(firstHalf).not.toBeChecked();
    await expect(dayPreview(employee, 4.5)).toBeVisible();

    // Vertretung über die Auswahl (statt Freitext)
    await chooseOption(
      employee,
      employee.getByRole("main").getByRole("combobox"),
      ADMIN_NAME
    );
    await expect(
      employee.locator('input[name="substituteUserId"]')
    ).toHaveValue(adminId);

    await employee.locator("#note").fill(note);
    await employee.getByRole("button", { name: "Antrag einreichen" }).click();
    await expect(employee).toHaveURL(/\/urlaub\/[0-9a-f-]{36}$/, {
      timeout: 30_000,
    });
    const id = employee.url().split("/").pop()!;

    await expect(statusBadge(employee, "Eingereicht")).toBeVisible();
    await expect(detail(employee, "Zeitraum")).toHaveText(
      "10.05.2027 – 14.05.2027 (letzter Tag halb)"
    );
    await expect(detail(employee, "Urlaubstage")).toHaveText(daysValue(4.5));
    await expect(detail(employee, "Vertretung")).toHaveText(ADMIN_NAME);
    await expect(detail(employee, "Bemerkung")).toHaveText(note);

    const [saved] = await db
      .select()
      .from(vacationRequests)
      .where(eq(vacationRequests.id, id));
    expect(saved).toMatchObject({
      status: "eingereicht",
      halfDayStart: false,
      halfDayEnd: true,
      days: 4.5,
      substituteUserId: adminId,
      substituteText: null,
      note,
    });

    // Der Admin sieht Halbtag, Vertretung und Bemerkung in der Freigabe
    const admin = await open(browser, ADMIN_STATE);
    await admin.goto("/freigaben");
    await admin
      .getByRole("row")
      .filter({ has: admin.locator(`a[href="/freigaben/urlaub/${id}"]`) })
      .getByRole("link", { name: "Prüfen" })
      .click();
    await expect(admin).toHaveURL(new RegExp(`/freigaben/urlaub/${id}$`), {
      timeout: 30_000,
    });
    await expect(detail(admin, "Zeitraum")).toHaveText(
      "10.05.2027 – 14.05.2027 (letzter Tag halb)"
    );
    await expect(detail(admin, "Urlaubstage")).toHaveText(daysValue(4.5));
    await expect(detail(admin, "Vertretung")).toHaveText(ADMIN_NAME);
    await expect(detail(admin, "Bemerkung")).toHaveText(note);
  });

  test("Zurückziehen aus „beanstandet“ und korrigiert erneut einreichen aus „zurückgezogen“", async ({
    browser,
  }) => {
    const db = testDb();
    const adminId = await userId(E2E_ADMIN_EMAIL);
    const employeeId = await userId(E2E_USER_EMAIL);
    const comment = `Bitte Zeitraum prüfen (E2E-${Date.now()})`;
    // Beanstandeter Antrag Mo 01.03. – Mi 03.03.2027 (3 Tage)
    const [request] = await db
      .insert(vacationRequests)
      .values({
        userId: employeeId,
        status: "beanstandet",
        startDate: "2027-03-01",
        endDate: "2027-03-03",
        days: 3,
        rejectionComment: comment,
        decidedById: adminId,
        decidedAt: new Date(),
      })
      .returning();

    const employee = await open(browser, USER_STATE);
    await employee.goto("/urlaub");
    await employee.locator(`a[href="/urlaub/${request.id}"]`).click();
    await expect(employee).toHaveURL(new RegExp(`/urlaub/${request.id}$`), {
      timeout: 30_000,
    });
    await expect(statusBadge(employee, "Beanstandet")).toBeVisible();
    await expect(employee.getByText(comment, { exact: true })).toBeVisible();

    // Zurückziehen ist auch aus „beanstandet“ möglich
    await employee.getByRole("button", { name: "Antrag zurückziehen" }).click();
    await expect(statusBadge(employee, "Zurückgezogen")).toBeVisible();
    await expect(employee.getByText(comment, { exact: true })).toHaveCount(0);
    await expect(
      employee.getByRole("button", { name: "Antrag zurückziehen" })
    ).toHaveCount(0);
    await expect(deleteTrigger(employee)).toBeVisible();
    await expect(
      employee.getByText("Antrag korrigieren und erneut einreichen", {
        exact: true,
      })
    ).toBeVisible();

    // Aus „zurückgezogen“ korrigieren: ein Tag länger, erster Tag halb
    const endDate = employee.locator("#endDate");
    await expectHydrated(endDate);
    await expect(employee.locator("#startDate")).toHaveValue("2027-03-01");
    await expect(endDate).toHaveValue("2027-03-03");
    await endDate.fill("2027-03-04");
    await expect(dayPreview(employee, 4)).toBeVisible();
    await employee
      .getByRole("checkbox", { name: "Erster Tag nur halber Tag" })
      .click();
    await expect(dayPreview(employee, 3.5)).toBeVisible();
    await employee
      .getByPlaceholder("Alternativ: Vertretung als Freitext")
      .fill("Team Vertrieb");
    await employee.locator("#note").fill("Korrigiert nach Rückzug");
    await employee
      .getByRole("button", { name: "Korrigiert erneut einreichen" })
      .click();

    await expect(statusBadge(employee, "Eingereicht")).toBeVisible({
      timeout: 30_000,
    });
    await expect(employee.getByText("Version 2", { exact: true })).toBeVisible();
    await expect(detail(employee, "Zeitraum")).toHaveText(
      "01.03.2027 – 04.03.2027 (erster Tag halb)"
    );
    await expect(detail(employee, "Urlaubstage")).toHaveText(daysValue(3.5));
    await expect(detail(employee, "Vertretung")).toHaveText("Team Vertrieb");
    await expect(detail(employee, "Bemerkung")).toHaveText(
      "Korrigiert nach Rückzug"
    );
    // Die Ursprungsfassung bleibt als frühere Version sichtbar
    await expect(
      employee.getByText("Frühere Versionen", { exact: true })
    ).toBeVisible();
    await expect(
      employee.getByText("01.03.2027 – 03.03.2027 · 3 Tage", {
        exact: true,
      })
    ).toBeVisible();

    const [saved] = await db
      .select()
      .from(vacationRequests)
      .where(eq(vacationRequests.id, request.id));
    expect(saved).toMatchObject({
      status: "eingereicht",
      version: 2,
      endDate: "2027-03-04",
      halfDayStart: true,
      halfDayEnd: false,
      days: 3.5,
      substituteUserId: null,
      substituteText: "Team Vertrieb",
    });
  });

  test("„Abbrechen“ im Löschdialog behält den zurückgezogenen Antrag", async ({
    browser,
  }) => {
    const db = testDb();
    const employeeId = await userId(E2E_USER_EMAIL);
    // Zurückgezogener Antrag Mo 15.03. – Di 16.03.2027
    const [request] = await db
      .insert(vacationRequests)
      .values({
        userId: employeeId,
        status: "zurueckgezogen",
        startDate: "2027-03-15",
        endDate: "2027-03-16",
        days: 2,
      })
      .returning();

    const employee = await open(browser, USER_STATE);
    await employee.goto("/urlaub");
    await employee.locator(`a[href="/urlaub/${request.id}"]`).click();
    await expect(employee).toHaveURL(new RegExp(`/urlaub/${request.id}$`), {
      timeout: 30_000,
    });
    await expect(statusBadge(employee, "Zurückgezogen")).toBeVisible();

    const dialog = employee.getByRole("dialog");
    await openDialog(deleteTrigger(employee), dialog);
    await expect(
      dialog.getByText(
        "Der Urlaubsantrag wird unwiderruflich gelöscht. Dieser Schritt kann nicht rückgängig gemacht werden.",
        { exact: true }
      )
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Abbrechen" }).click();
    await expect(dialog).toBeHidden();

    // Antrag bleibt erhalten — auf der Seite, in der DB und nach dem Neuladen
    await expect(employee).toHaveURL(new RegExp(`/urlaub/${request.id}$`));
    await expect(statusBadge(employee, "Zurückgezogen")).toBeVisible();
    const afterCancel = await db
      .select()
      .from(vacationRequests)
      .where(eq(vacationRequests.id, request.id));
    expect(afterCancel).toHaveLength(1);
    expect(afterCancel[0].status).toBe("zurueckgezogen");
    await employee.reload();
    await expect(statusBadge(employee, "Zurückgezogen")).toBeVisible();

    // Aufräumen über denselben Dialog: jetzt endgültig löschen
    await openDialog(deleteTrigger(employee), dialog);
    await dialog.getByRole("button", { name: "Endgültig löschen" }).click();
    await expect(employee).toHaveURL(/\/urlaub$/, { timeout: 30_000 });
    await expect(
      employee.locator(`a[href="/urlaub/${request.id}"]`)
    ).toHaveCount(0);
  });
});
