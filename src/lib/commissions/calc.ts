/**
 * Berechnung der Provisionsansprüche gemäß Zusatzvereinbarung:
 *
 *   Folge-Trainings   = Anzahl × Satz je Format
 *                       (halbtägig 50 €, ganztägig 75 €, zweitägig 100 €);
 *                       abweichende Formate → Pauschale individuell (kein
 *                       Autobetrag, Admin trägt bei der Freigabe ein)
 *   Folgeberatungen   = 4 % vom Nettoauftragswert (brutto)
 *   Neukunden-Vermittlung: zusätzlich individuelle Vermittlungsprovision,
 *                       die der Admin bei der Freigabe pflegt
 *
 * Alle Beträge in Cents (ganzzahlig), um Rundungsfehler auszuschließen.
 */

export type BusinessType = "beratung" | "schulung";
export type CustomerType = "neukunde" | "bestandskunde";
export type CommissionUnit = "tage" | "liefergegenstaende";
export type TrainingFormat =
  | "halbtaegig"
  | "ganztaegig"
  | "zweitaegig"
  | "abweichend";

export const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  beratung: "Beratung",
  schulung: "Schulung",
};

export const CUSTOMER_TYPE_LABELS: Record<CustomerType, string> = {
  neukunde: "Neukunde",
  bestandskunde: "Bestandskunde",
};

export const UNIT_LABELS: Record<CommissionUnit, string> = {
  tage: "Tage",
  liefergegenstaende: "Liefergegenstände",
};

export const TRAINING_FORMAT_LABELS: Record<TrainingFormat, string> = {
  halbtaegig: "halbtägig",
  ganztaegig: "ganztägig",
  zweitaegig: "zweitägig",
  abweichend: "abweichendes Format (Pauschale)",
};

export interface CommissionRates {
  halfDayCents: number;
  fullDayCents: number;
  twoDayCents: number;
  consultingPercent: number;
}

export interface CommissionInput {
  businessType: BusinessType;
  trainingFormat?: TrainingFormat | null;
  trainingCount?: number | null;
  netOrderValueCents?: number | null;
}

/**
 * Automatisch berechneter Anspruch in Cents.
 * `null`, wenn keine automatische Berechnung möglich ist
 * (Schulung mit abweichendem Format → individuelle Pauschale).
 */
export function calcCommissionCents(
  input: CommissionInput,
  rates: CommissionRates
): number | null {
  if (input.businessType === "beratung") {
    const net = input.netOrderValueCents ?? 0;
    return Math.round((net * rates.consultingPercent) / 100);
  }
  const count = input.trainingCount ?? 0;
  switch (input.trainingFormat) {
    case "halbtaegig":
      return count * rates.halfDayCents;
    case "ganztaegig":
      return count * rates.fullDayCents;
    case "zweitaegig":
      return count * rates.twoDayCents;
    default:
      return null;
  }
}
