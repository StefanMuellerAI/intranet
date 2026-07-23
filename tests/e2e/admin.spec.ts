import { expect, test } from "@playwright/test";
import { ADMIN_STATE, pageAs } from "./helpers";

test.describe("Administration", () => {
  test("Einstellungen: Kontingente ändern und wieder zurücksetzen", async ({
    browser,
  }) => {
    const admin = await pageAs(browser, ADMIN_STATE);
    await admin.goto("/einstellungen");

    await admin.locator("#defaultAnnualVacationDays").fill("28");
    await admin
      .locator("form", { has: admin.locator("#defaultAnnualVacationDays") })
      .getByRole("button", { name: "Speichern" })
      .click();
    await expect(admin.getByText("Kontingente gespeichert.")).toBeVisible();

    await admin.reload();
    await expect(admin.locator("#defaultAnnualVacationDays")).toHaveValue(
      "28"
    );

    // zurück auf den Standardwert
    await admin.locator("#defaultAnnualVacationDays").fill("30");
    await admin
      .locator("form", { has: admin.locator("#defaultAnnualVacationDays") })
      .getByRole("button", { name: "Speichern" })
      .click();
    await expect(admin.getByText("Kontingente gespeichert.")).toBeVisible();
  });

  test("API-Key anlegen, verwenden und widerrufen", async ({ browser }) => {
    const admin = await pageAs(browser, ADMIN_STATE);
    await admin.goto("/einstellungen");

    // Key erzeugen — wird genau einmal im Klartext angezeigt
    await admin.locator("#key-name").fill("E2E-Testkey");
    await admin.getByRole("button", { name: "Key erzeugen" }).click();
    await expect(
      admin.getByText("Neuer API-Key — wird nur dieses eine Mal angezeigt:")
    ).toBeVisible();
    const key = (
      await admin.locator("code.block").innerText()
    ).trim();
    expect(key.length).toBeGreaterThan(20);

    // Der Key funktioniert gegen die Freigabe-API
    const okRes = await admin.request.get("/api/v1/requests", {
      headers: { authorization: `Bearer ${key}` },
    });
    expect(okRes.status()).toBe(200);

    // Widerrufen → API lehnt ab
    await admin
      .locator("li", { hasText: "E2E-Testkey" })
      .getByRole("button", { name: "Widerrufen" })
      .click();
    await expect(admin.getByText("API-Key widerrufen.")).toBeVisible();

    const revokedRes = await admin.request.get("/api/v1/requests", {
      headers: { authorization: `Bearer ${key}` },
    });
    expect(revokedRes.status()).toBe(401);
  });

  test("Mitarbeitende: einladen, deaktivieren, reaktivieren", async ({
    browser,
  }) => {
    const admin = await pageAs(browser, ADMIN_STATE);
    await admin.goto("/mitarbeitende");

    // Einladen (Clerk-Einladung mit notify:false, Mail nur über Stub geloggt)
    await admin.locator("#firstName").fill("Nora");
    await admin.locator("#lastName").fill("Neu");
    await admin.locator("#email").fill("e2e-neu@stefanai.de");
    await admin.getByRole("button", { name: "Einladen", exact: true }).click();
    await expect(admin.getByText("Einladung versendet.")).toBeVisible();

    await expect(admin.getByText("e2e-neu@stefanai.de")).toBeVisible();
    await expect(admin.getByText("Eingeladen")).toBeVisible();

    // Deaktivieren (Offboarding — Daten bleiben erhalten)
    await admin
      .locator("div.flex.flex-wrap.gap-2", {
        has: admin.getByRole("button", { name: "Einladung erneut senden" }),
      })
      .getByRole("button", { name: "Deaktivieren" })
      .click();
    await expect(admin.getByText(/User deaktiviert/)).toBeVisible();
    await expect(admin.getByText("Deaktiviert").first()).toBeVisible();

    // Reaktivieren
    await admin.getByRole("button", { name: "Reaktivieren" }).click();
    await expect(admin.getByText("User reaktiviert.")).toBeVisible();
  });

  test("Fremde E-Mail-Domains können nicht eingeladen werden", async ({
    browser,
  }) => {
    const admin = await pageAs(browser, ADMIN_STATE);
    await admin.goto("/mitarbeitende");
    await admin.locator("#firstName").fill("Eve");
    await admin.locator("#lastName").fill("Extern");
    await admin.locator("#email").fill("eve@example.com");
    await admin.getByRole("button", { name: "Einladen", exact: true }).click();
    await expect(
      admin.getByText(/Zulässig sind ausschließlich Adressen der Domain/)
    ).toBeVisible();
  });
});
