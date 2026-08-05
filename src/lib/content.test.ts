import { describe, expect, it } from "vitest";
import {
  SALES_NEWS_DASHBOARD_DAYS,
  parseDeliveryRange,
  parseEuroVolume,
  parseEventRange,
  parseExternalUrl,
  parseISODateInput,
  parseSortOrder,
  requireNonEmpty,
  salesNewsDashboardCutoff,
} from "./content";

describe("requireNonEmpty", () => {
  it("trimmt und gibt den Text zurück", () => {
    expect(requireNonEmpty("  Wiki  ", "Titel")).toBe("Wiki");
  });

  it("wirft bei leerem Text", () => {
    expect(() => requireNonEmpty("   ", "Titel")).toThrow(
      "Titel ist erforderlich."
    );
  });
});

describe("parseExternalUrl", () => {
  it("akzeptiert https-URLs und normalisiert sie", () => {
    expect(parseExternalUrl("https://wiki.stefanai.de/hilfe")).toBe(
      "https://wiki.stefanai.de/hilfe"
    );
  });

  it("akzeptiert http-URLs", () => {
    expect(parseExternalUrl("http://example.com")).toBe("http://example.com/");
  });

  it("lehnt ungültige URLs ab", () => {
    expect(() => parseExternalUrl("kein-url")).toThrow("Ungültige URL.");
  });

  it("lehnt nicht-http(s)-Protokolle ab", () => {
    expect(() => parseExternalUrl("ftp://files.example.com")).toThrow(
      "URL muss mit http:// oder https:// beginnen."
    );
    expect(() => parseExternalUrl("javascript:alert(1)")).toThrow(
      "URL muss mit http:// oder https:// beginnen."
    );
  });

  it("wirft bei leerer URL", () => {
    expect(() => parseExternalUrl("")).toThrow("URL ist erforderlich.");
  });
});

describe("parseSortOrder", () => {
  it("parst nicht-negative Ganzzahlen", () => {
    expect(parseSortOrder("0")).toBe(0);
    expect(parseSortOrder("3")).toBe(3);
    expect(parseSortOrder("2.6")).toBe(3);
  });

  it("lehnt negative und ungültige Werte ab", () => {
    expect(() => parseSortOrder("-1")).toThrow("Ungültige Sortierung.");
    expect(() => parseSortOrder("abc")).toThrow("Ungültige Sortierung.");
  });
});

describe("parseISODateInput", () => {
  it("akzeptiert gültige Kalenderdaten", () => {
    expect(parseISODateInput("2026-08-12", "Startdatum")).toBe("2026-08-12");
    expect(parseISODateInput(" 2028-02-29 ", "Startdatum")).toBe("2028-02-29");
  });

  it("lehnt falsche Formate und Nicht-Kalendertage ab", () => {
    expect(() => parseISODateInput("12.08.2026", "Startdatum")).toThrow(
      "Startdatum ist ungültig."
    );
    expect(() => parseISODateInput("2026-02-30", "Startdatum")).toThrow(
      "Startdatum ist ungültig."
    );
  });

  it("wirft bei leerem Datum", () => {
    expect(() => parseISODateInput("", "Startdatum")).toThrow(
      "Startdatum ist erforderlich."
    );
  });
});

describe("parseEventRange", () => {
  it("nutzt das Startdatum als Ende, wenn kein Enddatum angegeben ist", () => {
    expect(parseEventRange("2026-08-12", "")).toEqual({
      startDate: "2026-08-12",
      endDate: "2026-08-12",
    });
  });

  it("akzeptiert mehrtägige Zeiträume", () => {
    expect(parseEventRange("2026-08-12", "2026-08-14")).toEqual({
      startDate: "2026-08-12",
      endDate: "2026-08-14",
    });
  });

  it("lehnt ein Enddatum vor dem Startdatum ab", () => {
    expect(() => parseEventRange("2026-08-12", "2026-08-11")).toThrow(
      "Das Enddatum darf nicht vor dem Startdatum liegen."
    );
  });
});

describe("parseEuroVolume", () => {
  it("parst ganze Euro-Beträge in Cents", () => {
    expect(parseEuroVolume("25000")).toBe(2_500_000);
  });

  it("akzeptiert Punkt- und Komma-Dezimale und rundet auf ganze Cents", () => {
    expect(parseEuroVolume("12500.50")).toBe(1_250_050);
    expect(parseEuroVolume("12500,50")).toBe(1_250_050);
    expect(parseEuroVolume("19.999")).toBe(2_000);
    expect(parseEuroVolume("0.01")).toBe(1);
  });

  it("lehnt leere, nicht numerische und nicht positive Werte ab", () => {
    expect(() => parseEuroVolume("")).toThrow("Volumen ist erforderlich.");
    expect(() => parseEuroVolume("abc")).toThrow("Ungültiges Volumen.");
    expect(() => parseEuroVolume("0")).toThrow("Ungültiges Volumen.");
    expect(() => parseEuroVolume("-5")).toThrow("Ungültiges Volumen.");
  });

  it("begrenzt das Volumen auf 20 Mio. € (Integer-Spalte)", () => {
    expect(parseEuroVolume("20000000")).toBe(2_000_000_000);
    expect(() => parseEuroVolume("20000000.01")).toThrow(
      "Volumen ist zu groß (max. 20 Mio. €)."
    );
  });
});

describe("parseDeliveryRange", () => {
  it("nutzt den Beginn als Ende, wenn kein Ende angegeben ist", () => {
    expect(parseDeliveryRange("2026-09-01", "")).toEqual({
      deliveryStart: "2026-09-01",
      deliveryEnd: "2026-09-01",
    });
  });

  it("akzeptiert mehrtägige Zeiträume", () => {
    expect(parseDeliveryRange("2026-09-01", "2026-11-30")).toEqual({
      deliveryStart: "2026-09-01",
      deliveryEnd: "2026-11-30",
    });
  });

  it("lehnt ein Ende vor dem Beginn ab", () => {
    expect(() => parseDeliveryRange("2026-09-01", "2026-08-31")).toThrow(
      "Das Leistungsende darf nicht vor dem Beginn liegen."
    );
  });

  it("wirft bei fehlendem Beginn", () => {
    expect(() => parseDeliveryRange("", "")).toThrow(
      "Leistungsbeginn ist erforderlich."
    );
  });
});

describe("salesNewsDashboardCutoff", () => {
  it("liegt genau 14 Tage vor dem übergebenen Zeitpunkt", () => {
    expect(SALES_NEWS_DASHBOARD_DAYS).toBe(14);
    const now = new Date("2026-08-05T12:00:00.000Z");
    expect(salesNewsDashboardCutoff(now).toISOString()).toBe(
      "2026-07-22T12:00:00.000Z"
    );
  });
});
