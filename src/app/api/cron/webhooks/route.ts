import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { pruneOldWebhookDeliveries, retryDueDeliveries } from "@/lib/webhooks";

export const preferredRegion = "fra1";

/**
 * Prüft den Bearer-Cron-Secret in konstanter Zeit. Fail-closed: ohne
 * gesetztes CRON_SECRET (oder ohne/mit falschem Header) wird abgelehnt —
 * die Route darf niemals unauthentifiziert erreichbar sein.
 */
function isCronAuthorized(
  authHeader: string | null,
  secret: string | undefined
): boolean {
  if (!secret || !authHeader) return false;
  const provided = Buffer.from(authHeader);
  const expected = Buffer.from(`Bearer ${secret}`);
  return (
    provided.length === expected.length && timingSafeEqual(provided, expected)
  );
}

/**
 * Führt einen Cron-Schritt aus und fängt dabei Fehler ab. Der Cron ist ein
 * Best-Effort-Hintergrundjob: eine vorübergehend nicht erreichbare Datenbank
 * darf ihn nicht mit 500 abbrechen lassen, sonst füllt jeder Ausfall mit jedem
 * Cron-Lauf das Fehlerprotokoll und verdeckt die echten Fehler. Der Fehler wird
 * geloggt und in der Antwort gemeldet; fällige Zustellungen bleiben in der
 * Datenbank und werden beim nächsten Lauf erneut versucht.
 */
async function schritt<T>(
  name: string,
  aufgabe: () => Promise<T>
): Promise<{ wert: T | null; fehler: string | null }> {
  try {
    return { wert: await aufgabe(), fehler: null };
  } catch (err) {
    console.error(`Webhook-Cron: ${name} fehlgeschlagen:`, err);
    return { wert: null, fehler: err instanceof Error ? err.message : String(err) };
  }
}

/** Vercel Cron: fällige Webhook-Wiederholungen ausführen (Backoff-Retry). */
export async function GET(req: Request) {
  if (!isCronAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET))
    return NextResponse.json({ fehler: "Kein Zugriff." }, { status: 401 });

  // Beide Schritte sind unabhängig: scheitert die Wiederholung, soll das
  // Aufräumen trotzdem laufen (und umgekehrt).
  const retried = await schritt("Wiederholung", retryDueDeliveries);
  const geloescht = await schritt("Aufräumen", pruneOldWebhookDeliveries);

  const fehler = [retried.fehler, geloescht.fehler].filter(Boolean);
  return NextResponse.json({
    wiederholt: retried.wert,
    geloescht: geloescht.wert,
    ...(fehler.length ? { fehler } : {}),
  });
}
