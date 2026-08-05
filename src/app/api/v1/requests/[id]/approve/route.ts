import { NextResponse } from "next/server";
import { authenticateApiRequest } from "@/lib/api-auth";
import { approveRequest, findRequestWithType } from "@/lib/workflow";

export const preferredRegion = "fra1";

/** POST /api/v1/requests/{id}/approve — genehmigen (Kennzeichnung „API“). */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateApiRequest(req, { requireScope: "full" });
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const found = await findRequestWithType(id);
  if (!found)
    return NextResponse.json(
      { fehler: "Vorgang nicht gefunden." },
      { status: 404 }
    );

  try {
    const updated = await approveRequest(found.type, id, {
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
