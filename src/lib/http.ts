/** Kleine Hilfen für Route-Handler (IDs prüfen, Downloads ausliefern). */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * IDs aus URLs vor der Datenbankabfrage prüfen: Postgres lehnt Nicht-UUIDs
 * mit einem Fehler ab, der sonst als 500 statt 404 endet.
 */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * Content-Disposition für hochgeladene Dateien. HTTP-Header dürfen nur
 * Latin-1 enthalten — Zeichen wie „–“ oder „€“ im Dateinamen ließen die
 * Antwort sonst mit einem 500 scheitern. Daher ein ASCII-Ersatzname plus
 * der vollständige Name nach RFC 6266 (filename*).
 */
export function attachmentDisposition(filename: string): string {
  const clean = filename.replaceAll('"', "").replace(/[\r\n]/g, " ");
  const ascii = clean
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7e]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean)}`;
}
