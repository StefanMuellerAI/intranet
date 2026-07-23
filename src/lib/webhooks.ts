import "server-only";
import { createHmac } from "node:crypto";
import { and, eq, lte, or, isNull, sql } from "drizzle-orm";
import { db, webhookConfigs, webhookDeliveries } from "@/db";

/**
 * Ausgehende n8n-Webhooks:
 * - pro Kategorie und Ereignis konfigurierbar
 * - HMAC-SHA256-Signatur über den Payload (Header X-StefanAI-Signature)
 * - 3 Zustellversuche mit Backoff (1 min, 5 min, 30 min) über Vercel Cron
 * - Zustell-Log in webhook_deliveries
 */

const MAX_ATTEMPTS = 3;
const BACKOFF_MINUTES = [1, 5, 30];

export function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/** Ereignis auslösen: Zustellungen anlegen und sofort erstmals versuchen. */
export async function dispatchWebhookEvent(
  category: "urlaub" | "workation" | "reisekosten" | "krankmeldung" | "provision",
  event: string,
  payload: Record<string, unknown>
): Promise<void> {
  const configs = await db
    .select()
    .from(webhookConfigs)
    .where(
      and(
        eq(webhookConfigs.category, category),
        eq(webhookConfigs.event, event as never),
        eq(webhookConfigs.active, true)
      )
    );
  if (configs.length === 0) return;

  const fullPayload = {
    kategorie: category,
    ereignis: event,
    zeitstempel: new Date().toISOString(),
    ...payload,
  };

  for (const config of configs) {
    const [delivery] = await db
      .insert(webhookDeliveries)
      .values({
        configId: config.id,
        event,
        payload: fullPayload,
      })
      .returning();
    await attemptDelivery(delivery.id);
  }
}

/** Einen Zustellversuch ausführen und Log/Retry-Zustand fortschreiben. */
export async function attemptDelivery(deliveryId: string): Promise<void> {
  const delivery = await db.query.webhookDeliveries.findFirst({
    where: eq(webhookDeliveries.id, deliveryId),
  });
  if (!delivery || delivery.status === "erfolgreich") return;

  const config = await db.query.webhookConfigs.findFirst({
    where: eq(webhookConfigs.id, delivery.configId),
  });
  if (!config) return;

  const body = JSON.stringify(delivery.payload);
  const signature = signPayload(body, config.secret);
  const attempt = delivery.attempts + 1;

  let responseStatus: number | null = null;
  let responseBody = "";
  let ok = false;
  try {
    const res = await fetch(config.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-stefanai-signature": signature,
        "x-stefanai-event": delivery.event,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    responseStatus = res.status;
    responseBody = (await res.text()).slice(0, 2000);
    ok = res.ok;
  } catch (err) {
    responseBody = err instanceof Error ? err.message : String(err);
  }

  const failedFinally = !ok && attempt >= MAX_ATTEMPTS;
  const nextRetryAt =
    !ok && !failedFinally
      ? new Date(
          Date.now() + BACKOFF_MINUTES[Math.min(attempt - 1, BACKOFF_MINUTES.length - 1)] * 60_000
        )
      : null;

  await db
    .update(webhookDeliveries)
    .set({
      attempts: attempt,
      lastAttemptAt: new Date(),
      status: ok ? "erfolgreich" : failedFinally ? "fehlgeschlagen" : "ausstehend",
      nextRetryAt,
      responseStatus,
      responseBody,
    })
    .where(eq(webhookDeliveries.id, deliveryId));
}

/** Vom Cron aufgerufen: alle fälligen Wiederholungen ausführen. */
export async function retryDueDeliveries(): Promise<number> {
  const due = await db
    .select({ id: webhookDeliveries.id })
    .from(webhookDeliveries)
    .where(
      and(
        eq(webhookDeliveries.status, "ausstehend"),
        sql`${webhookDeliveries.attempts} > 0`,
        or(
          isNull(webhookDeliveries.nextRetryAt),
          lte(webhookDeliveries.nextRetryAt, new Date())
        )
      )
    );
  for (const d of due) {
    await attemptDelivery(d.id);
  }
  return due.length;
}
