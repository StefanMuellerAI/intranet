import { expect, test, type Locator, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { sickLeaves, users } from "../../src/db/schema";
import { E2E_ADMIN_EMAIL, E2E_USER_EMAIL, testDb } from "../helpers/db";
import { ADMIN_STATE, USER_STATE, pageAs } from "./helpers";

/**
 * Abwesenheitskalender (src/app/(app)/kalender/page.tsx). Alle Tests steuern
 * Jahr/Monat über URL-Parameter, damit sie unabhängig vom Systemdatum sind.
 * Die Umschalter sind als <a role="button"> gerendert (Base-UI-Button mit Link).
 */

const MONTH_NAMES = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

const ACTIVE = /(^|\s)bg-primary(\s|$)/;

function monthHeadings(page: Page): Locator {
  return page.getByRole("heading", { level: 3 });
}

function monthHeading(page: Page, name: string): Locator {
  return page.getByRole("heading", { level: 3, name, exact: true });
}

function navButton(page: Page, name: string): Locator {
  return page.getByRole("button", { name, exact: true });
}

async function userByEmail(email: string) {
  const [user] = await testDb().select().from(users).where(eq(users.email, email));
  if (!user) throw new Error(`Test-User ${email} fehlt in der Datenbank.`);
  return user;
}

test.describe("Abwesenheitskalender", () => {
  test("Monats- und Jahresansicht umschalten", async ({ browser }) => {
    const page = await pageAs(browser, USER_STATE);
    await page.goto("/kalender?jahr=2030&monat=5");
    await expect(
      page.getByRole("heading", { level: 1, name: "Abwesenheitskalender" })
    ).toBeVisible();
    await expect(monthHeading(page, "Mai 2030")).toBeVisible();
    await expect(monthHeadings(page)).toHaveCount(1);
    await expect(navButton(page, "Monatsansicht")).toHaveClass(ACTIVE);
    await expect(navButton(page, "Jahresansicht")).not.toHaveClass(ACTIVE);

    // Jahresansicht: alle 12 Monate, keine Monatsnavigation
    await navButton(page, "Jahresansicht").click();
    await expect(page).toHaveURL(/\/kalender\?jahr=2030&ansicht=jahr$/);
    await expect(monthHeadings(page)).toHaveCount(12);
    await expect(monthHeading(page, "Januar 2030")).toBeVisible();
    await expect(monthHeading(page, "Dezember 2030")).toBeVisible();
    await expect(navButton(page, "Jahresansicht")).toHaveClass(ACTIVE);
    await expect(navButton(page, "Monatsansicht")).not.toHaveClass(ACTIVE);
    await expect(navButton(page, "← April")).toHaveCount(0);
    await expect(navButton(page, "Juni →")).toHaveCount(0);

    // Zurück in die Monatsansicht — die Jahres-URL trägt keinen Monat mehr,
    // daher landet man (für ein anderes als das laufende Jahr) im Januar
    await navButton(page, "Monatsansicht").click();
    await expect(page).toHaveURL(/\/kalender\?jahr=2030&monat=1$/);
    await expect(monthHeading(page, "Januar 2030")).toBeVisible();
    await expect(monthHeadings(page)).toHaveCount(1);
  });

  test("Vor/zurück: Monatswechsel inkl. Jahreswechsel und Jahresnavigation", async ({
    browser,
  }) => {
    const page = await pageAs(browser, USER_STATE);

    // Dezember → Januar des Folgejahres
    await page.goto("/kalender?jahr=2030&monat=12");
    await expect(monthHeading(page, "Dezember 2030")).toBeVisible();
    await navButton(page, "Januar →").click();
    await expect(page).toHaveURL(/\/kalender\?jahr=2031&monat=1$/);
    await expect(monthHeading(page, "Januar 2031")).toBeVisible();

    // … und wieder zurück ins Vorjahr
    await navButton(page, "← Dezember").click();
    await expect(page).toHaveURL(/\/kalender\?jahr=2030&monat=12$/);
    await expect(monthHeading(page, "Dezember 2030")).toBeVisible();

    // Monat zurück innerhalb des Jahres
    await navButton(page, "← November").click();
    await expect(page).toHaveURL(/\/kalender\?jahr=2030&monat=11$/);
    await expect(monthHeading(page, "November 2030")).toBeVisible();

    // Jahr zurück/vor behält den Monat
    await navButton(page, "← 2029").click();
    await expect(page).toHaveURL(/\/kalender\?jahr=2029&monat=11$/);
    await expect(monthHeading(page, "November 2029")).toBeVisible();
    await navButton(page, "2030 →").click();
    await expect(page).toHaveURL(/\/kalender\?jahr=2030&monat=11$/);
    await expect(monthHeading(page, "November 2030")).toBeVisible();

    // In der Jahresansicht blättern die Jahres-Buttons ganze Jahre
    await page.goto("/kalender?jahr=2030&ansicht=jahr");
    await navButton(page, "2031 →").click();
    await expect(page).toHaveURL(/\/kalender\?jahr=2031&ansicht=jahr$/);
    await expect(monthHeadings(page)).toHaveCount(12);
    await expect(monthHeading(page, "Januar 2031")).toBeVisible();
    await navButton(page, "← 2030").click();
    await expect(page).toHaveURL(/\/kalender\?jahr=2030&ansicht=jahr$/);
    await expect(monthHeading(page, "Dezember 2030")).toBeVisible();
  });

  test("Legende und Krankheit je Rolle: Admin sieht „Krank“, Mitarbeiter „abwesend“", async ({
    browser,
  }) => {
    const db = testDb();
    const admin = await userByEmail(E2E_ADMIN_EMAIL);
    const employee = await userByEmail(E2E_USER_EMAIL);
    const adminName = `${admin.firstName} ${admin.lastName}`;
    const employeeName = `${employee.firstName} ${employee.lastName}`;

    // Krankmeldung des Admins (für den Mitarbeiter fremd) und eine eigene
    const [adminSick] = await db
      .insert(sickLeaves)
      .values({
        userId: admin.id,
        status: "abgeschlossen",
        type: "eigene_erkrankung",
        startDate: "2031-03-10",
        endDate: "2031-03-12",
      })
      .returning();
    const [employeeSick] = await db
      .insert(sickLeaves)
      .values({
        userId: employee.id,
        status: "abgeschlossen",
        type: "eigene_erkrankung",
        startDate: "2031-03-17",
        endDate: "2031-03-18",
      })
      .returning();

    try {
      // Admin: Legende mit „Krank“, ohne „abwesend“; alle Krankheiten als krank
      const adminPage = await pageAs(browser, ADMIN_STATE);
      await adminPage.goto("/kalender?jahr=2031&monat=3");
      await expect(monthHeading(adminPage, "März 2031")).toBeVisible();
      await expect(adminPage.getByText("Krank", { exact: true })).toBeVisible();
      await expect(adminPage.getByText("abwesend", { exact: true })).toHaveCount(0);
      await expect(
        adminPage.getByTitle(`${adminName}: Krank`, { exact: true }).first()
      ).toBeVisible();
      await expect(
        adminPage.getByTitle(`${employeeName}: Krank`, { exact: true }).first()
      ).toBeVisible();
      await expect(adminPage.getByTitle(/: abwesend$/)).toHaveCount(0);

      // Mitarbeiter: Legende mit „abwesend“, ohne „Krank“
      const employeePage = await pageAs(browser, USER_STATE);
      await employeePage.goto("/kalender?jahr=2031&monat=3");
      await expect(monthHeading(employeePage, "März 2031")).toBeVisible();
      await expect(
        employeePage.getByText("abwesend", { exact: true })
      ).toBeVisible();
      await expect(employeePage.getByText("Krank", { exact: true })).toHaveCount(0);
      // Fremde Krankheit nur neutral als „abwesend“
      await expect(
        employeePage
          .getByTitle(`${adminName}: abwesend`, { exact: true })
          .first()
      ).toBeVisible();
      await expect(
        employeePage.getByTitle(`${adminName}: Krank`, { exact: true })
      ).toHaveCount(0);
      // Die eigene Krankmeldung sieht die betroffene Person als krank
      await expect(
        employeePage
          .getByTitle(`${employeeName}: Krank`, { exact: true })
          .first()
      ).toBeVisible();

      // Gemeinsame Legenden-Einträge
      for (const page of [adminPage, employeePage]) {
        await expect(page.getByText("Geburtstag", { exact: true })).toBeVisible();
        await expect(page.getByText("Teamevent", { exact: true })).toBeVisible();
      }
    } finally {
      await db.delete(sickLeaves).where(eq(sickLeaves.id, adminSick.id));
      await db.delete(sickLeaves).where(eq(sickLeaves.id, employeeSick.id));
    }
  });

  test("Ungültige Parameter fallen auf sinnvolle Werte zurück", async ({
    browser,
  }) => {
    const page = await pageAs(browser, USER_STATE);
    const now = new Date();
    const currentYear = now.getFullYear();

    // Unsinniges Jahr/Monat/Ansicht → aktueller Monat, Monatsansicht
    await page.goto("/kalender?jahr=abc&monat=13&ansicht=quatsch");
    await expect(
      page.getByRole("heading", { level: 1, name: "Abwesenheitskalender" })
    ).toBeVisible();
    await expect(
      monthHeading(page, `${MONTH_NAMES[now.getMonth()]} ${currentYear}`)
    ).toBeVisible();
    await expect(monthHeadings(page)).toHaveCount(1);
    await expect(navButton(page, "Monatsansicht")).toHaveClass(ACTIVE);

    // Ungültiger Monat in einem anderen Jahr → Januar
    await page.goto("/kalender?jahr=2030&monat=0");
    await expect(monthHeading(page, "Januar 2030")).toBeVisible();
    await page.goto("/kalender?jahr=2030&monat=abc");
    await expect(monthHeading(page, "Januar 2030")).toBeVisible();

    // Nur der Monat → laufendes Jahr
    await page.goto("/kalender?monat=7");
    await expect(monthHeading(page, `Juli ${currentYear}`)).toBeVisible();
    await expect(navButton(page, "← Juni")).toHaveAttribute(
      "href",
      `/kalender?jahr=${currentYear}&monat=6`
    );
  });
});
