/**
 * Validierung für Dashboard-Inhalte (Links & Neuigkeiten).
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
