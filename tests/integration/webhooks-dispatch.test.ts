import { createHmac, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  attemptDelivery,
  dispatchWebhookEvent,
  pruneOldWebhookDeliveries,
  retryDueDeliveries,
} from "@/lib/webhooks";
import * as schema from "../../src/db/schema";
import { resetDb, seedTestData, testDb } from "../helpers/db";

/**
 * Zustellung gegen einen lokalen HTTP-Empfänger (127.0.0.1). Außerhalb von
 * Produktion prüft attemptDelivery die URL bewusst nicht gegen SSRF, damit
 * lokale Empfänger nutzbar bleiben; der Produktionspfad wird per
 * NODE_ENV-Stub geprüft.
 */

const SECRET = "webhook-test-secret";
const MINUTE = 60_000;

interface Received {
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

let server: Server;
let baseUrl: string;
let respondWith = 200;
let responseText = "ok";
const received: Received[] = [];

async function insertConfig(
  values: Partial<typeof schema.webhookConfigs.$inferInsert> = {}
) {
  const [config] = await testDb()
    .insert(schema.webhookConfigs)
    .values({
      category: "urlaub",
      event: "eingereicht",
      url: `${baseUrl}/hook`,
      secret: SECRET,
      ...values,
    })
    .returning();
  return config;
}

async function insertDelivery(
  configId: string,
  values: Partial<typeof schema.webhookDeliveries.$inferInsert> = {}
) {
  const [delivery] = await testDb()
    .insert(schema.webhookDeliveries)
    .values({
      configId,
      event: "eingereicht",
      payload: { kategorie: "urlaub", ereignis: "eingereicht", vorgangs_id: "v-1" },
      ...values,
    })
    .returning();
  return delivery;
}

async function loadDelivery(id: string) {
  const row = await testDb().query.webhookDeliveries.findFirst({
    where: eq(schema.webhookDeliveries.id, id),
  });
  if (!row) throw new Error("Zustellung fehlt");
  return row;
}

async function allDeliveries() {
  return testDb().select().from(schema.webhookDeliveries);
}

/** Erwartet nextRetryAt ≈ Zeitpunkt des Versuchs + Backoff */
function expectRetryIn(
  nextRetryAt: Date | null,
  before: number,
  after: number,
  minutes: number
) {
  expect(nextRetryAt).toBeInstanceOf(Date);
  const t = nextRetryAt!.getTime();
  expect(t).toBeGreaterThanOrEqual(before + minutes * MINUTE);
  expect(t).toBeLessThanOrEqual(after + minutes * MINUTE);
}

/** Port, auf dem garantiert niemand lauscht (Verbindung wird abgelehnt) */
async function closedPortUrl(): Promise<string> {
  const tmp = createServer();
  await new Promise<void>((resolve) => tmp.listen(0, "127.0.0.1", resolve));
  const { port } = tmp.address() as AddressInfo;
  await new Promise<void>((resolve) => tmp.close(() => resolve()));
  return `http://127.0.0.1:${port}/hook`;
}

beforeAll(async () => {
  await resetDb();
  await seedTestData();

  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      received.push({ body, headers: req.headers });
      res.statusCode = respondWith;
      res.end(responseText);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  if (!server) return;
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
});

beforeEach(async () => {
  await testDb().delete(schema.webhookConfigs);
  received.length = 0;
  respondWith = 200;
  responseText = "ok";
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("dispatchWebhookEvent", () => {
  it("stellt an eine aktive passende Konfiguration sofort zu und signiert den Payload", async () => {
    const config = await insertConfig();
    const before = Date.now();

    await dispatchWebhookEvent("urlaub", "eingereicht", {
      vorgangs_id: "abc-123",
      status: "eingereicht",
    });

    const [delivery] = await allDeliveries();
    expect(delivery).toMatchObject({
      configId: config.id,
      event: "eingereicht",
      status: "erfolgreich",
      attempts: 1,
      responseStatus: 200,
      responseBody: "ok",
      nextRetryAt: null,
    });
    expect(delivery.lastAttemptAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);

    const payload = delivery.payload as Record<string, unknown>;
    expect(payload).toMatchObject({
      kategorie: "urlaub",
      ereignis: "eingereicht",
      vorgangs_id: "abc-123",
      status: "eingereicht",
    });
    expect(new Date(String(payload.zeitstempel)).getTime()).toBeGreaterThanOrEqual(
      before - 1000
    );

    expect(received).toHaveLength(1);
    const [req] = received;
    expect(req.headers["content-type"]).toBe("application/json");
    expect(req.headers["x-stefanai-event"]).toBe("eingereicht");
    expect(req.headers["x-stefanai-signature"]).toBe(
      createHmac("sha256", SECRET).update(req.body).digest("hex")
    );
    expect(JSON.parse(req.body)).toEqual(payload);
  });

  it("legt je passender Konfiguration eine eigene Zustellung an", async () => {
    const a = await insertConfig();
    const b = await insertConfig({ secret: "zweites-secret" });

    await dispatchWebhookEvent("urlaub", "eingereicht", { vorgangs_id: "x" });

    const deliveries = await allDeliveries();
    expect(deliveries.map((d) => d.configId).sort()).toEqual([a.id, b.id].sort());
    expect(deliveries.every((d) => d.status === "erfolgreich")).toBe(true);
    expect(received).toHaveLength(2);
    const signatures = received.map((r) => r.headers["x-stefanai-signature"]);
    expect(signatures).toContain(
      createHmac("sha256", "zweites-secret").update(received[0].body).digest("hex")
    );
  });

  it("ignoriert inaktive Konfigurationen und andere Kategorien oder Ereignisse", async () => {
    await insertConfig({ active: false });
    await insertConfig({ category: "workation" });
    await insertConfig({ event: "genehmigt" });

    await dispatchWebhookEvent("urlaub", "eingereicht", { vorgangs_id: "x" });

    expect(await allDeliveries()).toHaveLength(0);
    expect(received).toHaveLength(0);
  });

  it("merkt einen fehlgeschlagenen Erstversuch für eine Wiederholung nach 1 Minute vor", async () => {
    await insertConfig({ category: "krankmeldung", event: "gemeldet" });
    respondWith = 500;
    responseText = "kaputt";
    const before = Date.now();

    await dispatchWebhookEvent("krankmeldung", "gemeldet", { vorgangs_id: "k-1" });

    const after = Date.now();
    const [delivery] = await allDeliveries();
    expect(delivery).toMatchObject({
      status: "ausstehend",
      attempts: 1,
      responseStatus: 500,
      responseBody: "kaputt",
    });
    expectRetryIn(delivery.nextRetryAt, before, after, 1);
  });
});

describe("attemptDelivery", () => {
  it("stellt eine ausstehende Zustellung erfolgreich zu", async () => {
    const config = await insertConfig();
    const delivery = await insertDelivery(config.id, {
      attempts: 1,
      nextRetryAt: new Date(Date.now() - MINUTE),
    });

    await attemptDelivery(delivery.id);

    expect(await loadDelivery(delivery.id)).toMatchObject({
      status: "erfolgreich",
      attempts: 2,
      responseStatus: 200,
      nextRetryAt: null,
    });
    expect(JSON.parse(received[0].body)).toEqual(delivery.payload);
  });

  it("plant nach dem 1. Fehlversuch die Wiederholung in 1 Minute", async () => {
    const config = await insertConfig();
    const delivery = await insertDelivery(config.id);
    respondWith = 503;

    const before = Date.now();
    await attemptDelivery(delivery.id);
    const after = Date.now();

    const updated = await loadDelivery(delivery.id);
    expect(updated).toMatchObject({ status: "ausstehend", attempts: 1, responseStatus: 503 });
    expectRetryIn(updated.nextRetryAt, before, after, 1);
  });

  it("plant nach dem 2. Fehlversuch die Wiederholung in 5 Minuten", async () => {
    const config = await insertConfig();
    const delivery = await insertDelivery(config.id, { attempts: 1 });
    respondWith = 500;

    const before = Date.now();
    await attemptDelivery(delivery.id);
    const after = Date.now();

    const updated = await loadDelivery(delivery.id);
    expect(updated).toMatchObject({ status: "ausstehend", attempts: 2 });
    expectRetryIn(updated.nextRetryAt, before, after, 5);
  });

  it("markiert die Zustellung nach dem 3. Fehlversuch endgültig als fehlgeschlagen", async () => {
    const config = await insertConfig();
    const delivery = await insertDelivery(config.id, { attempts: 2 });
    respondWith = 404;

    await attemptDelivery(delivery.id);

    expect(await loadDelivery(delivery.id)).toMatchObject({
      status: "fehlgeschlagen",
      attempts: 3,
      responseStatus: 404,
      nextRetryAt: null,
    });
  });

  it("protokolliert Netzwerkfehler ohne HTTP-Status und plant eine Wiederholung", async () => {
    const config = await insertConfig({ url: await closedPortUrl() });
    const delivery = await insertDelivery(config.id);

    const before = Date.now();
    await attemptDelivery(delivery.id);
    const after = Date.now();

    const updated = await loadDelivery(delivery.id);
    expect(updated).toMatchObject({
      status: "ausstehend",
      attempts: 1,
      responseStatus: null,
    });
    expect(updated.responseBody).toBeTruthy();
    expect(updated.lastAttemptAt).not.toBeNull();
    expectRetryIn(updated.nextRetryAt, before, after, 1);
  });

  it("kürzt lange Antworttexte auf 2000 Zeichen", async () => {
    const config = await insertConfig();
    const delivery = await insertDelivery(config.id);
    responseText = "x".repeat(5000);

    await attemptDelivery(delivery.id);

    expect((await loadDelivery(delivery.id)).responseBody).toHaveLength(2000);
  });

  it("lässt bereits erfolgreiche Zustellungen unangetastet", async () => {
    const config = await insertConfig();
    const delivery = await insertDelivery(config.id, {
      status: "erfolgreich",
      attempts: 1,
      responseStatus: 200,
    });

    await attemptDelivery(delivery.id);

    expect(received).toHaveLength(0);
    expect(await loadDelivery(delivery.id)).toMatchObject({
      status: "erfolgreich",
      attempts: 1,
    });
  });

  it("ignoriert unbekannte Zustellungen", async () => {
    await expect(attemptDelivery(randomUUID())).resolves.toBeUndefined();
    expect(received).toHaveLength(0);
  });

  it("verweigert in Produktion die Zustellung an http-URLs (SSRF-Schutz)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const config = await insertConfig();
    const delivery = await insertDelivery(config.id);

    await attemptDelivery(delivery.id);

    expect(received).toHaveLength(0);
    expect(await loadDelivery(delivery.id)).toMatchObject({
      status: "ausstehend",
      attempts: 1,
      responseStatus: null,
      responseBody: "Die Webhook-URL muss mit https:// beginnen.",
    });
  });

  it("verweigert in Produktion die Zustellung an interne Adressen (SSRF-Schutz)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const config = await insertConfig({
      url: baseUrl.replace("http://", "https://") + "/hook",
    });
    const delivery = await insertDelivery(config.id, { attempts: 2 });

    await attemptDelivery(delivery.id);

    expect(received).toHaveLength(0);
    expect(await loadDelivery(delivery.id)).toMatchObject({
      status: "fehlgeschlagen",
      attempts: 3,
      responseBody:
        "Die Webhook-URL darf keine internen oder privaten Adressen ansprechen.",
    });
  });
});

describe("retryDueDeliveries", () => {
  it("wiederholt nur fällige ausstehende Zustellungen", async () => {
    const config = await insertConfig();
    const faellig = await insertDelivery(config.id, {
      attempts: 1,
      nextRetryAt: new Date(Date.now() - MINUTE),
    });
    const ohneTermin = await insertDelivery(config.id, { attempts: 2, nextRetryAt: null });
    const spaeter = await insertDelivery(config.id, {
      attempts: 1,
      nextRetryAt: new Date(Date.now() + 5 * MINUTE),
    });
    const nieVersucht = await insertDelivery(config.id, { attempts: 0 });
    const erfolgreich = await insertDelivery(config.id, {
      status: "erfolgreich",
      attempts: 1,
    });
    const fehlgeschlagen = await insertDelivery(config.id, {
      status: "fehlgeschlagen",
      attempts: 3,
    });

    expect(await retryDueDeliveries()).toBe(2);

    expect(received).toHaveLength(2);
    expect(await loadDelivery(faellig.id)).toMatchObject({
      status: "erfolgreich",
      attempts: 2,
    });
    expect(await loadDelivery(ohneTermin.id)).toMatchObject({
      status: "erfolgreich",
      attempts: 3,
    });
    expect(await loadDelivery(spaeter.id)).toMatchObject({
      status: "ausstehend",
      attempts: 1,
      lastAttemptAt: null,
    });
    expect((await loadDelivery(nieVersucht.id)).attempts).toBe(0);
    expect((await loadDelivery(erfolgreich.id)).attempts).toBe(1);
    expect(await loadDelivery(fehlgeschlagen.id)).toMatchObject({
      status: "fehlgeschlagen",
      attempts: 3,
    });
  });

  it("liefert 0, wenn nichts fällig ist", async () => {
    const config = await insertConfig();
    await insertDelivery(config.id, {
      attempts: 1,
      nextRetryAt: new Date(Date.now() + MINUTE),
    });
    expect(await retryDueDeliveries()).toBe(0);
    expect(received).toHaveLength(0);
  });
});

describe("pruneOldWebhookDeliveries", () => {
  const DAY = 24 * 60 * MINUTE;

  it("löscht nur Zustellungen älter als 30 Tage und behält frische", async () => {
    const config = await insertConfig();
    const frisch = await insertDelivery(config.id);
    const knapp = await insertDelivery(config.id, {
      createdAt: new Date(Date.now() - 29 * DAY),
    });
    const alt = await insertDelivery(config.id, {
      status: "erfolgreich",
      createdAt: new Date(Date.now() - 31 * DAY),
    });
    const altFehlgeschlagen = await insertDelivery(config.id, {
      status: "fehlgeschlagen",
      createdAt: new Date(Date.now() - 400 * DAY),
    });

    expect(await pruneOldWebhookDeliveries()).toBe(2);

    const ids = (await allDeliveries()).map((d) => d.id).sort();
    expect(ids).toEqual([frisch.id, knapp.id].sort());
    expect(ids).not.toContain(alt.id);
    expect(ids).not.toContain(altFehlgeschlagen.id);
  });

  it("berücksichtigt eine abweichende Aufbewahrungsfrist", async () => {
    const config = await insertConfig();
    await insertDelivery(config.id, { createdAt: new Date(Date.now() - 3 * DAY) });
    const neu = await insertDelivery(config.id);

    expect(await pruneOldWebhookDeliveries(2)).toBe(1);
    expect((await allDeliveries()).map((d) => d.id)).toEqual([neu.id]);
  });

  it("liefert 0, wenn nichts abgelaufen ist", async () => {
    const config = await insertConfig();
    await insertDelivery(config.id);
    expect(await pruneOldWebhookDeliveries()).toBe(0);
    expect(await allDeliveries()).toHaveLength(1);
  });
});
