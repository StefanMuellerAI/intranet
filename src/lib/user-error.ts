import { ZodError } from "zod";

/**
 * Fachlicher Fehler mit nutzerlesbarer Meldung.
 *
 * Server Actions dürfen solche Fehler nicht werfen: Next.js maskiert
 * geworfene Fehlermeldungen in Production-Builds. Stattdessen werden sie
 * über runAction() als Rückgabewert an den Client transportiert.
 */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}

export type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * Führt eine Action-Logik aus und wandelt fachliche Fehler (UserError,
 * Zod-Validierung) in ein Ergebnisobjekt um. Unerwartete Fehler werden
 * serverseitig geloggt und nur generisch gemeldet.
 */
export async function runAction<T>(
  fn: () => Promise<T>
): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof UserError) return { ok: false, error: err.message };
    if (err instanceof ZodError) {
      const message = err.issues[0]?.message;
      if (message) return { ok: false, error: message };
    }
    console.error("Server-Action fehlgeschlagen:", err);
    return {
      ok: false,
      error: "Unerwarteter Fehler. Bitte versuchen Sie es später erneut.",
    };
  }
}
