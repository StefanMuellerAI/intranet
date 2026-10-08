import {
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";
import { eq } from "drizzle-orm";
import {
  requestHistory,
  users,
  workationRequests,
} from "../../src/db/schema";
import { E2E_ADMIN_EMAIL, E2E_USER_EMAIL, testDb } from "../helpers/db";
import { USER_STATE, fetchHref, openDialog, pageAs, statusBadge } from "./helpers";

/*
 * Ergänzt workation.spec.ts (Testplan 5.5 „Workation“). Alle Anträge liegen
 * in 2027 und sind kurz, damit das Jahreskontingent (30 Arbeitstage), das
 * workation.spec.ts für 2026 nutzt, unberührt bleibt.
 */

const pages: Page[] = [];

async function open(browser: Browser, state: string): Promise<Page> {
  const page = await pageAs(browser, state);
  pages.push(page);
  return page;
}

test.afterEach(async () => {
  for (const page of pages.splice(0))
    await page.context().close().catch(() => {});
});

async function userId(email: string): Promise<string> {
  const [user] = await testDb()
    .select()
    .from(users)
    .where(eq(users.email, email));
  if (!user) throw new Error(`Test-User ${email} fehlt in der Datenbank.`);
  return user.id;
}

/** Wartet, bis React das Element hydriert hat (Event-Handler sind aktiv). */
async function expectHydrated(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(
      () =>
        locator.evaluate((el) =>
          Object.keys(el).some((key) => key.startsWith("__reactProps$"))
        ),
      { timeout: 30_000 }
    )
    .toBe(true);
}

/** Wert eines <dt>/<dd>-Paars in den Antragsdetails. */
function detail(scope: Page | Locator, label: string): Locator {
  return scope.locator(`div:has(> dt:text-is("${label}")) > dd`);
}

/** ISO-Datum in n Tagen (UTC genügt, die Prüfung hat mehrere Tage Puffer). */
function isoInDays(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

type WorkationInsert = typeof workationRequests.$inferInsert;

/** Vollständig ausgefüllter Workation-Antrag für Direkt-Inserts. */
function workationFixture(
  userId: string,
  values: Pick<
    WorkationInsert,
    "country" | "countryCategory" | "city" | "startDate" | "endDate" | "workDays"
  > &
    Partial<WorkationInsert>
): WorkationInsert {
  return {
    userId,
    accommodationAddress: "Testanschrift 1",
    vacationDays: 0,
    timezoneAvailability: "MEZ, erreichbar 9–17 Uhr",
    daysInCountryThisYear: 0,
    emergencyContactName: "Maria Mitarbeiter",
    emergencyContactPhone: "+49 221 987654",
    visaType: "keins (EU-Freizügigkeit)",
    insuranceDetails: "Envivas Auslandsschutz, Police 12345",
    plannedTasks: "Projektarbeit",
    domesticSubstitution: "Erika Admin übernimmt Termine vor Ort.",
    declResidence: true,
    declVisa: true,
    declWorkingTime: true,
    declDataProtection: true,
    declNoForbiddenActivities: true,
    declReportChanges: true,
    declCosts: true,
    ...values,
  };
}

function deleteTrigger(page: Page): Locator {
  return page
    .getByRole("main")
    .getByRole("button", { name: "Endgültig löschen" });
}

test.describe("Workation — erweiterte Bedienelemente", () => {
  test.describe.configure({ timeout: 120_000 });

  test("Drittstaat: 8-Wochen-Hinweis, manuelle Arbeitstage und Visum „gültig bis“", async ({
    browser,
  }) => {
    const db = testDb();
    const city = `Osaka E2E-${Date.now()}`;
    const employee = await open(browser, USER_STATE);

    await employee.goto("/workation");
    await employee.getByRole("button", { name: "Workation beantragen" }).click();
    await expect(employee).toHaveURL(/\/workation\/neu$/, { timeout: 30_000 });

    const country = employee.locator("#country");
    await expectHydrated(country);
    await country.fill("Japan");
    await expect(
      employee.getByText("Drittstaat — gesonderte Prüfung erforderlich", {
        exact: true,
      })
    ).toBeVisible();

    // Beginn in sechs Wochen: für Drittstaaten gilt ein Vorlauf von 8 Wochen
    await employee.locator("#startDate").fill(isoInDays(42));
    await employee.locator("#endDate").fill(isoInDays(44));
    await expect(
      employee.getByText("Hinweise zur Prüfung", { exact: true })
    ).toBeVisible();
    await expect(
      employee.getByText(
        /Der Mindestvorlauf von 8 Wochen \(Drittstaat\) ist unterschritten/
      )
    ).toBeVisible();

    // Gegenprobe EU-Ziel: dort genügen 4 Wochen, der Hinweis entfällt
    await country.fill("Spanien");
    await expect(
      employee.getByText("EU / EWR / Schweiz", { exact: true })
    ).toBeVisible();
    await expect(
      employee.getByText(/Der Mindestvorlauf von \d Wochen/)
    ).toHaveCount(0);
    await country.fill("Japan");
    await expect(
      employee.getByText(/Der Mindestvorlauf von 8 Wochen \(Drittstaat\)/)
    ).toBeVisible();

    // Tatsächlicher Zeitraum Mo 06.09. – Fr 10.09.2027: 5 Arbeitstage automatisch
    await employee.locator("#startDate").fill("2027-09-06");
    await employee.locator("#endDate").fill("2027-09-10");
    const workDays = employee.locator("#workDays");
    await expect(workDays).toHaveValue("5");

    // Manuelle Korrektur bleibt auch bei geändertem Zeitraum erhalten
    await workDays.fill("4");
    await employee.locator("#endDate").fill("2027-09-09");
    await expect(workDays).toHaveValue("4");
    await employee.locator("#endDate").fill("2027-09-10");
    await expect(workDays).toHaveValue("4");

    await employee.locator("#city").fill(city);
    await employee.locator("#accommodationAddress").fill("1-2-3 Namba, Osaka");
    await employee.locator("#vacationDays").fill("1");
    await employee
      .locator("#timezoneAvailability")
      .fill("MEZ+7, erreichbar 8–12 Uhr dt. Zeit");
    await employee.locator("#emergencyContactName").fill("Maria Mitarbeiter");
    await employee.locator("#emergencyContactPhone").fill("+49 221 987654");
    await employee.locator("#visaType").fill("Working-Holiday-Visum");
    await employee.locator("#visaValidUntil").fill("2027-12-31");
    await employee
      .locator("#insuranceDetails")
      .fill("Envivas Auslandsschutz, Police 12345");
    await employee.locator("#plannedTasks").fill("Projektarbeit Kunde Y");
    await employee
      .locator("#domesticSubstitution")
      .fill("Erika Admin übernimmt Termine vor Ort.");

    const checkboxes = employee.getByRole("checkbox");
    await expect(checkboxes).toHaveCount(7);
    for (const checkbox of await checkboxes.all()) {
      await checkbox.click();
      await expect(checkbox).toBeChecked();
    }
    await employee.getByRole("button", { name: "Antrag einreichen" }).click();
    await expect(employee).toHaveURL(/\/workation\/[0-9a-f-]{36}$/, {
      timeout: 30_000,
    });
    const id = employee.url().split("/").pop()!;

    await expect(statusBadge(employee, "Eingereicht")).toBeVisible();
    await expect(detail(employee, "Zielland")).toContainText("Japan");
    await expect(
      detail(employee, "Zielland").locator('[data-slot="badge"]')
    ).toHaveText("Drittstaat");
    await expect(
      employee.getByText("Drittstaat — gesonderte Prüfung erforderlich", {
        exact: true,
      })
    ).toBeVisible();
    await expect(detail(employee, "davon Arbeitstage")).toHaveText("4");
    await expect(detail(employee, "davon beantragte Urlaubstage")).toHaveText(
      "1"
    );
    await expect(detail(employee, "gültig bis")).toHaveText("31.12.2027");
    // Nicht genehmigt → kein Genehmigungs-PDF
    await expect(
      employee.getByRole("button", { name: "Genehmigungs-PDF herunterladen" })
    ).toHaveCount(0);

    const [saved] = await db
      .select()
      .from(workationRequests)
      .where(eq(workationRequests.id, id));
    expect(saved).toMatchObject({
      status: "eingereicht",
      country: "Japan",
      countryCategory: "drittstaat",
      city,
      startDate: "2027-09-06",
      endDate: "2027-09-10",
      workDays: 4,
      vacationDays: 1,
      visaValidUntil: "2027-12-31",
    });
  });

  test("Zurückziehen, korrigiert erneut einreichen, erneut zurückziehen und löschen", async ({
    browser,
  }) => {
    const db = testDb();
    const employeeId = await userId(E2E_USER_EMAIL);
    const stamp = Date.now();
    const cityV1 = `Porto E2E-${stamp}`;
    const cityV2 = `Lissabon E2E-${stamp}`;
    // Eingereichter Antrag Mo 13.09. – Fr 17.09.2027 (5 Arbeitstage)
    const [request] = await db
      .insert(workationRequests)
      .values(
        workationFixture(employeeId, {
          country: "Portugal",
          countryCategory: "eu_ewr_ch",
          city: cityV1,
          startDate: "2027-09-13",
          endDate: "2027-09-17",
          workDays: 5,
        })
      )
      .returning();

    const employee = await open(browser, USER_STATE);
    await employee.goto("/workation");
    await employee.locator(`a[href="/workation/${request.id}"]`).click();
    await expect(employee).toHaveURL(
      new RegExp(`/workation/${request.id}$`),
      { timeout: 30_000 }
    );
    await expect(statusBadge(employee, "Eingereicht")).toBeVisible();

    // 1. Zurückziehen
    await employee.getByRole("button", { name: "Antrag zurückziehen" }).click();
    await expect(statusBadge(employee, "Zurückgezogen")).toBeVisible();
    await expect(
      employee.getByText("Antrag korrigieren und erneut einreichen", {
        exact: true,
      })
    ).toBeVisible();

    // 2. Korrigiert erneut einreichen: anderer Ort, ein Arbeitstag weniger
    const city = employee.locator("#city");
    await expectHydrated(city);
    await expect(city).toHaveValue(cityV1);
    await city.fill(cityV2);
    await employee.locator("#workDays").fill("4");
    // Die Erklärungen sind aus dem ursprünglichen Antrag übernommen
    for (const checkbox of await employee.getByRole("checkbox").all())
      await expect(checkbox).toBeChecked();
    await employee
      .getByRole("button", { name: "Korrigiert erneut einreichen" })
      .click();
    await expect(statusBadge(employee, "Eingereicht")).toBeVisible({
      timeout: 30_000,
    });
    await expect(employee.getByText("Version 2", { exact: true })).toBeVisible();
    await expect(detail(employee, "Aufenthaltsort (Stadt)")).toHaveText(cityV2);
    await expect(detail(employee, "davon Arbeitstage")).toHaveText("4");
    await expect(
      employee.getByText(
        `${cityV1}, Portugal · 13.09.2027 – 17.09.2027 · 5 Arbeitstage`,
        { exact: true }
      )
    ).toBeVisible();

    // 3. Erneut zurückziehen
    await employee.getByRole("button", { name: "Antrag zurückziehen" }).click();
    await expect(statusBadge(employee, "Zurückgezogen")).toBeVisible();

    // 4. Endgültig löschen (inkl. Versionshistorie)
    const dialog = employee.getByRole("dialog");
    await openDialog(deleteTrigger(employee), dialog);
    await expect(
      dialog.getByText(
        "Der Workation-Antrag wird unwiderruflich gelöscht. Dieser Schritt kann nicht rückgängig gemacht werden.",
        { exact: true }
      )
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Endgültig löschen" }).click();
    await expect(employee).toHaveURL(/\/workation$/, { timeout: 30_000 });
    await expect(
      employee.locator(`a[href="/workation/${request.id}"]`)
    ).toHaveCount(0);

    expect(
      await db
        .select()
        .from(workationRequests)
        .where(eq(workationRequests.id, request.id))
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(requestHistory)
        .where(eq(requestHistory.requestId, request.id))
    ).toHaveLength(0);
  });

  test("Button „Genehmigungs-PDF herunterladen“ liefert das PDF", async ({
    browser,
  }) => {
    const db = testDb();
    const adminId = await userId(E2E_ADMIN_EMAIL);
    const employeeId = await userId(E2E_USER_EMAIL);
    // Genehmigter Antrag Mo 04.10. – Mi 06.10.2027 (3 Arbeitstage)
    const [request] = await db
      .insert(workationRequests)
      .values(
        workationFixture(employeeId, {
          country: "Österreich",
          countryCategory: "eu_ewr_ch",
          city: `Graz E2E-${Date.now()}`,
          startDate: "2027-10-04",
          endDate: "2027-10-06",
          workDays: 3,
          status: "genehmigt",
          a1Status: "beantragt",
          decidedById: adminId,
          decidedAt: new Date(),
        })
      )
      .returning();

    const employee = await open(browser, USER_STATE);
    await employee.goto("/workation");
    await employee.locator(`a[href="/workation/${request.id}"]`).click();
    await expect(employee).toHaveURL(
      new RegExp(`/workation/${request.id}$`),
      { timeout: 30_000 }
    );
    await expect(statusBadge(employee, "Genehmigt")).toBeVisible();

    // Der Button ist ein Link (role="button"), der das PDF in neuem Tab öffnet
    const pdfButton = employee.getByRole("button", {
      name: "Genehmigungs-PDF herunterladen",
    });
    await expect(pdfButton).toHaveAttribute(
      "href",
      `/workation/${request.id}/pdf`
    );
    await expect(pdfButton).toHaveAttribute("target", "_blank");
    const popupPromise = employee.waitForEvent("popup");
    await pdfButton.click();
    const popup = await popupPromise;
    await popup.close().catch(() => {});

    const res = await fetchHref(employee, pdfButton);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/pdf");
    expect((await res.body()).subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});
