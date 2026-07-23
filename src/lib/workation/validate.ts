/**
 * Validierungen gemäß Workation-Richtlinie (Ziffern 5 und 6):
 * - max. 30 Arbeitstage pro Kalenderjahr (blockierend)
 * - max. 20 zusammenhängende Arbeitstage pro Aufenthalt (blockierend)
 * - 90-Tage-Plausibilitätswarnung je Land und Kalenderjahr
 * - Mindestvorlauf: 4 Wochen (EU/EWR/CH) bzw. 8 Wochen (Drittstaat) — Warnung,
 *   Admin kann dennoch genehmigen
 */

import { parseISODate } from "@/lib/dates";

export type CountryCategory = "eu_ewr_ch" | "drittstaat";

export interface WorkationValidationInput {
  startDate: string;
  endDate: string;
  workDays: number;
  daysInCountryThisYear: number;
  countryCategory: CountryCategory;
  /** Bereits genehmigte/eingereichte Arbeitstage im selben Kalenderjahr (ohne diesen Antrag) */
  usedWorkDaysThisYear: number;
  yearlyLimitDays: number; // Standard 30
  consecutiveLimitDays: number; // Standard 20
  /** Bezugsdatum für die Vorlaufprüfung (Standard: heute) */
  today?: Date;
}

export interface WorkationValidationResult {
  /** Blockierende Fehler — Einreichung nicht möglich */
  errors: string[];
  /** Warnungen — Einreichung möglich, bewusste Einzelfallentscheidung des Admins */
  warnings: string[];
  remainingWorkDays: number;
  minLeadWeeks: number;
}

export function validateWorkation(
  input: WorkationValidationInput
): WorkationValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const remaining =
    input.yearlyLimitDays - input.usedWorkDaysThisYear - input.workDays;

  if (remaining < 0) {
    errors.push(
      `Das Jahreskontingent von ${input.yearlyLimitDays} Arbeitstagen wird überschritten: ` +
        `${input.usedWorkDaysThisYear} Tage sind bereits verplant, dieser Antrag umfasst ${input.workDays} weitere Arbeitstage. ` +
        `Verfügbar sind noch ${Math.max(0, input.yearlyLimitDays - input.usedWorkDaysThisYear)} Arbeitstage.`
    );
  }

  if (input.workDays > input.consecutiveLimitDays) {
    errors.push(
      `Ein Aufenthalt darf höchstens ${input.consecutiveLimitDays} zusammenhängende Arbeitstage umfassen — ` +
        `dieser Antrag enthält ${input.workDays} Arbeitstage. Bitte den Zeitraum verkürzen.`
    );
  }

  // 90-Tage-Plausibilität: bisherige Tage im Land + Kalendertage dieses Aufenthalts
  const stayDays =
    Math.round(
      (parseISODate(input.endDate).getTime() -
        parseISODate(input.startDate).getTime()) /
        86_400_000
    ) + 1;
  const totalCountryDays = input.daysInCountryThisYear + stayDays;
  if (totalCountryDays > 90) {
    warnings.push(
      `Plausibilitätswarnung: Mit diesem Aufenthalt ergeben sich ${totalCountryDays} Tage in diesem Land ` +
        `im laufenden Kalenderjahr — die 90-Tage-Grenze der Richtlinie wird überschritten. Bitte prüfen.`
    );
  }

  // Mindestvorlauf
  const minLeadWeeks = input.countryCategory === "eu_ewr_ch" ? 4 : 8;
  const today = input.today ?? new Date();
  const todayMidnight = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );
  const leadDays = Math.floor(
    (parseISODate(input.startDate).getTime() - todayMidnight.getTime()) /
      86_400_000
  );
  if (leadDays < minLeadWeeks * 7) {
    warnings.push(
      `Der Mindestvorlauf von ${minLeadWeeks} Wochen (${
        input.countryCategory === "eu_ewr_ch" ? "EU/EWR/Schweiz" : "Drittstaat"
      }) ist unterschritten (${Math.max(0, leadDays)} Tage Vorlauf). ` +
        `Die Genehmigung ist eine bewusste Einzelfallentscheidung der Geschäftsführung.`
    );
  }

  // Aufenthalte über den Jahreswechsel: gesonderte steuerliche Prüfung (Ziffer 5)
  if (
    parseISODate(input.startDate).getFullYear() !==
    parseISODate(input.endDate).getFullYear()
  ) {
    warnings.push(
      "Der Aufenthalt erstreckt sich über den Jahreswechsel und bedarf gemäß Richtlinie einer gesonderten steuerlichen Prüfung."
    );
  }

  return { errors, warnings, remainingWorkDays: remaining, minLeadWeeks };
}

/** Die 7 Erklärungen aus Anlage 1 im Wortlaut */
export const WORKATION_DECLARATIONS = [
  {
    key: "declResidence",
    text: "Mein Wohnsitz und meine melderechtliche Anmeldung in Deutschland bleiben während des gesamten Zeitraums bestehen.",
  },
  {
    key: "declVisa",
    text: "Mein Aufenthaltstitel gestattet die Erbringung von Remote-Arbeit für einen ausländischen Arbeitgeber.",
  },
  {
    key: "declWorkingTime",
    text: "Ich halte die Vorgaben zu Arbeitszeit und Erreichbarkeit nach Ziffer 7 der Richtlinie ein.",
  },
  {
    key: "declDataProtection",
    text: "Ich halte die Vorgaben zu Datenschutz und IT-Sicherheit nach Ziffer 9 der Richtlinie ein.",
  },
  {
    key: "declNoForbiddenActivities",
    text: "Ich nehme im Aufenthaltsland keine der in Ziffer 8 als unzulässig bezeichneten Tätigkeiten vor, insbesondere keine Vertragsverhandlungen oder Vertragsabschlüsse für die Gesellschaft.",
  },
  {
    key: "declReportChanges",
    text: "Ich zeige Änderungen der Dauer, des Aufenthaltsorts oder des aufenthaltsrechtlichen Status unverzüglich an.",
  },
  {
    key: "declCosts",
    text: "Mir ist bekannt, dass ich die Kosten des Aufenthalts selbst trage und dass keine Reisekosten oder Verpflegungspauschalen erstattet werden.",
  },
] as const;

export type DeclarationKey = (typeof WORKATION_DECLARATIONS)[number]["key"];

/** Vereinbarungstext aus Anlage 1 (für das Genehmigungs-PDF) */
export const WORKATION_AGREEMENT_TEXT =
  "Die Erbringung der Arbeitsleistung aus dem oben genannten Land ist von vornherein auf den " +
  "oben genannten Zeitraum befristet. Das Arbeitsverhältnis mit der StefanAI Solutions GmbH " +
  "besteht während dieser Zeit unverändert fort; arbeitsvertraglicher Arbeitsort bleibt Köln. Mit " +
  "Ablauf des genannten Enddatums wird die Arbeitsleistung wieder vom Inland aus erbracht. Die " +
  "Gesellschaft kann die Genehmigung nach Ziffer 13 der Richtlinie widerrufen.";

/** EU/EWR/Schweiz-Länder zur automatischen Kennzeichnung */
export const EU_EWR_CH_COUNTRIES = [
  "Belgien",
  "Bulgarien",
  "Dänemark",
  "Deutschland",
  "Estland",
  "Finnland",
  "Frankreich",
  "Griechenland",
  "Irland",
  "Island",
  "Italien",
  "Kroatien",
  "Lettland",
  "Liechtenstein",
  "Litauen",
  "Luxemburg",
  "Malta",
  "Niederlande",
  "Norwegen",
  "Österreich",
  "Polen",
  "Portugal",
  "Rumänien",
  "Schweden",
  "Schweiz",
  "Slowakei",
  "Slowenien",
  "Spanien",
  "Tschechien",
  "Ungarn",
  "Zypern",
];

export function classifyCountry(country: string): CountryCategory {
  const normalized = country.trim().toLowerCase();
  return EU_EWR_CH_COUNTRIES.some((c) => c.toLowerCase() === normalized)
    ? "eu_ewr_ch"
    : "drittstaat";
}
