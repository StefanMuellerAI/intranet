/**
 * Berechnungs-Engine der Reisekostenabrechnung.
 * Bildet die Formeln der Datei "Reisekostenabrechnung.xlsx" 1:1 ab:
 *
 *   Grundsatz  = Satz je Abwesenheitsart (ganzer Tag / An-Abreisetag bzw.
 *                über 8 Std. / unter 8 Std.)
 *   Kürzung    = MIN(Grundsatz, Summe der Kürzungen je gestellter Mahlzeit)
 *                → nie negativ (Kappung beim Grundsatz)
 *   Pauschale  = Grundsatz − Kürzung
 *   Privat-Pkw = km × km-Satz + km × Personen × Mitnahme-Satz
 *
 * Alle Beträge in Cents (ganzzahlig), um Rundungsfehler auszuschließen.
 */

import { eachDay, toISODate } from "@/lib/dates";

export type AbsenceType =
  | "ganzer_tag"
  | "an_abreisetag"
  | "ueber_8_std"
  | "unter_8_std";

export const ABSENCE_LABELS: Record<AbsenceType, string> = {
  ganzer_tag: "ganzer Tag",
  an_abreisetag: "An-/Abreisetag",
  ueber_8_std: "über 8 Std.",
  unter_8_std: "unter 8 Std.",
};

export interface MealRates {
  fullDayCents: number; // Sätze!C4 — voller Reisetag
  partialDayCents: number; // Sätze!C5 — An-/Abreisetag bzw. eintägig über 8 Std.
  breakfastCents: number; // Sätze!C8
  lunchCents: number; // Sätze!C9
  dinnerCents: number; // Sätze!C10
  kmCents: number; // Sätze!C13
  passengerKmCents: number; // Sätze!C14
  employerDailySupplementCents: number; // freiwilliger Zuschlag je anspruchsberechtigtem Reisetag
}

export interface MealDayInput {
  date: string; // ISO
  absenceType: AbsenceType;
  breakfastProvided: boolean;
  lunchProvided: boolean;
  dinnerProvided: boolean;
}

export interface MealDayResult extends MealDayInput {
  grossCents: number; // Grundsatz
  reductionCents: number; // Kürzung (gekappt)
  netCents: number; // Pauschale
}

/** Grundsatz je Abwesenheitsart (Excel: IF-Kaskade in Spalte G) */
export function grossForAbsence(type: AbsenceType, rates: MealRates): number {
  if (type === "ganzer_tag") return rates.fullDayCents;
  if (type === "an_abreisetag" || type === "ueber_8_std")
    return rates.partialDayCents;
  return 0;
}

/** Eine Verpflegungszeile berechnen (Excel-Zeilenformeln G/H/I) */
export function calcMealDay(day: MealDayInput, rates: MealRates): MealDayResult {
  const gross = grossForAbsence(day.absenceType, rates);
  const rawReduction =
    (day.breakfastProvided ? rates.breakfastCents : 0) +
    (day.lunchProvided ? rates.lunchCents : 0) +
    (day.dinnerProvided ? rates.dinnerCents : 0);
  const reduction = Math.min(gross, rawReduction);
  return {
    ...day,
    grossCents: gross,
    reductionCents: reduction,
    netCents: gross - reduction,
  };
}

/** Summe Verpflegung (Excel: SUM(I18:I27), hier ohne Zeilenlimit) */
export function calcMealAllowance(
  days: MealDayInput[],
  rates: MealRates
): { rows: MealDayResult[]; totalCents: number } {
  const rows = days.map((d) => calcMealDay(d, rates));
  return { rows, totalCents: rows.reduce((s, r) => s + r.netCents, 0) };
}

/** Privat-Pkw: km × Satz + km × Personen × Mitnahme-Zuschlag */
export function calcCarCents(
  kilometers: number,
  passengers: number,
  rates: MealRates
): number {
  return Math.round(
    kilometers * rates.kmCents + kilometers * passengers * rates.passengerKmCents
  );
}

/**
 * Freiwilliger Arbeitgeber-Zuschlag: je Reisetag mit Pauschalen-Anspruch
 * (Grundsatz > 0), Standard 0 €.
 */
export function calcEmployerSupplementCents(
  rows: MealDayResult[],
  rates: MealRates
): number {
  if (rates.employerDailySupplementCents <= 0) return 0;
  const eligibleDays = rows.filter((r) => r.grossCents > 0).length;
  return eligibleDays * rates.employerDailySupplementCents;
}

/**
 * Erzeugt aus dem Reisezeitraum eine Zeile pro Kalendertag und schlägt die
 * Abwesenheitsart vor: eintägig → über/unter 8 Std. nach Dauer; mehrtägig →
 * erster/letzter Tag An-/Abreisetag, dazwischen ganzer Tag.
 */
export function suggestMealDays(
  departureDate: string,
  departureTime: string,
  returnDate: string,
  returnTime: string
): MealDayInput[] {
  const days = eachDay(departureDate, returnDate);
  if (days.length === 0) return [];
  if (days.length === 1) {
    const hours = durationHours(
      departureDate,
      departureTime,
      returnDate,
      returnTime
    );
    return [
      {
        date: departureDate,
        absenceType: hours > 8 ? "ueber_8_std" : "unter_8_std",
        breakfastProvided: false,
        lunchProvided: false,
        dinnerProvided: false,
      },
    ];
  }
  return days.map((d, i) => ({
    date: toISODate(d),
    absenceType:
      i === 0 || i === days.length - 1 ? "an_abreisetag" : "ganzer_tag",
    breakfastProvided: false,
    lunchProvided: false,
    dinnerProvided: false,
  }));
}

/** Dauer gesamt in Stunden (Excel: (C13+C14)-(C11+C12)) */
export function durationHours(
  departureDate: string,
  departureTime: string,
  returnDate: string,
  returnTime: string
): number {
  const start = new Date(`${departureDate}T${departureTime}:00`);
  const end = new Date(`${returnDate}T${returnTime}:00`);
  return (end.getTime() - start.getTime()) / 3_600_000;
}

export interface ReportTotals {
  mealAllowanceCents: number;
  transportCents: number;
  carCents: number;
  lodgingCents: number;
  incidentalsCents: number;
  employerSupplementCents: number;
  totalCents: number;
}

/** Block 6 — Erstattungsbetrag (Excel: Summenblock) */
export function calcReportTotals(input: {
  mealAllowanceCents: number;
  transportItemCents: number[];
  carCents: number;
  lodgingItemCents: number[];
  incidentalItemCents: number[];
  employerSupplementCents: number;
}): ReportTotals {
  const transportCents = input.transportItemCents.reduce((s, v) => s + v, 0);
  const lodgingCents = input.lodgingItemCents.reduce((s, v) => s + v, 0);
  const incidentalsCents = input.incidentalItemCents.reduce((s, v) => s + v, 0);
  return {
    mealAllowanceCents: input.mealAllowanceCents,
    transportCents,
    carCents: input.carCents,
    lodgingCents,
    incidentalsCents,
    employerSupplementCents: input.employerSupplementCents,
    totalCents:
      input.mealAllowanceCents +
      transportCents +
      input.carCents +
      lodgingCents +
      incidentalsCents +
      input.employerSupplementCents,
  };
}

export function formatEuro(cents: number): string {
  return (cents / 100).toLocaleString("de-DE", {
    style: "currency",
    currency: "EUR",
  });
}
