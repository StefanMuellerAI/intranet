import { expect, test } from "@playwright/test";
import { ADMIN_STATE, USER_NAME, USER_STATE, pageAs } from "./helpers";

test.describe("Seminar- und Beratungsberichte", () => {
  test("Bericht mit Zitaten erfassen, im Admin filtern und Zitat freigeben", async ({
    browser,
  }) => {
    const employee = await pageAs(browser, USER_STATE);
    const admin = await pageAs(browser, ADMIN_STATE);

    const title = `E2E-Seminar ${Date.now()}`;

    // Mitarbeiter/in erfasst einen Bericht mit zwei Zitaten
    await employee.goto("/berichte/neu");
    await employee.locator("#customerName").fill("Haufe Akademie");
    await employee.locator("#title").fill(title);
    await employee.locator("#eventDate").fill("2026-05-12");
    await employee.locator("#durationDays").fill("0,5");

    await employee.getByText("Bewertung wählen").click();
    await employee.getByRole("option", { name: "5 — sehr gut" }).click();

    await employee.locator("#whatWentWell").fill("Die Übungen kamen gut an.");
    await employee.locator("#whatWentBadly").fill("Der Raum war zu klein.");
    await employee
      .locator("#improvements")
      .fill("Teilnehmendenzahl vorab abfragen.");

    await employee
      .getByRole("textbox", { name: "Zitat 1" })
      .fill("Sehr praxisnah, ich nehme viel mit.");
    await employee.getByRole("button", { name: "Zitat hinzufügen" }).click();
    await employee
      .getByRole("textbox", { name: "Zitat 2" })
      .fill("Guter Einstieg in das Thema.");

    await employee.getByRole("button", { name: "Bericht speichern" }).click();

    // Detailseite zeigt Angaben und Zitate
    await expect(employee).toHaveURL(/\/berichte\/[0-9a-f-]+$/);
    await expect(
      employee.getByRole("heading", { name: title })
    ).toBeVisible();
    await expect(employee.getByText("0,5 Tage")).toBeVisible();
    await expect(employee.getByText("5 — sehr gut")).toBeVisible();
    await expect(
      employee.getByText("Zitate von Teilnehmenden (2)")
    ).toBeVisible();

    // Eigene Übersicht listet den Bericht
    await employee.goto("/berichte");
    await expect(
      employee.getByRole("row").filter({ hasText: title })
    ).toBeVisible();

    // Admin filtert die Gesamtübersicht auf diese Person
    await admin.goto("/berichte/alle");
    await admin.getByRole("row").filter({ hasText: title }).waitFor();
    await admin.locator('form[method="get"]').getByRole("combobox").first().click();
    await admin.getByRole("option", { name: USER_NAME }).click();
    await admin.getByRole("button", { name: "Filtern" }).click();

    const row = admin.getByRole("row").filter({ hasText: title });
    await expect(row).toBeVisible();
    await expect(row).toContainText(USER_NAME);

    // Sortierung nach Datum lässt sich umschalten
    await admin.getByRole("link", { name: /^Datum/ }).click();
    await expect(admin).toHaveURL(/sortierung=datum_alt/);

    // Admin gibt ein Zitat für die Website frei
    await admin.goto("/berichte/zitate");
    const quoteRow = admin
      .getByRole("row")
      .filter({ hasText: "Sehr praxisnah, ich nehme viel mit." });
    await quoteRow.getByRole("switch").click();
    await expect(
      admin.getByText("Zitat für die Website freigegeben.")
    ).toBeVisible();

    // Die Freigabe erscheint auch beim Bericht
    await admin.goto("/berichte/zitate");
    await expect(
      admin
        .getByRole("row")
        .filter({ hasText: "Sehr praxisnah, ich nehme viel mit." })
        .getByRole("switch")
    ).toBeChecked();
  });

  test("Geänderter Wortlaut setzt eine bestehende Website-Freigabe zurück", async ({
    browser,
  }) => {
    const employee = await pageAs(browser, USER_STATE);
    const admin = await pageAs(browser, ADMIN_STATE);

    const title = `E2E-Beratung ${Date.now()}`;
    const quote = `Sehr hilfreich ${Date.now()}`;

    await employee.goto("/berichte/neu");
    await employee.locator("#customerName").fill("dbb akademie");
    await employee.locator("#title").fill(title);
    await employee.locator("#eventDate").fill("2026-06-02");
    await employee.locator("#durationDays").fill("1");
    await employee.getByText("Bewertung wählen").click();
    await employee.getByRole("option", { name: "4 — gut" }).click();
    await employee.locator("#whatWentWell").fill("Klare Fragestellung.");
    await employee.locator("#whatWentBadly").fill("Zu wenig Zeit.");
    await employee.locator("#improvements").fill("Mehr Vorlauf einplanen.");
    await employee.getByRole("textbox", { name: "Zitat 1" }).fill(quote);
    await employee.getByRole("button", { name: "Bericht speichern" }).click();
    await expect(employee).toHaveURL(/\/berichte\/[0-9a-f-]+$/);

    // Admin gibt das Zitat frei
    await admin.goto("/berichte/zitate");
    await admin
      .getByRole("row")
      .filter({ hasText: quote })
      .getByRole("switch")
      .click();
    await expect(
      admin.getByText("Zitat für die Website freigegeben.")
    ).toBeVisible();

    // Mitarbeiter/in ändert den Wortlaut
    await employee.reload();
    await employee
      .getByRole("textbox", { name: "Zitat 1" })
      .fill(`${quote} (überarbeitet)`);
    await employee
      .getByRole("button", { name: "Änderungen speichern" })
      .click();
    await expect(employee.getByText("Bericht aktualisiert.")).toBeVisible();

    // Die Freigabe ist zurückgesetzt
    await admin.goto("/berichte/zitate");
    await expect(
      admin
        .getByRole("row")
        .filter({ hasText: `${quote} (überarbeitet)` })
        .getByRole("switch")
    ).not.toBeChecked();
  });
});
