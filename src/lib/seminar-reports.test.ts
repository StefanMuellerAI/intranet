import { describe, expect, it } from "vitest";
import { buildQuotesCsv } from "@/lib/seminar-reports-csv";
import {
  averageRating,
  formatDurationDays,
  parseDurationDays,
  planQuoteChanges,
  seminarReportInputSchema,
  type ExistingQuote,
  type SeminarReportInput,
} from "@/lib/seminar-reports";

function validInput(
  overrides: Partial<SeminarReportInput> = {}
): Record<string, unknown> {
  return {
    kind: "seminar",
    customerName: "Haufe Akademie",
    title: "KI-Grundlagen für Führungskräfte",
    eventDate: "2026-05-12",
    durationDays: 1,
    whatWentWell: "Die Übungen kamen sehr gut an.",
    whatWentBadly: "Der Raum war zu klein.",
    improvements: "Vorab die Teilnehmendenzahl abfragen.",
    feedbackRating: 5,
    quotes: [],
    ...overrides,
  };
}

describe("seminarReportInputSchema", () => {
  it("nimmt einen vollständigen Bericht an", () => {
    const parsed = seminarReportInputSchema.parse(validInput());
    expect(parsed.customerName).toBe("Haufe Akademie");
    expect(parsed.feedbackRating).toBe(5);
  });

  it("schneidet umgebende Leerzeichen ab", () => {
    const parsed = seminarReportInputSchema.parse(
      validInput({ customerName: "  dbb akademie  " } as Partial<SeminarReportInput>)
    );
    expect(parsed.customerName).toBe("dbb akademie");
  });

  it("lehnt ein Feedback außerhalb von 1 bis 5 ab", () => {
    expect(() =>
      seminarReportInputSchema.parse(validInput({ feedbackRating: 0 }))
    ).toThrow();
    expect(() =>
      seminarReportInputSchema.parse(validInput({ feedbackRating: 6 }))
    ).toThrow();
  });

  it("erlaubt halbe Tage, aber kein feineres Raster", () => {
    expect(
      seminarReportInputSchema.parse(validInput({ durationDays: 0.5 }))
        .durationDays
    ).toBe(0.5);
    expect(
      seminarReportInputSchema.parse(validInput({ durationDays: 1.5 }))
        .durationDays
    ).toBe(1.5);
    expect(() =>
      seminarReportInputSchema.parse(validInput({ durationDays: 0.3 }))
    ).toThrow();
    expect(() =>
      seminarReportInputSchema.parse(validInput({ durationDays: 0 }))
    ).toThrow();
  });

  it("verlangt Titel, Kunde und alle drei Freitexte", () => {
    for (const field of [
      "title",
      "customerName",
      "whatWentWell",
      "whatWentBadly",
      "improvements",
    ]) {
      expect(() =>
        seminarReportInputSchema.parse(validInput({ [field]: "   " }))
      ).toThrow();
    }
  });

  it("verlangt ein Datum im ISO-Format", () => {
    expect(() =>
      seminarReportInputSchema.parse(validInput({ eventDate: "12.05.2026" }))
    ).toThrow();
  });

  it("nimmt Zitate mit und ohne Id an", () => {
    const parsed = seminarReportInputSchema.parse(
      validInput({
        quotes: [
          { id: null, quote: "Sehr praxisnah." },
          {
            id: "3f0f1a4e-6c1f-4f3a-9a2e-6d7c8b9a0e11",
            quote: "Ich nehme viel mit.",
          },
        ],
      })
    );
    expect(parsed.quotes).toHaveLength(2);
    expect(parsed.quotes[0].id).toBeNull();
  });

  it("lehnt mehr als 20 Zitate ab", () => {
    const quotes = Array.from({ length: 21 }, (_, i) => ({
      id: null,
      quote: `Zitat ${i}`,
    }));
    expect(() =>
      seminarReportInputSchema.parse(validInput({ quotes }))
    ).toThrow();
  });

  it("lehnt ein leeres Zitat ab", () => {
    expect(() =>
      seminarReportInputSchema.parse(
        validInput({ quotes: [{ id: null, quote: "   " }] })
      )
    ).toThrow();
  });
});

describe("formatDurationDays", () => {
  it("setzt den Singular nur bei genau einem Tag", () => {
    expect(formatDurationDays(1)).toBe("1 Tag");
    expect(formatDurationDays(0.5)).toBe("0,5 Tage");
    expect(formatDurationDays(2)).toBe("2 Tage");
    expect(formatDurationDays(1.5)).toBe("1,5 Tage");
  });
});

describe("parseDurationDays", () => {
  it("akzeptiert Komma und Punkt", () => {
    expect(parseDurationDays("0,5")).toBe(0.5);
    expect(parseDurationDays("1.5")).toBe(1.5);
    expect(parseDurationDays(" 2 ")).toBe(2);
  });

  it("liefert null bei leerer oder unsinniger Eingabe", () => {
    expect(parseDurationDays("")).toBeNull();
    expect(parseDurationDays("   ")).toBeNull();
    expect(parseDurationDays("zwei Tage")).toBeNull();
  });
});

describe("planQuoteChanges", () => {
  const A: ExistingQuote = {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    quote: "Sehr praxisnah.",
    websiteApproved: true,
  };
  const B: ExistingQuote = {
    id: "bbbbbbbb-0000-4000-8000-000000000002",
    quote: "Guter Einstieg.",
    websiteApproved: false,
  };

  it("legt Zitate ohne Id neu an", () => {
    const plan = planQuoteChanges([], [{ id: null, quote: "Neu" }]);
    expect(plan.insert).toEqual([{ quote: "Neu", position: 0 }]);
    expect(plan.update).toEqual([]);
    expect(plan.remove).toEqual([]);
  });

  it("behält die Website-Freigabe bei unverändertem Wortlaut", () => {
    const plan = planQuoteChanges([A], [{ id: A.id, quote: A.quote }]);
    expect(plan.update).toEqual([
      { id: A.id, quote: A.quote, position: 0, resetApproval: false },
    ]);
    expect(plan.remove).toEqual([]);
  });

  it("setzt die Freigabe zurück, wenn sich der Wortlaut ändert", () => {
    const plan = planQuoteChanges([A], [{ id: A.id, quote: "Doch anders." }]);
    expect(plan.update[0].resetApproval).toBe(true);
  });

  it("setzt nichts zurück, wenn das Zitat gar nicht freigegeben war", () => {
    const plan = planQuoteChanges([B], [{ id: B.id, quote: "Anders." }]);
    expect(plan.update[0].resetApproval).toBe(false);
  });

  it("entfernt Zitate, die im Formular fehlen", () => {
    const plan = planQuoteChanges([A, B], [{ id: B.id, quote: B.quote }]);
    expect(plan.remove).toEqual([A.id]);
    expect(plan.update).toHaveLength(1);
  });

  it("übernimmt die Reihenfolge des Formulars als position", () => {
    const plan = planQuoteChanges(
      [A, B],
      [
        { id: B.id, quote: B.quote },
        { id: null, quote: "Ganz neu" },
        { id: A.id, quote: A.quote },
      ]
    );
    expect(plan.update).toEqual([
      { id: B.id, quote: B.quote, position: 0, resetApproval: false },
      { id: A.id, quote: A.quote, position: 2, resetApproval: false },
    ]);
    expect(plan.insert).toEqual([{ quote: "Ganz neu", position: 1 }]);
    expect(plan.remove).toEqual([]);
  });

  it("behandelt eine fremde Id wie ein neues Zitat", () => {
    const plan = planQuoteChanges(
      [A],
      [{ id: "cccccccc-0000-4000-8000-000000000003", quote: "Eingeschmuggelt" }]
    );
    expect(plan.insert).toEqual([{ quote: "Eingeschmuggelt", position: 0 }]);
    expect(plan.update).toEqual([]);
    // Das eigene Zitat verschwindet, weil es im Formular nicht mehr steht —
    // aber es wird nicht überschrieben.
    expect(plan.remove).toEqual([A.id]);
  });

  it("ordnet eine doppelt gesendete Id nur einmal zu", () => {
    const plan = planQuoteChanges(
      [A],
      [
        { id: A.id, quote: "Erste" },
        { id: A.id, quote: "Zweite" },
      ]
    );
    expect(plan.update).toHaveLength(1);
    expect(plan.insert).toEqual([{ quote: "Zweite", position: 1 }]);
  });

  it("entfernt alle Zitate, wenn das Formular keine mehr enthält", () => {
    const plan = planQuoteChanges([A, B], []);
    expect(plan.remove).toEqual([A.id, B.id]);
    expect(plan.update).toEqual([]);
    expect(plan.insert).toEqual([]);
  });
});

describe("averageRating", () => {
  it("rundet auf eine Nachkommastelle", () => {
    expect(averageRating([5, 4, 4])).toBe(4.3);
    expect(averageRating([5, 5])).toBe(5);
  });

  it("liefert null ohne Bewertungen", () => {
    expect(averageRating([])).toBeNull();
  });
});

describe("buildQuotesCsv", () => {
  const row = {
    quote: "Sehr praxisnah.",
    kind: "seminar" as const,
    title: "KI-Grundlagen",
    customerName: "Haufe Akademie",
    eventDate: "2026-05-12",
    userName: "Max Mitarbeiter",
  };

  it("beginnt mit BOM und der Kopfzeile", () => {
    const csv = buildQuotesCsv([]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("Zitat;Art;Veranstaltung;Kunde;Datum;Mitarbeiter/in");
  });

  it("trennt Zeilen mit CRLF und Felder mit Semikolon", () => {
    const csv = buildQuotesCsv([row]);
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe(
      '"Sehr praxisnah.";"Seminar";"KI-Grundlagen";"Haufe Akademie";"12.05.2026";"Max Mitarbeiter"'
    );
  });

  it("verdoppelt Anführungszeichen im Zitat", () => {
    const csv = buildQuotesCsv([{ ...row, quote: 'Er sagte "top".' }]);
    expect(csv).toContain('"Er sagte ""top""."');
  });
});
