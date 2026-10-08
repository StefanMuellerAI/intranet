import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as approve } from "@/app/api/v1/requests/[id]/approve/route";
import { POST as reject } from "@/app/api/v1/requests/[id]/reject/route";
import { GET as getRequest } from "@/app/api/v1/requests/[id]/route";
import { GET as listRequests } from "@/app/api/v1/requests/route";
import {
  createExpenseReport,
  resubmitExpenseReportForUser,
  type ExpenseReportInput,
} from "@/lib/requests/expense";
import * as schema from "../../../src/db/schema";
import { auditFor, createUser, testFile } from "../../helpers/actions";
import {
  createTestApiKey,
  resetDb,
  seedTestData,
  testDb,
  type SeedResult,
} from "../../helpers/db";
import { mailsTo } from "../../helpers/framework-fakes";

let seed: SeedResult;
/** Pro Test frische Keys — so greift das Rate Limit (60/min je Key) nie. */
let fullKey: { key: string; id: string };
let readonlyKey: { key: string; id: string };
let websiteKey: { key: string; id: string };

const BASE = "http://localhost/api/v1/requests";

function withKey(key: string | null, url: string, init: RequestInit = {}): Request {
  return new Request(url, {
    ...init,
    headers: {
      ...(key ? { authorization: `Bearer ${key}` } : {}),
      ...(init.headers ?? {}),
    },
  });
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function rejectBody(comment: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ comment }),
  };
}

const EXPENSE: ExpenseReportInput = {
  destination: "Berlin",
  customerPurpose: "Workshop",
  departureDate: "2026-07-01",
  departureTime: "08:00",
  returnDate: "2026-07-02",
  returnTime: "18:00",
  isAbroad: false,
  mealDays: [
    {
      date: "2026-07-01",
      absenceType: "an_abreisetag",
      breakfastProvided: false,
      lunchProvided: false,
      dinnerProvided: false,
    },
  ],
  transport: [{ date: "2026-07-01", description: "Bahn", amountCents: 4590 }],
  carKilometers: 10,
  carPassengers: 0,
  lodging: [
    { date: "2026-07-01", description: "Hotel", amountCents: 9900, fileIndex: 0 },
  ],
  incidentals: [],
};

async function insertVacation(
  userId: string,
  status: schema.RequestStatus = "eingereicht"
) {
  const [row] = await testDb()
    .insert(schema.vacationRequests)
    .values({ userId, status, startDate: "2026-11-02", endDate: "2026-11-06", days: 5 })
    .returning();
  return row.id;
}

async function insertWorkation(
  userId: string,
  status: schema.RequestStatus = "eingereicht"
) {
  const [row] = await testDb()
    .insert(schema.workationRequests)
    .values({
      userId,
      status,
      country: "Spanien",
      countryCategory: "eu_ewr_ch",
      city: "Valencia",
      accommodationAddress: "Calle Mayor 1",
      startDate: "2026-11-02",
      endDate: "2026-11-13",
      workDays: 10,
      timezoneAvailability: "MEZ",
      emergencyContactName: "Erika Muster",
      emergencyContactPhone: "+49 170 0000000",
      visaType: "EU-Bürger",
      insuranceDetails: "EHIC",
      plannedTasks: "Konzeption",
      domesticSubstitution: "Team",
    })
    .returning();
  return row.id;
}

async function insertCommission(
  userId: string,
  status: schema.RequestStatus = "eingereicht"
) {
  const [row] = await testDb()
    .insert(schema.commissionClaims)
    .values({
      userId,
      status,
      businessType: "schulung",
      customerType: "bestandskunde",
      customerName: "Haufe",
      orderDate: "2026-06-15",
      unit: "tage",
      quantity: 1,
      finalAmountCents: 7500,
    })
    .returning();
  return row.id;
}

async function insertExpense(
  userId: string,
  status: schema.RequestStatus = "eingereicht"
) {
  const [row] = await testDb()
    .insert(schema.expenseReports)
    .values({
      userId,
      status,
      destination: "Hamburg",
      customerPurpose: "Messe",
      departureDate: "2026-07-01",
      departureTime: "08:00",
      returnDate: "2026-07-01",
      returnTime: "20:00",
    })
    .returning();
  return row.id;
}

/** Abrechnung über die Fachlogik inkl. Positionen und verschlüsseltem Beleg */
async function createExpenseWithReceipt() {
  return createExpenseReport(seed.employee, EXPENSE, "web", {
    getFile: (i) => (i === 0 ? testFile("hotel.pdf") : null),
  });
}

async function vacationStatus(id: string) {
  const [row] = await testDb()
    .select()
    .from(schema.vacationRequests)
    .where(eq(schema.vacationRequests.id, id));
  return row.status;
}

/** Admin anlegen, Key erzeugen und den Admin danach herabstufen */
async function keyOfDemotedAdmin(): Promise<string> {
  const formerAdmin = await createUser({ role: "admin" });
  const { key } = await createTestApiKey(formerAdmin.id, "Ex-Admin");
  await testDb()
    .update(schema.users)
    .set({ role: "mitarbeiter" })
    .where(eq(schema.users.id, formerAdmin.id));
  return key;
}

beforeAll(async () => {
  await resetDb();
  seed = await seedTestData();
});

beforeEach(async () => {
  const db = testDb();
  await db.delete(schema.requestHistory);
  await db.delete(schema.receipts);
  await db.delete(schema.expenseItems);
  await db.delete(schema.expenseReports);
  await db.delete(schema.vacationRequests);
  await db.delete(schema.workationRequests);
  await db.delete(schema.commissionClaims);
  fullKey = await createTestApiKey(seed.admin.id, "Voll");
  readonlyKey = await createTestApiKey(seed.admin.id, "Nur lesen", "readonly");
  websiteKey = await createTestApiKey(seed.admin.id, "Website", "website");
});

describe("GET /api/v1/requests", () => {
  it("akzeptiert readonly-Keys", async () => {
    const id = await insertVacation(seed.employee.id);
    const res = await listRequests(withKey(readonlyKey.key, BASE));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requests.map((r: { id: string }) => r.id)).toEqual([id]);
  });

  it("lehnt Keys ab, deren Ersteller kein Admin mehr ist (401)", async () => {
    const res = await listRequests(withKey(await keyOfDemotedAdmin(), BASE));
    expect(res.status).toBe(401);
    expect((await res.json()).fehler).toContain("nicht mehr berechtigt");
  });

  it("liefert ohne Parameter alle offenen Anträge aller Typen inkl. Storno-Anträge", async () => {
    const vacation = await insertVacation(seed.employee.id);
    const storno = await insertVacation(seed.employee.id, "storno_beantragt");
    await insertVacation(seed.employee.id, "genehmigt");
    const workation = await insertWorkation(seed.employee.id);
    const commission = await insertCommission(seed.employee.id);
    const expense = await insertExpense(seed.employee.id);
    await insertExpense(seed.employee.id, "beanstandet");

    const res = await listRequests(withKey(fullKey.key, BASE));
    const body = await res.json();
    const byId = Object.fromEntries(
      body.requests.map((r: { id: string; type: string; status: string }) => [
        r.id,
        `${r.type}:${r.status}`,
      ])
    );
    expect(byId).toEqual({
      [vacation]: "vacation:eingereicht",
      [storno]: "vacation:storno_beantragt",
      [workation]: "workation:eingereicht",
      [commission]: "commission:eingereicht",
      [expense]: "expense:eingereicht",
    });
  });

  it.each([
    ["approved", "genehmigt"],
    ["rejected", "beanstandet"],
    ["withdrawn", "zurueckgezogen"],
    ["storniert", "storniert"],
  ] as const)("bildet status=%s auf den Status %s ab", async (param, status) => {
    const all: schema.RequestStatus[] = [
      "eingereicht",
      "genehmigt",
      "beanstandet",
      "zurueckgezogen",
      "storniert",
    ];
    for (const s of all) {
      await insertVacation(seed.employee.id, s);
      await insertWorkation(seed.employee.id, s);
      await insertCommission(seed.employee.id, s);
      await insertExpense(seed.employee.id, s);
    }

    const res = await listRequests(withKey(fullKey.key, `${BASE}?status=${param}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requests).toHaveLength(4);
    expect(
      body.requests.every((r: { status: string }) => r.status === status)
    ).toBe(true);
    expect(body.requests.map((r: { type: string }) => r.type).sort()).toEqual([
      "commission",
      "expense",
      "vacation",
      "workation",
    ]);
  });

  it("liefert Reisekosten mit Positionen in Reihenfolge und Personendaten", async () => {
    const report = await createExpenseWithReceipt();
    await insertVacation(seed.employee.id);

    const res = await listRequests(withKey(fullKey.key, `${BASE}?type=expense`));
    const body = await res.json();
    expect(body.requests).toHaveLength(1);
    const [entry] = body.requests;
    expect(entry).toMatchObject({
      id: report.id,
      type: "expense",
      status: "eingereicht",
      user: {
        id: seed.employee.id,
        name: "Max Mitarbeiter",
        email: seed.employee.email,
      },
      data: {
        destination: "Berlin",
        totalCents: report.totalCents,
      },
    });
    expect(
      entry.data.items.map((i: { kind: string; position: number }) => [i.kind, i.position])
    ).toEqual([
      ["verpflegung", 0],
      ["fahrt", 1],
      ["uebernachtung", 2],
      ["pkw", 3],
    ]);
    // Die Liste enthält keine Belege (und damit auch keine Blob-URLs)
    expect(JSON.stringify(body)).not.toContain("belege/");
  });
});

describe("GET /api/v1/requests/{id}", () => {
  it("verlangt einen gültigen API-Key (401)", async () => {
    const id = await insertVacation(seed.employee.id);
    for (const key of [null, "sk_test_unbekannt"]) {
      const res = await getRequest(withKey(key, `${BASE}/${id}`), ctx(id));
      expect(res.status).toBe(401);
    }
    const res = await getRequest(withKey(await keyOfDemotedAdmin(), `${BASE}/${id}`), ctx(id));
    expect(res.status).toBe(401);
  });

  it("akzeptiert readonly-Keys", async () => {
    const id = await insertWorkation(seed.employee.id);
    const res = await getRequest(withKey(readonlyKey.key, `${BASE}/${id}`), ctx(id));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id, type: "workation", history: [] });
  });

  it("liefert Provisionen mit Typ commission", async () => {
    const id = await insertCommission(seed.employee.id);
    const res = await getRequest(withKey(fullKey.key, `${BASE}/${id}`), ctx(id));
    expect(await res.json()).toMatchObject({
      id,
      type: "commission",
      status: "eingereicht",
      data: { customerName: "Haufe", finalAmountCents: 7500 },
    });
  });

  it("liefert Reisekosten mit Positionen und Belegen ohne Blob-URL", async () => {
    const report = await createExpenseWithReceipt();
    const [receipt] = await testDb()
      .select()
      .from(schema.receipts)
      .where(eq(schema.receipts.reportId, report.id));

    const res = await getRequest(withKey(fullKey.key, `${BASE}/${report.id}`), ctx(report.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      id: report.id,
      type: "expense",
      status: "eingereicht",
      user: { email: seed.employee.email },
      data: {
        destination: "Berlin",
        lodgingCents: 9900,
        belege: [{ id: receipt.id, dateiname: "hotel.pdf" }],
      },
      history: [],
    });
    expect(body.data.items).toHaveLength(4);
    expect(body.data.items[2]).toMatchObject({
      kind: "uebernachtung",
      description: "Hotel",
      amountCents: 9900,
    });
    expect(Object.keys(body.data.belege[0]).sort()).toEqual(["dateiname", "id"]);
    expect(JSON.stringify(body)).not.toContain(receipt.blobUrl);
  });

  it("liefert die Historie früherer Versionen", async () => {
    const report = await createExpenseWithReceipt();
    await testDb()
      .update(schema.expenseReports)
      .set({ status: "beanstandet" })
      .where(eq(schema.expenseReports.id, report.id));
    await resubmitExpenseReportForUser(seed.employee, report.id, {
      ...EXPENSE,
      destination: "München",
      lodging: [],
    });

    const res = await getRequest(withKey(fullKey.key, `${BASE}/${report.id}`), ctx(report.id));
    const body = await res.json();
    expect(body.status).toBe("eingereicht");
    expect(body.data).toMatchObject({ destination: "München", version: 2 });
    expect(body.history).toHaveLength(1);
    expect(body.history[0]).toMatchObject({
      version: 1,
      snapshot: { destination: "Berlin", status: "beanstandet" },
    });
    expect(body.history[0].snapshot.items).toHaveLength(4);
    expect(typeof body.history[0].erstellt).toBe("string");
  });
});

describe("POST /api/v1/requests/{id}/approve", () => {
  it("verlangt einen gültigen API-Key (401)", async () => {
    const id = await insertVacation(seed.employee.id);
    const init = { method: "POST" };
    expect((await approve(withKey(null, `${BASE}/${id}/approve`, init), ctx(id))).status).toBe(401);
    expect(
      (await approve(withKey(await keyOfDemotedAdmin(), `${BASE}/${id}/approve`, init), ctx(id)))
        .status
    ).toBe(401);
    expect(await vacationStatus(id)).toBe("eingereicht");
  });

  it("lehnt Website-Keys ab (403)", async () => {
    const id = await insertVacation(seed.employee.id);
    const res = await approve(
      withKey(websiteKey.key, `${BASE}/${id}/approve`, { method: "POST" }),
      ctx(id)
    );
    expect(res.status).toBe(403);
    expect(await vacationStatus(id)).toBe("eingereicht");
  });

  it("bestätigt einen Storno per API → storniert", async () => {
    const id = await insertVacation(seed.employee.id, "storno_beantragt");
    const res = await approve(
      withKey(fullKey.key, `${BASE}/${id}/approve`, { method: "POST" }),
      ctx(id)
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id, status: "storniert" });
    expect((await auditFor("urlaub", id))[0]).toMatchObject({
      action: "storno_bestaetigt",
      source: "api",
      apiKeyId: fullKey.id,
      actorUserId: seed.admin.id,
    });
    expect(mailsTo(seed.employee.email)[0].subject).toBe("Urlaubs-Storno bestätigt");
  });

  it("genehmigt Workations per API", async () => {
    const id = await insertWorkation(seed.employee.id);
    const res = await approve(
      withKey(fullKey.key, `${BASE}/${id}/approve`, { method: "POST" }),
      ctx(id)
    );
    expect(await res.json()).toEqual({ id, status: "genehmigt" });
    expect((await auditFor("workation", id))[0]).toMatchObject({
      action: "genehmigt",
      source: "api",
      apiKeyId: fullKey.id,
    });
  });

  it("genehmigt Reisekosten per API und benachrichtigt die antragstellende Person", async () => {
    const report = await createExpenseWithReceipt();
    const res = await approve(
      withKey(fullKey.key, `${BASE}/${report.id}/approve`, { method: "POST" }),
      ctx(report.id)
    );
    expect(await res.json()).toEqual({ id: report.id, status: "genehmigt" });
    const [row] = await testDb()
      .select()
      .from(schema.expenseReports)
      .where(eq(schema.expenseReports.id, report.id));
    expect(row).toMatchObject({ status: "genehmigt", decidedById: seed.admin.id });
    expect((await auditFor("reisekosten", report.id))[0]).toMatchObject({
      action: "genehmigt",
      source: "api",
    });
    expect(mailsTo(seed.employee.email)[0].subject).toBe(
      "Reisekostenabrechnung genehmigt"
    );
  });
});

describe("POST /api/v1/requests/{id}/reject", () => {
  it.each([123, ["a"], { text: "x" }])(
    "antwortet bei Kommentar %j (kein Text) mit 400",
    async (comment) => {
      const id = await insertVacation(seed.employee.id);
      const res = await reject(
        withKey(fullKey.key, `${BASE}/${id}/reject`, rejectBody(comment)),
        ctx(id)
      );
      expect(res.status).toBe(400);
      expect(await vacationStatus(id)).toBe("eingereicht");
    }
  );

  it("verlangt einen gültigen API-Key (401)", async () => {
    const id = await insertVacation(seed.employee.id);
    expect(
      (await reject(withKey(null, `${BASE}/${id}/reject`, rejectBody("x")), ctx(id))).status
    ).toBe(401);
    expect(
      (
        await reject(
          withKey(await keyOfDemotedAdmin(), `${BASE}/${id}/reject`, rejectBody("x")),
          ctx(id)
        )
      ).status
    ).toBe(401);
    expect(await vacationStatus(id)).toBe("eingereicht");
  });

  it.each(["readonly", "website"] as const)("lehnt %s-Keys ab (403)", async (scope) => {
    const id = await insertVacation(seed.employee.id);
    const key = scope === "readonly" ? readonlyKey.key : websiteKey.key;
    const res = await reject(
      withKey(key, `${BASE}/${id}/reject`, rejectBody("Bitte korrigieren")),
      ctx(id)
    );
    expect(res.status).toBe(403);
    expect(await vacationStatus(id)).toBe("eingereicht");
    expect(await auditFor("urlaub", id)).toHaveLength(0);
  });

  it("liefert 404 für unbekannte Vorgänge", async () => {
    const id = randomUUID();
    const res = await reject(
      withKey(fullKey.key, `${BASE}/${id}/reject`, rejectBody("Grund")),
      ctx(id)
    );
    expect(res.status).toBe(404);
    expect((await res.json()).fehler).toBe("Vorgang nicht gefunden.");
  });

  it("prüft den Pflichtkommentar vor der Suche nach dem Vorgang", async () => {
    const id = randomUUID();
    const res = await reject(
      withKey(fullKey.key, `${BASE}/${id}/reject`, rejectBody("")),
      ctx(id)
    );
    expect(res.status).toBe(400);
  });

  it.each([
    ["ungültiges JSON", "{kein json"],
    ["leerer Body", ""],
    ["JSON null", "null"],
    ["Kommentar nur aus Leerzeichen", JSON.stringify({ comment: "   " })],
  ])("antwortet bei %s mit 400", async (_label, body) => {
    const id = await insertVacation(seed.employee.id);
    const res = await reject(
      withKey(fullKey.key, `${BASE}/${id}/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      }),
      ctx(id)
    );
    expect(res.status).toBe(400);
    expect((await res.json()).fehler).toBe(
      "Eine Beanstandung erfordert einen Kommentar (comment)."
    );
    expect(await vacationStatus(id)).toBe("eingereicht");
  });

  it("verweigert die Beanstandung eigener Anträge (400, Vier-Augen-Prinzip)", async () => {
    const id = await insertVacation(seed.admin.id);
    const res = await reject(
      withKey(fullKey.key, `${BASE}/${id}/reject`, rejectBody("selbst")),
      ctx(id)
    );
    expect(res.status).toBe(400);
    expect((await res.json()).fehler).toContain("Vier-Augen-Prinzip");
    expect(await vacationStatus(id)).toBe("eingereicht");
  });

  it("lehnt nicht offene Vorgänge ab (400)", async () => {
    const id = await insertWorkation(seed.employee.id, "zurueckgezogen");
    const res = await reject(
      withKey(fullKey.key, `${BASE}/${id}/reject`, rejectBody("zu spät")),
      ctx(id)
    );
    expect(res.status).toBe(400);
    expect((await res.json()).fehler).toBe(
      "Antrag ist nicht offen (Status: zurueckgezogen)."
    );
  });

  it("beanstandet Reisekosten per API und protokolliert Key und Kommentar", async () => {
    const id = await insertExpense(seed.employee.id);
    const res = await reject(
      withKey(fullKey.key, `${BASE}/${id}/reject`, rejectBody("Beleg fehlt")),
      ctx(id)
    );
    expect(await res.json()).toEqual({ id, status: "beanstandet" });
    expect((await auditFor("reisekosten", id))[0]).toMatchObject({
      action: "beanstandet",
      source: "api",
      apiKeyId: fullKey.id,
      details: { kommentar: "Beleg fehlt" },
    });
    expect(mailsTo(seed.employee.email)[0].subject).toBe(
      "Reisekostenabrechnung beanstandet"
    );
  });
});
