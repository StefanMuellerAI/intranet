import { expect, test, type Locator, type Page } from "@playwright/test";
import { USER_NAME, USER_STATE } from "./helpers";

/**
 * Mobile Navigation (Projekt „mobile“, Pixel 7): Unterhalb von md blendet die
 * Sidebar die Desktop-Navigation aus und zeigt einen Kopf mit Burger-Button.
 * Der Button hat kein aria-label — er wird über den Mobil-Kopf (Logo) und
 * das Lucide-Icon (menu bzw. x) gefunden.
 *
 * Wichtig: Der page-Fixture übernimmt die Geräte-Emulation des Projekts —
 * pageAs() (browser.newContext) würde sie nicht erben.
 */
test.use({ storageState: USER_STATE });

const ACTIVE = /(^|\s)bg-primary(\s|$)/;

function mobileHeader(page: Page): Locator {
  return page
    .locator("div.md\\:hidden")
    .filter({ has: page.getByRole("img", { name: "StefanAI Logo" }) });
}

function burger(page: Page): Locator {
  return mobileHeader(page).getByRole("button");
}

function mobileNav(page: Page): Locator {
  return page.getByRole("navigation");
}

/** Öffnet das Menü (Hydration-Retry: vor der Hydration wirkt der Klick nicht). */
async function openMenu(page: Page): Promise<void> {
  await expect(async () => {
    if (!(await mobileNav(page).isVisible())) await burger(page).click();
    await expect(mobileNav(page)).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

test.describe("Mobile Navigation", () => {
  test("Burger-Menü öffnet und schließt die Navigation", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(
      page.getByRole("heading", { level: 1, name: "Willkommen, Max!" })
    ).toBeVisible();

    // Desktop-Sidebar ist ausgeblendet, Menü geschlossen
    await expect(page.locator("aside")).toBeHidden();
    await expect(mobileHeader(page)).toContainText("StefanAI Intranet");
    await expect(burger(page)).toBeVisible();
    await expect(burger(page).locator("svg.lucide-menu")).toBeVisible();
    await expect(mobileNav(page)).toHaveCount(0);

    // Öffnen: Navigation mit Links, Nutzer und Abmelden-Button
    await openMenu(page);
    await expect(burger(page).locator("svg.lucide-x")).toBeVisible();
    const nav = mobileNav(page);
    await expect(nav.getByRole("link", { name: "Dashboard", exact: true })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Urlaub", exact: true })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Mein Konto", exact: true })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Dashboard", exact: true })).toHaveClass(ACTIVE);
    // Der (ausgeblendete) Desktop-Footer enthält den Namen ebenfalls
    await expect(
      page.getByText(USER_NAME, { exact: true }).filter({ visible: true })
    ).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "Abmelden", exact: true })
    ).toBeVisible();

    // Schließen über denselben Button
    await burger(page).click();
    await expect(mobileNav(page)).toHaveCount(0);
    await expect(burger(page).locator("svg.lucide-menu")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Abmelden", exact: true })
    ).toHaveCount(0);
  });

  test("Klick auf einen Link navigiert und schließt das Menü", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await openMenu(page);

    await mobileNav(page).getByRole("link", { name: "Urlaub", exact: true }).click();
    await expect(page).toHaveURL(/\/urlaub$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Urlaub" })
    ).toBeVisible();
    await expect(mobileNav(page)).toHaveCount(0);
    await expect(burger(page).locator("svg.lucide-menu")).toBeVisible();

    // Erneut geöffnet ist „Urlaub“ als aktiv markiert
    await openMenu(page);
    await expect(
      mobileNav(page).getByRole("link", { name: "Urlaub", exact: true })
    ).toHaveClass(ACTIVE);
    await expect(
      mobileNav(page).getByRole("link", { name: "Dashboard", exact: true })
    ).not.toHaveClass(ACTIVE);

    // Ein zweiter Link-Klick führt ebenfalls zum Ziel und schließt wieder
    await mobileNav(page)
      .getByRole("link", { name: "Mein Konto", exact: true })
      .click();
    await expect(page).toHaveURL(/\/konto$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Mein Konto" })
    ).toBeVisible();
    await expect(mobileNav(page)).toHaveCount(0);
  });
});
