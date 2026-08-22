/**
 * Validierung, Labels und CSV-Aufbereitung der Seminar- und Beratungsberichte.
 * Bewusst ohne Drizzle-Import, damit Labels und Schema auch in
 * Client-Komponenten verwendbar bleiben und sich die Datei ohne Datenbank
 * testen lässt. Die Arten sind in `src/db/schema.ts` als Spalten-Enum
 * gespiegelt; beim Insert prüft TypeScript, dass beide Seiten zusammenpassen.
 */

import { z } from "zod";

export const SEMINAR_REPORT_KINDS = ["seminar", "beratung"] as const;
export type SeminarReportKind = (typeof SEMINAR_REPORT_KINDS)[number];

export const SEMINAR_REPORT_KIND_LABELS: Record<SeminarReportKind, string> = {
  seminar: "Seminar",
  beratung: "Beratung",
};

export const FEEDBACK_RATINGS = [1, 2, 3, 4, 5] as const;
export type FeedbackRating = (typeof FEEDBACK_RATINGS)[number];

/**
 * Die Skala wird überall ausgeschrieben, damit sie nicht versehentlich als
 * Schulnote gelesen wird: 5 ist die beste Bewertung, nicht die schlechteste.
 */
export const FEEDBACK_RATING_LABELS: Record<FeedbackRating, string> = {
  1: "1 — sehr schlecht",
  2: "2 — schlecht",
  3: "3 — befriedigend",
  4: "4 — gut",
  5: "5 — sehr gut",
};

export const FEEDBACK_SCALE_HINT = "1 = sehr schlecht, 5 = sehr gut";

export const TEXT_MAX_LENGTH = 4000;
export const QUOTE_MAX_LENGTH = 1000;
export const QUOTES_MAX_COUNT = 20;
export const NAME_MAX_LENGTH = 200;

/** Dauer in Tagen im 0,5er-Raster, z. B. "0,5" / "1" / "2,5" — als HTML-pattern */
export const DURATION_DAYS_PATTERN = "[0-9]+([.,](0|00|5|50))?";

export const DURATION_DAYS_TITLE =
  "Bitte die Dauer in halben Tagen angeben, z. B. 0,5 oder 1,5";

/** "1,5" oder "1.5" → 1.5; leere oder ungültige Eingaben → null. */
export function parseDurationDays(raw: string): number | null {
  const text = raw.trim().replace(",", ".");
  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** Dauer für die Anzeige, z. B. "1 Tag" / "0,5 Tage" / "2 Tage". */
export function formatDurationDays(days: number): string {
  const text = days.toLocaleString("de-DE", { maximumFractionDigits: 1 });
  return `${text} ${days === 1 ? "Tag" : "Tage"}`;
}

/** Durchschnittliches Feedback auf eine Nachkommastelle, null ohne Berichte. */
export function averageRating(ratings: number[]): number | null {
  if (ratings.length === 0) return null;
  const sum = ratings.reduce((total, value) => total + value, 0);
  return Math.round((sum / ratings.length) * 10) / 10;
}

/** Wortlaut eines einzelnen Zitats — auch für die Admin-Korrektur einzeln nutzbar. */
export const quoteTextSchema = z
  .string()
  .trim()
  .min(1, "Bitte das Zitat eingeben.")
  .max(QUOTE_MAX_LENGTH, `Zitate dürfen höchstens ${QUOTE_MAX_LENGTH} Zeichen lang sein.`);

const quoteSchema = z.object({
  /** null = neue Zeile; vorhandene Ids behalten ihre Website-Freigabe */
  id: z.uuid().nullable(),
  quote: z
    .string()
    .trim()
    .min(1, "Bitte das Zitat eingeben oder die Zeile entfernen.")
    .max(QUOTE_MAX_LENGTH, `Zitate dürfen höchstens ${QUOTE_MAX_LENGTH} Zeichen lang sein.`),
});

export const seminarReportInputSchema = z.object({
  kind: z.enum(SEMINAR_REPORT_KINDS, {
    message: "Bitte Seminar oder Beratung wählen.",
  }),
  customerName: z
    .string()
    .trim()
    .min(1, "Bitte Kunde/Organisation angeben.")
    .max(NAME_MAX_LENGTH),
  title: z
    .string()
    .trim()
    .min(1, "Bitte den Titel der Veranstaltung angeben.")
    .max(NAME_MAX_LENGTH),
  eventDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Bitte das Datum der Veranstaltung angeben."),
  durationDays: z
    .number({ message: "Bitte die Dauer angeben." })
    .positive("Die Dauer muss größer als 0 sein.")
    .max(60, "Bitte die Dauer in Tagen angeben (höchstens 60).")
    .refine(
      (value) => Number.isInteger(value * 2),
      "Bitte die Dauer in halben Tagen angeben, z. B. 0,5 oder 1,5."
    ),
  whatWentWell: z
    .string()
    .trim()
    .min(1, "Bitte angeben, was gut lief.")
    .max(TEXT_MAX_LENGTH),
  whatWentBadly: z
    .string()
    .trim()
    .min(1, "Bitte angeben, was nicht gut lief.")
    .max(TEXT_MAX_LENGTH),
  improvements: z
    .string()
    .trim()
    .min(1, "Bitte angeben, was Sie beim nächsten Mal verbessern möchten.")
    .max(TEXT_MAX_LENGTH),
  feedbackRating: z
    .number({ message: "Bitte das Teilnehmenden-Feedback angeben." })
    .int()
    .min(1, "Das Feedback liegt zwischen 1 und 5.")
    .max(5, "Das Feedback liegt zwischen 1 und 5."),
  quotes: z
    .array(quoteSchema)
    .max(
      QUOTES_MAX_COUNT,
      `Bitte höchstens ${QUOTES_MAX_COUNT} Zitate je Bericht erfassen.`
    ),
});

export type SeminarReportInput = z.infer<typeof seminarReportInputSchema>;
export type SeminarReportQuoteInput = z.infer<typeof quoteSchema>;

// ---------------------------------------------------------------------------
// Abgleich der Zitate beim Bearbeiten
// ---------------------------------------------------------------------------

export interface ExistingQuote {
  id: string;
  quote: string;
  websiteApproved: boolean;
}

export interface QuoteChangePlan {
  /** Ids der Zitate, die im Formular nicht mehr vorkommen */
  remove: string[];
  update: {
    id: string;
    quote: string;
    position: number;
    /** Bei geändertem Wortlaut muss der Admin erneut freigeben */
    resetApproval: boolean;
  }[];
  insert: { quote: string; position: number }[];
}

export interface QuotePlanOptions {
  /**
   * Freigabe auch bei geändertem Wortlaut behalten. Gilt für Korrekturen des
   * Admins: Er ist die freigebende Stelle, also soll ausgerechnet sein
   * Feinschliff ein Zitat nicht stillschweigend von der Website nehmen.
   */
  keepApproval?: boolean;
}

/**
 * Entscheidet, welche Zitate gelöscht, aktualisiert und angelegt werden.
 *
 * Bewusst ein Abgleich über die Id statt „alles löschen und neu anlegen":
 * sonst würde jede Bearbeitung die vom Admin gesetzte Website-Freigabe
 * stillschweigend zurücksetzen. Ids, die nicht zum Bericht gehören, werden
 * wie neue Zitate behandelt — eine untergeschobene fremde Id kann damit kein
 * fremdes Zitat überschreiben.
 */
export function planQuoteChanges(
  existing: ExistingQuote[],
  incoming: SeminarReportQuoteInput[],
  options: QuotePlanOptions = {}
): QuoteChangePlan {
  const existingById = new Map(existing.map((quote) => [quote.id, quote]));
  const plan: QuoteChangePlan = { remove: [], update: [], insert: [] };
  const kept = new Set<string>();

  incoming.forEach((quote, position) => {
    const match = quote.id ? existingById.get(quote.id) : undefined;
    if (!match) {
      plan.insert.push({ quote: quote.quote, position });
      return;
    }
    // Eine Id darf nur einmal zugeordnet werden, sonst würden zwei Zeilen
    // dieselbe Datenbankzeile beschreiben.
    if (kept.has(match.id)) {
      plan.insert.push({ quote: quote.quote, position });
      return;
    }
    kept.add(match.id);
    plan.update.push({
      id: match.id,
      quote: quote.quote,
      position,
      resetApproval:
        !options.keepApproval &&
        match.websiteApproved &&
        match.quote !== quote.quote,
    });
  });

  plan.remove = existing
    .filter((quote) => !kept.has(quote.id))
    .map((quote) => quote.id);

  return plan;
}
