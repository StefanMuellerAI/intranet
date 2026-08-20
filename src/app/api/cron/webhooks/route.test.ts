import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const retryDueDeliveries = vi.fn();
const pruneOldWebhookDeliveries = vi.fn();

vi.mock("@/lib/webhooks", () => ({
  retryDueDeliveries: () => retryDueDeliveries(),
  pruneOldWebhookDeliveries: () => pruneOldWebhookDeliveries(),
}));

const { GET } = await import("./route");

const SECRET = "cron-test-secret";

function request(secret?: string): Request {
  return new Request("http://localhost/api/cron/webhooks", {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

let fehlerLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  retryDueDeliveries.mockReset().mockResolvedValue(0);
  pruneOldWebhookDeliveries.mockReset().mockResolvedValue(0);
  fehlerLog = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  fehlerLog.mockRestore();
});

describe("GET /api/cron/webhooks — Fehlerverhalten", () => {
  it("meldet den Erfolgsfall mit beiden Zählern", async () => {
    retryDueDeliveries.mockResolvedValue(2);
    pruneOldWebhookDeliveries.mockResolvedValue(7);

    const res = await GET(request(SECRET));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ wiederholt: 2, geloescht: 7 });
  });

  it("antwortet bei nicht erreichbarer Datenbank mit 200 statt 500", async () => {
    // Neon meldet bei aufgebrauchtem Kontingent HTTP 402 — der Cron darf
    // deswegen nicht alle 30 Minuten einen 500er ins Fehlerprotokoll schreiben.
    retryDueDeliveries.mockRejectedValue(new Error("HTTP status 402"));
    pruneOldWebhookDeliveries.mockRejectedValue(new Error("HTTP status 402"));

    const res = await GET(request(SECRET));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      wiederholt: null,
      geloescht: null,
      fehler: ["HTTP status 402", "HTTP status 402"],
    });
    expect(fehlerLog).toHaveBeenCalledTimes(2);
  });

  it("räumt weiter auf, wenn nur die Wiederholung scheitert", async () => {
    retryDueDeliveries.mockRejectedValue(new Error("kaputt"));
    pruneOldWebhookDeliveries.mockResolvedValue(3);

    const res = await GET(request(SECRET));

    expect(pruneOldWebhookDeliveries).toHaveBeenCalledTimes(1);
    expect(await res.json()).toEqual({
      wiederholt: null,
      geloescht: 3,
      fehler: ["kaputt"],
    });
  });

  it("lehnt weiterhin ohne gültiges Secret ab und rührt die Datenbank nicht an", async () => {
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request("falsch"))).status).toBe(401);
    expect(retryDueDeliveries).not.toHaveBeenCalled();
    expect(pruneOldWebhookDeliveries).not.toHaveBeenCalled();
  });
});
