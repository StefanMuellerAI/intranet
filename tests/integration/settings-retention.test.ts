import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getRetentionReport } from "@/lib/retention";
import { commissionRatesFromSettings, getSettings, ratesFromSettings } from "@/lib/settings";
import * as schema from "../../src/db/schema";
import { resetDb, seedTestData, testDb, type SeedResult } from "../helpers/db";

let seed: SeedResult;

const Y = new Date().getFullYear();

async function insertExpense(departureDate: string, returnDate: string) {
  await testDb().insert(schema.expenseReports).values({
    userId: seed.employee.id,
    destination: "Berlin",
    customerPurpose: "Workshop",
    departureDate,
    departureTime: "08:00",
    returnDate,
    returnTime: "18:00",
  });
}

async function insertSickLeave(startDate: string, endDate: string | null) {
  await testDb().insert(schema.sickLeaves).values({
    userId: seed.employee.id,
    type: "eigene_erkrankung",
    startDate,
    endDate,
  });
}

async function insertVacation(
  startDate: string,
  endDate: string,
  status: schema.RequestStatus = "genehmigt"
) {
  await testDb().insert(schema.vacationRequests).values({
    userId: seed.employee.id,
    startDate,
    endDate,
    days: 1,
    status,
  });
}

async function insertWorkation(startDate: string, endDate: string) {
  await testDb().insert(schema.workationRequests).values({
    userId: seed.employee.id,
    country: "Spanien",
    countryCategory: "eu_ewr_ch",
    city: "Valencia",
    accommodationAddress: "Calle 1",
    startDate,
    endDate,
    workDays: 5,
    timezoneAvailability: "MEZ",
    emergencyContactName: "Erika",
    emergencyContactPhone: "0123",
    visaType: "EU-Bürger",
    insuranceDetails: "EHIC",
    plannedTasks: "Projektarbeit",
    domesticSubstitution: "Team",
  });
}

beforeAll(async () => {
  await resetDb();
  seed = await seedTestData();
});

beforeEach(async () => {
  const db = testDb();
  await db.delete(schema.expenseReports);
  await db.delete(schema.sickLeaves);
  await db.delete(schema.vacationRequests);
  await db.delete(schema.workationRequests);
  await db.delete(schema.settings);
  await db.insert(schema.settings).values({ id: 1 });
});

describe("getSettings", () => {
  it("liefert die vorhandene Einstellungszeile", async () => {
    await testDb()
      .update(schema.settings)
      .set({ rateFullDayCents: 3100, retentionExpenseYears: 10 });
    expect(await getSettings()).toMatchObject({
      id: 1,
      rateFullDayCents: 3100,
      retentionExpenseYears: 10,
    });
  });

  it("legt die Zeile mit Standardwerten an, wenn sie fehlt", async () => {
    await testDb().delete(schema.settings);

    const settings = await getSettings();

    expect(settings).toMatchObject({
      id: 1,
      defaultAnnualVacationDays: 30,
      workationYearlyLimitDays: 30,
      workationConsecutiveLimitDays: 20,
      rateFullDayCents: 2800,
      ratePartialDayCents: 1400,
      rateKmCents: 30,
      employerDailySupplementCents: 0,
      commissionConsultingPercent: 4,
      retentionExpenseYears: 8,
      retentionSickLeaveYears: 5,
      retentionRequestYears: 3,
    });
    expect(await testDb().select().from(schema.settings)).toHaveLength(1);
  });

  it("verträgt gleichzeitige Erstaufrufe ohne doppelte Zeile", async () => {
    await testDb().delete(schema.settings);

    const [a, b] = await Promise.all([getSettings(), getSettings()]);

    expect(a.id).toBe(1);
    expect(b.id).toBe(1);
    expect(await testDb().select().from(schema.settings)).toHaveLength(1);
  });
});

describe("ratesFromSettings", () => {
  it("bildet alle Reisekosten-Sätze ab", async () => {
    const settings = {
      ...(await getSettings()),
      rateFullDayCents: 1,
      ratePartialDayCents: 2,
      rateReductionBreakfastCents: 3,
      rateReductionLunchCents: 4,
      rateReductionDinnerCents: 5,
      rateKmCents: 6,
      ratePassengerKmCents: 7,
      employerDailySupplementCents: 8,
    };
    expect(ratesFromSettings(settings)).toEqual({
      fullDayCents: 1,
      partialDayCents: 2,
      breakfastCents: 3,
      lunchCents: 4,
      dinnerCents: 5,
      kmCents: 6,
      passengerKmCents: 7,
      employerDailySupplementCents: 8,
    });
  });
});

describe("commissionRatesFromSettings", () => {
  it("bildet alle Provisionssätze ab", async () => {
    const settings = {
      ...(await getSettings()),
      commissionHalfDayCents: 11,
      commissionFullDayCents: 22,
      commissionTwoDayCents: 33,
      commissionConsultingPercent: 4.5,
    };
    expect(commissionRatesFromSettings(settings)).toEqual({
      halfDayCents: 11,
      fullDayCents: 22,
      twoDayCents: 33,
      consultingPercent: 4.5,
    });
  });
});

describe("getRetentionReport", () => {
  it("setzt die Stichtage je Kategorie auf den 1.1. von (laufendes Jahr − Frist)", async () => {
    const report = await getRetentionReport(await getSettings());
    expect(report).toEqual({
      cutoffExpenses: `${Y - 8}-01-01`,
      cutoffSickLeaves: `${Y - 5}-01-01`,
      cutoffRequests: `${Y - 3}-01-01`,
      deletableExpenses: 0,
      deletableSickLeaves: 0,
      deletableVacations: 0,
      deletableWorkations: 0,
    });
  });

  it("zählt Reisekosten nach Rückkehrdatum", async () => {
    await insertExpense(`${Y - 9}-12-30`, `${Y - 9}-12-31`); // löschbar
    await insertExpense(`${Y - 9}-12-31`, `${Y - 8}-01-01`); // Rückkehr im Folgejahr
    await insertExpense(`${Y - 8}-06-01`, `${Y - 8}-06-02`);

    expect((await getRetentionReport(await getSettings())).deletableExpenses).toBe(1);
  });

  it("zählt Krankmeldungen nach Beginn — auch über den Jahreswechsel und offene", async () => {
    await insertSickLeave(`${Y - 6}-12-31`, `${Y - 6}-12-31`); // löschbar
    await insertSickLeave(`${Y - 6}-12-28`, `${Y - 5}-01-05`); // löschbar (Beginn zählt)
    await insertSickLeave(`${Y - 7}-03-01`, null); // löschbar (offen, aber alt)
    await insertSickLeave(`${Y - 5}-01-01`, `${Y - 5}-01-02`);

    expect((await getRetentionReport(await getSettings())).deletableSickLeaves).toBe(3);
  });

  it("zählt Urlaub und Workation nach Enddatum, unabhängig vom Status", async () => {
    await insertVacation(`${Y - 4}-12-30`, `${Y - 4}-12-31`); // löschbar
    await insertVacation(`${Y - 4}-12-01`, `${Y - 4}-12-02`, "zurueckgezogen"); // löschbar
    await insertVacation(`${Y - 4}-12-28`, `${Y - 3}-01-02`); // endet im Folgejahr
    await insertVacation(`${Y - 3}-01-01`, `${Y - 3}-01-01`);
    await insertWorkation(`${Y - 5}-05-01`, `${Y - 5}-05-20`); // löschbar
    await insertWorkation(`${Y - 4}-12-20`, `${Y - 3}-01-10`);

    const report = await getRetentionReport(await getSettings());
    expect(report.deletableVacations).toBe(2);
    expect(report.deletableWorkations).toBe(1);
  });

  it("folgt geänderten Fristen", async () => {
    await insertVacation(`${Y - 2}-05-01`, `${Y - 2}-05-02`);
    await insertExpense(`${Y - 3}-05-01`, `${Y - 3}-05-02`);

    const report = await getRetentionReport({
      ...(await getSettings()),
      retentionRequestYears: 1,
      retentionExpenseYears: 2,
      retentionSickLeaveYears: 10,
    });

    expect(report).toMatchObject({
      cutoffRequests: `${Y - 1}-01-01`,
      cutoffExpenses: `${Y - 2}-01-01`,
      cutoffSickLeaves: `${Y - 10}-01-01`,
      deletableVacations: 1,
      deletableExpenses: 1,
    });
  });

  it("weist bei negativer Frist auch laufende Vorgänge als löschbar aus (Folge der fehlenden Validierung)", async () => {
    await insertVacation(`${Y}-01-05`, `${Y}-01-06`);

    const report = await getRetentionReport({
      ...(await getSettings()),
      retentionRequestYears: -2,
    });

    expect(report.cutoffRequests).toBe(`${Y + 2}-01-01`);
    expect(report.deletableVacations).toBe(1);
  });
});
