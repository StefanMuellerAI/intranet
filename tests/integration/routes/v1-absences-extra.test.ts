import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as listAbsences } from "@/app/api/v1/absences/route";
import * as schema from "../../../src/db/schema";
import {
  createTestApiKey,
  resetDb,
  seedTestData,
  testDb,
  type SeedResult,
} from "../../helpers/db";

let seed: SeedResult;

function absencesRequest(key: string): Request {
  return new Request("http://localhost/api/v1/absences", {
    headers: { authorization: `Bearer ${key}` },
  });
}

async function insertVacation(
  status: schema.RequestStatus,
  values: Partial<typeof schema.vacationRequests.$inferInsert> = {}
) {
  const [row] = await testDb()
    .insert(schema.vacationRequests)
    .values({
      userId: seed.employee.id,
      status,
      startDate: "2026-08-03",
      endDate: "2026-08-07",
      days: 5,
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
  await db.delete(schema.sickLeaves);
  // Die Route loggt jeden Key-Zugriff — im Test nur Rauschen
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/v1/absences", () => {
  it("liefert Urlaube mit beantragtem Storno als weiterhin bestehende Abwesenheit", async () => {
    const { key } = await createTestApiKey(seed.admin.id, "Storno");
    const genehmigt = await insertVacation("genehmigt");
    const storno = await insertVacation("storno_beantragt", {
      startDate: "2026-09-07",
      endDate: "2026-09-08",
      days: 2,
    });
    for (const status of [
      "eingereicht",
      "beanstandet",
      "storniert",
      "zurueckgezogen",
    ] as const) {
      await insertVacation(status);
    }

    const res = await listAbsences(absencesRequest(key));

    expect(res.status).toBe(200);
    const { absences } = await res.json();
    expect(absences).toHaveLength(2);
    expect(absences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "vacation", von: genehmigt.startDate, status: "genehmigt" }),
        {
          type: "vacation",
          user: {
            id: seed.employee.id,
            name: "Max Mitarbeiter",
            email: seed.employee.email,
          },
          von: storno.startDate,
          bis: storno.endDate,
          tage: 2,
          status: "storno_beantragt",
        },
      ])
    );
  });

  it("liefert offene und abgeschlossene Krankmeldungen", async () => {
    const { key } = await createTestApiKey(seed.admin.id, "Krank");
    await testDb().insert(schema.sickLeaves).values([
      { userId: seed.employee.id, type: "eigene_erkrankung", startDate: "2026-07-20" },
      {
        userId: seed.employee.id,
        type: "kind_krank",
        startDate: "2026-06-01",
        endDate: "2026-06-03",
        status: "abgeschlossen",
      },
    ]);

    const { absences } = await (await listAbsences(absencesRequest(key))).json();

    expect(
      absences.map((a: { status: string; bis: string | null }) => [a.status, a.bis]).sort()
    ).toEqual([
      ["abgeschlossen", "2026-06-03"],
      ["gemeldet", null],
    ]);
  });

  it("antwortet nach 60 Anfragen pro Minute mit 429", async () => {
    const { key, id } = await createTestApiKey(seed.admin.id, "Rate-Limit", "readonly");

    for (let i = 1; i <= 60; i++) {
      const res = await listAbsences(absencesRequest(key));
      expect(res.status, `Anfrage ${i}`).toBe(200);
    }

    const res = await listAbsences(absencesRequest(key));
    expect(res.status).toBe(429);
    expect((await res.json()).fehler).toBe(
      "Rate Limit erreicht (60 Anfragen pro Minute)."
    );

    const [row] = await testDb()
      .select()
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.id, id));
    // Die abgewiesene Anfrage zählt nicht weiter hoch
    expect(row.rateWindowCount).toBe(60);
  });

  it("hält das Limit auch bei parallelen Anfragen", async () => {
    const { key, id } = await createTestApiKey(seed.admin.id, "Parallel", "readonly");
    const responses = await Promise.all(
      Array.from({ length: 80 }, () => listAbsences(absencesRequest(key)))
    );
    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(60);
    expect(statuses.filter((s) => s === 429)).toHaveLength(20);

    const [row] = await testDb()
      .select()
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.id, id));
    expect(row.rateWindowCount).toBe(60);
  });

  it("lässt andere Keys vom Rate Limit eines Keys unberührt", async () => {
    const { id: erschoepft } = await createTestApiKey(seed.admin.id, "Erschöpft");
    await testDb()
      .update(schema.apiKeys)
      .set({ rateWindowStart: new Date(), rateWindowCount: 60 })
      .where(eq(schema.apiKeys.id, erschoepft));
    const { key: frisch } = await createTestApiKey(seed.admin.id, "Frisch");

    expect((await listAbsences(absencesRequest(frisch))).status).toBe(200);
  });
});
