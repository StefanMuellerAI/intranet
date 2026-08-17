/**
 * CSV-Export der für die Website freigegebenen Teilnehmenden-Zitate.
 *
 * Format wie beim IT- und Faktura-Export: Semikolon als Trennzeichen, UTF-8
 * mit BOM und CRLF — so öffnet Excel die Datei per Doppelklick korrekt.
 * Bewusst ohne Drizzle-Import, damit die Funktion ohne Datenbank testbar ist.
 */

import { formatDateDE } from "@/lib/dates";
import {
  SEMINAR_REPORT_KIND_LABELS,
  type SeminarReportKind,
} from "@/lib/seminar-reports";

export interface QuoteExportRow {
  quote: string;
  kind: SeminarReportKind;
  title: string;
  customerName: string;
  eventDate: string;
  userName: string;
}

/** Spaltenüberschriften — sie sind die Schnittstelle zur Tabellenkalkulation. */
const COLUMN_ORDER = [
  "Zitat",
  "Art",
  "Veranstaltung",
  "Kunde",
  "Datum",
  "Mitarbeiter/in",
];

function csvField(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function buildQuotesCsv(rows: QuoteExportRow[]): string {
  const lines = [
    COLUMN_ORDER.join(";"),
    ...rows.map((row) =>
      [
        row.quote,
        SEMINAR_REPORT_KIND_LABELS[row.kind],
        row.title,
        row.customerName,
        formatDateDE(row.eventDate),
        row.userName,
      ]
        .map(csvField)
        .join(";")
    ),
  ];
  return "﻿" + lines.join("\r\n");
}
