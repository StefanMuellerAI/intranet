import { clerk } from "@clerk/testing/playwright";
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { and, eq, inArray } from "drizzle-orm";
import { deputyAssignments, users } from "../../src/db/schema";
import { E2E_USER_EMAIL, testDb } from "../helpers/db";
import { USER_NAME, USER_STATE, pageAs } from "./helpers";

/**
 * Sperrbildschirme aus src/app/(app)/layout.tsx, Direktaufrufe der
 * Admin-Seiten als Mitarbeiter und „Abmelden“.
 *
 * Abmelden: Clerk beendet beim signOut() die Sitzungen des Clients serverseitig.
 * Ein aus USER_STATE erzeugter Kontext teilt sich diesen Client (dev-browser-
 * Token) mit allen späteren Specs — ein Klick dort würde die gespeicherte
 * Sitzung für alle nachfolgenden Tests ungültig machen. Die Abmelde-Tests
 * melden den Mitarbeiter deshalb in einem frischen Kontext neu an (eigener
 * Clerk-Client) und prüfen am Ende, dass die gespeicherte Sitzung weiter gilt.
 */

const BASE_URL = process.env.APP_BASE_URL ?? "http://localhost:3100";

const NO_ACCESS_TEXT =
  "Für Ihr Konto ist kein aktiver Intranet-Zugang hinterlegt oder das Konto wurde deaktiviert. Bitte wenden Sie sich an die Geschäftsführung.";

function h1(page: Page, name: string): Locator {
  return page.getByRole("heading", { level: 1, name, exact: true });
}

async function userByEmail(email: string) {
  const [user] = await testDb().select().from(users).where(eq(users.email, email));
  if (!user) throw new Error(`Test-User ${email} fehlt in der Datenbank.`);
  return user;
}

/** Neue, von USER_STATE unabhängige Clerk-Sitzung des Mitarbeiters */
async function freshEmployeeSession(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  const page = await context.newPage();
  await page.goto("/anmelden");
  await clerk.signIn({ page, emailAddress: E2E_USER_EMAIL });
  await page.goto("/dashboard");
  await expect(h1(page, "Willkommen, Max!")).toBeVisible();
  return page;
}

/** Klickt „Abmelden“ (mit Hydration-Retry), bis die Anmeldeseite erscheint. */
async function signOutVia(page: Page, button: Locator): Promise<void> {
  await expect(async () => {
    if (!/\/anmelden/.test(page.url())) await button.click({ timeout: 2_000 });
    await expect(page).toHaveURL(/\/anmelden/, { timeout: 5_000 });
  }).toPass({ timeout: 30_000 });
  await expect(
    page.getByText("Mitarbeiterportal der StefanAI Solutions GmbH")
  ).toBeVisible();
}

/** Die gespeicherte Mitarbeiter-Sitzung (USER_STATE) funktioniert weiterhin. */
async function expectSharedSessionIntact(browser: Browser): Promise<void> {
  const shared = await pageAs(browser, USER_STATE);
  await shared.goto("/dashboard");
  await expect(h1(shared, "Willkommen, Max!")).toBeVisible();
  await shared.context().close();
}

test.describe("Zugang und Sperrbildschirme", () => {
  test("Deaktiviertes Konto sieht „Kein Zugang“ mit Abmelden-Button", async ({
    browser,
  }) => {
    const db = testDb();
    const employee = await userByEmail(E2E_USER_EMAIL);
    const page = await pageAs(browser, USER_STATE);
    try {
      await db
        .update(users)
        .set({ status: "deaktiviert" })
        .where(eq(users.id, employee.id));

      for (const path of ["/dashboard", "/urlaub"]) {
        await page.goto(path);
        await expect(h1(page, "Kein Zugang")).toBeVisible();
        await expect(page.getByText(NO_ACCESS_TEXT, { exact: true })).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Abmelden", exact: true })
        ).toBeVisible();
        // Keine App-Navigation, keine Seiteninhalte
        await expect(page.getByRole("navigation")).toHaveCount(0);
        await expect(h1(page, "Willkommen, Max!")).toHaveCount(0);
        await expect(h1(page, "Urlaub")).toHaveCount(0);
      }
    } finally {
      await db
        .update(users)
        .set({ status: employee.status })
        .where(eq(users.id, employee.id));
    }

    // Nach dem Reaktivieren ist der Zugang wieder da
    await page.goto("/dashboard");
    await expect(h1(page, "Willkommen, Max!")).toBeVisible();
  });

  test("Vor dem Eintrittsdatum: „Zugang noch nicht freigeschaltet“", async ({
    browser,
  }) => {
    const db = testDb();
    const employee = await userByEmail(E2E_USER_EMAIL);
    const page = await pageAs(browser, USER_STATE);
    try {
      await db
        .update(users)
        .set({ entryDate: "2099-01-01" })
        .where(eq(users.id, employee.id));

      await page.goto("/dashboard");
      await expect(h1(page, "Zugang noch nicht freigeschaltet")).toBeVisible();
      await expect(
        page.getByText(
          "Ihr Intranet-Zugang steht ab Ihrem Eintrittsdatum am 01.01.2099 bereit. Bitte melden Sie sich ab diesem Tag erneut an.",
          { exact: true }
        )
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Abmelden", exact: true })
      ).toBeVisible();
      await expect(page.getByRole("navigation")).toHaveCount(0);
      await expect(h1(page, "Willkommen, Max!")).toHaveCount(0);
    } finally {
      await db
        .update(users)
        .set({ entryDate: employee.entryDate })
        .where(eq(users.id, employee.id));
    }

    await page.goto("/dashboard");
    await expect(h1(page, "Willkommen, Max!")).toBeVisible();
  });

  test("Direktaufruf der Admin-Seiten als Mitarbeiter zeigt keine Admin-Inhalte", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    // Jede Seite wirft für Nicht-Admins (requireAdmin/requireApprover);
    // geprüft wird, dass weder Überschrift noch Seitenbeschreibung erscheinen.
    const adminPages: { path: string; heading: string; marker: string | RegExp }[] = [
      { path: "/einstellungen", heading: "Einstellungen", marker: "Sätze, Kontingente, Vertretung, Webhooks, API-Keys und Compliance" },
      { path: "/mitarbeitende", heading: "Mitarbeitende", marker: /^User-Verwaltung/ },
      { path: "/it-management", heading: "IT-Management", marker: /^Ausstattung der Mitarbeitenden inklusive Geräte-IDs/ },
      { path: "/inhalte", heading: "Inhalte", marker: /^Hilfreiche Links, Neuigkeiten, Teamevents und Sales-Nachrichten/ },
      { path: "/faktura/kunden", heading: "Kunden & Projekte", marker: /^Stammdaten für die Zeiterfassung/ },
      { path: "/faktura/freigabe", heading: "Wochenfreigabe", marker: /^Alle Buchungen aller Mitarbeitenden je Kalenderwoche/ },
      { path: "/faktura/export", heading: "Export & Stundenzettel", marker: /^Rohdaten-Export \(CSV\) für interne Zwecke/ },
      { path: "/berichte/zitate", heading: "Zitate", marker: /^Anonyme Zitate von Teilnehmenden aus allen Berichten/ },
      { path: "/freigaben", heading: "Freigaben", marker: "Alle offenen Anträge mit Direktzugriff auf die Freigabe" },
    ];

    // /freigaben ist für eine aktive Vertretung erlaubt — sicherstellen,
    // dass der Mitarbeiter gerade keine ist
    const db = testDb();
    const employee = await userByEmail(E2E_USER_EMAIL);
    const ownAssignments = await db
      .select({ id: deputyAssignments.id })
      .from(deputyAssignments)
      .where(
        and(
          eq(deputyAssignments.userId, employee.id),
          eq(deputyAssignments.active, true)
        )
      );
    const ownIds = ownAssignments.map((a) => a.id);

    const page = await pageAs(browser, USER_STATE);
    try {
      if (ownIds.length > 0)
        await db
          .update(deputyAssignments)
          .set({ active: false })
          .where(inArray(deputyAssignments.id, ownIds));

      // Positivkontrolle: Sitzung ist gültig
      await page.goto("/dashboard");
      await expect(h1(page, "Willkommen, Max!")).toBeVisible();
      await expect(page.getByText(USER_NAME).first()).toBeVisible();

      for (const adminPage of adminPages) {
        await page.goto(adminPage.path);
        await expect(page).not.toHaveURL(/\/anmelden/);
        await expect(h1(page, adminPage.heading)).toHaveCount(0);
        await expect(page.getByText(adminPage.marker)).toHaveCount(0);
      }
    } finally {
      if (ownIds.length > 0)
        await db
          .update(deputyAssignments)
          .set({ active: true })
          .where(inArray(deputyAssignments.id, ownIds));
    }
  });

  // Die beiden Abmelde-Tests stehen bewusst am Ende der Datei.
  test("„Abmelden“ im Sperrbildschirm beendet die Sitzung", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const db = testDb();
    const employee = await userByEmail(E2E_USER_EMAIL);
    const page = await freshEmployeeSession(browser);
    try {
      await db
        .update(users)
        .set({ status: "deaktiviert" })
        .where(eq(users.id, employee.id));
      await page.goto("/dashboard");
      await expect(h1(page, "Kein Zugang")).toBeVisible();
      await signOutVia(
        page,
        page.getByRole("button", { name: "Abmelden", exact: true })
      );
    } finally {
      await db
        .update(users)
        .set({ status: employee.status })
        .where(eq(users.id, employee.id));
    }

    // Sitzung beendet: geschützte Seiten leiten wieder zur Anmeldung
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/anmelden/);
    await page.context().close();

    await expectSharedSessionIntact(browser);
  });

  test("„Abmelden“ in der Sidebar beendet die Sitzung", async ({ browser }) => {
    test.setTimeout(120_000);
    const page = await freshEmployeeSession(browser);
    const footerButton = page.getByRole("button", {
      name: "Abmelden",
      exact: true,
    });
    await expect(footerButton).toHaveCount(1);
    await signOutVia(page, footerButton);

    await page.goto("/urlaub");
    await expect(page).toHaveURL(/\/anmelden/);
    await page.context().close();

    await expectSharedSessionIntact(browser);
  });
});
