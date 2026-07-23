import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Zeitlich begrenzte, HMAC-signierte Download-URLs für Belege.
 * Belege werden nie direkt aus dem Blob-Store ausgeliefert, sondern über
 * /api/receipts/[id], das entweder eine App-Session oder eine gültige
 * Signatur verlangt (für n8n-Webhook-Payloads).
 */

function secret(): string {
  const s = process.env.DOWNLOAD_URL_SECRET;
  if (!s) throw new Error("DOWNLOAD_URL_SECRET ist nicht gesetzt.");
  return s;
}

export function signReceiptUrl(
  receiptId: string,
  validForSeconds = 60 * 60 * 24
): string {
  const expires = Math.floor(Date.now() / 1000) + validForSeconds;
  const sig = createHmac("sha256", secret())
    .update(`${receiptId}.${expires}`)
    .digest("hex");
  const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
  return `${baseUrl}/api/receipts/${receiptId}?expires=${expires}&sig=${sig}`;
}

export function verifyReceiptSignature(
  receiptId: string,
  expires: string,
  sig: string
): boolean {
  const expiresNum = Number(expires);
  if (!Number.isFinite(expiresNum) || expiresNum < Date.now() / 1000)
    return false;
  const expected = createHmac("sha256", secret())
    .update(`${receiptId}.${expires}`)
    .digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(sig || "0".repeat(64), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
