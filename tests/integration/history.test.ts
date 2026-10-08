import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getHistory, saveHistorySnapshot } from "@/lib/history";
import * as schema from "../../src/db/schema";
import { resetDb, seedTestData, testDb } from "../helpers/db";

beforeAll(async () => {
  await resetDb();
  await seedTestData();
});

beforeEach(async () => {
  await testDb().delete(schema.requestHistory);
});

describe("saveHistorySnapshot", () => {
  it("legt einen Snapshot mit Typ, Antrags-ID und Version ab", async () => {
    const requestId = randomUUID();
    await saveHistorySnapshot("urlaub", requestId, 1, {
      startDate: "2026-08-03",
      endDate: "2026-08-07",
      days: 5,
      status: "beanstandet",
    });

    const rows = await testDb().select().from(schema.requestHistory);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      requestType: "urlaub",
      requestId,
      version: 1,
      snapshot: {
        startDate: "2026-08-03",
        endDate: "2026-08-07",
        days: 5,
        status: "beanstandet",
      },
    });
    expect(rows[0].createdAt).toBeInstanceOf(Date);
  });

  it("speichert verschachtelte Daten und Zeitstempel als JSON", async () => {
    const requestId = randomUUID();
    const createdAt = new Date("2026-08-01T09:30:00.000Z");
    await saveHistorySnapshot("reisekosten", requestId, 2, {
      destination: "Berlin",
      createdAt,
      items: [{ kind: "fahrt", amountCents: 4590 }],
    });

    const [entry] = await getHistory("reisekosten", requestId);
    expect(entry.snapshot).toEqual({
      destination: "Berlin",
      createdAt: "2026-08-01T09:30:00.000Z",
      items: [{ kind: "fahrt", amountCents: 4590 }],
    });
  });
});

describe("getHistory", () => {
  it("liefert alle Versionen eines Antrags aufsteigend sortiert", async () => {
    const requestId = randomUUID();
    // bewusst in unsortierter Reihenfolge ablegen
    await saveHistorySnapshot("provision", requestId, 3, { customerName: "C" });
    await saveHistorySnapshot("provision", requestId, 1, { customerName: "A" });
    await saveHistorySnapshot("provision", requestId, 2, { customerName: "B" });

    const history = await getHistory("provision", requestId);
    expect(history.map((h) => h.version)).toEqual([1, 2, 3]);
    expect(history.map((h) => (h.snapshot as { customerName: string }).customerName)).toEqual([
      "A",
      "B",
      "C",
    ]);
  });

  it("trennt nach Antragsart und Antrags-ID", async () => {
    const requestId = randomUUID();
    const otherId = randomUUID();
    await saveHistorySnapshot("urlaub", requestId, 1, { art: "urlaub" });
    await saveHistorySnapshot("workation", requestId, 1, { art: "workation" });
    await saveHistorySnapshot("urlaub", otherId, 1, { art: "anderer" });

    const history = await getHistory("urlaub", requestId);
    expect(history).toHaveLength(1);
    expect(history[0].snapshot).toEqual({ art: "urlaub" });
    expect(await getHistory("workation", requestId)).toHaveLength(1);
  });

  it("liefert für Anträge ohne Korrektur eine leere Liste", async () => {
    expect(await getHistory("urlaub", randomUUID())).toEqual([]);
  });
});
