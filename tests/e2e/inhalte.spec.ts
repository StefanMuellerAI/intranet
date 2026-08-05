import { expect, test } from "@playwright/test";
import { ADMIN_STATE, USER_STATE, pageAs } from "./helpers";

test.describe("Dashboard-Inhalte", () => {
  test("Admin legt Link und Neuigkeit an — erscheinen auf dem Dashboard", async ({
    browser,
  }) => {
    const admin = await pageAs(browser, ADMIN_STATE);
    await admin.goto("/inhalte");
    await expect(admin.getByRole("heading", { name: "Inhalte" })).toBeVisible();

    // Hilfreichen Link anlegen — Reiter "Hilfreiche Links" ist voreingestellt
    await admin.getByRole("button", { name: "Neuer Link" }).click();
    await admin.locator("#link-title").fill("E2E Wiki");
    await admin.locator("#link-url").fill("https://wiki.example.com/hilfe");
    await admin.locator("#link-description").fill("Kurzanleitung für alle");
    await admin
      .getByRole("dialog")
      .getByRole("button", { name: "Link hinzufügen" })
      .click();
    await expect(admin.getByText("Link angelegt.")).toBeVisible();
    await expect(admin.getByText("E2E Wiki").first()).toBeVisible();

    // Neuigkeit veröffentlichen
    await admin.getByRole("tab", { name: "Neuigkeiten" }).click();
    await admin.getByRole("button", { name: "Neue Neuigkeit" }).click();
    await admin.locator("#news-title").fill("E2E Büro-Hinweis");
    await admin
      .locator("#news-body")
      .fill("Morgen um 10 Uhr Team-Meeting im großen Raum.");
    await admin
      .getByRole("dialog")
      .getByRole("button", { name: "Neuigkeit veröffentlichen" })
      .click();
    await expect(admin.getByText("Neuigkeit veröffentlicht.")).toBeVisible();
    await expect(admin.getByText("E2E Büro-Hinweis").first()).toBeVisible();

    // Sales-Nachricht veröffentlichen
    await admin.getByRole("tab", { name: "Sales-Nachrichten" }).click();
    await admin.getByRole("button", { name: "Neue Sales-Nachricht" }).click();
    await admin.locator("#sales-customer").fill("E2E Kunde AG");
    await admin.locator("#sales-volume").fill("25000");
    await admin
      .locator("#sales-soldBy")
      .selectOption({ label: "Max Mitarbeiter" });
    await admin.locator("#sales-deliveryStart").fill("2027-01-11");
    await admin.locator("#sales-deliveryEnd").fill("2027-03-31");
    await admin
      .getByRole("dialog")
      .getByRole("button", { name: "Sales-Nachricht veröffentlichen" })
      .click();
    await expect(
      admin.getByText("Sales-Nachricht veröffentlicht.")
    ).toBeVisible();
    await expect(admin.getByText("E2E Kunde AG").first()).toBeVisible();

    // Dashboard zeigt alle Inhalte
    await admin.goto("/dashboard");
    await expect(admin.getByText("Hilfreiche Links")).toBeVisible();
    await expect(admin.getByRole("link", { name: /E2E Wiki/ })).toBeVisible();
    await expect(admin.getByText("Kurzanleitung für alle")).toBeVisible();
    await expect(admin.getByText("Neuigkeiten").first()).toBeVisible();
    // Ticker verdoppelt den Text für den nahtlosen Loop → .first()
    await expect(admin.getByText(/E2E Büro-Hinweis/).first()).toBeVisible();
    await expect(
      admin.getByText(/Morgen um 10 Uhr Team-Meeting/).first()
    ).toBeVisible();

    // Feierliche Sales-Karte mit Kunde, Volumen, Mitarbeiter und Zeitraum
    const salesCard = admin.getByTestId("sales-nachrichten");
    await expect(salesCard).toBeVisible();
    await expect(salesCard.getByText("Gewonnene Aufträge")).toBeVisible();
    await expect(salesCard.getByText("E2E Kunde AG")).toBeVisible();
    await expect(salesCard.getByText("25.000,00 €")).toBeVisible();
    await expect(salesCard.getByText("Max Mitarbeiter")).toBeVisible();
    await expect(
      salesCard.getByText("Leistung vsl. 11.01.2027 – 31.03.2027")
    ).toBeVisible();
  });

  test("Ausgeblendete Inhalte verschwinden vom Dashboard", async ({
    browser,
  }) => {
    const admin = await pageAs(browser, ADMIN_STATE);
    await admin.goto("/inhalte");

    // Sicherstellen, dass die im vorherigen Test angelegten Einträge da sind
    const linkRow = admin.locator("tr", { hasText: "E2E Wiki" }).first();
    await expect(linkRow).toBeVisible();
    await linkRow.getByRole("button", { name: "Ausblenden" }).click();
    await expect(admin.getByText("Link ausgeblendet.")).toBeVisible();

    await admin.getByRole("tab", { name: "Neuigkeiten" }).click();
    const newsRow = admin.locator("tr", { hasText: "E2E Büro-Hinweis" }).first();
    await expect(newsRow).toBeVisible();
    await newsRow.getByRole("button", { name: "Ausblenden" }).click();
    await expect(admin.getByText("Neuigkeit ausgeblendet.")).toBeVisible();

    await admin.getByRole("tab", { name: "Sales-Nachrichten" }).click();
    const salesRow = admin.locator("tr", { hasText: "E2E Kunde AG" }).first();
    await expect(salesRow).toBeVisible();
    await salesRow.getByRole("button", { name: "Ausblenden" }).click();
    await expect(admin.getByText("Sales-Nachricht ausgeblendet.")).toBeVisible();

    await admin.goto("/dashboard");
    await expect(admin.getByRole("link", { name: /E2E Wiki/ })).toHaveCount(0);
    await expect(admin.getByText(/E2E Büro-Hinweis/)).toHaveCount(0);
    // Ohne sichtbare Sales-Nachricht verschwindet die ganze Karte
    await expect(admin.getByTestId("sales-nachrichten")).toHaveCount(0);
  });

  test("Mitarbeiter sieht Inhalte-Nav nicht und darf /inhalte nicht öffnen", async ({
    browser,
  }) => {
    const employee = await pageAs(browser, USER_STATE);
    await employee.goto("/dashboard");

    const nav = employee.getByRole("navigation").first();
    await expect(nav.getByRole("link", { name: "Inhalte" })).toHaveCount(0);

    // Direkter Aufruf der Admin-Seite schlägt fehl
    await employee.goto("/inhalte");
    await expect(
      employee.getByRole("heading", { name: "Inhalte" })
    ).toHaveCount(0);
  });

  test("Mitarbeiter schließt eine Sales-Nachricht nur für sich", async ({
    browser,
  }) => {
    // Admin legt eine frische Sales-Nachricht an (die erste wurde ausgeblendet)
    const admin = await pageAs(browser, ADMIN_STATE);
    await admin.goto("/inhalte");
    await admin.getByRole("tab", { name: "Sales-Nachrichten" }).click();
    await admin.getByRole("button", { name: "Neue Sales-Nachricht" }).click();
    await admin.locator("#sales-customer").fill("E2E Kunde Zwei GmbH");
    await admin.locator("#sales-volume").fill("12345.67");
    await admin.locator("#sales-soldBy").selectOption({ label: "Erika Admin" });
    await admin.locator("#sales-deliveryStart").fill("2027-05-03");
    await admin
      .getByRole("dialog")
      .getByRole("button", { name: "Sales-Nachricht veröffentlichen" })
      .click();
    await expect(
      admin.getByText("Sales-Nachricht veröffentlicht.")
    ).toBeVisible();

    // Mitarbeiter sieht die Meldung und schließt sie
    const employee = await pageAs(browser, USER_STATE);
    await employee.goto("/dashboard");
    const employeeCard = employee.getByTestId("sales-nachrichten");
    await expect(employeeCard.getByText("E2E Kunde Zwei GmbH")).toBeVisible();
    await employeeCard
      .getByRole("button", { name: "Meldung schließen" })
      .click();
    await expect(employee.getByTestId("sales-nachrichten")).toHaveCount(0);

    // Auch nach einem Reload bleibt die Meldung für den Mitarbeiter geschlossen
    await employee.reload();
    await expect(employee.getByTestId("sales-nachrichten")).toHaveCount(0);

    // Für den Admin bleibt sie sichtbar — das Schließen wirkt nur persönlich
    await admin.goto("/dashboard");
    await expect(
      admin.getByTestId("sales-nachrichten").getByText("E2E Kunde Zwei GmbH")
    ).toBeVisible();
  });
});
