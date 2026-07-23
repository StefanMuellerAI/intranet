import { expect, test } from "@playwright/test";
import { ADMIN_STATE, USER_NAME, USER_STATE, pageAs, statusBadge } from "./helpers";

test.describe("Workation-Workflow", () => {
  test("Antrag einreichen, genehmigen und PDF abrufen", async ({
    browser,
  }) => {
    const employee = await pageAs(browser, USER_STATE);
    const admin = await pageAs(browser, ADMIN_STATE);

    // Mitarbeiter füllt den Antrag aus (EU-Land, innerhalb der Limits)
    await employee.goto("/workation/neu");
    await employee.locator("#country").fill("Spanien");
    await expect(employee.getByText("EU / EWR / Schweiz")).toBeVisible();
    await employee.locator("#city").fill("Valencia");
    await employee
      .locator("#accommodationAddress")
      .fill("Calle Mayor 1, 46001 Valencia");
    await employee.locator("#startDate").fill("2026-10-12");
    await employee.locator("#endDate").fill("2026-10-23");
    await employee
      .locator("#timezoneAvailability")
      .fill("MEZ+0, erreichbar 9–17 Uhr");
    await employee.locator("#emergencyContactName").fill("Maria Mitarbeiter");
    await employee.locator("#emergencyContactPhone").fill("+49 221 987654");
    await employee.locator("#visaType").fill("keins (EU-Freizügigkeit)");
    await employee
      .locator("#insuranceDetails")
      .fill("Envivas Auslandsschutz, Police 12345");
    await employee.locator("#plannedTasks").fill("Projektarbeit Kunde X");
    await employee
      .locator("#domesticSubstitution")
      .fill("Erika Admin übernimmt Termine vor Ort.");

    // Ohne alle 7 Erklärungen keine Einreichung möglich
    await expect(
      employee.getByRole("button", { name: "Antrag einreichen" })
    ).toBeDisabled();
    const checkboxes = await employee.getByRole("checkbox").all();
    expect(checkboxes.length).toBe(7);
    for (const checkbox of checkboxes) {
      await checkbox.click();
    }
    await employee.getByRole("button", { name: "Antrag einreichen" }).click();
    await expect(employee).toHaveURL(/\/workation\/[0-9a-f-]+$/);
    await expect(statusBadge(employee, "Eingereicht")).toBeVisible();

    // Admin genehmigt
    await admin.goto("/freigaben");
    await admin
      .getByRole("row")
      .filter({ hasText: "Valencia" })
      .getByRole("link", { name: "Prüfen" })
      .click();
    await expect(
      admin.getByRole("heading", { name: `Workation: ${USER_NAME}` })
    ).toBeVisible();
    await admin.getByRole("button", { name: "Genehmigen" }).click();
    await expect(admin.getByText("Antrag genehmigt.")).toBeVisible();

    // PDF-Zusammenfassung ist abrufbar
    await employee.reload();
    await expect(statusBadge(employee, "Genehmigt")).toBeVisible();
    const pdfUrl = `${employee.url()}/pdf`;
    const res = await employee.request.get(pdfUrl);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/pdf");
  });

  test("Jahreslimit-Überschreitung blockiert die Einreichung", async ({
    browser,
  }) => {
    const employee = await pageAs(browser, USER_STATE);

    await employee.goto("/workation/neu");
    await employee.locator("#country").fill("Portugal");
    await employee.locator("#city").fill("Lissabon");
    await employee.locator("#accommodationAddress").fill("Rua Augusta 1");
    // Über 2 Monate → weit über dem Jahreslimit von 30 Arbeitstagen
    await employee.locator("#startDate").fill("2026-11-02");
    await employee.locator("#endDate").fill("2027-01-29");
    await employee.locator("#timezoneAvailability").fill("MEZ-1");
    await employee.locator("#emergencyContactName").fill("Maria Mitarbeiter");
    await employee.locator("#emergencyContactPhone").fill("+49 221 987654");
    await employee.locator("#visaType").fill("keins");
    await employee.locator("#insuranceDetails").fill("Police 999");
    await employee.locator("#plannedTasks").fill("Projektarbeit");
    await employee.locator("#domesticSubstitution").fill("Erika Admin");
    for (const checkbox of await employee.getByRole("checkbox").all()) {
      await checkbox.click();
    }

    await expect(employee.getByText("Einreichung nicht möglich")).toBeVisible();
    await expect(
      employee.getByRole("button", { name: "Antrag einreichen" })
    ).toBeDisabled();
  });
});
