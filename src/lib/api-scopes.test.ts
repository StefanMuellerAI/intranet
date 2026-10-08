import { describe, expect, it } from "vitest";
import { apiKeys } from "@/db/schema";
import {
  API_KEY_SCOPE_HINTS,
  API_KEY_SCOPE_LABELS,
  API_KEY_SCOPES,
  isApiKeyScope,
} from "./api-scopes";

describe("isApiKeyScope", () => {
  it.each(["readonly", "full", "website"])("erkennt den Umfang %s", (scope) => {
    expect(isApiKeyScope(scope)).toBe(true);
  });

  it.each([
    ["unbekannter Wert", "admin"],
    ["Großschreibung", "FULL"],
    ["Leerzeichen", " full"],
    ["leerer String", ""],
    ["null", null],
    ["undefined", undefined],
    ["Zahl", 1],
    ["Array", ["full"]],
    ["Datei aus FormData", new Blob(["full"])],
  ])("lehnt %s ab", (_label, value) => {
    expect(isApiKeyScope(value)).toBe(false);
  });
});

describe("API_KEY_SCOPES", () => {
  it("entspricht dem Spalten-Enum in src/db/schema.ts", () => {
    expect([...API_KEY_SCOPES].sort()).toEqual([...apiKeys.scope.enumValues].sort());
  });

  it("hat readonly als ersten (geringsten) Umfang", () => {
    expect(API_KEY_SCOPES[0]).toBe("readonly");
  });
});

describe("API_KEY_SCOPE_LABELS und API_KEY_SCOPE_HINTS", () => {
  it("haben für jeden Umfang genau einen Eintrag", () => {
    expect(Object.keys(API_KEY_SCOPE_LABELS).sort()).toEqual([...API_KEY_SCOPES].sort());
    expect(Object.keys(API_KEY_SCOPE_HINTS).sort()).toEqual([...API_KEY_SCOPES].sort());
  });

  it("sind nicht leer und die Bezeichnungen eindeutig", () => {
    for (const scope of API_KEY_SCOPES) {
      expect(API_KEY_SCOPE_LABELS[scope].trim()).not.toBe("");
      expect(API_KEY_SCOPE_HINTS[scope].trim()).not.toBe("");
    }
    const labels = Object.values(API_KEY_SCOPE_LABELS);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("weist den Website-Umfang als Zitate-only ohne HR-/Faktura-Zugriff aus", () => {
    expect(API_KEY_SCOPE_LABELS.website).toContain("Zitate");
    expect(API_KEY_SCOPE_HINTS.website).toContain("kein Zugriff auf HR- oder Faktura-Daten");
  });
});
