import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { authenticateApiRequest } from "@/lib/api-auth";
import {
  listApprovedQuotesForWebsite,
  WEBSITE_QUOTES_MAX_LIMIT,
} from "@/lib/seminar-reports-store";
import { corsHeaders } from "@/lib/website-cors";

export const preferredRegion = "fra1";

/**
 * GET /api/v1/website/zitate — die vom Admin für die Website freigegebenen
 * Teilnehmenden-Zitate, gedacht für die Einbindung auf der Firmenwebsite
 * durch externe Dienstleister.
 *
 * Die Zitate sind anonym: Es gibt weder zur zitierenden Person noch zu
 * der/dem Vortragenden eine Namensangabe, und auch Kunde, Titel und Datum
 * des Berichts bleiben innen. Ausgeliefert werden nur die stabile Id und der
 * Wortlaut. Keys mit dem Umfang "website" erreichen ausschließlich diesen
 * Endpunkt; readonly- und full-Keys dürfen ihn ebenfalls lesen, damit
 * bestehende Integrationen keinen zweiten Key brauchen.
 *
 * Optional: ?limit=1..200 (Standard: 200).
 */
export async function GET(req: Request) {
  const cors = corsHeaders(req.headers.get("origin"));

  const auth = await authenticateApiRequest(req, {
    allowScopes: ["website", "readonly", "full"],
  });
  if (!auth.ok) {
    for (const [key, value] of Object.entries(cors))
      auth.response.headers.set(key, value);
    return auth.response;
  }

  const limitParam = new URL(req.url).searchParams.get("limit");
  const limit = limitParam === null ? undefined : Number(limitParam);
  if (
    limit !== undefined &&
    (!Number.isInteger(limit) || limit < 1 || limit > WEBSITE_QUOTES_MAX_LIMIT)
  )
    return NextResponse.json(
      {
        fehler: `Parameter 'limit' muss eine ganze Zahl zwischen 1 und ${WEBSITE_QUOTES_MAX_LIMIT} sein.`,
      },
      { status: 400, headers: cors }
    );

  const rows = await listApprovedQuotesForWebsite({ limit });
  const body = JSON.stringify({
    zitate: rows.map((row) => ({ id: row.id, zitat: row.quote })),
    anzahl: rows.length,
  });

  // Kein Last-Modified: Das Setzen oder Zurückziehen einer Freigabe ändert
  // keinen Zeitstempel in der Datenbank, ein daraus abgeleiteter Wert wäre
  // also genau bei der Änderung falsch, die die Website interessiert. Der
  // ETag über den Antwortinhalt erfasst dagegen jede Änderung.
  const etag = `W/"${createHash("sha256")
    .update(body)
    .digest("base64url")
    .slice(0, 32)}"`;

  const headers = {
    ...cors,
    // Der Endpunkt ist key-gebunden: Nur der aufrufende Client darf
    // zwischenspeichern, niemals ein geteilter Proxy oder ein CDN.
    "cache-control": "private, max-age=300, must-revalidate",
    vary: "Authorization, Origin",
    etag,
  };

  if (req.headers.get("if-none-match") === etag)
    return new NextResponse(null, { status: 304, headers });

  return new NextResponse(body, {
    headers: { ...headers, "content-type": "application/json; charset=utf-8" },
  });
}

/**
 * Preflight für den Browser-Abruf. Trägt nie einen Authorization-Header und
 * wird deshalb ohne Key beantwortet; ausgeliefert werden die CORS-Header nur
 * für Origins auf der Allowlist.
 */
export async function OPTIONS(req: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(req.headers.get("origin")),
  });
}
