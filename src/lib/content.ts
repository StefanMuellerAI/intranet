/**
 * Validierung für Dashboard-Inhalte (Links, Neuigkeiten, Teamevents &
 * Sales-Nachrichten). Wird von den Admin-Server-Actions und den Unit-Tests
 * genutzt.
 */

export function requireNonEmpty(value: string, label: string): string {
  const text = value.trim();
  if (!text) throw new Error(`${label} ist erforderlich.`);
  return text;
}

/** Erlaubt nur http(s)-URLs und normalisiert sie über `URL`. */
export function parseExternalUrl(raw: string): string {
  const text = requireNonEmpty(raw, "URL");
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error("Ungültige URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("URL muss mit http:// oder https:// beginnen.");
  }
  return url.toString();
}

export function parseSortOrder(raw: string): number {
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || n < 0) throw new Error("Ungültige Sortierung.");
  return Math.round(n);
}

/** Erwartet ein Kalenderdatum im Format JJJJ-MM-TT (HTML-Date-Input). */
export function parseISODateInput(raw: string, label: string): string {
  const text = requireNonEmpty(raw, label);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error(`${label} ist ungültig.`);
  }
  const [y, m, d] = text.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== m - 1 ||
    date.getDate() !== d
  ) {
    throw new Error(`${label} ist ungültig.`);
  }
  return text;
}

/**
 * Zeitraum eines Teamevents: Enddatum ist optional — leer bedeutet
 * eintägiges Event (Enddatum = Startdatum).
 */
export function parseEventRange(
  startRaw: string,
  endRaw: string
): { startDate: string; endDate: string } {
  const startDate = parseISODateInput(startRaw, "Startdatum");
  const endDate = endRaw.trim()
    ? parseISODateInput(endRaw, "Enddatum")
    : startDate;
  if (endDate < startDate) {
    throw new Error("Das Enddatum darf nicht vor dem Startdatum liegen.");
  }
  return { startDate, endDate };
}

// ---------------------------------------------------------------------------
// Sales-Nachrichten
// ---------------------------------------------------------------------------

/** Anzahl Tage, die eine Sales-Nachricht auf dem Dashboard angezeigt wird. */
export const SALES_NEWS_DASHBOARD_DAYS = 14;

/**
 * Frühester Veröffentlichungszeitpunkt, mit dem eine Sales-Nachricht noch
 * auf dem Dashboard erscheint (jetzt minus 14 Tage).
 */
export function salesNewsDashboardCutoff(now: Date): Date {
  return new Date(
    now.getTime() - SALES_NEWS_DASHBOARD_DAYS * 24 * 60 * 60 * 1000
  );
}

/**
 * Auftragsvolumen in Euro → Cents. Akzeptiert Punkt- und Komma-Dezimale
 * (ohne Tausendertrennzeichen), verlangt einen positiven Betrag und begrenzt
 * ihn auf 20 Mio. € (Integer-Spalte).
 */
export function parseEuroVolume(raw: string): number {
  const text = requireNonEmpty(raw, "Volumen");
  const n = Number(text.replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) throw new Error("Ungültiges Volumen.");
  const cents = Math.round(n * 100);
  if (cents > 2_000_000_000) {
    throw new Error("Volumen ist zu groß (max. 20 Mio. €).");
  }
  return cents;
}

/**
 * Wahrscheinlicher Leistungszeitraum: Ende ist optional — leer bedeutet
 * eintägige Leistung (Ende = Beginn).
 */
export function parseDeliveryRange(
  startRaw: string,
  endRaw: string
): { deliveryStart: string; deliveryEnd: string } {
  const deliveryStart = parseISODateInput(startRaw, "Leistungsbeginn");
  const deliveryEnd = endRaw.trim()
    ? parseISODateInput(endRaw, "Leistungsende")
    : deliveryStart;
  if (deliveryEnd < deliveryStart) {
    throw new Error("Das Leistungsende darf nicht vor dem Beginn liegen.");
  }
  return { deliveryStart, deliveryEnd };
}
