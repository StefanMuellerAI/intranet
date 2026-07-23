import { describe, expect, it } from "vitest";
import { calcCommissionCents, type CommissionRates } from "./calc";

const RATES: CommissionRates = {
  halfDayCents: 5000,
  fullDayCents: 7500,
  twoDayCents: 10000,
  consultingPercent: 4,
};

describe("calcCommissionCents — Folge-Trainings", () => {
  it("halbtägig: 50 € je Training", () => {
    expect(
      calcCommissionCents(
        { businessType: "schulung", trainingFormat: "halbtaegig", trainingCount: 1 },
        RATES
      )
    ).toBe(5000);
    expect(
      calcCommissionCents(
        { businessType: "schulung", trainingFormat: "halbtaegig", trainingCount: 3 },
        RATES
      )
    ).toBe(15000);
  });

  it("ganztägig: 75 € je Training", () => {
    expect(
      calcCommissionCents(
        { businessType: "schulung", trainingFormat: "ganztaegig", trainingCount: 2 },
        RATES
      )
    ).toBe(15000);
  });

  it("zweitägig: 100 € je Training", () => {
    expect(
      calcCommissionCents(
        { businessType: "schulung", trainingFormat: "zweitaegig", trainingCount: 2 },
        RATES
      )
    ).toBe(20000);
  });

  it("abweichendes Format: keine automatische Berechnung", () => {
    expect(
      calcCommissionCents(
        { businessType: "schulung", trainingFormat: "abweichend", trainingCount: 1 },
        RATES
      )
    ).toBeNull();
  });

  it("fehlendes Format: keine automatische Berechnung", () => {
    expect(
      calcCommissionCents(
        { businessType: "schulung", trainingCount: 1 },
        RATES
      )
    ).toBeNull();
  });
});

describe("calcCommissionCents — Folgeberatungen", () => {
  it("4 % vom Nettoauftragswert", () => {
    expect(
      calcCommissionCents(
        { businessType: "beratung", netOrderValueCents: 1_000_000 },
        RATES
      )
    ).toBe(40_000); // 10.000 € → 400 €
  });

  it("rundet kaufmännisch auf ganze Cents", () => {
    // 123,45 € × 4 % = 4,938 € → 494 Cents
    expect(
      calcCommissionCents(
        { businessType: "beratung", netOrderValueCents: 12_345 },
        RATES
      )
    ).toBe(494);
  });

  it("0 € Nettoauftragswert ergibt 0", () => {
    expect(
      calcCommissionCents(
        { businessType: "beratung", netOrderValueCents: 0 },
        RATES
      )
    ).toBe(0);
  });

  it("geänderter Prozentsatz aus den Einstellungen wird angewendet", () => {
    expect(
      calcCommissionCents(
        { businessType: "beratung", netOrderValueCents: 100_000 },
        { ...RATES, consultingPercent: 5 }
      )
    ).toBe(5000);
  });
});
