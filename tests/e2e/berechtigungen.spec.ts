import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { users, vacationRequests } from "../../src/db/schema";
import { testDb, E2E_ADMIN_EMAIL } from "../helpers/db";
import {
  ADMIN_STATE,
  USER_NAME,
  USER_STATE,
  pageAs,
} from "./helpers";

test.describe("Rollen und Berechtigungen", () => {
  test("Mitarbeiter sieht keine Admin-Navigation und keine Freigaben", async ({
    browser,
  }) => {
    const employee = await pageAs(browser, USER_STATE);
    await employee.goto("/dashboard");
    await expect(employee.getByText("Mitarbeiter/in").first()).toBeVisible();
    const nav = employee.getByRole("navigation").first();
    await expect(nav.getByRole("link", { name: "Urlaub" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Freigaben" })).toHaveCount(0);
    await expect(
      nav.getByRole("link", { name: "Mitarbeitende" })
    ).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Inhalte" })).toHaveCount(0);
    await expect(
      nav.getByRole("link", { name: "Einstellungen" })
    ).toHaveCount(0);

    // Direkter Aufruf der Freigaben-Seite schlägt fehl
    await employee.goto("/freigaben");
    await expect(employee.getByText("Offene Anträge")).toHaveCount(0);
  });

  test("Mitarbeiter sieht die Admin-Bereiche der Berichte nicht", async ({
    browser,
  }) => {
    const employee = await pageAs(browser, USER_STATE);

    // Der Menüpunkt selbst ist für alle da, die Unterbereiche nicht
    await employee.goto("/berichte");
    await expect(
      employee.getByRole("heading", { name: "Berichte" })
    ).toBeVisible();
    await expect(
      employee.getByRole("link", { name: "Alle Berichte" })
    ).toHaveCount(0);
    await expect(employee.getByRole("link", { name: "Zitate" })).toHaveCount(0);

    // Direkte Aufrufe der Admin-Seiten schlagen fehl
    await employee.goto("/berichte/alle");
    await expect(
      employee.getByRole("heading", { name: "Alle Berichte" })
    ).toHaveCount(0);

    await employee.goto("/berichte/zitate");
    await expect(employee.getByRole("switch")).toHaveCount(0);

    // Der CSV-Export der Zitate bleibt dem Admin vorbehalten
    const response = await employee.request.get("/api/exports/berichte-zitate");
    expect(response.status()).toBe(403);
  });

  test("Mitarbeiter sieht fremde Anträge nicht", async ({ browser }) => {
    // Antrag des Admins direkt in der Test-DB anlegen
    const db = testDb();
    const [adminUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, E2E_ADMIN_EMAIL));
    const [request] = await db
      .insert(vacationRequests)
      .values({
        userId: adminUser.id,
        startDate: "2026-11-02",
        endDate: "2026-11-06",
        days: 5,
      })
      .returning();

    const employee = await pageAs(browser, USER_STATE);
    await employee.goto(`/urlaub/${request.id}`);
    await expect(employee.getByText("Antragsdaten")).toHaveCount(0);
    await expect(employee.getByText("02.11.2026")).toHaveCount(0);
  });

  test("Vertretung darf freigeben — und verliert das Recht nach Entzug", async ({
    browser,
  }) => {
    const admin = await pageAs(browser, ADMIN_STATE);
    const employee = await pageAs(browser, USER_STATE);

    // Admin aktiviert den Mitarbeiter als Vertretung
    await admin.goto("/einstellungen");
    await admin.locator("#deputy-user").selectOption({ label: USER_NAME });
    await admin
      .getByRole("button", { name: "Vertretung aktivieren" })
      .click();
    await expect(admin.getByText("Vertretung aktiviert.")).toBeVisible();

    // Mitarbeiter ist jetzt Vertretung und sieht die Freigaben
    await employee.goto("/dashboard");
    await expect(employee.getByText("Vertretung (aktiv)").first()).toBeVisible();
    await employee.goto("/freigaben");
    await expect(employee.getByText(/Offene Anträge/)).toBeVisible();

    // Vertretung genehmigt den offenen Antrag des Admins (02.11.–06.11.)
    await employee
      .getByRole("row")
      .filter({ hasText: "02.11.2026" })
      .getByRole("link", { name: "Prüfen" })
      .click();
    await employee.getByRole("button", { name: "Genehmigen" }).click();
    await expect(employee.getByText("Antrag genehmigt.")).toBeVisible();

    // Admin entzieht die Vertretung
    await admin.goto("/einstellungen");
    await admin.getByRole("button", { name: "Vertretung entziehen" }).click();
    await expect(admin.getByText("Vertretung entzogen.")).toBeVisible();

    // Mitarbeiter hat keinen Freigaben-Zugriff mehr
    await employee.goto("/freigaben");
    await expect(employee.getByText("Offene Anträge")).toHaveCount(0);
  });

  test("Admin darf eigene Anträge nicht selbst genehmigen", async ({
    browser,
  }) => {
    // Eigener offener Antrag des Admins
    const db = testDb();
    const [adminUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, E2E_ADMIN_EMAIL));
    const [request] = await db
      .insert(vacationRequests)
      .values({
        userId: adminUser.id,
        startDate: "2026-12-21",
        endDate: "2026-12-23",
        days: 3,
      })
      .returning();

    const admin = await pageAs(browser, ADMIN_STATE);
    await admin.goto(`/freigaben/urlaub/${request.id}`);
    await expect(
      admin.getByText(
        "Eigene Anträge dürfen nicht selbst genehmigt werden (Vier-Augen-Prinzip)."
      )
    ).toBeVisible();
    await expect(
      admin.getByRole("button", { name: "Genehmigen" })
    ).toHaveCount(0);
  });
});
