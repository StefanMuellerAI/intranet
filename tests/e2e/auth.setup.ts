import { clerk } from "@clerk/testing/playwright";
import { expect, test as setup, type Page } from "@playwright/test";
import { ADMIN_NAME, ADMIN_STATE, USER_NAME, USER_STATE } from "./helpers";

/**
 * Meldet beide Rollen einmal per Clerk an (ticketbasiert über die Backend-API,
 * unabhängig von den aktivierten Login-Methoden der Instanz) und speichert die
 * Sessions als Storage-States. Der erste Aufruf einer App-Seite verknüpft
 * dabei den Clerk-Account mit dem geseedeten DB-User (E-Mail-Abgleich in
 * src/lib/auth.ts).
 */
async function signInAndSave(
  page: Page,
  email: string,
  expectedName: string,
  statePath: string
) {
  await page.goto("/anmelden");
  await clerk.signIn({ page, emailAddress: email });
  await page.goto("/dashboard");
  await expect(page.getByText(expectedName).first()).toBeVisible();
  await page.context().storageState({ path: statePath });
}

setup("Admin anmelden und Session speichern", async ({ page }) => {
  await signInAndSave(
    page,
    process.env.E2E_ADMIN_EMAIL!,
    ADMIN_NAME,
    ADMIN_STATE
  );
});

setup("Mitarbeiter anmelden und Session speichern", async ({ page }) => {
  await signInAndSave(page, process.env.E2E_USER_EMAIL!, USER_NAME, USER_STATE);
});
