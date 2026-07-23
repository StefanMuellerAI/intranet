import { expect, test } from "@playwright/test";
import { ADMIN_STATE, USER_NAME, USER_STATE, pageAs, statusBadge } from "./helpers";

test.describe("Provisions-Workflow", () => {
  test("Folge-Training einreichen und genehmigen", async ({ browser }) => {
    const employee = await pageAs(browser, USER_STATE);
    const admin = await pageAs(browser, ADMIN_STATE);

    // Mitarbeiter reicht einen Anspruch ein (Schulung, ganztägig, 1 Training)
    await employee.goto("/provision/neu");
    await employee.locator("#customerName").fill("Haufe Akademie");
    await employee.locator("#orderDate").fill("2026-07-01");
    await employee.locator("#quantity").fill("1");
    await employee.getByText("Format wählen").click();
    await employee.getByRole("option", { name: /^ganztägig/ }).click();
    // Berechnungsvorschau: 75 € je ganztägigem Training (Standardsatz)
    await expect(
      employee.getByText("Berechneter Provisionsanspruch: 75,00 €")
    ).toBeVisible();
    await employee
      .getByRole("button", { name: "Anspruch einreichen" })
      .click();
    await expect(employee).toHaveURL(/\/provision\/[0-9a-f-]+$/);
    await expect(statusBadge(employee, "Eingereicht")).toBeVisible();

    // Admin genehmigt — finaler Betrag ist mit der Berechnung vorbelegt
    await admin.goto("/freigaben");
    await admin
      .getByRole("row")
      .filter({ hasText: "Haufe Akademie" })
      .getByRole("link", { name: "Prüfen" })
      .click();
    await expect(
      admin.getByRole("heading", {
        name: `Provision: ${USER_NAME} · 75,00 €`,
      })
    ).toBeVisible();
    await admin.getByRole("button", { name: "Genehmigen" }).click();
    await expect(admin.getByText("Antrag genehmigt.")).toBeVisible();

    await employee.reload();
    await expect(statusBadge(employee, "Genehmigt")).toBeVisible();
  });
});
