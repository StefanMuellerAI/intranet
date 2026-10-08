import { randomUUID } from "node:crypto";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { toISODate } from "@/lib/dates";
import { resolveUserFromMcpAuth } from "@/lib/mcp-auth";
import { getMyProfile, getMyRequest, listMyRequests } from "@/lib/requests/query";
import * as schema from "../../src/db/schema";
import { createUser } from "../helpers/actions";
import { resetDb, seedTestData, testDb, type SeedResult } from "../helpers/db";

let seed: SeedResult;

/** AuthInfo, wie sie verifyClerkToken für den MCP-Client liefert */
function authInfo(clerkUserId: unknown): AuthInfo {
  return {
    token: "oauth-test-token",
    clientId: "mcp-client",
    scopes: ["profile", "email"],
    extra: { userId: clerkUserId },
  };
}

/** User mit Clerk-ID anlegen (verknüpftes Konto) */
async function linkedUser(overrides: Partial<typeof schema.users.$inferInsert> = {}) {
  return createUser({ clerkId: `user_mcp_${randomUUID().slice(0, 8)}`, ...overrides });
}

function daysFromToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

const YEAR = new Date().getFullYear();

async function insertVacation(
  userId: string,
  values: Partial<typeof schema.vacationRequests.$inferInsert> = {}
) {
  const [row] = await testDb()
    .insert(schema.vacationRequests)
    .values({
      userId,
      startDate: `${YEAR}-08-03`,
      endDate: `${YEAR}-08-07`,
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
      startDate: `${YEAR}-09-01`,
      endDate: `${YEAR}-09-12`,
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

async function insertExpense(userId: string) {
  const [row] = await testDb()
    .insert(schema.expenseReports)
    .values({
      userId,
      destination: "Berlin",
      customerPurpose: "Kundentermin",
      departureDate: `${YEAR}-09-14`,
      departureTime: "07:00",
      returnDate: `${YEAR}-09-15`,
      returnTime: "20:00",
      totalCents: 12345,
    })
    .returning();
  return row;
}

async function insertCommission(userId: string) {
  const [row] = await testDb()
    .insert(schema.commissionClaims)
    .values({
      userId,
      businessType: "schulung",
      customerType: "bestandskunde",
      customerName: "ACME GmbH",
      orderDate: `${YEAR}-09-10`,
      unit: "tage",
      quantity: 2,
      trainingFormat: "ganztaegig",
      trainingCount: 2,
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
      startDate: `${YEAR}-07-20`,
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
  await db.delete(schema.requestHistory);
  await db.delete(schema.vacationRequests);
  await db.delete(schema.workationRequests);
  await db.delete(schema.expenseReports);
  await db.delete(schema.commissionClaims);
  await db.delete(schema.sickLeaves);
});

describe("resolveUserFromMcpAuth", () => {
  it("liefert den verknüpften aktiven Intranet-User", async () => {
    const user = await linkedUser({ firstName: "Mia", lastName: "Mcp" });
    const resolved = await resolveUserFromMcpAuth(authInfo(user.clerkId));
    expect(resolved).toMatchObject({ id: user.id, email: user.email });
  });

  it("lehnt Aufrufe ohne OAuth-Kontext ab", async () => {
    await expect(resolveUserFromMcpAuth(undefined)).rejects.toThrow(
      "Nicht angemeldet (fehlendes OAuth-Token)."
    );
  });

  it("lehnt einen Token ohne oder mit ungültiger Clerk-User-ID ab", async () => {
    const ohneExtra: AuthInfo = { token: "t", clientId: "c", scopes: [] };
    for (const info of [ohneExtra, authInfo(undefined), authInfo(""), authInfo(42)]) {
      await expect(resolveUserFromMcpAuth(info)).rejects.toThrow(
        "Nicht angemeldet (fehlendes OAuth-Token)."
      );
    }
  });

  it("lehnt Clerk-User ohne Intranet-Konto ab", async () => {
    await expect(
      resolveUserFromMcpAuth(authInfo("user_unbekannt"))
    ).rejects.toThrow(
      "Kein aktives Intranet-Konto für diesen Clerk-User. Bitte zuerst im Browser anmelden."
    );
  });

  it("lehnt deaktivierte Konten ab", async () => {
    const user = await linkedUser({ status: "deaktiviert" });
    await expect(resolveUserFromMcpAuth(authInfo(user.clerkId))).rejects.toThrow(
      "Kein aktives Intranet-Konto für diesen Clerk-User."
    );
  });

  it("sperrt den Zugang vor dem Eintrittsdatum", async () => {
    const user = await linkedUser({ entryDate: "2099-01-04" });
    await expect(resolveUserFromMcpAuth(authInfo(user.clerkId))).rejects.toThrow(
      "Der Zugang ist erst ab dem Eintrittsdatum (04.01.2099) freigeschaltet."
    );
  });

  it("lässt den Zugang ab dem Eintrittstag zu", async () => {
    const heute = await linkedUser({ entryDate: daysFromToday(0) });
    const frueher = await linkedUser({ entryDate: "2020-01-01" });
    expect((await resolveUserFromMcpAuth(authInfo(heute.clerkId))).id).toBe(heute.id);
    expect((await resolveUserFromMcpAuth(authInfo(frueher.clerkId))).id).toBe(frueher.id);
  });
});

describe("getMyProfile", () => {
  it("liefert Stammdaten, Urlaubskonto und Workation-Kontingent des Users", async () => {
    await insertVacation(seed.employee.id, { status: "genehmigt" });
    await insertVacation(seed.employee.id, {
      status: "eingereicht",
      startDate: `${YEAR}-10-05`,
      endDate: `${YEAR}-10-06`,
      days: 2,
    });
    await insertWorkation(seed.employee.id, { status: "genehmigt", workDays: 9 });
    await insertWorkation(seed.employee.id, { status: "eingereicht", workDays: 3 });
    await insertWorkation(seed.employee.id, { status: "beanstandet", workDays: 4 });
    // Fremde Anträge zählen nicht
    await insertVacation(seed.admin.id, { status: "genehmigt" });

    const profile = await getMyProfile(seed.employee);

    expect(profile).toEqual({
      id: seed.employee.id,
      name: "Max Mitarbeiter",
      email: seed.employee.email,
      role: "mitarbeiter",
      vacation: {
        year: YEAR,
        entitlement: 30,
        used: 5,
        pending: 2,
        remaining: 25,
        remainingAfterPending: 23,
      },
      workation: {
        year: YEAR,
        usedDays: 12,
        yearlyLimitDays: 30,
        remainingDays: 18,
        consecutiveLimitDays: 20,
      },
    });
  });

  it("zeigt im Eintrittsjahr nur den vereinbarten Resturlaub", async () => {
    const neu = await createUser({
      entryDate: `${YEAR}-01-01`,
      entryYearVacationDays: 12,
    });
    const profile = await getMyProfile(neu);
    expect(profile.vacation).toMatchObject({ entitlement: 12, remaining: 12 });
  });
});

describe("listMyRequests", () => {
  it("listet nur eigene Anträge aller Arten, neueste zuerst", async () => {
    const v = await insertVacation(seed.employee.id);
    const w = await insertWorkation(seed.employee.id);
    const e = await insertExpense(seed.employee.id);
    const c = await insertCommission(seed.employee.id);
    const s = await insertSickLeave(seed.employee.id);
    await insertVacation(seed.admin.id);
    await insertSickLeave(seed.admin.id);

    const list = await listMyRequests(seed.employee);

    expect(list.map((r) => [r.type, r.id])).toEqual([
      ["sick_leave", s.id],
      ["commission", c.id],
      ["expense", e.id],
      ["workation", w.id],
      ["vacation", v.id],
    ]);
  });

  it("fasst jeden Antrag kurz zusammen", async () => {
    await insertVacation(seed.employee.id);
    await insertWorkation(seed.employee.id);
    await insertExpense(seed.employee.id);
    await insertCommission(seed.employee.id);
    await insertSickLeave(seed.employee.id, { endDate: `${YEAR}-07-22` });

    const byType = Object.fromEntries(
      (await listMyRequests(seed.employee)).map((r) => [r.type, r])
    );

    expect(byType.vacation.summary).toBe(`${YEAR}-08-03–${YEAR}-08-07 (5 Tage)`);
    expect(byType.workation.summary).toBe(
      `Valencia, Spanien · ${YEAR}-09-01–${YEAR}-09-12`
    );
    expect(byType.expense.summary).toBe(
      `Berlin · ${YEAR}-09-14–${YEAR}-09-15 · 123.45 €`
    );
    expect(byType.commission.summary).toBe(
      `ACME GmbH · schulung · ${YEAR}-09-10`
    );
    expect(byType.sick_leave.summary).toBe(
      `eigene_erkrankung ab ${YEAR}-07-20 bis ${YEAR}-07-22`
    );
    expect(byType.vacation).toMatchObject({ status: "eingereicht" });
    expect(byType.vacation.createdAt).toBeInstanceOf(Date);
  });

  it("zeigt eine offene Krankmeldung ohne Enddatum", async () => {
    await insertSickLeave(seed.employee.id, { type: "kind_krank" });
    const [entry] = await listMyRequests(seed.employee);
    expect(entry.summary).toBe(`kind_krank ab ${YEAR}-07-20`);
  });

  it("filtert nach Art und Status", async () => {
    const genehmigt = await insertVacation(seed.employee.id, { status: "genehmigt" });
    await insertVacation(seed.employee.id);
    await insertWorkation(seed.employee.id, { status: "genehmigt" });
    await insertSickLeave(seed.employee.id);

    const urlaub = await listMyRequests(seed.employee, { type: "vacation" });
    expect(urlaub).toHaveLength(2);
    expect(urlaub.every((r) => r.type === "vacation")).toBe(true);

    const genehmigteUrlaube = await listMyRequests(seed.employee, {
      type: "vacation",
      status: "genehmigt",
    });
    expect(genehmigteUrlaube.map((r) => r.id)).toEqual([genehmigt.id]);

    const alleGenehmigten = await listMyRequests(seed.employee, { status: "genehmigt" });
    expect(alleGenehmigten.map((r) => r.type).sort()).toEqual(["vacation", "workation"]);

    expect(
      await listMyRequests(seed.employee, { type: "sick_leave", status: "gemeldet" })
    ).toHaveLength(1);
  });

  it("liefert ohne Anträge eine leere Liste", async () => {
    await insertVacation(seed.admin.id);
    expect(await listMyRequests(seed.employee)).toEqual([]);
  });
});

describe("getMyRequest", () => {
  it("liefert einen eigenen Urlaubsantrag mit Historie dieser Antragsart", async () => {
    const v = await insertVacation(seed.employee.id, { version: 2 });
    await testDb().insert(schema.requestHistory).values([
      { requestType: "urlaub", requestId: v.id, version: 1, snapshot: { days: 3 } },
      // gleiche ID, andere Art — darf nicht erscheinen
      { requestType: "workation", requestId: v.id, version: 1, snapshot: {} },
    ]);

    const result = await getMyRequest(seed.employee, "vacation", v.id);

    expect(result.type).toBe("vacation");
    expect(result.data).toMatchObject({ id: v.id, days: 5, version: 2 });
    expect(result.history).toHaveLength(1);
    expect(result.history[0]).toMatchObject({ version: 1, snapshot: { days: 3 } });
  });

  it("liefert eigene Workations, Provisionen und Krankmeldungen", async () => {
    const w = await insertWorkation(seed.employee.id);
    const c = await insertCommission(seed.employee.id);
    const s = await insertSickLeave(seed.employee.id);
    await testDb().insert(schema.requestHistory).values({
      requestType: "provision",
      requestId: c.id,
      version: 1,
      snapshot: { customerName: "Alt" },
    });

    expect((await getMyRequest(seed.employee, "workation", w.id)).data).toMatchObject({
      city: "Valencia",
    });
    const provision = await getMyRequest(seed.employee, "commission", c.id);
    expect(provision.data).toMatchObject({ customerName: "ACME GmbH" });
    expect(provision.history).toHaveLength(1);
    const krank = await getMyRequest(seed.employee, "sick_leave", s.id);
    expect(krank).toMatchObject({ type: "sick_leave", data: { id: s.id }, history: [] });
  });

  it("liefert eine Reisekostenabrechnung mit Positionen", async () => {
    const e = await insertExpense(seed.employee.id);
    await testDb().insert(schema.expenseItems).values([
      { reportId: e.id, kind: "fahrt", position: 0, description: "Bahn", amountCents: 8900, netCents: 8900 },
      { reportId: e.id, kind: "nebenkosten", position: 1, description: "Parken", amountCents: 1200, netCents: 1200 },
    ]);

    const result = await getMyRequest(seed.employee, "expense", e.id);

    const data = result.data as { id: string; items: { description: string }[] };
    expect(data.id).toBe(e.id);
    expect(data.items.map((i) => i.description).sort()).toEqual(["Bahn", "Parken"]);
    expect(result.history).toEqual([]);
  });

  it("verweigert fremde Anträge wie unbekannte (Eigentümerprüfung)", async () => {
    const v = await insertVacation(seed.admin.id);
    const w = await insertWorkation(seed.admin.id);
    const e = await insertExpense(seed.admin.id);
    const c = await insertCommission(seed.admin.id);
    const s = await insertSickLeave(seed.admin.id);

    await expect(getMyRequest(seed.employee, "vacation", v.id)).rejects.toThrow(
      "Antrag nicht gefunden."
    );
    await expect(getMyRequest(seed.employee, "workation", w.id)).rejects.toThrow(
      "Antrag nicht gefunden."
    );
    await expect(getMyRequest(seed.employee, "expense", e.id)).rejects.toThrow(
      "Abrechnung nicht gefunden."
    );
    await expect(getMyRequest(seed.employee, "commission", c.id)).rejects.toThrow(
      "Anspruch nicht gefunden."
    );
    await expect(getMyRequest(seed.employee, "sick_leave", s.id)).rejects.toThrow(
      "Krankmeldung nicht gefunden."
    );
  });

  it("findet keinen Antrag unter der falschen Antragsart", async () => {
    const v = await insertVacation(seed.employee.id);
    await expect(getMyRequest(seed.employee, "workation", v.id)).rejects.toThrow(
      "Antrag nicht gefunden."
    );
    await expect(getMyRequest(seed.employee, "vacation", randomUUID())).rejects.toThrow(
      "Antrag nicht gefunden."
    );
  });

  it("gilt auch für Admins: kein Zugriff auf fremde Anträge über die eigene Abfrage", async () => {
    const v = await insertVacation(seed.employee.id);
    await expect(getMyRequest(seed.admin, "vacation", v.id)).rejects.toThrow(
      "Antrag nicht gefunden."
    );
  });
});
