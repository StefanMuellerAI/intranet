import { NextResponse } from "next/server";
import { authenticateApiRequest } from "@/lib/api-auth";
import { findRequestWithType, rejectRequest } from "@/lib/workflow";

export const preferredRegion = "fra1";

/**
 * POST /api/v1/requests/{id}/reject — beanstanden.
 * Body: { "comment": "…" } (Pflicht).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateApiRequest(req, {
    allowScopes: ["full"],
  });
  if (!auth.ok) return auth.response;

  const { id } = await params;
  let comment = "";
  try {
    const body = (await req.json()) as { comment?: string };
    comment = body.comment ?? "";
  } catch {
    // leerer/ungültiger Body → Pflichtkommentar-Fehler unten
  }
  if (!comment.trim())
    return NextResponse.json(
      { fehler: "Eine Beanstandung erfordert einen Kommentar (comment)." },
      { status: 400 }
    );

  const found = await findRequestWithType(id);
  if (!found)
    return NextResponse.json(
      { fehler: "Vorgang nicht gefunden." },
      { status: 404 }
    );

  try {
    const updated = await rejectRequest(found.type, id, comment, {
      user: auth.context.actor,
      source: "api",
      apiKeyId: auth.context.apiKey.id,
    });
    return NextResponse.json({ id, status: updated.status });
  } catch (err) {
    return NextResponse.json(
      { fehler: err instanceof Error ? err.message : "Fehler" },
      { status: 400 }
    );
  }
}
