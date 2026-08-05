import "server-only";
import { createHmac } from "node:crypto";
import { and, eq, lt, lte, or, isNull, sql } from "drizzle-orm";
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

/** Interne/private Hosts, die ein Webhook nie ansprechen darf (SSRF). */
function isPrivateHost(host: string): boolean {
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  )
    return true;
  // IPv6: Loopback, Link-local (fe80::/10), Unique-local (fc00::/7)
  if (host === "::1" || host.startsWith("fe80:") || /^f[cd]/.test(host))
    return true;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (a === 0 || a === 127) return true; // "dieses Netz" / Loopback
    if (a === 10) return true; // RFC1918
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 192 && b === 168) return true; // RFC1918
    if (a === 169 && b === 254) return true; // Link-local + Cloud-Metadaten
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  }
  return false;
}

/**
 * SSRF-Schutz für ausgehende Webhooks: nur https und keine internen Adressen.
 * IP-Literale werden direkt geblockt; Hostnamen lassen sich per DNS theoretisch
 * umgehen (DNS-Rebinding), die offensichtlichen internen Ziele sind aber
 * ausgeschlossen. Wird beim Anlegen (Einstellungen) und vor jeder Zustellung
 * geprüft.
 */
export function assertSafeWebhookUrl(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Ungültige Webhook-URL.");
  }
  if (url.protocol !== "https:")
    throw new Error("Die Webhook-URL muss mit https:// beginnen.");
  if (isPrivateHost(url.hostname.toLowerCase()))
    throw new Error(
      "Die Webhook-URL darf keine internen oder privaten Adressen ansprechen."
    );
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
    // Defense-in-depth: auch gespeicherte Ziel-URLs vor jeder Zustellung prüfen.
    assertSafeWebhookUrl(config.url);
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

/**
 * Betriebslogs sind keine Geschäftsunterlagen: alte Zustellungen samt Payload
 * (enthält Antragsdaten, E-Mail-Adressen und signierte Beleg-Links) werden nach
 * Ablauf gelöscht, statt unbegrenzt zu wachsen. Gibt die Anzahl gelöschter
 * Zeilen zurück.
 */
const DELIVERY_RETENTION_DAYS = 30;

export async function pruneOldWebhookDeliveries(
  retentionDays = DELIVERY_RETENTION_DAYS
): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const deleted = await db
    .delete(webhookDeliveries)
    .where(lt(webhookDeliveries.createdAt, cutoff))
    .returning({ id: webhookDeliveries.id });
  return deleted.length;
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
