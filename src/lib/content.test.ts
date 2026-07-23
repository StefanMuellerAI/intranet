import { describe, expect, it } from "vitest";
import {
  parseExternalUrl,
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
