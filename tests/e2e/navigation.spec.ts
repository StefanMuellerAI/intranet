import { expect, test, type Locator, type Page } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import {
  commissionClaims,
  deputyAssignments,
  expenseReports,
  seminarReports,
  sickLeaves,
  users,
  vacationRequests,
  workationRequests,
} from "../../src/db/schema";
import { E2E_USER_EMAIL, testDb } from "../helpers/db";
import { ADMIN_STATE, USER_STATE, pageAs } from "./helpers";

/**
 * Sidebar-Navigation, Header-Aktionen und „Details“-Links.
 * Die Sidebar kennt keinen aria-current-Zustand — der aktive Link ist nur
 * über die Klasse bg-primary erkennbar (src/components/sidebar.tsx).
 */

interface NavItem {
  label: string;
  href: string;
  heading: string;
}

/** Links für alle (Reihenfolge wie in src/components/sidebar.tsx) */
function baseNav(firstName: string): NavItem[] {
  return [
    { label: "Dashboard", href: "/dashboard", heading: `Willkommen, ${firstName}!` },
    { label: "Urlaub", href: "/urlaub", heading: "Urlaub" },
    { label: "Workation", href: "/workation", heading: "Workation" },
    { label: "Reisekosten", href: "/reisekosten", heading: "Reisekosten" },
    { label: "Provisionen", href: "/provision", heading: "Provisionen" },
    { label: "Krankmeldung", href: "/krankmeldung", heading: "Krankmeldung" },
    { label: "Faktura", href: "/faktura", heading: "Zeiterfassung" },
    { label: "Berichte", href: "/berichte", heading: "Berichte" },
    { label: "Kalender", href: "/kalender", heading: "Abwesenheitskalender" },
    { label: "Organigramm", href: "/organigramm", heading: "Organigramm" },
    { label: "Dokumente", href: "/dokumente", heading: "Meine Dokumente" },
    { label: "Mein Konto", href: "/konto", heading: "Mein Konto" },
  ];
}

const APPROVER_NAV: NavItem[] = [
  { label: "Freigaben", href: "/freigaben", heading: "Freigaben" },
];

const ADMIN_NAV: NavItem[] = [
  { label: "Mitarbeitende", href: "/mitarbeitende", heading: "Mitarbeitende" },
  { label: "IT-Management", href: "/it-management", heading: "IT-Management" },
  { label: "Inhalte", href: "/inhalte", heading: "Inhalte" },
  { label: "Einstellungen", href: "/einstellungen", heading: "Einstellungen" },
];

/** Der Freigaben-Link trägt ggf. die Badge-Zahl im Linktext. */
const FREIGABEN_NAME = /^Freigaben(\s*\d+)?$/;
const ACTIVE = /(^|\s)bg-primary(\s|$)/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

function urlEndingWith(path: string): RegExp {
  return new RegExp(`${escapeRegExp(path)}$`);
}

function sidebarNav(page: Page): Locator {
  return page.getByRole("navigation").first();
}

function navLink(page: Page, label: string): Locator {
  return label === "Freigaben"
    ? sidebarNav(page).getByRole("link", { name: FREIGABEN_NAME })
    : sidebarNav(page).getByRole("link", { name: label, exact: true });
}

function approvalsBadge(page: Page): Locator {
  return navLink(page, "Freigaben").locator("span.rounded-full");
}

function h1(page: Page, name: string): Locator {
  return page.getByRole("heading", { level: 1, name, exact: true });
}

async function userByEmail(email: string) {
  const [user] = await testDb().select().from(users).where(eq(users.email, email));
  if (!user) throw new Error(`Test-User ${email} fehlt in der Datenbank.`);
  return user;
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

/** Klickt jeden Link der Liste und prüft Ziel-URL, Überschrift und Aktiv-Zustand. */
async function clickThroughNav(page: Page, items: NavItem[]): Promise<void> {
  for (const item of items) {
    await navLink(page, item.label).click();
    // Erstaufruf im Dev-Server kompiliert die Route — großzügige Timeouts
    await expect(page).toHaveURL(urlEndingWith(item.href), { timeout: 30_000 });
    await expect(h1(page, item.heading)).toBeVisible({ timeout: 30_000 });
    for (const other of items) {
      const link = navLink(page, other.label);
      if (other === item) await expect(link).toHaveClass(ACTIVE);
      else await expect(link).not.toHaveClass(ACTIVE);
    }
  }
}

test.describe("Navigation", () => {
  test("Startseite leitet Angemeldete auf das Dashboard", async ({
    browser,
  }) => {
    const admin = await pageAs(browser, ADMIN_STATE);
    await admin.goto("/");
    await expect(admin).toHaveURL(/\/dashboard$/);
    await expect(h1(admin, "Willkommen, Erika!")).toBeVisible();
  });

  test("Admin: jeder Sidebar-Link öffnet seine Seite und ist danach aktiv", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const items = [...baseNav("Erika"), ...APPROVER_NAV, ...ADMIN_NAV];
    const admin = await pageAs(browser, ADMIN_STATE);
    await admin.goto("/dashboard");

    // Vollständiger Linksatz in der Reihenfolge der Sidebar
    await expect(sidebarNav(admin).getByRole("link")).toHaveText(
      items.map((i) => (i.label === "Freigaben" ? /^Freigaben\s*\d*$/ : i.label))
    );

    await clickThroughNav(admin, items);

    // Unterseiten halten den Bereich aktiv (startsWith-Logik)
    await admin.goto("/faktura/kunden");
    await expect(h1(admin, "Kunden & Projekte")).toBeVisible();
    await expect(navLink(admin, "Faktura")).toHaveClass(ACTIVE);
    await expect(navLink(admin, "Dashboard")).not.toHaveClass(ACTIVE);
  });

  test("Mitarbeiter: nur die Mitarbeiter-Links, alle führen zur Seite", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const items = baseNav("Max");
    const employee = await pageAs(browser, USER_STATE);
    await employee.goto("/dashboard");

    await expect(employee.getByText("Mitarbeiter/in", { exact: true })).toBeVisible();
    await expect(sidebarNav(employee).getByRole("link")).toHaveText(
      items.map((i) => i.label)
    );
    await expect(navLink(employee, "Freigaben")).toHaveCount(0);
    for (const adminItem of ADMIN_NAV)
      await expect(navLink(employee, adminItem.label)).toHaveCount(0);

    await clickThroughNav(employee, items);

    // Unterseite /urlaub/neu hält „Urlaub“ aktiv
    await employee.goto("/urlaub/neu");
    await expect(h1(employee, "Urlaub beantragen")).toBeVisible();
    await expect(navLink(employee, "Urlaub")).toHaveClass(ACTIVE);
  });

  test("Badge „Freigaben“ zeigt die Zahl offener Anträge", async ({
    browser,
  }) => {
    const db = testDb();
    const employee = await userByEmail(E2E_USER_EMAIL);
    const [request] = await db
      .insert(vacationRequests)
      .values({
        userId: employee.id,
        startDate: "2031-06-02",
        endDate: "2031-06-04",
        days: 3,
      })
      .returning();

    const admin = await pageAs(browser, ADMIN_STATE);
    try {
      const open = await countOpenApprovals();
      expect(open).toBeGreaterThan(0);
      await admin.goto("/dashboard");
      await expect(approvalsBadge(admin)).toHaveText(String(open));

      // Der Link führt zur Freigabenliste mit derselben Anzahl
      await navLink(admin, "Freigaben").click();
      await expect(admin).toHaveURL(/\/freigaben$/);
      await expect(
        admin.getByText(`Offene Anträge (${open})`, { exact: true })
      ).toBeVisible();
      await expect(
        admin.getByRole("row").filter({ hasText: "02.06.2031" })
      ).toBeVisible();
      await expect(navLink(admin, "Freigaben")).toHaveClass(ACTIVE);
    } finally {
      await db
        .delete(vacationRequests)
        .where(eq(vacationRequests.id, request.id));
    }

    // Nach dem Entfernen sinkt der Zähler (bzw. das Badge verschwindet bei 0)
    const after = await countOpenApprovals();
    await admin.goto("/dashboard");
    if (after > 0) await expect(approvalsBadge(admin)).toHaveText(String(after));
    else await expect(approvalsBadge(admin)).toHaveCount(0);
  });

  test("Aktive Vertretung sieht den Link „Freigaben“", async ({ browser }) => {
    const db = testDb();
    const employee = await userByEmail(E2E_USER_EMAIL);
    const previouslyActive = await db
      .select({ id: deputyAssignments.id })
      .from(deputyAssignments)
      .where(eq(deputyAssignments.active, true));
    const previousIds = previouslyActive.map((a) => a.id);

    const page = await pageAs(browser, USER_STATE);
    let assignmentId: string | undefined;
    try {
      if (previousIds.length > 0)
        await db
          .update(deputyAssignments)
          .set({ active: false })
          .where(inArray(deputyAssignments.id, previousIds));

      // Ohne Vertretung: kein Freigaben-Link
      await page.goto("/dashboard");
      await expect(page.getByText("Mitarbeiter/in", { exact: true })).toBeVisible();
      await expect(navLink(page, "Freigaben")).toHaveCount(0);

      // Mitarbeiter wird aktive Vertretung (ohne Zeitraum = sofort)
      const [assignment] = await db
        .insert(deputyAssignments)
        .values({ userId: employee.id, active: true })
        .returning();
      assignmentId = assignment.id;

      await page.reload();
      await expect(
        page.getByText("Vertretung (aktiv)", { exact: true })
      ).toBeVisible();
      const open = await countOpenApprovals();
      const link = navLink(page, "Freigaben");
      await expect(link).toBeVisible();
      if (open > 0) await expect(approvalsBadge(page)).toHaveText(String(open));
      // Admin-Links bleiben verborgen
      for (const adminItem of ADMIN_NAV)
        await expect(navLink(page, adminItem.label)).toHaveCount(0);

      await link.click();
      await expect(page).toHaveURL(/\/freigaben$/);
      await expect(h1(page, "Freigaben")).toBeVisible();
      await expect(navLink(page, "Freigaben")).toHaveClass(ACTIVE);
    } finally {
      if (assignmentId)
        await db
          .delete(deputyAssignments)
          .where(eq(deputyAssignments.id, assignmentId));
      if (previousIds.length > 0)
        await db
          .update(deputyAssignments)
          .set({ active: true })
          .where(inArray(deputyAssignments.id, previousIds));
    }

    if (previousIds.length === 0) {
      await page.goto("/dashboard");
      await expect(navLink(page, "Freigaben")).toHaveCount(0);
    }
  });

  test("Header-Buttons führen zu den Formularseiten", async ({ browser }) => {
    test.setTimeout(180_000);
    // PageHeader rendert die Aktion als <a role="button"> (Base-UI-Button mit Link)
    const actions = [
      { list: "/urlaub", button: "Urlaub beantragen", target: "/urlaub/neu", heading: "Urlaub beantragen" },
      { list: "/workation", button: "Workation beantragen", target: "/workation/neu", heading: "Workation beantragen" },
      { list: "/reisekosten", button: "Abrechnung erstellen", target: "/reisekosten/neu", heading: "Reisekostenabrechnung" },
      { list: "/provision", button: "Anspruch einreichen", target: "/provision/neu", heading: "Provisionsanspruch einreichen" },
      { list: "/krankmeldung", button: "Krank melden", target: "/krankmeldung/neu", heading: "Krank melden" },
      { list: "/berichte", button: "Bericht erfassen", target: "/berichte/neu", heading: "Bericht erfassen" },
    ];
    const employee = await pageAs(browser, USER_STATE);
    for (const action of actions) {
      await employee.goto(action.list);
      const button = employee.getByRole("button", {
        name: action.button,
        exact: true,
      });
      await expect(button).toHaveAttribute("href", action.target);
      await button.click();
      await expect(employee).toHaveURL(urlEndingWith(action.target), {
        timeout: 30_000,
      });
      await expect(h1(employee, action.heading)).toBeVisible({
        timeout: 30_000,
      });
    }
  });

  test("„Details“-Links in allen Listen öffnen die Detailseite", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const db = testDb();
    const employee = await userByEmail(E2E_USER_EMAIL);
    const stamp = Date.now();
    const city = `E2E-Navistadt ${stamp}`;
    const destination = `E2E-Navireise ${stamp}`;
    const customer = `E2E-Navikunde ${stamp}`;
    const sickNote = `E2E-Navinotiz ${stamp}`;
    const reportTitle = `E2E-Navibericht ${stamp}`;

    // Bewusst genehmigt bzw. abgeschlossen: keine offenen Freigaben, nur Lesesicht
    const [vacation] = await db
      .insert(vacationRequests)
      .values({
        userId: employee.id,
        status: "genehmigt",
        startDate: "2031-03-03",
        endDate: "2031-03-05",
        days: 3,
      })
      .returning();
    const [workation] = await db
      .insert(workationRequests)
      .values({
        userId: employee.id,
        status: "genehmigt",
        country: "Spanien",
        countryCategory: "eu_ewr_ch",
        city,
        accommodationAddress: "Calle Mayor 1, Valencia",
        startDate: "2031-04-07",
        endDate: "2031-04-09",
        workDays: 3,
        timezoneAvailability: "MEZ, 9–17 Uhr",
        emergencyContactName: "Erika Admin",
        emergencyContactPhone: "+49 221 000000",
        visaType: "nicht erforderlich",
        insuranceDetails: "Auslandskrankenversicherung",
        plannedTasks: "Projektarbeit",
        domesticSubstitution: "keine",
      })
      .returning();
    const [expense] = await db
      .insert(expenseReports)
      .values({
        userId: employee.id,
        status: "genehmigt",
        destination,
        customerPurpose: "Workshop",
        departureDate: "2031-05-12",
        departureTime: "08:00",
        returnDate: "2031-05-12",
        returnTime: "18:00",
        mealAllowanceCents: 1400,
        totalCents: 1400,
      })
      .returning();
    const [claim] = await db
      .insert(commissionClaims)
      .values({
        userId: employee.id,
        status: "genehmigt",
        businessType: "schulung",
        customerType: "bestandskunde",
        customerName: customer,
        orderDate: "2031-05-05",
        unit: "tage",
        quantity: 1,
        trainingFormat: "ganztaegig",
        trainingCount: 1,
        calculatedAmountCents: 7500,
        finalAmountCents: 7500,
      })
      .returning();
    const [sick] = await db
      .insert(sickLeaves)
      .values({
        userId: employee.id,
        status: "abgeschlossen",
        type: "eigene_erkrankung",
        startDate: "2031-05-19",
        endDate: "2031-05-20",
        note: sickNote,
      })
      .returning();
    const [report] = await db
      .insert(seminarReports)
      .values({
        userId: employee.id,
        kind: "seminar",
        customerName: "Haufe Akademie",
        title: reportTitle,
        eventDate: "2031-05-26",
        durationDays: 1,
        whatWentWell: "Gute Diskussion.",
        whatWentBadly: "Technik hakte.",
        improvements: "Technik vorab testen.",
        feedbackRating: 4,
      })
      .returning();

    const cases = [
      { list: "/urlaub", rowText: "03.03.2031", target: `/urlaub/${vacation.id}`, heading: "Urlaubsantrag", detailText: /03\.03\.2031 bis 05\.03\.2031/ },
      { list: "/workation", rowText: city, target: `/workation/${workation.id}`, heading: "Workation-Antrag", detailText: city },
      { list: "/reisekosten", rowText: destination, target: `/reisekosten/${expense.id}`, heading: "Reisekostenabrechnung", detailText: destination },
      { list: "/provision", rowText: customer, target: `/provision/${claim.id}`, heading: "Provisionsanspruch", detailText: customer },
      { list: "/krankmeldung", rowText: "19.05.2031", target: `/krankmeldung/${sick.id}`, heading: "Krankmeldung", detailText: sickNote },
      { list: "/berichte", rowText: reportTitle, target: `/berichte/${report.id}`, heading: reportTitle, detailText: /Bericht zur Veranstaltung/ },
    ];

    const page = await pageAs(browser, USER_STATE);
    try {
      for (const c of cases) {
        await page.goto(c.list);
        const row = page.getByRole("row").filter({ hasText: c.rowText });
        await expect(row).toHaveCount(1);
        await row.getByRole("link", { name: "Details", exact: true }).click();
        await expect(page).toHaveURL(urlEndingWith(c.target), {
          timeout: 30_000,
        });
        await expect(h1(page, c.heading)).toBeVisible({ timeout: 30_000 });
        await expect(page.getByText(c.detailText).first()).toBeVisible();
      }
    } finally {
      await db.delete(vacationRequests).where(eq(vacationRequests.id, vacation.id));
      await db.delete(workationRequests).where(eq(workationRequests.id, workation.id));
      await db.delete(expenseReports).where(eq(expenseReports.id, expense.id));
      await db.delete(commissionClaims).where(eq(commissionClaims.id, claim.id));
      await db.delete(sickLeaves).where(eq(sickLeaves.id, sick.id));
      await db.delete(seminarReports).where(eq(seminarReports.id, report.id));
    }
  });

  test("Admin sieht in „Krankmeldung“ auch fremde Meldungen mit Details-Link", async ({
    browser,
  }) => {
    const db = testDb();
    const employee = await userByEmail(E2E_USER_EMAIL);
    const note = `E2E-Adminsicht ${Date.now()}`;
    const [sick] = await db
      .insert(sickLeaves)
      .values({
        userId: employee.id,
        status: "abgeschlossen",
        type: "kind_krank",
        startDate: "2031-06-16",
        endDate: "2031-06-17",
        note,
      })
      .returning();

    const admin = await pageAs(browser, ADMIN_STATE);
    try {
      await admin.goto("/krankmeldung");
      await expect(
        admin.getByText("Alle Krankmeldungen", { exact: true })
      ).toBeVisible();
      const row = admin.getByRole("row").filter({ hasText: "16.06.2031" });
      await expect(row).toContainText("Max Mitarbeiter");
      await expect(row).toContainText("Kind krank");
      await row.getByRole("link", { name: "Details", exact: true }).click();
      await expect(admin).toHaveURL(urlEndingWith(`/krankmeldung/${sick.id}`));
      // .first(): die Bemerkung steht auch im Korrekturformular (Textarea)
      await expect(admin.getByText(note, { exact: true }).first()).toBeVisible();
      await expect(
        admin.getByText("Meldung korrigieren (Admin)", { exact: true })
      ).toBeVisible();
    } finally {
      await db.delete(sickLeaves).where(eq(sickLeaves.id, sick.id));
    }
  });
});
