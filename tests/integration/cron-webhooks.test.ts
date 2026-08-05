import { createServer, type Server } from "node:http";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as cron } from "@/app/api/cron/webhooks/route";
import { webhookConfigs, webhookDeliveries } from "../../src/db/schema";
import { resetDb, seedTestData, testDb } from "../helpers/db";

const WEBHOOK_SECRET = "test-webhook-secret";

let server: Server;
let baseUrl: string;
let respondWith = 200;
const received: { body: string; signature: string; event: string }[] = [];

function cronRequest(secret?: string): Request {
  return new Request("http://localhost/api/cron/webhooks", {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

async function insertDelivery(opts: { attempts: number }) {
  const db = testDb();
  const [config] = await db
    .insert(webhookConfigs)
    .values({
      category: "urlaub",
      event: "genehmigt",
      url: `${baseUrl}/hook`,
      secret: WEBHOOK_SECRET,
    })
    .returning();
  const [delivery] = await db
    .insert(webhookDeliveries)
    .values({
      configId: config.id,
      event: "genehmigt",
      payload: { kategorie: "urlaub", ereignis: "genehmigt" },
      status: "ausstehend",
      attempts: opts.attempts,
      nextRetryAt: new Date(Date.now() - 60_000),
    })
    .returning();
  return delivery;
}

beforeAll(async () => {
  await resetDb();
  await seedTestData();

  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      received.push({
        body,
        signature: String(req.headers["x-stefanai-signature"] ?? ""),
        event: String(req.headers["x-stefanai-event"] ?? ""),
      });
      res.statusCode = respondWith;
      res.end(respondWith === 200 ? "ok" : "kaputt");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Testserver ohne Port.");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (!server) return;
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
});

describe("GET /api/cron/webhooks", () => {
  it("verweigert den Zugriff ohne gültiges CRON_SECRET", async () => {
    expect(process.env.CRON_SECRET).toBeTruthy();
    expect((await cron(cronRequest())).status).toBe(401);
    expect((await cron(cronRequest("falsches-secret"))).status).toBe(401);
  });

  it("verweigert den Zugriff fail-closed, wenn CRON_SECRET nicht gesetzt ist", async () => {
    const original = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    try {
      // Ohne Header und mit beliebigem Bearer muss die Route ablehnen —
      // sonst wäre sie bei fehlender Env-Variable öffentlich erreichbar.
      expect((await cron(cronRequest())).status).toBe(401);
      expect((await cron(cronRequest("irgendwas"))).status).toBe(401);
    } finally {
      process.env.CRON_SECRET = original;
    }
  });

  it("stellt fällige Zustellungen erneut zu und signiert den Payload", async () => {
    respondWith = 200;
    const delivery = await insertDelivery({ attempts: 1 });

    const res = await cron(cronRequest(process.env.CRON_SECRET));
    expect(res.status).toBe(200);
    expect((await res.json()).wiederholt).toBe(1);

    const [updated] = await testDb()
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, delivery.id));
    expect(updated.status).toBe("erfolgreich");
    expect(updated.attempts).toBe(2);
    expect(updated.responseStatus).toBe(200);

    const last = received.at(-1);
    expect(last?.event).toBe("genehmigt");
    const expectedSig = createHmac("sha256", WEBHOOK_SECRET)
      .update(last?.body ?? "")
      .digest("hex");
    expect(last?.signature).toBe(expectedSig);
  });

  it("löscht abgelaufene Zustellungen samt Payload (Retention)", async () => {
    const db = testDb();
    const [config] = await db
      .insert(webhookConfigs)
      .values({
        category: "urlaub",
        event: "genehmigt",
        url: `${baseUrl}/hook`,
        secret: WEBHOOK_SECRET,
      })
      .returning();
    const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    const [oldDelivery] = await db
      .insert(webhookDeliveries)
      .values({
        configId: config.id,
        event: "genehmigt",
        payload: { kategorie: "urlaub", ereignis: "genehmigt" },
        status: "erfolgreich",
        attempts: 1,
        createdAt: fortyDaysAgo,
      })
      .returning();

    await cron(cronRequest(process.env.CRON_SECRET));

    const rows = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, oldDelivery.id));
    expect(rows).toHaveLength(0);
  });

  it("markiert Zustellungen nach dem dritten Fehlversuch als fehlgeschlagen", async () => {
    respondWith = 500;
    const delivery = await insertDelivery({ attempts: 2 });

    const res = await cron(cronRequest(process.env.CRON_SECRET));
    expect(res.status).toBe(200);

    const [updated] = await testDb()
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, delivery.id));
    expect(updated.status).toBe("fehlgeschlagen");
    expect(updated.attempts).toBe(3);
    expect(updated.nextRetryAt).toBeNull();
  });
});
