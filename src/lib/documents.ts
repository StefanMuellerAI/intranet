import type { DocumentCategory } from "@/db/schema";

/** Anzeige-Labels für Dokument-Kategorien (Admin- und Mitarbeiter-Ansicht) */
export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  arbeitsvertrag: "Arbeitsvertrag",
  zusatzvereinbarung: "Zusatzvereinbarung",
  bescheinigung: "Bescheinigung",
  sonstiges: "Sonstiges",
};

/** Kategorien für Auswahlfelder — client-tauglich ohne Drizzle-Import */
export const DOCUMENT_CATEGORY_OPTIONS = Object.keys(
  DOCUMENT_CATEGORY_LABELS
) as DocumentCategory[];
