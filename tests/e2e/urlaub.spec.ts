import { expect, test } from "@playwright/test";
import { ADMIN_STATE, USER_NAME, USER_STATE, pageAs, statusBadge } from "./helpers";

test.describe("Urlaubs-Workflow", () => {
  test("Antrag einreichen, als Admin genehmigen, Storno-Runde", async ({
    browser,
  }) => {
    const employee = await pageAs(browser, USER_STATE);
    const admin = await pageAs(browser, ADMIN_STATE);

    // 1. Mitarbeiter reicht einen Antrag ein (Mo 03.08. – Fr 07.08. = 5 Tage)
    await employee.goto("/urlaub/neu");
    await employee.locator("#startDate").fill("2026-08-03");
    await employee.locator("#endDate").fill("2026-08-07");
    await expect(
      employee.getByText("5 Urlaubstage (ohne Wochenenden und Feiertage NRW)")
    ).toBeVisible();
    await employee.getByRole("button", { name: "Antrag einreichen" }).click();
    await expect(employee).toHaveURL(/\/urlaub\/[0-9a-f-]+$/);
    await expect(statusBadge(employee, "Eingereicht")).toBeVisible();

    // 2. Admin sieht den Antrag unter Freigaben und genehmigt
    await admin.goto("/freigaben");
    const row = admin
      .getByRole("row")
      .filter({ hasText: USER_NAME })
      .filter({ hasText: "03.08.2026" });
    await row.getByRole("link", { name: "Prüfen" }).click();
    await expect(
      admin.getByRole("heading", { name: `Urlaub: ${USER_NAME}` })
    ).toBeVisible();
    await admin.getByRole("button", { name: "Genehmigen" }).click();
    await expect(admin.getByText("Antrag genehmigt.")).toBeVisible();
    await expect(
      admin.getByText("Dieser Vorgang ist bereits entschieden.")
    ).toBeVisible();

    // 3. Mitarbeiter sieht den genehmigten Antrag und beantragt Storno
    await employee.reload();
    await expect(statusBadge(employee, "Genehmigt")).toBeVisible();
    await employee
      .getByRole("button", { name: "Stornierung beantragen" })
      .click();
    await expect(statusBadge(employee, "Storno beantragt")).toBeVisible();

    // 4. Admin bestätigt den Storno — Tage werden wieder gutgeschrieben
    await admin.goto("/freigaben");
    await admin
      .getByRole("row")
      .filter({ hasText: "03.08.2026" })
      .getByRole("link", { name: "Prüfen" })
      .click();
    await admin.getByRole("button", { name: "Storno bestätigen" }).click();
    await expect(admin.getByText("Storno bestätigt.")).toBeVisible();

    await employee.reload();
    await expect(statusBadge(employee, "Storniert")).toBeVisible();
  });

  test("Beanstandung, Korrektur und erneute Genehmigung", async ({
    browser,
  }) => {
    const employee = await pageAs(browser, USER_STATE);
    const admin = await pageAs(browser, ADMIN_STATE);

    // Mitarbeiter reicht ein (Mo 07.09. – Fr 11.09.)
    await employee.goto("/urlaub/neu");
    await employee.locator("#startDate").fill("2026-09-07");
    await employee.locator("#endDate").fill("2026-09-11");
    await employee.getByRole("button", { name: "Antrag einreichen" }).click();
    await expect(employee).toHaveURL(/\/urlaub\/[0-9a-f-]+$/);
    const detailUrl = employee.url();

    // Admin beanstandet mit Pflicht-Kommentar
    await admin.goto("/freigaben");
    await admin
      .getByRole("row")
      .filter({ hasText: "07.09.2026" })
      .getByRole("link", { name: "Prüfen" })
      .click();
    await admin.getByRole("button", { name: "Beanstanden" }).click();
    await admin
      .locator("#comment")
      .fill("Bitte eine Vertretung für den Zeitraum angeben.");
    await admin.getByRole("button", { name: "Beanstandung senden" }).click();
    await expect(admin.getByText("Beanstandung gesendet.")).toBeVisible();

    // Mitarbeiter sieht die Beanstandung und korrigiert den Antrag
    await employee.goto(detailUrl);
    await expect(statusBadge(employee, "Beanstandet")).toBeVisible();
    await expect(
      employee.getByText("Bitte eine Vertretung für den Zeitraum angeben.")
    ).toBeVisible();
    await expect(
      employee.getByText("Antrag korrigieren und erneut einreichen")
    ).toBeVisible();
    await employee
      .getByPlaceholder("Alternativ: Vertretung als Freitext")
      .fill("Erika Admin");
    await employee
      .getByRole("button", { name: "Korrigiert erneut einreichen" })
      .click();
    await expect(statusBadge(employee, "Eingereicht")).toBeVisible();
    await expect(employee.getByText("Version 2")).toBeVisible();

    // Admin genehmigt die korrigierte Version; Historie ist sichtbar
    await admin.goto("/freigaben");
    await admin
      .getByRole("row")
      .filter({ hasText: "07.09.2026" })
      .getByRole("link", { name: "Prüfen" })
      .click();
    await expect(admin.getByText("Erika Admin").first()).toBeVisible();
    await admin.getByRole("button", { name: "Genehmigen" }).click();
    await expect(admin.getByText("Antrag genehmigt.")).toBeVisible();

    await employee.goto(detailUrl);
    await expect(statusBadge(employee, "Genehmigt")).toBeVisible();
  });

  test("Antrag über den Resturlaub hinaus wird abgelehnt", async ({
    browser,
  }) => {
    const employee = await pageAs(browser, USER_STATE);

    await employee.goto("/urlaub/neu");
    await employee.locator("#startDate").fill("2026-10-01");
    await employee.locator("#endDate").fill("2026-12-15");
    // Client-Hinweis auf Überschreitung
    await expect(
      employee.getByText(/übersteigt Ihren Resturlaub/).first()
    ).toBeVisible();
    // Serverseitige Prüfung lehnt die Einreichung ab
    await employee.getByRole("button", { name: "Antrag einreichen" }).click();
    await expect(
      employee.getByText(/übersteigt Ihren Resturlaub von \d+(,\d+)? Tagen/)
    ).toBeVisible();
    await expect(employee).toHaveURL(/\/urlaub\/neu/);
  });

  test("Zeitraum ohne Arbeitstage kann nicht eingereicht werden", async ({
    browser,
  }) => {
    const employee = await pageAs(browser, USER_STATE);

    // Sa/So — 0 Urlaubstage, Button bleibt deaktiviert
    await employee.goto("/urlaub/neu");
    await employee.locator("#startDate").fill("2026-08-08");
    await employee.locator("#endDate").fill("2026-08-09");
    await expect(
      employee.getByText("0 Urlaubstage (ohne Wochenenden und Feiertage NRW)")
    ).toBeVisible();
    await expect(
      employee.getByRole("button", { name: "Antrag einreichen" })
    ).toBeDisabled();
  });
});
