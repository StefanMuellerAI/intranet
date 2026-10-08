import {
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";
import { eq } from "drizzle-orm";
import {
  expenseItems,
  expenseReports,
  receipts,
  requestHistory,
  settings,
  users,
} from "../../src/db/schema";
import { E2E_USER_EMAIL, testDb } from "../helpers/db";
import {
  USER_STATE,
  fetchHref,
  fillByLabelText,
  openDialog,
  pageAs,
  statusBadge,
} from "./helpers";

/*
 * Ergänzt reisekosten.spec.ts (Testplan 5.5 „Reisekosten“): vollständiges
 * Formular, Zurückziehen/Korrigieren/Löschen und Beleg-Upload. Erwartete
 * Beträge werden aus den aktuellen Sätzen der Settings-Zeile berechnet, damit
 * der Test auch nach geänderten Reisekostensätzen stimmt.
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

async function currentRates() {
  const [row] = await testDb()
    .select()
    .from(settings)
    .where(eq(settings.id, 1));
  return {
    fullDay: row.rateFullDayCents,
    partialDay: row.ratePartialDayCents,
    breakfast: row.rateReductionBreakfastCents,
    km: row.rateKmCents,
    passengerKm: row.ratePassengerKmCents,
    dailySupplement: row.employerDailySupplementCents,
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

/** Wert eines <dt>/<dd>-Paars (Angaben zur Reise, Erstattungsbetrag). */
function detail(scope: Page | Locator, label: string): Locator {
  return scope.locator(`div:has(> dt:text-is("${label}")) > dd`);
}

/** Innerste Karte mit genau diesem Titel (auch innerhalb der Korrektur-Karte). */
function cardByTitle(scope: Page | Locator, title: string): Locator {
  return scope
    .locator(`[data-slot="card-title"]:text-is("${title}")`)
    .locator("xpath=ancestor::*[@data-slot='card'][1]");
}

/** Positionszeilen eines Belegblocks (Fahrt, Übernachtung, Nebenkosten). */
function belegRows(card: Locator): Locator {
  return card.locator('[data-slot="card-content"] > div.grid');
}

function belegDescription(row: Locator): Locator {
  return row.locator("div.space-y-1").nth(1).locator("input");
}

async function fillBeleg(
  row: Locator,
  date: string,
  description: string,
  amount: string
): Promise<void> {
  await row.locator('input[type="date"]').fill(date);
  await belegDescription(row).fill(description);
  await row.getByPlaceholder("0,00").fill(amount);
}

/** Öffnet eine Base-UI-Auswahl und wählt eine Option. */
async function chooseOption(
  page: Page,
  combobox: Locator,
  option: string
): Promise<void> {
  const item = page.getByRole("option", { name: option, exact: true }).first();
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

/** Kleinstes gültiges PDF für den Beleg-Upload. */
const MINI_PDF = Buffer.from(
  "%PDF-1.4\n" +
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n" +
    "trailer<</Root 1 0 R>>\n%%EOF\n",
  "latin1"
);

test.describe("Reisekosten — erweiterte Bedienelemente", () => {
  test.describe.configure({ timeout: 120_000 });

  test("Vollständige Abrechnung: Verpflegungszeilen, alle Belegblöcke, Privat-Pkw und Auslandsreise", async ({
    browser,
  }) => {
    const db = testDb();
    const rates = await currentRates();
    const destination = `Wien E2E-${Date.now()}`;
    const employee = await open(browser, USER_STATE);

    await employee.goto("/reisekosten");
    await employee.getByRole("button", { name: "Abrechnung erstellen" }).click();
    await expect(employee).toHaveURL(/\/reisekosten\/neu$/, {
      timeout: 30_000,
    });

    // Block 1 — Mi 10.03. 07:00 bis Fr 12.03.2027 19:30
    const destinationInput = employee.locator(
      'div.space-y-1:has(> label:text-is("Reiseziel (Ort)")) input'
    );
    await expectHydrated(destinationInput);
    await destinationInput.fill(destination);
    await fillByLabelText(employee, "Kunde / Anlass", "Workshop Stadtwerke");
    await fillByLabelText(employee, "Abreise: Datum", "2027-03-10");
    await fillByLabelText(employee, "Abreise: Uhrzeit", "07:00");
    await fillByLabelText(employee, "Rückkehr: Datum", "2027-03-12");
    await fillByLabelText(employee, "Rückkehr: Uhrzeit", "19:30");
    await expect(employee.getByText("Dauer gesamt: 60,5 Std.")).toBeVisible();

    // Auslands-Checkbox blendet den Hinweis zu den BMF-Sätzen ein
    const abroad = employee.getByRole("checkbox", {
      name: "Reiseziel im Ausland",
    });
    await abroad.click();
    await expect(abroad).toBeChecked();
    await expect(
      employee.getByText("Auslandsreise", { exact: true })
    ).toBeVisible();

    // Block 2 — Verpflegungszeilen aus dem Reisezeitraum
    await employee
      .getByRole("button", { name: "Zeilen aus Reisezeitraum erzeugen" })
      .click();
    const mealCard = cardByTitle(
      employee,
      "2. Verpflegungspauschale (keine Belege erforderlich)"
    );
    const mealRows = mealCard.locator("tbody tr");
    await expect(mealRows).toHaveCount(3);
    await expect(
      mealCard.getByText(
        `Summe Verpflegung: ${euro(2 * rates.partialDay + rates.fullDay)}`
      )
    ).toBeVisible();

    // Mitteltag (ganzer Tag): Frühstück gestellt → Kürzung
    const breakfast = mealRows.nth(1).getByRole("checkbox").nth(0);
    await breakfast.click();
    await expect(breakfast).toBeChecked();
    const middleDayNet = Math.max(0, rates.fullDay - rates.breakfast);
    await expect(mealRows.nth(1).getByRole("cell").last()).toHaveText(
      euro(middleDayNet)
    );

    // Rückreisetag: Abwesenheit „unter 8 Std.“ → keine Pauschale
    await chooseOption(
      employee,
      mealRows.nth(2).getByRole("combobox"),
      "unter 8 Std."
    );
    await expect(mealRows.nth(2).getByRole("cell").last()).toHaveText(euro(0));
    const mealCents = rates.partialDay + middleDayNet;
    await expect(
      mealCard.getByText(`Summe Verpflegung: ${euro(mealCents)}`)
    ).toBeVisible();

    // Block 3 — Fahrtkosten: zwei Positionen anlegen, die erste entfernen
    const transport = cardByTitle(employee, "3. Fahrtkosten (Beleg beifügen)");
    const addTransport = transport.getByRole("button", {
      name: "Position hinzufügen",
    });
    await addTransport.click();
    await addTransport.click();
    await expect(belegRows(transport)).toHaveCount(2);
    await fillBeleg(
      belegRows(transport).nth(0),
      "2027-03-10",
      "Taxi zum Bahnhof (wird entfernt)",
      "25,00"
    );
    await fillBeleg(
      belegRows(transport).nth(1),
      "2027-03-10",
      "ICE Köln nach Wien",
      "189,90"
    );
    await belegRows(transport)
      .nth(0)
      .getByRole("button", { name: "Entfernen" })
      .click();
    await expect(belegRows(transport)).toHaveCount(1);
    await expect(belegDescription(belegRows(transport).nth(0))).toHaveValue(
      "ICE Köln nach Wien"
    );
    await expect(
      belegRows(transport).nth(0).getByPlaceholder("0,00")
    ).toHaveValue("189,90");

    // Privat-Pkw: 100 km mit einer mitgenommenen Person
    await fillByLabelText(employee, "Gefahrene km", "100");
    await fillByLabelText(employee, "Mitgenommene Personen", "1");
    const carCents = 100 * rates.km + 100 * 1 * rates.passengerKm;
    await expect(
      cardByTitle(employee, "Privat-Pkw").getByText(`Betrag: ${euro(carCents)}`)
    ).toBeVisible();

    // Block 4 — Übernachtung: zwei Positionen, die zweite entfernen
    const lodging = cardByTitle(
      employee,
      "4. Übernachtung (Rechnung auf die GmbH)"
    );
    const addLodging = lodging.getByRole("button", {
      name: "Position hinzufügen",
    });
    await addLodging.click();
    await addLodging.click();
    await expect(belegRows(lodging)).toHaveCount(2);
    await fillBeleg(
      belegRows(lodging).nth(0),
      "2027-03-10",
      "Hotel am Ring, 2 Nächte",
      "240,00"
    );
    await fillBeleg(
      belegRows(lodging).nth(1),
      "2027-03-11",
      "Zweites Hotel (wird entfernt)",
      "99,00"
    );
    await belegRows(lodging)
      .nth(1)
      .getByRole("button", { name: "Entfernen" })
      .click();
    await expect(belegRows(lodging)).toHaveCount(1);
    await expect(belegDescription(belegRows(lodging).nth(0))).toHaveValue(
      "Hotel am Ring, 2 Nächte"
    );

    // Block 5 — Reisenebenkosten: zwei Positionen, die zweite entfernen
    const incidentals = cardByTitle(
      employee,
      "5. Reisenebenkosten (Beleg beifügen)"
    );
    const addIncidental = incidentals.getByRole("button", {
      name: "Position hinzufügen",
    });
    await addIncidental.click();
    await addIncidental.click();
    await expect(belegRows(incidentals)).toHaveCount(2);
    await fillBeleg(
      belegRows(incidentals).nth(0),
      "2027-03-12",
      "Parken Flughafen",
      "12,50"
    );
    await fillBeleg(
      belegRows(incidentals).nth(1),
      "2027-03-12",
      "Maut (wird entfernt)",
      "9,00"
    );
    await belegRows(incidentals)
      .nth(1)
      .getByRole("button", { name: "Entfernen" })
      .click();
    await expect(belegRows(incidentals)).toHaveCount(1);

    // Block 6 — Summen im Formular
    const eligibleMealDays = [rates.partialDay, rates.fullDay].filter(
      (gross) => gross > 0
    ).length;
    const supplementCents =
      rates.dailySupplement > 0 ? eligibleMealDays * rates.dailySupplement : 0;
    const totalCents =
      mealCents + 18_990 + carCents + 24_000 + 1_250 + supplementCents;
    const formTotals = cardByTitle(employee, "6. Erstattungsbetrag");
    await expect(
      detail(formTotals, "Verpflegungspauschale (steuerfrei)")
    ).toHaveText(euro(mealCents));
    await expect(detail(formTotals, "Fahrtkosten (Belege)")).toHaveText(
      euro(18_990)
    );
    await expect(detail(formTotals, "Fahrtkosten Privat-Pkw")).toHaveText(
      euro(carCents)
    );
    await expect(detail(formTotals, "Übernachtung")).toHaveText(euro(24_000));
    await expect(detail(formTotals, "Reisenebenkosten")).toHaveText(
      euro(1_250)
    );
    await expect(detail(formTotals, "Gesamterstattung")).toHaveText(
      euro(totalCents)
    );

    await employee.getByRole("button", { name: "Abrechnung einreichen" }).click();
    await expect(employee).toHaveURL(/\/reisekosten\/[0-9a-f-]{36}$/, {
      timeout: 30_000,
    });
    const id = employee.url().split("/").pop()!;

    // Detailseite: alle Angaben und Summen wie eingegeben
    await expect(statusBadge(employee, "Eingereicht")).toBeVisible();
    await expect(detail(employee, "Reiseziel (Ort)")).toHaveText(
      `${destination} (Ausland)`
    );
    await expect(
      employee.getByText("Auslandsreise", { exact: true })
    ).toBeVisible();

    const mealDetails = cardByTitle(employee, "2. Verpflegungspauschale");
    const mealDetailRows = mealDetails.locator("tbody tr");
    await expect(mealDetailRows).toHaveCount(3);
    await expect(mealDetailRows.nth(0).getByRole("cell").nth(0)).toHaveText(
      "10.03.2027"
    );
    await expect(mealDetailRows.nth(0).getByRole("cell").nth(1)).toHaveText(
      "An-/Abreisetag"
    );
    await expect(mealDetailRows.nth(1).getByRole("cell").nth(1)).toHaveText(
      "ganzer Tag"
    );
    await expect(mealDetailRows.nth(1).getByRole("cell").nth(2)).toHaveText(
      "ja"
    );
    await expect(mealDetailRows.nth(2).getByRole("cell").nth(1)).toHaveText(
      "unter 8 Std."
    );
    await expect(
      mealDetails.getByText(`Summe Verpflegung: ${euro(mealCents)}`)
    ).toBeVisible();

    const transportRows = cardByTitle(
      employee,
      "3. Fahrtkosten (Belege)"
    ).locator("tbody tr");
    await expect(transportRows).toHaveCount(1);
    await expect(transportRows.first()).toContainText("ICE Köln nach Wien");
    await expect(transportRows.first()).toContainText(euro(18_990));
    await expect(transportRows.first()).toContainText("kein Beleg");
    const lodgingRows = cardByTitle(employee, "4. Übernachtung").locator(
      "tbody tr"
    );
    await expect(lodgingRows).toHaveCount(1);
    await expect(lodgingRows.first()).toContainText("Hotel am Ring, 2 Nächte");
    const incidentalRows = cardByTitle(
      employee,
      "5. Reisenebenkosten"
    ).locator("tbody tr");
    await expect(incidentalRows).toHaveCount(1);
    await expect(incidentalRows.first()).toContainText("Parken Flughafen");
    await expect(employee.getByText(/wird entfernt/)).toHaveCount(0);

    await expect(
      cardByTitle(employee, "Privat-Pkw").locator('[data-slot="card-content"]')
    ).toHaveText(`100 km, 1 mitgenommene Person(en) → ${euro(carCents)}`);

    const detailTotals = cardByTitle(employee, "6. Erstattungsbetrag");
    await expect(
      detail(detailTotals, "Verpflegungspauschale (steuerfrei)")
    ).toHaveText(euro(mealCents));
    await expect(detail(detailTotals, "Fahrtkosten Privat-Pkw")).toHaveText(
      euro(carCents)
    );
    await expect(detail(detailTotals, "Gesamterstattung")).toHaveText(
      euro(totalCents)
    );

    const [report] = await db
      .select()
      .from(expenseReports)
      .where(eq(expenseReports.id, id));
    expect(report).toMatchObject({
      status: "eingereicht",
      destination,
      isAbroad: true,
      departureDate: "2027-03-10",
      departureTime: "07:00",
      returnDate: "2027-03-12",
      returnTime: "19:30",
      mealAllowanceCents: mealCents,
      transportCents: 18_990,
      carCents,
      lodgingCents: 24_000,
      incidentalsCents: 1_250,
      totalCents,
    });
    const items = await db
      .select()
      .from(expenseItems)
      .where(eq(expenseItems.reportId, id));
    expect(items.map((i) => i.kind).sort()).toEqual([
      "fahrt",
      "nebenkosten",
      "pkw",
      "uebernachtung",
      "verpflegung",
      "verpflegung",
      "verpflegung",
    ]);
    expect(items.find((i) => i.kind === "pkw")).toMatchObject({
      kilometers: 100,
      passengers: 1,
      netCents: carCents,
    });
  });

  test("Zurückziehen, korrigiert erneut einreichen, erneut zurückziehen und löschen", async ({
    browser,
  }) => {
    const db = testDb();
    const employeeId = await userId(E2E_USER_EMAIL);
    const destination = `Leipzig E2E-${Date.now()}`;
    // Eingereichte Tagesreise Mo 12.04.2027 mit einer Fahrtkosten-Position
    const [report] = await db
      .insert(expenseReports)
      .values({
        userId: employeeId,
        destination,
        customerPurpose: "Messe",
        departureDate: "2027-04-12",
        departureTime: "08:00",
        returnDate: "2027-04-12",
        returnTime: "18:00",
        transportCents: 9_990,
        totalCents: 9_990,
      })
      .returning();
    await db.insert(expenseItems).values({
      reportId: report.id,
      kind: "fahrt",
      position: 0,
      itemDate: "2027-04-12",
      description: "ICE Köln nach Leipzig",
      amountCents: 9_990,
      netCents: 9_990,
    });

    const employee = await open(browser, USER_STATE);
    await employee.goto("/reisekosten");
    await employee.locator(`a[href="/reisekosten/${report.id}"]`).click();
    await expect(employee).toHaveURL(
      new RegExp(`/reisekosten/${report.id}$`),
      { timeout: 30_000 }
    );
    await expect(statusBadge(employee, "Eingereicht")).toBeVisible();

    // 1. Zurückziehen → Korrekturformular mit übernommenen Positionen
    await employee
      .getByRole("button", { name: "Abrechnung zurückziehen" })
      .click();
    await expect(statusBadge(employee, "Zurückgezogen")).toBeVisible();
    const correction = cardByTitle(
      employee,
      "Abrechnung korrigieren und erneut einreichen"
    );
    await expect(correction).toBeVisible();
    const transport = cardByTitle(employee, "3. Fahrtkosten (Beleg beifügen)");
    await expect(belegRows(transport)).toHaveCount(1);
    await expect(belegDescription(belegRows(transport).nth(0))).toHaveValue(
      "ICE Köln nach Leipzig"
    );
    await expect(
      belegRows(transport).nth(0).getByPlaceholder("0,00")
    ).toHaveValue("99,90");

    // 2. Korrektur: Parkgebühr als Reisenebenkosten ergänzen
    const incidentals = cardByTitle(
      employee,
      "5. Reisenebenkosten (Beleg beifügen)"
    );
    const addIncidental = incidentals.getByRole("button", {
      name: "Position hinzufügen",
    });
    await expectHydrated(addIncidental);
    await addIncidental.click();
    await fillBeleg(
      belegRows(incidentals).nth(0),
      "2027-04-12",
      "Parken Messe",
      "8,00"
    );
    await expect(
      detail(cardByTitle(employee, "6. Erstattungsbetrag"), "Gesamterstattung")
    ).toHaveText(euro(10_790));
    await employee
      .getByRole("button", { name: "Korrigiert erneut einreichen" })
      .click();

    await expect(statusBadge(employee, "Eingereicht")).toBeVisible({
      timeout: 30_000,
    });
    await expect(employee.getByText("Version 2", { exact: true })).toBeVisible();
    await expect(
      cardByTitle(employee, "5. Reisenebenkosten").locator("tbody tr")
    ).toContainText("Parken Messe");
    await expect(
      detail(cardByTitle(employee, "6. Erstattungsbetrag"), "Gesamterstattung")
    ).toHaveText(euro(10_790));
    await expect(
      employee.getByText(
        `${destination} (Messe) · 12.04.2027 – 12.04.2027 · Gesamterstattung ${euro(9_990)}`,
        { exact: true }
      )
    ).toBeVisible();

    // 3. Erneut zurückziehen
    await employee
      .getByRole("button", { name: "Abrechnung zurückziehen" })
      .click();
    await expect(statusBadge(employee, "Zurückgezogen")).toBeVisible();

    // 4. Endgültig löschen
    const dialog = employee.getByRole("dialog");
    await openDialog(deleteTrigger(employee), dialog);
    await expect(
      dialog.getByText(
        "Die Reisekostenabrechnung wird mitsamt allen hochgeladenen Belegen unwiderruflich gelöscht. Dieser Schritt kann nicht rückgängig gemacht werden.",
        { exact: true }
      )
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Endgültig löschen" }).click();
    await expect(employee).toHaveURL(/\/reisekosten$/, { timeout: 30_000 });
    await expect(
      employee.locator(`a[href="/reisekosten/${report.id}"]`)
    ).toHaveCount(0);

    expect(
      await db
        .select()
        .from(expenseReports)
        .where(eq(expenseReports.id, report.id))
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(expenseItems)
        .where(eq(expenseItems.reportId, report.id))
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(requestHistory)
        .where(eq(requestHistory.requestId, report.id))
    ).toHaveLength(0);
  });

  test("Beleg hochladen und den Beleg-Link in den Details öffnen", async ({
    browser,
  }) => {
    test.skip(
      !process.env.BLOB_READ_WRITE_TOKEN,
      "BLOB_READ_WRITE_TOKEN nicht gesetzt — Upload-Test wird übersprungen."
    );
    const db = testDb();
    const destination = `Bonn E2E-${Date.now()}`;
    const employee = await open(browser, USER_STATE);

    await employee.goto("/reisekosten");
    await employee.getByRole("button", { name: "Abrechnung erstellen" }).click();
    await expect(employee).toHaveURL(/\/reisekosten\/neu$/, {
      timeout: 30_000,
    });
    const destinationInput = employee.locator(
      'div.space-y-1:has(> label:text-is("Reiseziel (Ort)")) input'
    );
    await expectHydrated(destinationInput);
    await destinationInput.fill(destination);
    await fillByLabelText(employee, "Kunde / Anlass", "Schulung Bundesamt");
    await fillByLabelText(employee, "Abreise: Datum", "2027-05-03");
    await fillByLabelText(employee, "Abreise: Uhrzeit", "08:00");
    await fillByLabelText(employee, "Rückkehr: Datum", "2027-05-03");
    await fillByLabelText(employee, "Rückkehr: Uhrzeit", "18:00");

    // Fahrtkosten-Position mit PDF-Beleg
    const transport = cardByTitle(employee, "3. Fahrtkosten (Beleg beifügen)");
    await transport.getByRole("button", { name: "Position hinzufügen" }).click();
    const row = belegRows(transport).nth(0);
    await fillBeleg(row, "2027-05-03", "Bahnticket mit Beleg", "49,90");
    await row.locator('input[type="file"]').setInputFiles({
      name: "bahnticket.pdf",
      mimeType: "application/pdf",
      buffer: MINI_PDF,
    });
    await employee.getByRole("button", { name: "Abrechnung einreichen" }).click();
    await expect(employee).toHaveURL(/\/reisekosten\/[0-9a-f-]{36}$/, {
      timeout: 30_000,
    });
    const id = employee.url().split("/").pop()!;
    await expect(statusBadge(employee, "Eingereicht")).toBeVisible();
    await expect(employee.getByText(/Beleganzahl: 1 \(/)).toBeVisible();

    const [receipt] = await db
      .select()
      .from(receipts)
      .where(eq(receipts.reportId, id));
    expect(receipt).toMatchObject({
      filename: "bahnticket.pdf",
      contentType: "application/pdf",
    });

    // Beleg-Link in den Details öffnen (neuer Tab) und Inhalt prüfen
    const receiptLink = cardByTitle(employee, "3. Fahrtkosten (Belege)")
      .locator("tbody tr")
      .first()
      .getByRole("link", { name: "bahnticket.pdf" });
    await expect(receiptLink).toHaveAttribute(
      "href",
      `/api/receipts/${receipt.id}`
    );
    await expect(receiptLink).toHaveAttribute("target", "_blank");
    const popupPromise = employee.waitForEvent("popup");
    await receiptLink.click();
    const popup = await popupPromise;
    await popup.close().catch(() => {});

    const res = await fetchHref(employee, receiptLink);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/pdf");
    expect((await res.body()).equals(MINI_PDF)).toBe(true);

    // Aufräumen: zurückziehen und löschen (entfernt auch den Blob)
    await employee
      .getByRole("button", { name: "Abrechnung zurückziehen" })
      .click();
    await expect(statusBadge(employee, "Zurückgezogen")).toBeVisible();
    const dialog = employee.getByRole("dialog");
    await openDialog(deleteTrigger(employee), dialog);
    await dialog.getByRole("button", { name: "Endgültig löschen" }).click();
    await expect(employee).toHaveURL(/\/reisekosten$/, { timeout: 30_000 });
    expect(
      await db.select().from(receipts).where(eq(receipts.reportId, id))
    ).toHaveLength(0);
  });
});
