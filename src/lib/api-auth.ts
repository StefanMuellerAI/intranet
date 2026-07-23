import "server-only";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { apiKeys, db, users, type ApiKey, type User } from "@/db";
import { hashApiKey } from "@/lib/api-keys";

const RATE_LIMIT_PER_MINUTE = 60;

export interface ApiContext {
  apiKey: ApiKey;
  /** Admin-Konto, in dessen Namen die API agiert */
  actor: User;
}

export type ApiAuthResult =
  | { ok: true; context: ApiContext }
  | { ok: false; response: NextResponse };

function errorResponse(status: number, message: string): NextResponse {
  return NextResponse.json({ fehler: message }, { status });
}

/**
 * Authentifiziert eine API-Anfrage per Bearer-Key und wendet ein
 * Rate Limit (Fixed Window, 60 Anfragen/Minute je Key) an.
 */
export async function authenticateApiRequest(
  req: Request
): Promise<ApiAuthResult> {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match)
    return {
      ok: false,
      response: errorResponse(
        401,
        "Fehlender oder ungültiger Authorization-Header (Bearer-Key erforderlich)."
      ),
    };

  const key = await db.query.apiKeys.findFirst({
    where: eq(apiKeys.keyHash, hashApiKey(match[1].trim())),
  });
  if (!key)
    return { ok: false, response: errorResponse(401, "Ungültiger API-Key.") };
  if (key.revokedAt)
    return {
      ok: false,
      response: errorResponse(401, "Dieser API-Key wurde widerrufen."),
    };

  // Rate Limiting (Fixed Window pro Minute)
  const now = new Date();
  const windowExpired =
    !key.rateWindowStart ||
    now.getTime() - key.rateWindowStart.getTime() > 60_000;
  const count = windowExpired ? 1 : key.rateWindowCount + 1;
  if (!windowExpired && count > RATE_LIMIT_PER_MINUTE)
    return {
      ok: false,
      response: errorResponse(
        429,
        `Rate Limit erreicht (${RATE_LIMIT_PER_MINUTE} Anfragen pro Minute).`
      ),
    };
  await db
    .update(apiKeys)
    .set({
      lastUsedAt: now,
      rateWindowStart: windowExpired ? now : key.rateWindowStart,
      rateWindowCount: count,
    })
    .where(eq(apiKeys.id, key.id));

  // API-Keys agieren mit vollen Admin-Freigaberechten im Namen des Erstellers
  const actor = await db.query.users.findFirst({
    where: eq(users.id, key.createdById),
  });
  if (!actor)
    return {
      ok: false,
      response: errorResponse(401, "Zugehöriges Admin-Konto nicht gefunden."),
    };

  console.log(
    `[API] Key ${key.keyPrefix}… ${req.method} ${new URL(req.url).pathname}`
  );
  return { ok: true, context: { apiKey: key, actor } };
}
