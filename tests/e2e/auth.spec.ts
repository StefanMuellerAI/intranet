import { expect, test } from "@playwright/test";

test.describe("Zugriffsschutz", () => {
  test("Unangemeldete werden auf die Anmeldeseite geleitet", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/anmelden/);
    await expect(
      page.getByText("Mitarbeiterportal der StefanAI Solutions GmbH")
    ).toBeVisible();
  });

  test("Die Startseite leitet Unangemeldete ebenfalls zur Anmeldung", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/anmelden/);
  });

  test("api/v1 ist öffentlich erreichbar, verlangt aber einen API-Key", async ({
    request,
  }) => {
    const res = await request.get("/api/v1/requests");
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.fehler).toContain("Bearer-Key");
  });

  test("Cron-Endpoint verlangt das Secret", async ({ request }) => {
    const res = await request.get("/api/cron/webhooks");
    expect(res.status()).toBe(401);
  });
});
