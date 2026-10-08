import { describe, expect, it } from "vitest";
import { DECIMAL_PATTERN, parseEuroToCents } from "./form-patterns";

describe("parseEuroToCents", () => {
  it("liest Komma und Punkt als Dezimaltrenner", () => {
    expect(parseEuroToCents("5000,50")).toBe(500050);
    expect(parseEuroToCents("5000.50")).toBe(500050);
    expect(parseEuroToCents("180.00")).toBe(18000);
    expect(parseEuroToCents("0,5")).toBe(50);
    expect(parseEuroToCents("42")).toBe(4200);
  });

  it("versteht Tausenderpunkte vor einem Komma oder in Dreiergruppen", () => {
    expect(parseEuroToCents("12.345,67")).toBe(1234567);
    expect(parseEuroToCents("1.500")).toBe(150000);
    expect(parseEuroToCents("1.234.567")).toBe(123456700);
  });

  it("rundet auf ganze Cent und trimmt Leerzeichen", () => {
    expect(parseEuroToCents(" 19,999 ")).toBe(2000);
  });

  it("liefert null für leere und NaN für unlesbare Eingaben", () => {
    expect(parseEuroToCents("")).toBeNull();
    expect(parseEuroToCents("   ")).toBeNull();
    expect(parseEuroToCents("abc")).toBeNaN();
    expect(parseEuroToCents("12,3,4")).toBeNaN();
    expect(parseEuroToCents("1e3")).toBeNaN();
  });

  it("gibt negative Beträge zurück, damit Aufrufer sie ablehnen können", () => {
    expect(parseEuroToCents("-5")).toBe(-500);
  });

  it("liest jede Eingabe, die DECIMAL_PATTERN zulässt, als Dezimalzahl", () => {
    const pattern = new RegExp(`^(?:${DECIMAL_PATTERN})$`);
    for (const [input, cents] of [
      ["7", 700],
      ["7,1", 710],
      ["7.1", 710],
      ["7,25", 725],
      ["7.25", 725],
    ] as const) {
      expect(pattern.test(input), input).toBe(true);
      expect(parseEuroToCents(input), input).toBe(cents);
    }
  });
});
