import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listOpenApprovals, OPEN_APPROVAL_STATUSES } from "@/lib/approvals";
import * as schema from "../../src/db/schema";
import { createUser } from "../helpers/actions";
import { resetDb, seedTestData, testDb, type SeedResult } from "../helpers/db";

let seed: SeedResult;

/** Feste Zeitpunkte, damit die Sortierung über alle Antragsarten prüfbar ist */
function at(day: number): Date {
  return new Date(`2026-09-${String(day).padStart(2, "0")}T08:00:00.000Z`);
}

async function insertVacation(
  userId: string,
  values: Partial<typeof schema.vacationRequests.$inferInsert> = {}
) {
  const [row] = await testDb()
    .insert(schema.vacationRequests)
    .values({
      userId,
      startDate: "2026-08-03",
      endDate: "2026-08-07",
      days: 5,
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
      country: "Spanien",
      countryCategory: "eu_ewr_ch",
      city: "Valencia",
      accommodationAddress: "Calle Mayor 1",
      startDate: "2026-09-01",
      endDate: "2026-09-12",
      workDays: 9,
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

async function insertExpense(
  userId: string,
  values: Partial<typeof schema.expenseReports.$inferInsert> = {}
) {
  const [row] = await testDb()
    .insert(schema.expenseReports)
    .values({
      userId,
      destination: "Berlin",
      customerPurpose: "Kundentermin ACME",
      departureDate: "2026-09-14",
      departureTime: "07:00",
      returnDate: "2026-09-14",
      returnTime: "20:00",
      totalCents: 12345,
      ...values,
    })
    .returning();
  return row;
}

async function insertCommission(
  userId: string,
  values: Partial<typeof schema.commissionClaims.$inferInsert> = {}
) {
  const [row] = await testDb()
    .insert(schema.commissionClaims)
    .values({
      userId,
      businessType: "schulung",
      customerType: "bestandskunde",
      customerName: "ACME GmbH",
      orderDate: "2026-09-10",
      unit: "tage",
      quantity: 2,
      trainingFormat: "ganztaegig",
      trainingCount: 2,
      finalAmountCents: 15000,
      ...values,
    })
    .returning();
  return row;
}

beforeAll(async () => {
  await resetDb();
  seed = await seedTestData();
});

beforeEach(async () => {
  const db = testDb();
  await db.delete(schema.vacationRequests);
  await db.delete(schema.workationRequests);
  await db.delete(schema.expenseReports);
  await db.delete(schema.commissionClaims);
});

describe("listOpenApprovals", () => {
  it("liefert ohne offene Anträge eine leere Liste", async () => {
    await insertVacation(seed.employee.id, { status: "genehmigt" });
    expect(await listOpenApprovals()).toEqual([]);
  });

  it("enthält alle vier Antragsarten inkl. Provision mit Link zur Freigabe", async () => {
    const vacation = await insertVacation(seed.employee.id, { createdAt: at(1) });
    const workation = await insertWorkation(seed.employee.id, { createdAt: at(2) });
    const expense = await insertExpense(seed.employee.id, { createdAt: at(3) });
    const commission = await insertCommission(seed.employee.id, { createdAt: at(4) });

    const open = await listOpenApprovals();

    expect(open.map((o) => [o.type, o.typeLabel, o.id, o.href])).toEqual([
      ["urlaub", "Urlaub", vacation.id, `/freigaben/urlaub/${vacation.id}`],
      ["workation", "Workation", workation.id, `/freigaben/workation/${workation.id}`],
      ["reisekosten", "Reisekosten", expense.id, `/freigaben/reisekosten/${expense.id}`],
      ["provision", "Provision", commission.id, `/freigaben/provision/${commission.id}`],
    ]);
    expect(open.every((o) => o.user === "Max Mitarbeiter")).toBe(true);
    expect(open.every((o) => o.status === "eingereicht")).toBe(true);
  });

  it("berücksichtigt nur eingereichte Anträge und beantragte Stornos", async () => {
    expect([...OPEN_APPROVAL_STATUSES]).toEqual(["eingereicht", "storno_beantragt"]);

    const storno = await insertVacation(seed.employee.id, { status: "storno_beantragt" });
    const offen = await insertCommission(seed.employee.id);
    for (const status of [
      "genehmigt",
      "beanstandet",
      "storniert",
      "zurueckgezogen",
    ] as const) {
      await insertVacation(seed.employee.id, { status });
      await insertWorkation(seed.employee.id, { status });
      await insertExpense(seed.employee.id, { status });
      await insertCommission(seed.employee.id, { status });
    }

    const open = await listOpenApprovals();

    expect(open.map((o) => o.id).sort()).toEqual([storno.id, offen.id].sort());
    expect(open.find((o) => o.id === storno.id)?.status).toBe("storno_beantragt");
  });

  it("sortiert über alle Antragsarten hinweg älteste zuerst", async () => {
    const c = await insertCommission(seed.employee.id, { createdAt: at(1) });
    const v2 = await insertVacation(seed.employee.id, { createdAt: at(5) });
    const e = await insertExpense(seed.employee.id, { createdAt: at(3) });
    const w = await insertWorkation(seed.employee.id, { createdAt: at(2) });
    const v1 = await insertVacation(seed.employee.id, { createdAt: at(4) });

    const open = await listOpenApprovals();

    expect(open.map((o) => o.id)).toEqual([c.id, w.id, e.id, v1.id, v2.id]);
    expect(open[0].createdAt).toEqual(at(1));
  });

  it("zeigt die Namen der jeweiligen Antragsteller/innen", async () => {
    const vera = await createUser({ firstName: "Vera", lastName: "Vertrieb" });
    await insertVacation(seed.employee.id, { createdAt: at(1) });
    await insertCommission(vera.id, { createdAt: at(2) });

    const open = await listOpenApprovals();
    expect(open.map((o) => o.user)).toEqual(["Max Mitarbeiter", "Vera Vertrieb"]);
  });

  it("fasst jede Antragsart lesbar zusammen", async () => {
    await insertVacation(seed.employee.id, { createdAt: at(1) });
    await insertWorkation(seed.employee.id, { createdAt: at(2) });
    await insertExpense(seed.employee.id, { createdAt: at(3) });
    await insertCommission(seed.employee.id, { createdAt: at(4) });
    await insertCommission(seed.employee.id, {
      createdAt: at(5),
      businessType: "beratung",
      customerType: "neukunde",
      customerName: "Neu AG",
      trainingFormat: null,
      trainingCount: null,
      netOrderValueCents: 1_000_000,
      finalAmountCents: null,
    });

    const summaries = (await listOpenApprovals()).map((o) => o.summary);

    expect(summaries[0]).toBe("03.08.2026 – 07.08.2026 (5 Tage)");
    expect(summaries[1]).toBe("Valencia, Spanien · 01.09.2026 – 12.09.2026 (9 AT)");
    expect(summaries[2]).toMatch(/^Berlin \(Kundentermin ACME\) · 123,45\s€$/);
    expect(summaries[3]).toMatch(
      /^Schulung · ACME GmbH \(Bestandskunde\) · 150,00\s€$/
    );
    expect(summaries[4]).toBe(
      "Beratung · Neu AG (Neukunde) · Betrag individuell"
    );
  });
});
