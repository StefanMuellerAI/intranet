import { expect, type Browser, type Locator, type Page } from "@playwright/test";

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

/**
 * Klickt einen Dialog-Trigger, bis der Dialog sichtbar ist — direkt nach
 * einer Navigation kann der erste Klick sonst vor der React-Hydration landen.
 */
export async function openDialog(
  trigger: Locator,
  dialogMarker: Locator
): Promise<void> {
  await expect(async () => {
    await trigger.click();
    await expect(dialogMarker).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

/** Öffnet ein Select über den sichtbaren Trigger-Text (mit Hydration-Retry) und wählt eine Option. */
export async function selectOption(
  page: Page,
  triggerText: string,
  optionName: string
): Promise<void> {
  await expect(async () => {
    await page.getByText(triggerText, { exact: true }).click();
    await expect(
      page.getByRole("option", { name: optionName }).first()
    ).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await page.getByRole("option", { name: optionName }).first().click();
}

/** Navigationslink in der (Desktop-)Sidebar anklicken. */
export async function clickNav(page: Page, name: string): Promise<void> {
  await page
    .getByRole("navigation")
    .first()
    .getByRole("link", { name, exact: true })
    .click();
}

/** Erwartet einen Toast bzw. eine Meldung mit genau diesem Text. */
export async function expectToast(page: Page, text: string): Promise<void> {
  await expect(page.getByText(text, { exact: true }).first()).toBeVisible();
}

/**
 * Lädt eine Datei über einen Link/Button herunter, ohne den Browser-Download
 * abzuwarten: liest das href und ruft es mit der Session der Seite ab.
 */
export async function fetchHref(page: Page, link: Locator) {
  const href = await link.getAttribute("href");
  expect(href, "Link ohne href").toBeTruthy();
  return page.request.get(href!);
}
