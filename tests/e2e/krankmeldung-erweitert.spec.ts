import {
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";
import { eq } from "drizzle-orm";
import { sickLeaves, users } from "../../src/db/schema";
import { E2E_USER_EMAIL, testDb } from "../helpers/db";
import {
  ADMIN_STATE,
  USER_NAME,
  USER_STATE,
  clickNav,
  pageAs,
  statusBadge,
} from "./helpers";

/*
 * Ergänzt krankmeldung.spec.ts (Testplan 5.5 „Krankmeldung“): voraussichtliches
 * Ende, Typ „Kind krank“, „Details“ aus der Liste und die Admin-Korrektur.
 * Zeiträume in 2027, damit sie keine Prüfungen auf 2026 berühren.
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

/** Wert eines <dt>/<dd>-Paars in der Karte „Meldung“. */
function detail(scope: Page | Locator, label: string): Locator {
  return scope.locator(`div:has(> dt:text-is("${label}")) > dd`);
}

/** Tabellenzeile der Liste, die auf genau diese Meldung verlinkt. */
function listRow(page: Page, id: string): Locator {
  return page
    .getByRole("row")
    .filter({ has: page.locator(`a[href="/krankmeldung/${id}"]`) });
}

test.describe("Krankmeldung — erweiterte Bedienelemente", () => {
  test.describe.configure({ timeout: 120_000 });

  test("Meldung mit voraussichtlichem Ende und Typ „Kind krank“, „Details“ aus der Liste, Admin-Korrektur", async ({
    browser,
  }) => {
    const db = testDb();
    const note = `Kita geschlossen E2E-${Date.now()}`;
    const employee = await open(browser, USER_STATE);
    const admin = await open(browser, ADMIN_STATE);

    // 1. Mitarbeiter meldet Mo 08.02. bis voraussichtlich Mi 10.02.2027
    await employee.goto("/krankmeldung");
    await employee.getByRole("button", { name: "Krank melden" }).click();
    await expect(employee).toHaveURL(/\/krankmeldung\/neu$/, {
      timeout: 30_000,
    });
    await employee.locator("#startDate").fill("2027-02-08");
    await employee.locator("#endDate").fill("2027-02-10");
    await employee.locator("#type").selectOption({ label: "Kind krank" });
    await employee.locator("#note").fill(note);
    await employee.getByRole("button", { name: "Krankmeldung senden" }).click();
    await expect(employee).toHaveURL(/\/krankmeldung\/[0-9a-f-]{36}$/, {
      timeout: 30_000,
    });
    const id = employee.url().split("/").pop()!;

    await expect(statusBadge(employee, "Gemeldet")).toBeVisible();
    await expect(detail(employee, "Erster Tag")).toHaveText("08.02.2027");
    await expect(detail(employee, "Ende")).toHaveText(
      "10.02.2027 (voraussichtlich)"
    );
    await expect(detail(employee, "Typ")).toHaveText("Kind krank");
    await expect(detail(employee, "Bemerkung")).toHaveText(note);
    // Das Abschluss-Formular ist mit dem voraussichtlichen Ende vorbelegt
    await expect(employee.locator("#endDate")).toHaveValue("2027-02-10");
    // Mitarbeitende sehen keine Admin-Korrektur
    await expect(
      employee.getByText("Meldung korrigieren (Admin)", { exact: true })
    ).toHaveCount(0);

    const [created] = await db
      .select()
      .from(sickLeaves)
      .where(eq(sickLeaves.id, id));
    expect(created).toMatchObject({
      status: "gemeldet",
      type: "kind_krank",
      startDate: "2027-02-08",
      endDate: "2027-02-10",
      note,
    });

    // 2. „Details“ aus der eigenen Liste öffnet dieselbe Meldung
    await clickNav(employee, "Krankmeldung");
    await expect(employee).toHaveURL(/\/krankmeldung$/);
    const row = listRow(employee, id);
    await expect(row).toContainText("ab 08.02.2027 bis 10.02.2027");
    await expect(row).toContainText("Kind krank");
    await expect(row.locator('[data-slot="badge"]')).toHaveText("Gemeldet");
    await row.getByRole("link", { name: "Details" }).click();
    await expect(employee).toHaveURL(new RegExp(`/krankmeldung/${id}$`));
    await expect(detail(employee, "Typ")).toHaveText("Kind krank");

    // 3. Admin öffnet die Meldung über „Details“ in der Gesamtliste …
    await admin.goto("/krankmeldung");
    const adminRow = listRow(admin, id);
    await expect(adminRow).toContainText(USER_NAME);
    await adminRow.getByRole("link", { name: "Details" }).click();
    await expect(admin).toHaveURL(new RegExp(`/krankmeldung/${id}$`), {
      timeout: 30_000,
    });
    await expect(
      admin.getByText("Meldung korrigieren (Admin)", { exact: true })
    ).toBeVisible();
    // … kann fremde Meldungen nicht selbst abschließen …
    await expect(
      admin.getByRole("button", { name: "Abschließen" })
    ).toHaveCount(0);
    // … und korrigiert Zeitraum, Typ und Bemerkung
    await expect(admin.locator("#c-startDate")).toHaveValue("2027-02-08");
    await expect(admin.locator("#c-endDate")).toHaveValue("2027-02-10");
    await expect(admin.locator("#c-type")).toHaveValue("kind_krank");
    await admin.locator("#c-startDate").fill("2027-02-09");
    await admin.locator("#c-endDate").fill("2027-02-12");
    await admin.locator("#c-type").selectOption({ label: "eigene Erkrankung" });
    await admin.locator("#c-note").fill("Durch Admin korrigiert (eAU liegt vor)");
    await admin.getByRole("button", { name: "Korrektur speichern" }).click();

    // Mit Enddatum gilt die Meldung als abgeschlossen
    await expect(statusBadge(admin, "Abgeschlossen")).toBeVisible();
    await expect(detail(admin, "Erster Tag")).toHaveText("09.02.2027");
    await expect(detail(admin, "Ende")).toHaveText("12.02.2027");
    await expect(detail(admin, "Typ")).toHaveText("eigene Erkrankung");
    await expect(detail(admin, "Bemerkung")).toHaveText(
      "Durch Admin korrigiert (eAU liegt vor)"
    );
    await expect(
      admin.getByText("durch admin korrigiert", { exact: true })
    ).toBeVisible();

    const [corrected] = await db
      .select()
      .from(sickLeaves)
      .where(eq(sickLeaves.id, id));
    expect(corrected).toMatchObject({
      status: "abgeschlossen",
      type: "eigene_erkrankung",
      startDate: "2027-02-09",
      endDate: "2027-02-12",
      note: "Durch Admin korrigiert (eAU liegt vor)",
    });

    // 4. Der Mitarbeiter sieht die korrigierte, abgeschlossene Meldung
    await employee.reload();
    await expect(statusBadge(employee, "Abgeschlossen")).toBeVisible();
    await expect(detail(employee, "Ende")).toHaveText("12.02.2027");
    await expect(detail(employee, "Typ")).toHaveText("eigene Erkrankung");
    await expect(
      employee.getByRole("button", { name: "Abschließen" })
    ).toHaveCount(0);
  });

  test("Admin-Korrektur ohne Ende öffnet eine abgeschlossene Meldung wieder", async ({
    browser,
  }) => {
    const db = testDb();
    const employeeId = await userId(E2E_USER_EMAIL);
    const [leave] = await db
      .insert(sickLeaves)
      .values({
        userId: employeeId,
        status: "abgeschlossen",
        type: "eigene_erkrankung",
        startDate: "2027-03-22",
        endDate: "2027-03-23",
      })
      .returning();

    try {
      const admin = await open(browser, ADMIN_STATE);
      await admin.goto("/krankmeldung");
      await listRow(admin, leave.id)
        .getByRole("link", { name: "Details" })
        .click();
      await expect(admin).toHaveURL(new RegExp(`/krankmeldung/${leave.id}$`), {
        timeout: 30_000,
      });
      await expect(statusBadge(admin, "Abgeschlossen")).toBeVisible();

      await admin.locator("#c-endDate").fill("");
      await admin.getByRole("button", { name: "Korrektur speichern" }).click();
      await expect(statusBadge(admin, "Gemeldet")).toBeVisible();
      await expect(detail(admin, "Ende")).toHaveText("offen");

      const [reopened] = await db
        .select()
        .from(sickLeaves)
        .where(eq(sickLeaves.id, leave.id));
      expect(reopened).toMatchObject({ status: "gemeldet", endDate: null });
    } finally {
      // Offene Meldungen erscheinen in Überschneidungshinweisen — aufräumen
      await db.delete(sickLeaves).where(eq(sickLeaves.id, leave.id));
    }
  });
});
