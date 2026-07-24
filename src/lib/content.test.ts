import { describe, expect, it } from "vitest";
import {
  parseEventRange,
  parseExternalUrl,
  parseISODateInput,
  parseSortOrder,
  requireNonEmpty,
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
