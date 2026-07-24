import { describe, expect, it } from "vitest";
import {
  normalizeForFilename,
  periodFilenameLabel,
  timesheetFilename,
} from "./stundenzettel";

describe("normalizeForFilename (Edge Case 19)", () => {
  it("ersetzt Umlaute und ß", () => {
    expect(normalizeForFilename("Müller & Söhne GmbH")).toBe(
      "Mueller-Soehne-GmbH"
    );
    expect(normalizeForFilename("Straßenbau Äußerst Öde")).toBe(
      "Strassenbau-Aeusserst-Oede"
    );
  });

  it("entfernt Slashes, Leerzeichen und Sonderzeichen", () => {
    expect(normalizeForFilename("ACME / Sub-Unit  #7")).toBe("ACME-Sub-Unit-7");
    expect(normalizeForFilename("a\\b:c*d?e")).toBe("a-b-c-d-e");
  });

  it("entfernt Akzente und liefert nie einen leeren Namen", () => {
    expect(normalizeForFilename("Café René")).toBe("Cafe-Rene");
    expect(normalizeForFilename("///")).toBe("Kunde");
    expect(normalizeForFilename("  ")).toBe("Kunde");
  });
});

describe("periodFilenameLabel", () => {
  it("kompakter Monat bei vollem Kalendermonat", () => {
    expect(periodFilenameLabel("2026-07-01", "2026-07-31")).toBe("2026-07");
    expect(periodFilenameLabel("2026-02-01", "2026-02-28")).toBe("2026-02");
    // Schaltjahr
    expect(periodFilenameLabel("2028-02-01", "2028-02-29")).toBe("2028-02");
  });

  it("von_bis bei freiem Zeitraum", () => {
    expect(periodFilenameLabel("2026-07-20", "2026-07-26")).toBe(
      "2026-07-20_2026-07-26"
    );
    expect(periodFilenameLabel("2026-02-01", "2026-02-27")).toBe(
      "2026-02-01_2026-02-27"
    );
  });
});

describe("timesheetFilename (FA-6.7)", () => {
  it("baut den vollständigen Dateinamen", () => {
    expect(
      timesheetFilename("Müller / Partner", "2026-07-01", "2026-07-31", 3)
    ).toBe("Stundenzettel_Mueller-Partner_2026-07_v3.pdf");
  });
});
