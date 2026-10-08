import {
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";
import { eq } from "drizzle-orm";
import {
  commissionClaims,
  requestHistory,
  settings,
  users,
} from "../../src/db/schema";
import { E2E_USER_EMAIL, testDb } from "../helpers/db";
import {
  ADMIN_STATE,
  USER_NAME,
  USER_STATE,
  expectToast,
  openDialog,
  pageAs,
  statusBadge,
} from "./helpers";

/*
 * Ergänzt provision.spec.ts (Testplan 5.5 „Provision“): Beratung mit
 * Nettoauftragswert/Neukunde/Einheit/Bemerkung, Admin-Beträge, sowie
 * Zurückziehen/Korrigieren/Löschen. Erwartete Beträge kommen aus den
 * aktuellen Provisionssätzen der Settings-Zeile.
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

async function commissionRates() {
  const [row] = await testDb()
    .select()
    .from(settings)
    .where(eq(settings.id, 1));
  return {
    halfDay: row.commissionHalfDayCents,
    consultingPercent: row.commissionConsultingPercent,
  };
}

/** Betrag wie in der App formatiert (formatEuro). */
function euro(cents: number): string {
  return (cents / 100).toLocaleString("de-DE", {
    style: "currency",
    currency: "EUR",
  });
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

/** Wert eines <dt>/<dd>-Paars in „Angaben zum Folgegeschäft“. */
function detail(scope: Page | Locator, label: string): Locator {
  return scope.locator(`div:has(> dt:text-is("${label}")) > dd`);
}

/** Auswahlfeld (Base UI Select) unter einer Feldbeschriftung. */
function selectField(page: Page, label: string): Locator {
  return page
    .locator(`div.space-y-2:has(> label:text-is("${label}"))`)
    .getByRole("combobox");
}

/** Öffnet eine Base-UI-Auswahl und wählt eine Option. */
async function chooseOption(
  page: Page,
  combobox: Locator,
  option: string | RegExp
): Promise<void> {
  const item = page
    .getByRole(
      "option",
      typeof option === "string"
        ? { name: option, exact: true }
        : { name: option }
    )
    .first();
  await expectHydrated(combobox);
  await expect(async () => {
    if (!(await item.isVisible())) await combobox.click();
    await expect(item).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await item.click();
  await expect(item).toBeHidden();
}

function deleteTrigger(page: Page): Locator {
  return page
    .getByRole("main")
    .getByRole("button", { name: "Endgültig löschen" });
}

test.describe("Provision — erweiterte Bedienelemente", () => {
  test.describe.configure({ timeout: 120_000 });

  test("Beratung mit Nettoauftragswert, Neukunde, Einheit und Bemerkung — Admin pflegt Beträge und genehmigt", async ({
    browser,
  }) => {
    const db = testDb();
    const rates = await commissionRates();
    const customer = `E2E Beratung Neukunde ${Date.now()}`;
    const note = "Projekt KI-Strategie, Ansprechpartnerin Frau Muster";
    const netOrderCents = 1_250_000;
    const calculated = Math.round(
      (netOrderCents * rates.consultingPercent) / 100
    );
    const employee = await open(browser, USER_STATE);
    const admin = await open(browser, ADMIN_STATE);

    await employee.goto("/provision");
    await employee.getByRole("button", { name: "Anspruch einreichen" }).click();
    await expect(employee).toHaveURL(/\/provision\/neu$/, { timeout: 30_000 });

    // Beratung statt Schulung: Nettoauftragswert statt Trainingsfeldern
    await chooseOption(
      employee,
      selectField(employee, "Art des Folgegeschäfts"),
      "Beratung (Folgeberatung)"
    );
    await expect(employee.locator("#netOrderValue")).toBeVisible();
    await expect(employee.locator("#trainingCount")).toHaveCount(0);

    // Neukunde blendet den Hinweis zur Vermittlungsprovision ein
    await chooseOption(
      employee,
      selectField(employee, "Kundenart"),
      "Komplett neuer Kunde"
    );
    await expect(
      employee.getByText("Neukunden-Vermittlung", { exact: true })
    ).toBeVisible();

    await employee.locator("#customerName").fill(customer);
    await employee.locator("#orderDate").fill("2027-02-15");

    // Einheit „Liefergegenstände“ ändert die Umfang-Beschriftung
    await chooseOption(
      employee,
      selectField(employee, "Einheit"),
      "Liefergegenstände"
    );
    await expect(
      employee.getByText("Umfang (Anzahl Liefergegenstände)", { exact: true })
    ).toBeVisible();
    await employee.locator("#quantity").fill("3");

    await employee.locator("#netOrderValue").fill("12500,00");
    await expect(
      employee.getByText(
        `Berechneter Provisionsanspruch: ${euro(calculated)}`,
        { exact: true }
      )
    ).toBeVisible();
    await expect(
      employee.getByText(`${rates.consultingPercent} % vom Nettoauftragswert.`)
    ).toBeVisible();
    await employee.locator("#note").fill(note);

    await employee.getByRole("button", { name: "Anspruch einreichen" }).click();
    await expect(employee).toHaveURL(/\/provision\/[0-9a-f-]{36}$/, {
      timeout: 30_000,
    });
    const id = employee.url().split("/").pop()!;

    await expect(statusBadge(employee, "Eingereicht")).toBeVisible();
    await expect(detail(employee, "Art")).toHaveText("Beratung");
    await expect(detail(employee, "Kundenart")).toHaveText("Neukunde");
    await expect(detail(employee, "Kunde / Organisation")).toHaveText(customer);
    await expect(detail(employee, "Datum der Bestellung")).toHaveText(
      "15.02.2027"
    );
    await expect(detail(employee, "Umfang")).toHaveText("3 Liefergegenstände");
    await expect(detail(employee, "Nettoauftragswert")).toHaveText(
      euro(netOrderCents)
    );
    await expect(detail(employee, "Berechneter Anspruch")).toHaveText(
      euro(calculated)
    );
    await expect(
      detail(employee, "Vermittlungsprovision (Einzelfall)")
    ).toHaveText("noch nicht festgelegt");
    await expect(detail(employee, "Finaler Betrag")).toHaveText(
      euro(calculated)
    );
    await expect(detail(employee, "Bemerkung")).toHaveText(note);

    // Admin: Vermittlungsprovision pflegen → Endbetrag = Berechnung + Vermittlung
    await admin.goto("/freigaben");
    await admin
      .getByRole("row")
      .filter({ has: admin.locator(`a[href="/freigaben/provision/${id}"]`) })
      .getByRole("link", { name: "Prüfen" })
      .click();
    await expect(
      admin.getByRole("heading", {
        name: `Provision: ${USER_NAME} · ${euro(calculated)}`,
        exact: true,
      })
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      admin.getByText("Vom Admin zu pflegende Beträge", { exact: true })
    ).toBeVisible();

    await admin.locator("#referralBonus").fill("250,00");
    await admin.getByRole("button", { name: "Beträge speichern" }).click();
    await expect(
      admin.getByRole("heading", {
        name: `Provision: ${USER_NAME} · ${euro(calculated + 25_000)}`,
        exact: true,
      })
    ).toBeVisible();
    await expect(
      detail(admin, "Vermittlungsprovision (Einzelfall)")
    ).toHaveText(euro(25_000));
    await expect(detail(admin, "Finaler Betrag")).toHaveText(
      euro(calculated + 25_000)
    );

    // Finaler Provisionsbetrag überschreibt die Berechnung
    await admin.locator("#referralBonus").fill("250,00");
    await admin.locator("#finalAmount").fill("800,00");
    await admin.getByRole("button", { name: "Beträge speichern" }).click();
    await expect(
      admin.getByRole("heading", {
        name: `Provision: ${USER_NAME} · ${euro(80_000)}`,
        exact: true,
      })
    ).toBeVisible();
    await expect(detail(admin, "Finaler Betrag")).toHaveText(euro(80_000));
    await expect
      .poll(async () => {
        const [row] = await db
          .select()
          .from(commissionClaims)
          .where(eq(commissionClaims.id, id));
        return [row.referralBonusCents, row.finalAmountCents];
      })
      .toEqual([25_000, 80_000]);

    // Genehmigen
    const approve = admin.getByRole("button", { name: "Genehmigen" });
    await expectHydrated(approve);
    await approve.click();
    await expectToast(admin, "Antrag genehmigt.");
    await expect(
      admin.getByText("Dieser Vorgang ist bereits entschieden.")
    ).toBeVisible();

    await employee.reload();
    await expect(statusBadge(employee, "Genehmigt")).toBeVisible();
    await expect(detail(employee, "Finaler Betrag")).toHaveText(euro(80_000));
    await expect(
      detail(employee, "Vermittlungsprovision (Einzelfall)")
    ).toHaveText(euro(25_000));
  });

  test("Zurückziehen, als Folge-Training korrigiert erneut einreichen, erneut zurückziehen und löschen", async ({
    browser,
  }) => {
    const db = testDb();
    const rates = await commissionRates();
    const employeeId = await userId(E2E_USER_EMAIL);
    const customer = `E2E Korrektur ${Date.now()}`;
    // Eingereichte Folgeberatung (Bestandskunde, 3.000 € netto)
    const [claim] = await db
      .insert(commissionClaims)
      .values({
        userId: employeeId,
        businessType: "beratung",
        customerType: "bestandskunde",
        customerName: customer,
        orderDate: "2027-01-20",
        unit: "tage",
        quantity: 2,
        netOrderValueCents: 300_000,
        calculatedAmountCents: 12_000,
        finalAmountCents: 12_000,
        note: "Ursprüngliche Fassung",
      })
      .returning();

    const employee = await open(browser, USER_STATE);
    await employee.goto("/provision");
    await employee.locator(`a[href="/provision/${claim.id}"]`).click();
    await expect(employee).toHaveURL(new RegExp(`/provision/${claim.id}$`), {
      timeout: 30_000,
    });
    await expect(statusBadge(employee, "Eingereicht")).toBeVisible();

    // 1. Zurückziehen
    await employee
      .getByRole("button", { name: "Anspruch zurückziehen" })
      .click();
    await expect(statusBadge(employee, "Zurückgezogen")).toBeVisible();
    await expect(
      employee.getByText("Anspruch korrigieren und erneut einreichen", {
        exact: true,
      })
    ).toBeVisible();

    // 2. Korrektur: Folge-Training, 3 × halbtägig
    await chooseOption(
      employee,
      selectField(employee, "Art des Folgegeschäfts"),
      "Schulung (Folge-Training)"
    );
    await expect(employee.locator("#netOrderValue")).toHaveCount(0);
    await chooseOption(
      employee,
      selectField(employee, "Trainingsformat"),
      /^halbtägig/
    );
    await employee.locator("#trainingCount").fill("3");
    await expect(
      employee.getByText(
        `Berechneter Provisionsanspruch: ${euro(3 * rates.halfDay)}`,
        { exact: true }
      )
    ).toBeVisible();
    await employee
      .locator("#note")
      .fill("Korrigiert: drei halbtägige Folge-Trainings");
    await employee
      .getByRole("button", { name: "Korrigiert erneut einreichen" })
      .click();

    await expect(statusBadge(employee, "Eingereicht")).toBeVisible({
      timeout: 30_000,
    });
    await expect(employee.getByText("Version 2", { exact: true })).toBeVisible();
    await expect(detail(employee, "Art")).toHaveText("Schulung");
    await expect(detail(employee, "Trainings")).toHaveText("3 × halbtägig");
    await expect(detail(employee, "Berechneter Anspruch")).toHaveText(
      euro(3 * rates.halfDay)
    );
    await expect(detail(employee, "Finaler Betrag")).toHaveText(
      euro(3 * rates.halfDay)
    );
    await expect(detail(employee, "Bemerkung")).toHaveText(
      "Korrigiert: drei halbtägige Folge-Trainings"
    );
    await expect(
      employee.getByText(
        `${customer} · ${euro(12_000)} · Bemerkung: Ursprüngliche Fassung`,
        { exact: true }
      )
    ).toBeVisible();

    // 3. Erneut zurückziehen
    await employee
      .getByRole("button", { name: "Anspruch zurückziehen" })
      .click();
    await expect(statusBadge(employee, "Zurückgezogen")).toBeVisible();

    // 4. Endgültig löschen
    const dialog = employee.getByRole("dialog");
    await openDialog(deleteTrigger(employee), dialog);
    await expect(
      dialog.getByText(
        "Der Provisionsanspruch wird unwiderruflich gelöscht. Dieser Schritt kann nicht rückgängig gemacht werden.",
        { exact: true }
      )
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Endgültig löschen" }).click();
    await expect(employee).toHaveURL(/\/provision$/, { timeout: 30_000 });
    await expect(
      employee.locator(`a[href="/provision/${claim.id}"]`)
    ).toHaveCount(0);

    expect(
      await db
        .select()
        .from(commissionClaims)
        .where(eq(commissionClaims.id, claim.id))
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(requestHistory)
        .where(eq(requestHistory.requestId, claim.id))
    ).toHaveLength(0);
  });
});
