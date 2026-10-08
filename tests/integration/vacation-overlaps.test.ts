import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getOverlappingAbsences, getUsedWorkationDays } from "@/lib/vacation";
import * as schema from "../../src/db/schema";
import { createUser } from "../helpers/actions";
import { resetDb, seedTestData, testDb, type SeedResult } from "../helpers/db";

let seed: SeedResult;
let anna: schema.User;
let ben: schema.User;

// Zeitraum des eigenen Antrags: Mo 03.08. – Fr 14.08.2026
const FROM = "2026-08-03";
const TO = "2026-08-14";

async function insertVacation(
  userId: string,
  values: Partial<typeof schema.vacationRequests.$inferInsert> = {}
) {
  const [row] = await testDb()
    .insert(schema.vacationRequests)
    .values({
      userId,
      status: "genehmigt",
      startDate: "2026-08-05",
      endDate: "2026-08-06",
      days: 2,
      ...values,
    })
    .returning();
  return row;
}

async function insertWorkation(
  userId: string,
  values: Partial<typeof schema.workationRequests.$inferInsert> = {}
) {
  const [row] = await testDb()
    .insert(schema.workationRequests)
    .values({
      userId,
      status: "genehmigt",
      country: "Spanien",
      countryCategory: "eu_ewr_ch",
      city: "Valencia",
      accommodationAddress: "Calle Mayor 1",
      startDate: "2026-08-10",
      endDate: "2026-08-21",
      workDays: 10,
      timezoneAvailability: "10–16 Uhr MEZ",
      emergencyContactName: "Erika Muster",
      emergencyContactPhone: "+49 221 123456",
      visaType: "keins",
      insuranceDetails: "Auslandskrankenversicherung XYZ",
      plannedTasks: "Projektarbeit",
      domesticSubstitution: "Erika Admin",
      ...values,
    })
    .returning();
  return row;
}

async function insertSickLeave(
  userId: string,
  values: Partial<typeof schema.sickLeaves.$inferInsert> = {}
) {
  const [row] = await testDb()
    .insert(schema.sickLeaves)
    .values({
      userId,
      type: "eigene_erkrankung",
      status: "abgeschlossen",
      startDate: "2026-08-04",
      endDate: "2026-08-06",
      ...values,
    })
    .returning();
  return row;
}

/** Stabile Reihenfolge für Vergleiche (die DB garantiert keine) */
function sorted<T extends { name: string; type: string; from: string }>(rows: T[]) {
  return [...rows].sort(
    (a, b) =>
      a.type.localeCompare(b.type) ||
      a.name.localeCompare(b.name) ||
      a.from.localeCompare(b.from)
  );
}

beforeAll(async () => {
  await resetDb();
  seed = await seedTestData();
  anna = await createUser({ firstName: "Anna", lastName: "Muster" });
  ben = await createUser({ firstName: "Ben", lastName: "Beispiel" });
});

beforeEach(async () => {
  const db = testDb();
  await db.delete(schema.vacationRequests);
  await db.delete(schema.workationRequests);
  await db.delete(schema.sickLeaves);
});

describe("getOverlappingAbsences", () => {
  it("liefert genehmigte Urlaube anderer, die den Zeitraum berühren oder überdecken", async () => {
    // endet am ersten Tag des Zeitraums
    await insertVacation(anna.id, { startDate: "2026-07-27", endDate: FROM });
    // beginnt am letzten Tag des Zeitraums
    await insertVacation(anna.id, { startDate: TO, endDate: "2026-08-21" });
    // vollständig innerhalb
    await insertVacation(ben.id, { startDate: "2026-08-05", endDate: "2026-08-06" });
    // überdeckt den gesamten Zeitraum
    await insertVacation(seed.admin.id, { startDate: "2026-07-20", endDate: "2026-08-31" });
    // knapp davor / knapp danach — keine Überschneidung
    await insertVacation(ben.id, { startDate: "2026-07-20", endDate: "2026-08-02" });
    await insertVacation(ben.id, { startDate: "2026-08-15", endDate: "2026-08-21" });

    const result = await getOverlappingAbsences(seed.employee.id, FROM, TO);

    expect(sorted(result)).toEqual([
      { name: "Anna Muster", type: "Urlaub", from: "2026-07-27", to: FROM },
      { name: "Anna Muster", type: "Urlaub", from: TO, to: "2026-08-21" },
      { name: "Ben Beispiel", type: "Urlaub", from: "2026-08-05", to: "2026-08-06" },
      { name: "Erika Admin", type: "Urlaub", from: "2026-07-20", to: "2026-08-31" },
    ]);
  });

  it("liefert genehmigte Workations anderer als „Workation“", async () => {
    await insertWorkation(anna.id, { startDate: "2026-08-10", endDate: "2026-08-21" });
    await insertWorkation(ben.id, { startDate: "2026-08-17", endDate: "2026-08-28" });

    const result = await getOverlappingAbsences(seed.employee.id, FROM, TO);

    expect(result).toEqual([
      { name: "Anna Muster", type: "Workation", from: "2026-08-10", to: "2026-08-21" },
    ]);
  });

  it("ignoriert eingereichte, beanstandete, stornierte und zurückgezogene Anträge", async () => {
    for (const status of [
      "eingereicht",
      "beanstandet",
      "storniert",
      "zurueckgezogen",
    ] as const) {
      await insertVacation(anna.id, { status });
      await insertWorkation(ben.id, { status });
    }

    expect(await getOverlappingAbsences(seed.employee.id, FROM, TO)).toEqual([]);
  });

  it("weist Krankmeldungen anderer neutral als „abwesend“ aus — auch Kind krank", async () => {
    await insertSickLeave(anna.id, {
      type: "eigene_erkrankung",
      status: "abgeschlossen",
      startDate: "2026-08-04",
      endDate: "2026-08-06",
    });
    await insertSickLeave(ben.id, {
      type: "kind_krank",
      status: "gemeldet",
      startDate: "2026-08-12",
      endDate: "2026-08-13",
    });

    const result = await getOverlappingAbsences(seed.employee.id, FROM, TO);

    expect(sorted(result)).toEqual([
      { name: "Anna Muster", type: "abwesend", from: "2026-08-04", to: "2026-08-06" },
      { name: "Ben Beispiel", type: "abwesend", from: "2026-08-12", to: "2026-08-13" },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/krank|erkrankung/i);
  });

  it("berücksichtigt offene Krankmeldungen ohne Enddatum, die vor dem Zeitraumende beginnen", async () => {
    // seit vor dem Zeitraum krank, noch nicht gesundgemeldet
    await insertSickLeave(anna.id, {
      status: "gemeldet",
      startDate: "2026-07-30",
      endDate: null,
    });
    // beginnt erst nach dem Zeitraum
    await insertSickLeave(ben.id, {
      status: "gemeldet",
      startDate: "2026-08-17",
      endDate: null,
    });

    const result = await getOverlappingAbsences(seed.employee.id, FROM, TO);

    // Offen bedeutet „bis auf Weiteres“: abwesend bis Zeitraumende
    expect(result).toEqual([
      { name: "Anna Muster", type: "abwesend", from: "2026-07-30", to: TO },
    ]);
  });

  it("ignoriert gemeldete Krankmeldungen, deren Enddatum vor dem Zeitraum liegt", async () => {
    await insertSickLeave(anna.id, {
      status: "gemeldet",
      startDate: "2026-07-27",
      endDate: "2026-07-31",
    });

    expect(await getOverlappingAbsences(seed.employee.id, FROM, TO)).toEqual([]);
  });

  it("zählt Urlaube mit beantragtem Storno bis zur Entscheidung weiter mit", async () => {
    await insertVacation(anna.id, { status: "storno_beantragt" });

    expect(await getOverlappingAbsences(seed.employee.id, FROM, TO)).toEqual([
      { name: "Anna Muster", type: "Urlaub", from: "2026-08-05", to: "2026-08-06" },
    ]);
  });

  it("ignoriert abgeschlossene Krankmeldungen außerhalb des Zeitraums", async () => {
    await insertSickLeave(anna.id, { startDate: "2026-07-01", endDate: "2026-08-02" });
    await insertSickLeave(ben.id, { startDate: "2026-08-15", endDate: "2026-08-20" });

    expect(await getOverlappingAbsences(seed.employee.id, FROM, TO)).toEqual([]);
  });

  it("schließt die anfragende Person selbst aus", async () => {
    await insertVacation(seed.employee.id);
    await insertWorkation(seed.employee.id);
    await insertSickLeave(seed.employee.id, { status: "gemeldet", endDate: null });
    await insertVacation(anna.id);

    const asEmployee = await getOverlappingAbsences(seed.employee.id, FROM, TO);
    expect(asEmployee.map((a) => a.name)).toEqual(["Anna Muster"]);

    // Aus Sicht von Anna erscheinen dagegen die Abwesenheiten von Max
    const asAnna = await getOverlappingAbsences(anna.id, FROM, TO);
    expect(sorted(asAnna).map((a) => [a.name, a.type])).toEqual([
      ["Max Mitarbeiter", "abwesend"],
      ["Max Mitarbeiter", "Urlaub"],
      ["Max Mitarbeiter", "Workation"],
    ]);
  });
});

describe("getUsedWorkationDays", () => {
  it("summiert eingereichte und genehmigte Arbeitstage des Kalenderjahres", async () => {
    await insertWorkation(seed.employee.id, { status: "genehmigt", workDays: 9 });
    await insertWorkation(seed.employee.id, {
      status: "eingereicht",
      startDate: "2026-10-05",
      endDate: "2026-10-09",
      workDays: 4.5,
    });
    for (const status of ["beanstandet", "storniert", "zurueckgezogen"] as const) {
      await insertWorkation(seed.employee.id, { status, workDays: 3 });
    }
    // anderes Jahr und andere Person zählen nicht
    await insertWorkation(seed.employee.id, {
      startDate: "2027-03-01",
      endDate: "2027-03-12",
      workDays: 10,
    });
    await insertWorkation(anna.id, { workDays: 7 });

    expect(await getUsedWorkationDays(seed.employee.id, 2026)).toBe(13.5);
    expect(await getUsedWorkationDays(seed.employee.id, 2027)).toBe(10);
    expect(await getUsedWorkationDays(anna.id, 2026)).toBe(7);
  });

  it("lässt den angegebenen Antrag (z. B. beim Bearbeiten) außen vor", async () => {
    const edited = await insertWorkation(seed.employee.id, { workDays: 9 });
    await insertWorkation(seed.employee.id, {
      status: "eingereicht",
      startDate: "2026-10-05",
      endDate: "2026-10-09",
      workDays: 5,
    });

    expect(await getUsedWorkationDays(seed.employee.id, 2026, edited.id)).toBe(5);
    expect(
      await getUsedWorkationDays(
        seed.employee.id,
        2026,
        "00000000-0000-4000-8000-000000000000"
      )
    ).toBe(14);
  });

  it("liefert 0 ohne Workation-Anträge", async () => {
    expect(await getUsedWorkationDays(seed.employee.id, 2026)).toBe(0);
  });
});
