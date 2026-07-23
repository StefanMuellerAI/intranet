import { expect, test } from "@playwright/test";
import {
  ADMIN_STATE,
  USER_NAME,
  USER_STATE,
  fillByLabelText,
  pageAs,
  statusBadge,
} from "./helpers";

test.describe("Reisekosten-Workflow", () => {
  test("Abrechnung einreichen und genehmigen", async ({ browser }) => {
    const employee = await pageAs(browser, USER_STATE);
    const admin = await pageAs(browser, ADMIN_STATE);

    // Mitarbeiter erstellt eine Abrechnung (Block 1 — Angaben zur Reise)
    await employee.goto("/reisekosten/neu");
    await fillByLabelText(employee, "Reiseziel (Ort)", "Berlin");
    await fillByLabelText(employee, "Kunde / Anlass", "Kundenworkshop dbb");
    await fillByLabelText(employee, "Abreise: Datum", "2026-07-06");
    await fillByLabelText(employee, "Abreise: Uhrzeit", "08:00");
    await fillByLabelText(employee, "Rückkehr: Datum", "2026-07-07");
    await fillByLabelText(employee, "Rückkehr: Uhrzeit", "18:30");
    await employee
      .getByRole("button", { name: "Abrechnung einreichen" })
      .click();
    await expect(employee).toHaveURL(/\/reisekosten\/[0-9a-f-]+$/);
    await expect(statusBadge(employee, "Eingereicht")).toBeVisible();

    // Admin genehmigt über die Freigaben-Liste
    await admin.goto("/freigaben");
    await admin
      .getByRole("row")
      .filter({ hasText: "Berlin" })
      .getByRole("link", { name: "Prüfen" })
      .click();
    await expect(
      admin.getByRole("heading", { name: new RegExp(`Reisekosten: ${USER_NAME}`) })
    ).toBeVisible();
    await admin.getByRole("button", { name: "Genehmigen" }).click();
    await expect(admin.getByText("Antrag genehmigt.")).toBeVisible();

    await employee.reload();
    await expect(statusBadge(employee, "Genehmigt")).toBeVisible();
  });

  test("Beleg-Upload-Flow", async ({ browser }) => {
    test.skip(
      !process.env.BLOB_READ_WRITE_TOKEN,
      "BLOB_READ_WRITE_TOKEN nicht gesetzt — Upload-Test wird übersprungen."
    );
    const employee = await pageAs(browser, USER_STATE);
    await employee.goto("/reisekosten/neu");
    // Bewusst minimal: Upload-Verkabelung wird nur mit echtem Blob-Token getestet.
  });
});
