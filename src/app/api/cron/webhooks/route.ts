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

/** Vercel Cron: fällige Webhook-Wiederholungen ausführen (Backoff-Retry). */
export async function GET(req: Request) {
  if (!isCronAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET))
    return NextResponse.json({ fehler: "Kein Zugriff." }, { status: 401 });

  const retried = await retryDueDeliveries();
  const geloescht = await pruneOldWebhookDeliveries();
  return NextResponse.json({ wiederholt: retried, geloescht });
}
