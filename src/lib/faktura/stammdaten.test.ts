import { describe, expect, it } from "vitest";
import {
  customerInputSchema,
  customerProjectLabel,
  projectInputSchema,
} from "./stammdaten";

const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";

/** Alle Fehlermeldungen einer Schema-Prüfung */
function errorsOf(input: Record<string, unknown>): string[] {
  const result = projectInputSchema.safeParse({
    customerId: CUSTOMER_ID,
    name: "Website-Relaunch",
    ...input,
  });
  return result.success
    ? []
    : result.error.issues.map((issue) => issue.message);
}

describe("projectInputSchema", () => {
  it("akzeptiert ein Projekt ohne Laufzeit und Limit und trimmt den Namen", () => {
    const result = projectInputSchema.parse({
      customerId: CUSTOMER_ID,
      name: "  Website-Relaunch ",
    });
    expect(result).toEqual({
      customerId: CUSTOMER_ID,
      name: "Website-Relaunch",
    });
  });

  it("verlangt Kunde und Projektnamen", () => {
    expect(errorsOf({ customerId: "" })).toEqual([
      "Bitte einen Kunden auswählen.",
    ]);
    expect(errorsOf({ name: "   " })).toEqual([
      "Bitte einen Projektnamen angeben.",
    ]);
  });

  it("wandelt das Monatslimit in eine Zahl und erlaubt das 0,25-Stunden-Raster", () => {
    expect(
      projectInputSchema.parse({
        customerId: CUSTOMER_ID,
        name: "X",
        monthlyLimitHours: "12.75",
      }).monthlyLimitHours
    ).toBe(12.75);
    for (const hours of [0.25, 0.5, 1, 40, 160.25])
      expect(errorsOf({ monthlyLimitHours: hours })).toEqual([]);
  });

  it("lehnt Limits außerhalb des 0,25-Stunden-Rasters ab", () => {
    for (const hours of [0.1, 1 / 3, 2.6, 0.3, 1.01])
      expect(errorsOf({ monthlyLimitHours: hours }), String(hours)).toEqual([
        "Das Monatslimit muss ein Vielfaches von 0,25 Stunden sein.",
      ]);
  });

  it("lehnt ein Limit von 0 oder kleiner ab", () => {
    expect(errorsOf({ monthlyLimitHours: 0 })).toEqual([
      "Das Monatslimit muss größer als 0 sein.",
    ]);
    expect(errorsOf({ monthlyLimitHours: -0.25 })).toEqual([
      "Das Monatslimit muss größer als 0 sein.",
    ]);
  });

  it("lehnt nicht-numerische Limits ab", () => {
    expect(errorsOf({ monthlyLimitHours: "abc" })).toHaveLength(1);
  });

  it("prüft Start- und Enddatum der Laufzeit einzeln", () => {
    expect(errorsOf({ validFrom: "2026-02-30" })).toEqual([
      "Ungültiges Laufzeit-Startdatum.",
    ]);
    expect(errorsOf({ validTo: "31.12.2026" })).toEqual([
      "Ungültiges Laufzeit-Enddatum.",
    ]);
    expect(errorsOf({ validFrom: "x", validTo: "y" })).toEqual([
      "Ungültiges Laufzeit-Startdatum.",
      "Ungültiges Laufzeit-Enddatum.",
    ]);
  });

  it("verlangt ein Laufzeitende nicht vor dem Beginn — ein Tag Laufzeit ist erlaubt", () => {
    expect(
      errorsOf({ validFrom: "2026-08-01", validTo: "2026-07-31" })
    ).toEqual(["Das Laufzeitende darf nicht vor dem Laufzeitbeginn liegen."]);
    expect(
      errorsOf({ validFrom: "2026-08-01", validTo: "2026-08-01" })
    ).toEqual([]);
    // Bei ungültigem Beginn kein zusätzlicher Reihenfolgefehler
    expect(
      errorsOf({ validFrom: "2026-13-01", validTo: "2026-01-01" })
    ).toEqual(["Ungültiges Laufzeit-Startdatum."]);
  });

  it("erlaubt eine einseitig offene Laufzeit", () => {
    expect(errorsOf({ validFrom: "2026-01-01" })).toEqual([]);
    expect(errorsOf({ validTo: "2026-12-31" })).toEqual([]);
  });
});

describe("customerInputSchema", () => {
  it("trimmt Felder und verlangt einen Namen", () => {
    expect(
      customerInputSchema.parse({
        name: " ACME ",
        address: " Weg 1 ",
        contactPerson: "",
      })
    ).toEqual({ name: "ACME", address: "Weg 1", contactPerson: "" });
    expect(
      customerInputSchema.safeParse({ name: " " }).error?.issues[0].message
    ).toBe("Bitte einen Kundennamen angeben.");
  });
});

describe("customerProjectLabel", () => {
  it("zeigt immer „Kunde – Projekt“", () => {
    expect(customerProjectLabel("ACME GmbH", "Support")).toBe(
      "ACME GmbH – Support"
    );
  });
});
