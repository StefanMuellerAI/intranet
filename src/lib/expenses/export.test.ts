import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import type { ExpenseReport } from "@/db/schema";
import {
  buildExpensesCsv,
  buildExpensesPdf,
  receiptReimbursementCents,
  type ExportRow,
} from "./export";

// Klassisches pdf-parse (1.x) — Textextraktion wie in it-equipment-pdf.test.ts
const nodeRequire = createRequire(import.meta.url);
const parsePdf = nodeRequire("pdf-parse/lib/pdf-parse.js") as (
  data: Buffer
) => Promise<{ text: string; numpages: number }>;

function report(overrides: Partial<ExpenseReport> = {}): ExpenseReport {
  return {
    id: "8f1c2b8e-0000-4000-8000-000000000001",
    userId: "8f1c2b8e-0000-4000-8000-0000000000aa",
    status: "genehmigt",
    version: 1,
    destination: "Berlin",
    customerPurpose: "Workshop",
    departureDate: "2026-07-13",
    departureTime: "08:00",
    returnDate: "2026-07-15",
    returnTime: "18:00",
    isAbroad: false,
    ratesSnapshot: null,
    mealAllowanceCents: 3640,
    transportCents: 4590,
    carCents: 3400,
    lodgingCents: 18000,
    incidentalsCents: 2050,
    employerSupplementCents: 1000,
    totalCents: 32680,
    rejectionComment: null,
    decidedById: null,
    decidedAt: null,
    createdAt: new Date("2026-07-16T10:00:00Z"),
    updatedAt: new Date("2026-07-16T10:00:00Z"),
    ...overrides,
  };
}

function row(overrides: Partial<ExpenseReport> = {}, userName = "Max Mitarbeiter"): ExportRow {
  return { report: report(overrides), userName };
}

/** CSV ohne BOM in Zeilen zerlegen */
function lines(csv: string): string[] {
  return csv.slice(1).split("\r\n");
}

describe("receiptReimbursementCents", () => {
  it("summiert Fahrt, Privat-Pkw, Übernachtung und Nebenkosten", () => {
    expect(receiptReimbursementCents(report())).toBe(4590 + 3400 + 18000 + 2050);
  });

  it("lässt Verpflegungspauschale und Arbeitgeber-Zuschlag außen vor", () => {
    expect(
      receiptReimbursementCents(
        report({
          mealAllowanceCents: 9999,
          employerSupplementCents: 5000,
          transportCents: 0,
          carCents: 0,
          lodgingCents: 0,
          incidentalsCents: 0,
        })
      )
    ).toBe(0);
  });
});

describe("buildExpensesCsv", () => {
  it("beginnt mit BOM, trennt mit Semikolon und CRLF und weist die Beträge getrennt aus", () => {
    const csv = buildExpensesCsv([row()]);
    expect(csv.startsWith("﻿")).toBe(true);
    const [header, line] = lines(csv);
    expect(header).toBe(
      "Mitarbeiter/in;Reiseziel;Kunde/Anlass;Abreise;Rückkehr;" +
        "Verpflegungspauschale steuerfrei (EUR);" +
        "Arbeitgeber-Zuschlag pauschal versteuert (EUR);" +
        "Beleg-Erstattungen (EUR);Gesamterstattung (EUR);Vorgangs-ID"
    );
    expect(line).toBe(
      '"Max Mitarbeiter";"Berlin";"Workshop";"13.07.2026";"15.07.2026";' +
        '"36,40";"10,00";"280,40";"326,80";"8f1c2b8e-0000-4000-8000-000000000001"'
    );
  });

  it("liefert ohne Abrechnungen nur die Kopfzeile", () => {
    expect(lines(buildExpensesCsv([]))).toHaveLength(1);
  });

  it("formatiert Beträge mit Dezimalkomma ohne Tausendertrennzeichen", () => {
    const [, line] = lines(
      buildExpensesCsv([
        row({
          mealAllowanceCents: 0,
          employerSupplementCents: 5,
          transportCents: 123456,
          carCents: 0,
          lodgingCents: 0,
          incidentalsCents: 0,
          totalCents: 123461,
        }),
      ])
    );
    expect(line).toContain('"0,00";"0,05";"1234,56";"1234,61"');
  });

  it("maskiert Anführungszeichen und hält Semikolons und Zeilenumbrüche im Feld", () => {
    const [, line] = lines(
      buildExpensesCsv([
        row(
          {
            destination: 'Hotel "Adlon"; Berlin',
            customerPurpose: "Workshop\nTag 2",
          },
          'Anna "Nanni" Muster'
        ),
      ])
    );
    expect(line).toContain('"Anna ""Nanni"" Muster";"Hotel ""Adlon""; Berlin";"Workshop\nTag 2"');
  });

  it("schreibt eine Zeile je Abrechnung in der übergebenen Reihenfolge", () => {
    const csv = buildExpensesCsv([
      row({ id: "id-1" }, "Erste Person"),
      row({ id: "id-2" }, "Zweite Person"),
    ]);
    const [, first, second] = lines(csv);
    expect(first.startsWith('"Erste Person"')).toBe(true);
    expect(first.endsWith('"id-1"')).toBe(true);
    expect(second.startsWith('"Zweite Person"')).toBe(true);
  });
});

describe("buildExpensesPdf", () => {
  it("rendert Kopf, Zeilen und Summen", async () => {
    const pdf = await buildExpensesPdf(
      [
        row(),
        row(
          {
            id: "id-2",
            destination: "München",
            customerPurpose: "Messe",
            mealAllowanceCents: 1400,
            transportCents: 0,
            carCents: 0,
            lodgingCents: 0,
            incidentalsCents: 600,
            employerSupplementCents: 0,
            totalCents: 2000,
          },
          "Clara Kollegin"
        ),
      ],
      "2026-07"
    );
    const { text, numpages } = await parsePdf(pdf);
    expect(numpages).toBe(1);
    expect(text).toContain("Reisekosten-Export 2026-07");
    expect(text).toContain("Max Mitarbeiter");
    expect(text).toContain("München (Messe)");
    expect(text).toContain("13.07.2026");
    expect(text).toContain("Summe");
    expect(text).toContain("50,40");
    expect(text).toContain("286,40");
    expect(text).toContain("346,80");
    expect(text).not.toContain("Keine genehmigten Abrechnungen");
  });

  it("weist auf einen leeren Monat hin", async () => {
    const { text } = await parsePdf(await buildExpensesPdf([], "2026-03"));
    expect(text).toContain("Keine genehmigten Abrechnungen in diesem Monat.");
  });
});
