import { expect, test } from "@playwright/test";
import { USER_STATE, pageAs, statusBadge } from "./helpers";

test.describe("Krankmeldung", () => {
  test("melden, Enddatum nachtragen, abschließen", async ({ browser }) => {
    const employee = await pageAs(browser, USER_STATE);

    // Melden (Ende zunächst offen)
    await employee.goto("/krankmeldung/neu");
    await employee.locator("#startDate").fill("2026-07-20");
    await employee.locator("#note").fill("Bin per E-Mail erreichbar.");
    await employee
      .getByRole("button", { name: "Krankmeldung senden" })
      .click();
    await expect(employee).toHaveURL(/\/krankmeldung\/[0-9a-f-]+$/);
    await expect(statusBadge(employee, "Gemeldet")).toBeVisible();
    await expect(employee.getByText("eigene Erkrankung")).toBeVisible();
    await expect(employee.getByText("offen")).toBeVisible();

    // Tatsächliches Enddatum nachtragen → Status Abgeschlossen
    await employee.locator("#endDate").fill("2026-07-24");
    await employee.getByRole("button", { name: "Abschließen" }).click();
    await expect(statusBadge(employee, "Abgeschlossen")).toBeVisible();
    await expect(employee.getByText("24.07.2026")).toBeVisible();
  });

  test("Meldung erscheint in der eigenen Übersicht", async ({ browser }) => {
    const employee = await pageAs(browser, USER_STATE);
    await employee.goto("/krankmeldung");
    await expect(employee.getByText("20.07.2026").first()).toBeVisible();
  });
});
