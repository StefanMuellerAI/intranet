/**
 * Berechtigungsumfänge der API-Keys.
 *
 * Bewusst ohne Drizzle-Import, damit die Bezeichnungen auch in
 * Client-Komponenten (Einstellungen) verwendbar bleiben. Die Liste ist in
 * `src/db/schema.ts` als Spalten-Enum gespiegelt; welcher Umfang welchen
 * Endpunkt erreicht, entscheidet allein die Allowlist im jeweiligen
 * Route-Handler (siehe `authenticateApiRequest`).
 */

export const API_KEY_SCOPES = ["readonly", "full", "website"] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const API_KEY_SCOPE_LABELS: Record<ApiKeyScope, string> = {
  readonly: "Nur lesen",
  full: "Lesen + Freigeben",
  website: "Website (nur Zitate)",
};

export const API_KEY_SCOPE_HINTS: Record<ApiKeyScope, string> = {
  readonly: "Anträge, Abwesenheiten und Faktura lesen",
  full: "Zusätzlich Freigaben auslösen",
  website: "Nur freigegebene Zitate — kein Zugriff auf HR- oder Faktura-Daten",
};

export function isApiKeyScope(value: unknown): value is ApiKeyScope {
  return (
    typeof value === "string" &&
    (API_KEY_SCOPES as readonly string[]).includes(value)
  );
}
