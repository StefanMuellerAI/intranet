/**
 * CORS für die öffentliche Zitate-Schnittstelle.
 *
 * Standardmäßig aus: Ohne gesetzte Umgebungsvariable `WEBSITE_CORS_ORIGINS`
 * liefert `corsHeaders()` nichts zurück, der Endpunkt ist dann nur
 * serverseitig nutzbar — der empfohlene Weg, weil der API-Key so nie im
 * ausgelieferten Frontend-Code landet.
 *
 * Wird die Variable gesetzt (kommaseparierte Liste vollständiger Origins,
 * z. B. "https://stefanai.de,https://www.stefanai.de"), darf die Website die
 * Route direkt aus dem Browser abrufen. Der Origin wird dabei nur
 * gespiegelt, wenn er exakt auf der Allowlist steht — nie "*", weil die Route
 * einen Authorization-Header verlangt.
 */

function allowedOrigins(): string[] {
  return (process.env.WEBSITE_CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin || !allowedOrigins().includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "authorization, if-none-match",
    // Ohne diese Zeile käme der Browser nicht an den ETag und könnte
    // if-none-match nicht setzen.
    "access-control-expose-headers": "etag",
    "access-control-max-age": "86400",
  };
}
