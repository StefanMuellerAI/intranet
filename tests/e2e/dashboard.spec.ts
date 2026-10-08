import { expect, test, type Locator, type Page } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import {
  commissionClaims,
  expenseReports,
  helpfulLinks,
  settings,
  teamEvents,
  users,
  vacationRequests,
  workationRequests,
  type User,
} from "../../src/db/schema";
import { E2E_ADMIN_EMAIL, E2E_USER_EMAIL, testDb } from "../helpers/db";
import { ADMIN_STATE, USER_NAME, USER_STATE, pageAs } from "./helpers";

/**
 * Dashboard: Kontingent-Karten, Schnellzugriff, Kurzbriefing, offene
 * Freigaben (Admin), „Meine letzten Anträge“ und hilfreiche Links.
 * Leerzustände („Keine offenen Anträge.“, „Noch keine Anträge vorhanden.“,
 * „Aktuell keine Links hinterlegt.“) sind in der geteilten Test-DB nicht
 * verlässlich herstellbar und werden hier bewusst nicht geprüft.
 */

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

function urlEndingWith(path: string): RegExp {
  return new RegExp(`${escapeRegExp(path)}$`);
}

function h1(page: Page, name: string | RegExp): Locator {
  return typeof name === "string"
    ? page.getByRole("heading", { level: 1, name, exact: true })
    : page.getByRole("heading", { level: 1, name });
}

/** Karte (data-slot="card") anhand ihres Titels */
function card(page: Page, title: string | RegExp): Locator {
  return page.locator('[data-slot="card"]').filter({
    has:
      typeof title === "string"
        ? page.getByText(title, { exact: true })
        : page.getByText(title),
  });
}

/** Lokales Datum als YYYY-MM-DD (wie toISODate in src/lib/dates.ts) */
function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

async function userByEmail(email: string): Promise<User> {
  const [user] = await testDb().select().from(users).where(eq(users.email, email));
  if (!user) throw new Error(`Test-User ${email} fehlt in der Datenbank.`);
  return user;
}

/** Gleiche Regeln wie getVacationEntitlement (src/lib/vacation.ts) */
function entitlementFor(user: User, year: number): number {
  const full = user.annualVacationDays + user.vacationCarryoverDays;
  if (!user.entryDate) return full;
  const entryYear = Number(user.entryDate.slice(0, 4));
  if (year < entryYear) return 0;
  if (year === entryYear) return user.entryYearVacationDays ?? 0;
  return full;
}

/** Erwartete Kartenwerte direkt aus der Datenbank */
async function expectedQuotas(userId: string, year: number) {
  const db = testDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  const vacations = await db
    .select()
    .from(vacationRequests)
    .where(eq(vacationRequests.userId, userId));
  const workations = await db
    .select()
    .from(workationRequests)
    .where(eq(workationRequests.userId, userId));
  const [config] = await db.select().from(settings).where(eq(settings.id, 1));

  const used = vacations
    .filter(
      (r) =>
        r.startDate.startsWith(String(year)) &&
        (r.status === "genehmigt" || r.status === "storno_beantragt")
    )
    .reduce((sum, r) => sum + r.days, 0);
  const usedWorkation = workations
    .filter(
      (r) =>
        r.startDate.startsWith(String(year)) &&
        (r.status === "genehmigt" || r.status === "eingereicht")
    )
    .reduce((sum, r) => sum + r.workDays, 0);
  const entitlement = entitlementFor(user, year);
  return {
    entitlement,
    remaining: entitlement - used,
    workationLimit: config.workationYearlyLimitDays,
    workationRemaining: config.workationYearlyLimitDays - usedWorkation,
  };
}

/** Gleiche Definition wie listOpenApprovals (src/lib/approvals.ts). */
async function countOpenApprovals(): Promise<number> {
  const db = testDb();
  const open: ("eingereicht" | "storno_beantragt")[] = [
    "eingereicht",
    "storno_beantragt",
  ];
  const [vacations, workations, expenses, commissions] = await Promise.all([
    db
      .select({ id: vacationRequests.id })
      .from(vacationRequests)
      .where(inArray(vacationRequests.status, open)),
    db
      .select({ id: workationRequests.id })
      .from(workationRequests)
      .where(inArray(workationRequests.status, open)),
    db
      .select({ id: expenseReports.id })
      .from(expenseReports)
      .where(inArray(expenseReports.status, open)),
    db
      .select({ id: commissionClaims.id })
      .from(commissionClaims)
      .where(inArray(commissionClaims.status, open)),
  ]);
  return (
    vacations.length + workations.length + expenses.length + commissions.length
  );
}

/** Minimaler, gültiger Workation-Datensatz für Direkt-Inserts */
function workationValues(
  userId: string,
  values: {
    city: string;
    startDate: string;
    endDate: string;
    workDays: number;
    status: "eingereicht" | "genehmigt";
  }
) {
  return {
    userId,
    country: "Spanien",
    countryCategory: "eu_ewr_ch" as const,
    accommodationAddress: "Calle Mayor 1, Valencia",
    timezoneAvailability: "MEZ, 9–17 Uhr",
    emergencyContactName: "Erika Admin",
    emergencyContactPhone: "+49 221 000000",
    visaType: "nicht erforderlich",
    insuranceDetails: "Auslandskrankenversicherung",
    plannedTasks: "Projektarbeit",
    domesticSubstitution: "keine",
    ...values,
  };
}

test.describe("Dashboard", () => {
  test("Karten Resturlaub und Workation-Kontingent entsprechen der Datenbank", async ({
    browser,
  }) => {
    const db = testDb();
    const employee = await userByEmail(E2E_USER_EMAIL);
    // Die Karten zeigen das laufende Kalenderjahr (echte Systemzeit)
    const year = new Date().getFullYear();

    // Genehmigter Urlaub (2 Tage) und genehmigte Workation (3 AT) im Jahr
    const [vacation] = await db
      .insert(vacationRequests)
      .values({
        userId: employee.id,
        status: "genehmigt",
        startDate: `${year}-12-29`,
        endDate: `${year}-12-30`,
        days: 2,
      })
      .returning();
    const [workation] = await db
      .insert(workationRequests)
      .values(
        workationValues(employee.id, {
          city: `E2E-Kontingentstadt ${Date.now()}`,
          startDate: `${year}-12-14`,
          endDate: `${year}-12-16`,
          workDays: 3,
          status: "genehmigt",
        })
      )
      .returning();

    const page = await pageAs(browser, USER_STATE);
    try {
      const expected = await expectedQuotas(employee.id, year);
      await page.goto("/dashboard");
      await expect(h1(page, "Willkommen, Max!")).toBeVisible();

      await expect(card(page, `Resturlaub ${year}`)).toContainText(
        `${expected.remaining} / ${expected.entitlement} Tagen`
      );
      await expect(card(page, "Workation-Kontingent")).toContainText(
        `${expected.workationRemaining} / ${expected.workationLimit} AT`
      );

      // Gegenprobe: Urlaubsseite rechnet mit demselben Konto
      await page.goto("/urlaub");
      await expect(card(page, "Resturlaub")).toContainText(
        `${expected.remaining} Tage`
      );
      await expect(card(page, `Anspruch ${year}`)).toContainText(
        `${expected.entitlement} Tage`
      );
    } finally {
      await db.delete(vacationRequests).where(eq(vacationRequests.id, vacation.id));
      await db
        .delete(workationRequests)
        .where(eq(workationRequests.id, workation.id));
    }

    // Nach dem Entfernen steigt der Resturlaub wieder um 2 Tage
    const restored = await expectedQuotas(employee.id, year);
    await page.goto("/dashboard");
    await expect(card(page, `Resturlaub ${year}`)).toContainText(
      `${restored.remaining} / ${restored.entitlement} Tagen`
    );
    await expect(card(page, "Workation-Kontingent")).toContainText(
      `${restored.workationRemaining} / ${restored.workationLimit} AT`
    );
  });

  test("Schnellzugriff, „Zum Kalender“ und Kurzbriefing", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const db = testDb();
    const admin = await userByEmail(E2E_ADMIN_EMAIL);
    const title = `E2E-Briefing-Event ${Date.now()}`;
    const today = new Date();
    const [event] = await db
      .insert(teamEvents)
      .values({
        title,
        startDate: isoDate(today),
        endDate: isoDate(
          new Date(today.getFullYear(), today.getMonth(), today.getDate() + 3)
        ),
        createdById: admin.id,
      })
      .returning();

    const page = await pageAs(browser, USER_STATE);
    try {
      // Kurzbriefing erwähnt das laufende Teamevent
      await page.goto("/dashboard");
      const briefing = card(page, /^Kurzbriefing/);
      await expect(briefing).toContainText(title);

      await briefing
        .getByRole("link", { name: "Zum Kalender", exact: true })
        .click();
      await expect(page).toHaveURL(/\/kalender$/);
      await expect(h1(page, "Abwesenheitskalender")).toBeVisible();

      const quickLinks = [
        { name: "Urlaub beantragen", target: "/urlaub/neu", heading: "Urlaub beantragen" },
        { name: "Workation beantragen", target: "/workation/neu", heading: "Workation beantragen" },
        { name: "Reisekosten abrechnen", target: "/reisekosten/neu", heading: "Reisekostenabrechnung" },
        { name: "Krank melden", target: "/krankmeldung/neu", heading: "Krank melden" },
        { name: "Zeiten buchen", target: "/faktura", heading: "Zeiterfassung" },
      ];
      for (const link of quickLinks) {
        await page.goto("/dashboard");
        await card(page, "Schnellzugriff")
          .getByRole("link", { name: link.name, exact: true })
          .click();
        await expect(page).toHaveURL(urlEndingWith(link.target), {
          timeout: 30_000,
        });
        await expect(h1(page, link.heading)).toBeVisible({ timeout: 30_000 });
      }
    } finally {
      await db.delete(teamEvents).where(eq(teamEvents.id, event.id));
    }
  });

  test("Admin: „Offene Freigaben“ listet auch Provisionen und verlinkt auf die Prüfung", async ({
    browser,
  }) => {
    const db = testDb();
    const employee = await userByEmail(E2E_USER_EMAIL);
    const customer = `E2E-Dashboardkunde ${Date.now()}`;
    const [claim] = await db
      .insert(commissionClaims)
      .values({
        userId: employee.id,
        businessType: "schulung",
        customerType: "bestandskunde",
        customerName: customer,
        orderDate: "2031-07-01",
        unit: "tage",
        quantity: 1,
        trainingFormat: "ganztaegig",
        trainingCount: 1,
        calculatedAmountCents: 7500,
        finalAmountCents: 7500,
      })
      .returning();
    const [vacation] = await db
      .insert(vacationRequests)
      .values({
        userId: employee.id,
        startDate: "2031-07-07",
        endDate: "2031-07-09",
        days: 3,
      })
      .returning();

    const page = await pageAs(browser, ADMIN_STATE);
    try {
      const open = await countOpenApprovals();
      await page.goto("/dashboard");
      const approvals = card(page, /^Offene Freigaben \(\d+\)$/);
      await expect(
        approvals.getByText(`Offene Freigaben (${open})`, { exact: true })
      ).toBeVisible();
      await expect(approvals.getByRole("link")).toHaveCount(open);
      // Sidebar-Badge und Karte zählen dieselben Anträge (inkl. Provisionen)
      await expect(
        page
          .getByRole("navigation")
          .first()
          .getByRole("link", { name: /^Freigaben/ })
          .locator("span.rounded-full")
      ).toHaveText(String(open));

      const provisionLink = approvals
        .getByRole("link")
        .filter({ hasText: customer });
      await expect(provisionLink).toContainText("Provision");
      await expect(provisionLink).toContainText(USER_NAME);
      await expect(provisionLink).toContainText("Schulung");
      await expect(provisionLink).toContainText("75,00");
      await provisionLink.click();
      await expect(page).toHaveURL(
        urlEndingWith(`/freigaben/provision/${claim.id}`)
      );
      await expect(h1(page, new RegExp(`^Provision: ${USER_NAME}`))).toBeVisible();

      await page.goto("/dashboard");
      const vacationLink = card(page, /^Offene Freigaben \(\d+\)$/)
        .getByRole("link")
        .filter({ hasText: "07.07.2031" });
      await expect(vacationLink).toContainText("Urlaub");
      await expect(vacationLink).toContainText("(3 Tage)");
      await vacationLink.click();
      await expect(page).toHaveURL(
        urlEndingWith(`/freigaben/urlaub/${vacation.id}`)
      );
      await expect(h1(page, `Urlaub: ${USER_NAME}`)).toBeVisible();
    } finally {
      await db.delete(commissionClaims).where(eq(commissionClaims.id, claim.id));
      await db.delete(vacationRequests).where(eq(vacationRequests.id, vacation.id));
    }
  });

  test("Mitarbeiter sieht keine Karte „Offene Freigaben“", async ({
    browser,
  }) => {
    const page = await pageAs(browser, USER_STATE);
    await page.goto("/dashboard");
    await expect(h1(page, "Willkommen, Max!")).toBeVisible();
    await expect(page.getByText(/^Offene Freigaben/)).toHaveCount(0);
  });

  test("„Meine letzten Anträge“ verlinken auf die eigenen Anträge", async ({
    browser,
  }) => {
    const db = testDb();
    const employee = await userByEmail(E2E_USER_EMAIL);
    const stamp = Date.now();
    const city = `E2E-Letztestadt ${stamp}`;
    const destination = `E2E-Letztereise ${stamp}`;

    const [vacation] = await db
      .insert(vacationRequests)
      .values({
        userId: employee.id,
        status: "genehmigt",
        startDate: "2031-08-04",
        endDate: "2031-08-06",
        days: 3,
      })
      .returning();
    const [workation] = await db
      .insert(workationRequests)
      .values(
        workationValues(employee.id, {
          city,
          startDate: "2031-09-08",
          endDate: "2031-09-10",
          workDays: 3,
          status: "genehmigt",
        })
      )
      .returning();
    const [expense] = await db
      .insert(expenseReports)
      .values({
        userId: employee.id,
        status: "genehmigt",
        destination,
        customerPurpose: "Workshop",
        departureDate: "2031-09-15",
        departureTime: "08:00",
        returnDate: "2031-09-15",
        returnTime: "18:00",
        mealAllowanceCents: 1400,
        totalCents: 1400,
      })
      .returning();

    const cases = [
      { text: "04.08.2031", label: /^Urlaub · 04\.08\.2031 – 06\.08\.2031 \(3 Tage\)$/, target: `/urlaub/${vacation.id}`, heading: "Urlaubsantrag" },
      { text: city, label: new RegExp(`^Workation · ${escapeRegExp(city)}, Spanien$`), target: `/workation/${workation.id}`, heading: "Workation-Antrag" },
      { text: destination, label: new RegExp(`^Reisekosten · ${escapeRegExp(destination)} \\(14,00\\s€\\)$`), target: `/reisekosten/${expense.id}`, heading: "Reisekostenabrechnung" },
    ];

    const page = await pageAs(browser, USER_STATE);
    try {
      for (const c of cases) {
        await page.goto("/dashboard");
        const link = card(page, "Meine letzten Anträge")
          .getByRole("link")
          .filter({ hasText: c.text });
        await expect(link).toHaveText(c.label);
        await link.click();
        await expect(page).toHaveURL(urlEndingWith(c.target));
        await expect(h1(page, c.heading)).toBeVisible();
      }
    } finally {
      await db.delete(vacationRequests).where(eq(vacationRequests.id, vacation.id));
      await db
        .delete(workationRequests)
        .where(eq(workationRequests.id, workation.id));
      await db.delete(expenseReports).where(eq(expenseReports.id, expense.id));
    }
  });

  test("Hilfreicher Link öffnet in einem neuen Tab", async ({ browser }) => {
    const db = testDb();
    const stamp = Date.now();
    const title = `E2E-Hilfelink ${stamp}`;
    const url = `https://example.com/e2e-hilfe-${stamp}`;
    const [link] = await db
      .insert(helpfulLinks)
      .values({ title, url, description: "Nur für den E2E-Test" })
      .returning();

    const page = await pageAs(browser, USER_STATE);
    // Externes Ziel nicht wirklich aufrufen — Antwort lokal erfüllen
    await page.context().route(url, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><title>E2E-Hilfe</title><p>ok</p>",
      })
    );
    try {
      await page.goto("/dashboard");
      const anchor = card(page, "Hilfreiche Links").getByRole("link", {
        name: new RegExp(escapeRegExp(title)),
      });
      await expect(anchor).toHaveAttribute("href", url);
      await expect(anchor).toHaveAttribute("target", "_blank");
      await expect(anchor).toHaveAttribute("rel", "noopener noreferrer");
      await expect(anchor).toContainText("Nur für den E2E-Test");

      const newTab = page.context().waitForEvent("page");
      await anchor.click();
      const tab = await newTab;
      await tab.waitForLoadState();
      expect(tab.url()).toBe(url);
      // Das Dashboard bleibt im ursprünglichen Tab geöffnet
      await expect(page).toHaveURL(/\/dashboard$/);
    } finally {
      await db.delete(helpfulLinks).where(eq(helpfulLinks.id, link.id));
    }
  });
});
