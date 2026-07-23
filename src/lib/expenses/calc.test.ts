import { describe, expect, it } from "vitest";
import {
  calcCarCents,
  calcMealAllowance,
  calcMealDay,
  calcReportTotals,
  durationHours,
  suggestMealDays,
  type MealRates,
} from "./calc";

/** Startwerte exakt aus dem Blatt "Sätze" */
const RATES: MealRates = {
  fullDayCents: 2800,
  partialDayCents: 1400,
  breakfastCents: 560,
  lunchCents: 1120,
  dinnerCents: 1120,
  kmCents: 30,
  passengerKmCents: 2,
  employerDailySupplementCents: 0,
};

describe("Verpflegungspauschale (Excel-Logik)", () => {
  it("Beispiel A: Tagestour über 8 Std., nichts gestellt → 14,00 €", () => {
    const { totalCents } = calcMealAllowance(
      [
        {
          date: "2026-07-01",
          absenceType: "ueber_8_std",
          breakfastProvided: false,
          lunchProvided: false,
          dinnerProvided: false,
        },
      ],
      RATES
    );
    expect(totalCents).toBe(1400);
  });

  it("Beispiel B: zwei An-/Abreisetage ohne gestellte Mahlzeiten → 28,00 €", () => {
    const { totalCents } = calcMealAllowance(
      [
        {
          date: "2026-07-01",
          absenceType: "an_abreisetag",
          breakfastProvided: false,
          lunchProvided: false,
          dinnerProvided: false,
        },
        {
          date: "2026-07-02",
          absenceType: "an_abreisetag",
          breakfastProvided: false,
          lunchProvided: false,
          dinnerProvided: false,
        },
      ],
      RATES
    );
    expect(totalCents).toBe(2800);
  });

  it("Beispiel C (Abnahmekriterium 4): drei Tage, Hotelfrühstück an beiden Morgen, Kundenessen am vollen Tag → exakt 33,60 €", () => {
    const { rows, totalCents } = calcMealAllowance(
      [
        // Mo: An-/Abreisetag, nichts gestellt → 14,00
        {
          date: "2026-07-06",
          absenceType: "an_abreisetag",
          breakfastProvided: false,
          lunchProvided: false,
          dinnerProvided: false,
        },
        // Di: ganzer Tag, Frühstück + Mittag gestellt → 28,00 − 5,60 − 11,20 = 11,20
        {
          date: "2026-07-07",
          absenceType: "ganzer_tag",
          breakfastProvided: true,
          lunchProvided: true,
          dinnerProvided: false,
        },
        // Mi: An-/Abreisetag, Frühstück gestellt → 14,00 − 5,60 = 8,40
        {
          date: "2026-07-08",
          absenceType: "an_abreisetag",
          breakfastProvided: true,
          lunchProvided: false,
          dinnerProvided: false,
        },
      ],
      RATES
    );
    expect(rows[0].netCents).toBe(1400);
    expect(rows[1].netCents).toBe(1120);
    expect(rows[2].netCents).toBe(840);
    expect(totalCents).toBe(3360); // 33,60 €
  });

  it("Kürzung ist beim Grundsatz gekappt — nie negativ (22,40 € Kürzung auf 14,00 € → 0,00 €)", () => {
    const row = calcMealDay(
      {
        date: "2026-07-01",
        absenceType: "ueber_8_std",
        breakfastProvided: false,
        lunchProvided: true,
        dinnerProvided: true,
      },
      RATES
    );
    expect(row.reductionCents).toBe(1400); // MIN(1400, 2240)
    expect(row.netCents).toBe(0);
    expect(row.netCents).toBeGreaterThanOrEqual(0);
  });

  it("unter 8 Std. → Grundsatz 0, Pauschale 0, auch mit gestellten Mahlzeiten", () => {
    const row = calcMealDay(
      {
        date: "2026-07-01",
        absenceType: "unter_8_std",
        breakfastProvided: true,
        lunchProvided: true,
        dinnerProvided: true,
      },
      RATES
    );
    expect(row.grossCents).toBe(0);
    expect(row.netCents).toBe(0);
  });
});

describe("Privat-Pkw und Summenblock", () => {
  it("km-Pauschale: 100 km ohne Mitnahme → 30,00 €", () => {
    expect(calcCarCents(100, 0, RATES)).toBe(3000);
  });

  it("Mitnahme-Zuschlag: 100 km mit 2 Personen → 30,00 € + 4,00 €", () => {
    expect(calcCarCents(100, 2, RATES)).toBe(3400);
  });

  it("Gesamterstattung summiert alle Blöcke (Abnahmekriterium 4)", () => {
    const totals = calcReportTotals({
      mealAllowanceCents: 3360,
      transportItemCents: [1250, 890],
      carCents: 3400,
      lodgingItemCents: [11900],
      incidentalItemCents: [500],
      employerSupplementCents: 0,
    });
    expect(totals.transportCents).toBe(2140);
    expect(totals.totalCents).toBe(3360 + 2140 + 3400 + 11900 + 500);
  });
});

describe("Zeilenvorschlag und Reisedauer", () => {
  it("eintägig 6:30–20:15 → über 8 Std. (13,75 Std.)", () => {
    expect(durationHours("2026-07-01", "06:30", "2026-07-01", "20:15")).toBeCloseTo(
      13.75
    );
    const days = suggestMealDays("2026-07-01", "06:30", "2026-07-01", "20:15");
    expect(days).toHaveLength(1);
    expect(days[0].absenceType).toBe("ueber_8_std");
  });

  it("eintägig unter 8 Std. → unter 8 Std.", () => {
    const days = suggestMealDays("2026-07-01", "09:00", "2026-07-01", "15:00");
    expect(days[0].absenceType).toBe("unter_8_std");
  });

  it("dreitägig → An-/Abreisetag, ganzer Tag, An-/Abreisetag", () => {
    const days = suggestMealDays("2026-07-06", "18:00", "2026-07-08", "14:00");
    expect(days.map((d) => d.absenceType)).toEqual([
      "an_abreisetag",
      "ganzer_tag",
      "an_abreisetag",
    ]);
  });
});
