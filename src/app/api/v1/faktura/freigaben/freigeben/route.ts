import { NextResponse } from "next/server";
import { authenticateApiRequest } from "@/lib/api-auth";
import { approveWeek } from "@/lib/faktura/freigabe";

export const preferredRegion = "fra1";

/**
 * POST /api/v1/faktura/freigaben/freigeben — Wochenfreigabe per API (FA-5.8).
 * Body: { "jahr": 2026, "kw": 30 }
 */
export async function POST(req: Request) {
  const auth = await authenticateApiRequest(req, { requireScope: "full" });
  if (!auth.ok) return auth.response;

  let body: { jahr?: number; kw?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { fehler: "Ungültiger JSON-Body." },
      { status: 400 }
    );
  }

  const isoYear = Number(body.jahr);
  const isoWeek = Number(body.kw);
  if (
    !Number.isInteger(isoYear) ||
    !Number.isInteger(isoWeek) ||
    isoWeek < 1 ||
    isoWeek > 53
  )
    return NextResponse.json(
      { fehler: "Body benötigt 'jahr' und 'kw' als Zahlen." },
      { status: 400 }
    );

  try {
    await approveWeek(
      auth.context.actor,
      isoYear,
      isoWeek,
      "api",
      auth.context.apiKey.id
    );
  } catch (err) {
    return NextResponse.json(
      { fehler: err instanceof Error ? err.message : "Freigabe fehlgeschlagen." },
      { status: 409 }
    );
  }

  return NextResponse.json({
    jahr: isoYear,
    kw: isoWeek,
    status: "freigegeben",
  });
}
