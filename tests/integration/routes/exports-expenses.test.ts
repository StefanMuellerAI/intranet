import { createRequire } from "node:module";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as exportExpenses } from "@/app/api/exports/expenses/route";
import * as schema from "../../../src/db/schema";
import { actAs, createUser, makeDeputy } from "../../helpers/actions";
import { resetDb, seedTestData, testDb, type SeedResult } from "../../helpers/db";

// Klassisches pdf-parse (1.x) — Textextraktion wie in src/lib/it-equipment-pdf.test.ts
const nodeRequire = createRequire(import.meta.url);
const parsePdf = nodeRequire("pdf-parse/lib/pdf-parse.js") as (
  data: Buffer
) => Promise<{ text: string; numpages: number }>;

let seed: SeedResult;

function exportRequest(query: string) {
  return exportExpenses(new Request(`http://localhost/api/exports/expenses${query}`));
}

/** CSV-Antwort in Zeilen/Zellen zerlegen (BOM bleibt über arrayBuffer erhalten) */
async function csvOf(res: Response) {
  const raw = Buffer.from(await res.arrayBuffer()).toString("utf8");
  expect(raw.startsWith("﻿")).toBe(true);
  const lines = raw.slice(1).split("\r\n");
  return {
    header: lines[0].split(";"),
    rows: lines.slice(1).map((l) => l.split(";").map((c) => c.replace(/^"|"$/g, ""))),
  };
}

async function insertReport(
  overrides: Partial<typeof schema.expenseReports.$inferInsert> = {}
) {
  const [row] = await testDb()
    .insert(schema.expenseReports)
    .values({
      userId: seed.employee.id,
      status: "genehmigt",
      destination: "Berlin",
      customerPurpose: "Workshop",
      departureDate: "2026-07-13",
      departureTime: "08:00",
      returnDate: "2026-07-15",
      returnTime: "18:00",
      mealAllowanceCents: 3640,
      transportCents: 4590,
      carCents: 3400,
      lodgingCents: 18000,
      incidentalsCents: 2050,
      employerSupplementCents: 1000,
      totalCents: 3640 + 4590 + 3400 + 18000 + 2050 + 1000,
      ...overrides,
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
  await db.delete(schema.receipts);
  await db.delete(schema.expenseItems);
  await db.delete(schema.expenseReports);
  await db.delete(schema.deputyAssignments);
});

describe("GET /api/exports/expenses", () => {
  it("ist nur für den Admin (403 für Mitarbeitende, Vertretung und ohne Session)", async () => {
    await actAs(seed.employee);
    const res = await exportRequest("?monat=2026-07");
    expect(res.status).toBe(403);
    expect((await res.json()).fehler).toBe("Nur für den Admin.");

    const deputy = await createUser();
    await makeDeputy(deputy);
    await actAs(deputy);
    expect((await exportRequest("?monat=2026-07")).status).toBe(403);

    await actAs(null);
    expect((await exportRequest("?monat=2026-07")).status).toBe(403);
  });

  it.each([
    "",
    "?monat=",
    "?monat=2026-7",
    "?monat=07-2026",
    "?monat=Juli",
    "?monat=2026-07-01",
    "?monat=2026-13",
    "?monat=2026-00",
  ])(
    "verlangt den Monat im Format YYYY-MM (%s → 400)",
    async (query) => {
      await actAs(seed.admin);
      const res = await exportRequest(query);
      expect(res.status).toBe(400);
      expect((await res.json()).fehler).toBe(
        "Parameter 'monat' im Format YYYY-MM erforderlich."
      );
    }
  );

  it("exportiert eine CSV mit getrenntem Ausweis von Pauschale, Zuschlag und Beleg-Erstattungen", async () => {
    const report = await insertReport();
    await actAs(seed.admin);

    const res = await exportRequest("?monat=2026-07");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="Reisekosten-2026-07.csv"'
    );
    const { header, rows } = await csvOf(res);
    expect(header).toEqual([
      "Mitarbeiter/in",
      "Reiseziel",
      "Kunde/Anlass",
      "Abreise",
      "Rückkehr",
      "Verpflegungspauschale steuerfrei (EUR)",
      "Arbeitgeber-Zuschlag pauschal versteuert (EUR)",
      "Beleg-Erstattungen (EUR)",
      "Gesamterstattung (EUR)",
      "Vorgangs-ID",
    ]);
    expect(rows).toEqual([
      [
        "Max Mitarbeiter",
        "Berlin",
        "Workshop",
        "13.07.2026",
        "15.07.2026",
        "36,40",
        "10,00",
        // Fahrt + Pkw + Übernachtung + Nebenkosten
        "280,40",
        "326,80",
        report.id,
      ],
    ]);
  });

  it("exportiert nur genehmigte Abrechnungen", async () => {
    const approved = await insertReport();
    for (const status of [
      "eingereicht",
      "beanstandet",
      "zurueckgezogen",
      "storno_beantragt",
      "storniert",
    ] as const) {
      await insertReport({ status, destination: `Status ${status}` });
    }
    await actAs(seed.admin);

    const { rows } = await csvOf(await exportRequest("?monat=2026-07"));

    expect(rows.map((r) => r[9])).toEqual([approved.id]);
  });

  it("ordnet Reisen über das Rückkehrdatum dem Monat zu", async () => {
    const colleague = await createUser({ firstName: "Clara", lastName: "Kollegin" });
    // Abreise im Juni, Rückkehr am 1. Juli → Juli
    const overMonthEnd = await insertReport({
      departureDate: "2026-06-29",
      returnDate: "2026-07-01",
    });
    // letzter Tag des Monats → Juli
    const lastDay = await insertReport({
      userId: colleague.id,
      departureDate: "2026-07-30",
      returnDate: "2026-07-31",
    });
    // Rückkehr am 1. August → August
    const august = await insertReport({
      departureDate: "2026-07-31",
      returnDate: "2026-08-01",
    });
    // Rückkehr am 30. Juni → Juni
    const june = await insertReport({
      departureDate: "2026-06-30",
      returnDate: "2026-06-30",
    });
    await actAs(seed.admin);

    const ids = async (month: string) =>
      (await csvOf(await exportRequest(`?monat=${month}`))).rows.map((r) => r[9]).sort();

    expect(await ids("2026-07")).toEqual([overMonthEnd.id, lastDay.id].sort());
    expect(await ids("2026-08")).toEqual([august.id]);
    expect(await ids("2026-06")).toEqual([june.id]);
  });

  it("berücksichtigt die Monatslänge im Februar (auch im Schaltjahr)", async () => {
    const feb2027 = await insertReport({
      departureDate: "2027-02-27",
      returnDate: "2027-02-28",
    });
    const feb2028 = await insertReport({
      departureDate: "2028-02-28",
      returnDate: "2028-02-29",
    });
    await actAs(seed.admin);

    const rows2027 = (await csvOf(await exportRequest("?monat=2027-02"))).rows;
    expect(rows2027.map((r) => r[9])).toEqual([feb2027.id]);
    const rows2028 = (await csvOf(await exportRequest("?monat=2028-02"))).rows;
    expect(rows2028.map((r) => r[9])).toEqual([feb2028.id]);
  });

  it("liefert für einen leeren Monat nur die Kopfzeile", async () => {
    await insertReport();
    await actAs(seed.admin);
    const { header, rows } = await csvOf(await exportRequest("?monat=2026-09"));
    expect(header).toHaveLength(10);
    expect(rows).toEqual([]);
  });

  it("maskiert Anführungszeichen in Freitextfeldern", async () => {
    await insertReport({ destination: 'Hotel "Adlon"; Berlin' });
    await actAs(seed.admin);
    const raw = Buffer.from(
      await (await exportRequest("?monat=2026-07")).arrayBuffer()
    ).toString("utf8");
    expect(raw).toContain('"Hotel ""Adlon""; Berlin"');
  });

  it("fällt bei unbekanntem Format auf CSV zurück", async () => {
    await insertReport();
    await actAs(seed.admin);
    const res = await exportRequest("?monat=2026-07&format=xlsx");
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
  });

  it("exportiert ein PDF mit Zeilen und Summen", async () => {
    const colleague = await createUser({ firstName: "Clara", lastName: "Kollegin" });
    await insertReport();
    await insertReport({
      userId: colleague.id,
      destination: "München",
      customerPurpose: "Messe",
      mealAllowanceCents: 1400,
      transportCents: 0,
      carCents: 0,
      lodgingCents: 0,
      incidentalsCents: 600,
      employerSupplementCents: 0,
      totalCents: 2000,
    });
    await insertReport({ status: "eingereicht", destination: "Offen-Stadt" });
    await actAs(seed.admin);

    const res = await exportRequest("?monat=2026-07&format=pdf");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="Reisekosten-2026-07.pdf"'
    );
    const pdf = Buffer.from(await res.arrayBuffer());
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    const { text } = await parsePdf(pdf);
    expect(text).toContain("Reisekosten-Export 2026-07");
    expect(text).toContain("Max Mitarbeiter");
    expect(text).toContain("Clara Kollegin");
    expect(text).toContain("Berlin (Workshop)");
    expect(text).toContain("München (Messe)");
    expect(text).not.toContain("Offen-Stadt");
    // Summen: Pauschale 36,40 + 14,00; Zuschlag 10,00; Belege 280,40 + 6,00; Gesamt 326,80 + 20,00
    expect(text).toContain("Summe");
    expect(text).toContain("50,40");
    expect(text).toContain("286,40");
    expect(text).toContain("346,80");
  });

  it("weist im PDF auf einen leeren Monat hin", async () => {
    await actAs(seed.admin);
    const res = await exportRequest("?monat=2026-03&format=pdf");
    const { text } = await parsePdf(Buffer.from(await res.arrayBuffer()));
    expect(text).toContain("Keine genehmigten Abrechnungen in diesem Monat.");
  });
});
