import type { Browser, Page } from "@playwright/test";

export const ADMIN_STATE = "tests/e2e/.auth/admin.json";
export const USER_STATE = "tests/e2e/.auth/user.json";

export const ADMIN_NAME = "Erika Admin";
export const USER_NAME = "Max Mitarbeiter";

/**
 * Öffnet eine Seite mit der gespeicherten Session einer Rolle.
 * baseURL muss explizit gesetzt werden, da browser.newContext() die
 * Playwright-Config nicht erbt.
 */
export async function pageAs(browser: Browser, state: string): Promise<Page> {
  const context = await browser.newContext({
    storageState: state,
    baseURL: process.env.APP_BASE_URL ?? "http://localhost:3100",
  });
  return context.newPage();
}

/** Status-Badge mit exaktem Text (vermeidet Kollision mit Fließtext). */
export function statusBadge(page: Page, label: string) {
  return page
    .locator('[data-slot="badge"]', {
      hasText: new RegExp(`^${label}$`),
    })
    .first();
}

/** Eingabefeld über den sichtbaren Label-Text füllen (ohne htmlFor-Bindung). */
export async function fillByLabelText(
  page: Page,
  label: string,
  value: string
): Promise<void> {
  await page
    .locator(`div.space-y-1:has(> label:text-is("${label}")) input`)
    .fill(value);
}
