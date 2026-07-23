import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { GET as getRequest } from "@/app/api/v1/requests/[id]/route";
import { POST as approve } from "@/app/api/v1/requests/[id]/approve/route";
import { POST as reject } from "@/app/api/v1/requests/[id]/reject/route";
import { GET as listRequests } from "@/app/api/v1/requests/route";
import {
  auditLog,
  commissionClaims,
  vacationRequests,
} from "../../src/db/schema";
import {
  createTestApiKey,
  resetDb,
  seedTestData,
  testDb,
  type SeedResult,
} from "../helpers/db";

let seed: SeedResult;
let apiKey: string;

function authed(url: string, init?: RequestInit): Request {
  return new Request(url, {
    ...init,
    headers: { authorization: `Bearer ${apiKey}`, ...(init?.headers ?? {}) },
  });
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function insertVacation(userId: string) {
  const [row] = await testDb()
    .insert(vacationRequests)
    .values({
      userId,
      startDate: "2026-09-07",
      endDate: "2026-09-11",
      days: 5,
    })
    .returning();
  return row;
}

beforeAll(async () => {
  await resetDb();
  seed = await seedTestData();
  ({ key: apiKey } = await createTestApiKey(seed.admin.id));
});

describe("GET /api/v1/requests", () => {
  it("listet offene Anträge mit User-Infos und Formulardaten", async () => {
    const vacation = await insertVacation(seed.employee.id);

    const res = await listRequests(
      authed("http://localhost/api/v1/requests?status=pending")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const entry = body.requests.find((r: { id: string }) => r.id === vacation.id);
    expect(entry).toMatchObject({
      type: "vacation",
      status: "eingereicht",
      user: { email: seed.employee.email },
    });
    expect(entry.data.days).toBe(5);
  });

  it("filtert nach Typ", async () => {
    const res = await listRequests(
      authed("http://localhost/api/v1/requests?status=pending&type=commission")
    );
    const body = await res.json();
    expect(
      body.requests.every((r: { type: string }) => r.type === "commission")
    ).toBe(true);
  });
});

describe("GET /api/v1/requests/{id}", () => {
  it("liefert den Einzelvorgang inkl. Historie", async () => {
    const vacation = await insertVacation(seed.employee.id);
    const res = await getRequest(
      authed(`http://localhost/api/v1/requests/${vacation.id}`),
      ctx(vacation.id)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.type).toBe("vacation");
    expect(body.user.email).toBe(seed.employee.email);
    expect(body.history).toEqual([]);
  });

  it("liefert 404 für unbekannte IDs", async () => {
    const res = await getRequest(
      authed(`http://localhost/api/v1/requests/${randomUUID()}`),
      ctx(randomUUID())
    );
    expect(res.status).toBe(404);
  });
});

describe("POST /api/v1/requests/{id}/approve", () => {
  it("genehmigt einen offenen Antrag und schreibt einen API-Audit-Eintrag", async () => {
    const vacation = await insertVacation(seed.employee.id);
    const res = await approve(
      authed(`http://localhost/api/v1/requests/${vacation.id}/approve`, {
        method: "POST",
      }),
      ctx(vacation.id)
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: vacation.id, status: "genehmigt" });

    const [updated] = await testDb()
      .select()
      .from(vacationRequests)
      .where(eq(vacationRequests.id, vacation.id));
    expect(updated.status).toBe("genehmigt");
    expect(updated.decidedById).toBe(seed.admin.id);

    const audits = await testDb()
      .select()
      .from(auditLog)
      .where(eq(auditLog.objectId, vacation.id));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "genehmigt", source: "api" });
  });

  it("verweigert die Genehmigung eigener Anträge (Vier-Augen-Prinzip)", async () => {
    const ownRequest = await insertVacation(seed.admin.id);
    const res = await approve(
      authed(`http://localhost/api/v1/requests/${ownRequest.id}/approve`, {
        method: "POST",
      }),
      ctx(ownRequest.id)
    );
    expect(res.status).toBe(400);
    expect((await res.json()).fehler).toContain("Vier-Augen-Prinzip");
  });

  it("lehnt bereits entschiedene Anträge ab", async () => {
    const vacation = await insertVacation(seed.employee.id);
    await testDb()
      .update(vacationRequests)
      .set({ status: "genehmigt" })
      .where(eq(vacationRequests.id, vacation.id));

    const res = await approve(
      authed(`http://localhost/api/v1/requests/${vacation.id}/approve`, {
        method: "POST",
      }),
      ctx(vacation.id)
    );
    expect(res.status).toBe(400);
    expect((await res.json()).fehler).toContain("nicht offen");
  });

  it("verweigert Provisions-Genehmigung ohne gepflegten finalen Betrag", async () => {
    const [claim] = await testDb()
      .insert(commissionClaims)
      .values({
        userId: seed.employee.id,
        businessType: "beratung",
        customerType: "bestandskunde",
        customerName: "Haufe",
        orderDate: "2026-06-15",
        unit: "tage",
        quantity: 10,
        netOrderValueCents: 1_000_000,
      })
      .returning();

    const res = await approve(
      authed(`http://localhost/api/v1/requests/${claim.id}/approve`, {
        method: "POST",
      }),
      ctx(claim.id)
    );
    expect(res.status).toBe(400);
    expect((await res.json()).fehler).toContain("finale Provisionsbetrag");
  });

  it("liefert 404 für unbekannte Vorgänge", async () => {
    const id = randomUUID();
    const res = await approve(
      authed(`http://localhost/api/v1/requests/${id}/approve`, {
        method: "POST",
      }),
      ctx(id)
    );
    expect(res.status).toBe(404);
  });
});

describe("POST /api/v1/requests/{id}/reject", () => {
  it("beanstandet mit Pflicht-Kommentar und protokolliert ihn", async () => {
    const vacation = await insertVacation(seed.employee.id);
    const res = await reject(
      authed(`http://localhost/api/v1/requests/${vacation.id}/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ comment: "Bitte Vertretung angeben." }),
      }),
      ctx(vacation.id)
    );
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("beanstandet");

    const [updated] = await testDb()
      .select()
      .from(vacationRequests)
      .where(eq(vacationRequests.id, vacation.id));
    expect(updated.rejectionComment).toBe("Bitte Vertretung angeben.");
  });

  it("verweigert die Beanstandung ohne Kommentar", async () => {
    const vacation = await insertVacation(seed.employee.id);
    const res = await reject(
      authed(`http://localhost/api/v1/requests/${vacation.id}/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      ctx(vacation.id)
    );
    expect(res.status).toBe(400);
  });

  it("Storno-Beanstandung setzt den Urlaub zurück auf genehmigt", async () => {
    const vacation = await insertVacation(seed.employee.id);
    await testDb()
      .update(vacationRequests)
      .set({ status: "storno_beantragt" })
      .where(eq(vacationRequests.id, vacation.id));

    const res = await reject(
      authed(`http://localhost/api/v1/requests/${vacation.id}/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ comment: "Projektphase, bitte bleiben." }),
      }),
      ctx(vacation.id)
    );
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("genehmigt");
  });
});
