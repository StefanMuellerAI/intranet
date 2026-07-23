import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { GET as listRequests } from "@/app/api/v1/requests/route";
import { apiKeys } from "../../src/db/schema";
import {
  createTestApiKey,
  resetDb,
  seedTestData,
  testDb,
  type SeedResult,
} from "../helpers/db";

let seed: SeedResult;
let validKey: string;

function apiRequest(key?: string): Request {
  return new Request("http://localhost/api/v1/requests", {
    headers: key ? { authorization: `Bearer ${key}` } : {},
  });
}

beforeAll(async () => {
  await resetDb();
  seed = await seedTestData();
  ({ key: validKey } = await createTestApiKey(seed.admin.id));
});

describe("API-Key-Authentifizierung", () => {
  it("lehnt Anfragen ohne Authorization-Header mit 401 ab", async () => {
    const res = await listRequests(apiRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.fehler).toContain("Authorization-Header");
  });

  it("lehnt ungültige Keys mit 401 ab", async () => {
    const res = await listRequests(apiRequest("sk_test_ungueltig"));
    expect(res.status).toBe(401);
    expect((await res.json()).fehler).toBe("Ungültiger API-Key.");
  });

  it("akzeptiert einen gültigen Key und aktualisiert lastUsedAt", async () => {
    const res = await listRequests(apiRequest(validKey));
    expect(res.status).toBe(200);

    const [row] = await testDb().select().from(apiKeys);
    expect(row.lastUsedAt).not.toBeNull();
    expect(row.rateWindowCount).toBeGreaterThan(0);
  });

  it("lehnt widerrufene Keys mit 401 ab", async () => {
    const { key, id } = await createTestApiKey(seed.admin.id, "Widerrufen");
    await testDb()
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(eq(apiKeys.id, id));

    const res = await listRequests(apiRequest(key));
    expect(res.status).toBe(401);
    expect((await res.json()).fehler).toBe("Dieser API-Key wurde widerrufen.");
  });

  it("liefert 429, wenn das Rate Limit (60/min) erreicht ist", async () => {
    const { key, id } = await createTestApiKey(seed.admin.id, "Rate-Limit");
    await testDb()
      .update(apiKeys)
      .set({ rateWindowStart: new Date(), rateWindowCount: 60 })
      .where(eq(apiKeys.id, id));

    const res = await listRequests(apiRequest(key));
    expect(res.status).toBe(429);
    expect((await res.json()).fehler).toContain("Rate Limit");
  });

  it("setzt das Rate-Limit-Fenster nach Ablauf zurück", async () => {
    const { key, id } = await createTestApiKey(seed.admin.id, "Fenster-Reset");
    await testDb()
      .update(apiKeys)
      .set({
        rateWindowStart: new Date(Date.now() - 61_000),
        rateWindowCount: 60,
      })
      .where(eq(apiKeys.id, id));

    const res = await listRequests(apiRequest(key));
    expect(res.status).toBe(200);
  });
});
