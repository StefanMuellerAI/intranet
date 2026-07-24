/**
 * Validierung für Dashboard-Inhalte (Links, Neuigkeiten & Teamevents).
 * Wird von den Admin-Server-Actions und den Unit-Tests genutzt.
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
