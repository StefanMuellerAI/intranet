import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db, expenseItems, receipts, users } from "@/db";
import { authenticateApiRequest } from "@/lib/api-auth";
import { fullName } from "@/lib/auth";
import { getHistory } from "@/lib/history";
import { findRequestWithType, type WorkflowType } from "@/lib/workflow";

export const preferredRegion = "fra1";

/** GET /api/v1/requests/{id} — Einzelvorgang inkl. Historie. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const found = await findRequestWithType(id);
  if (!found)
    return NextResponse.json({ fehler: "Vorgang nicht gefunden." }, { status: 404 });

  const user = await db.query.users.findFirst({
    where: eq(users.id, found.request.userId),
  });
  const history = await getHistory(found.type, id);

  let extra: Record<string, unknown> = {};
  if (found.type === "reisekosten") {
    const [items, receiptRows] = await Promise.all([
      db
        .select()
        .from(expenseItems)
        .where(eq(expenseItems.reportId, id))
        .orderBy(asc(expenseItems.position)),
      db.select().from(receipts).where(eq(receipts.reportId, id)),
    ]);
    extra = {
      items,
      belege: receiptRows.map((r) => ({ id: r.id, dateiname: r.filename })),
    };
  }

  const typeNames: Record<WorkflowType, string> = {
    urlaub: "vacation",
    workation: "workation",
    reisekosten: "expense",
  };

  return NextResponse.json({
    id,
    type: typeNames[found.type],
    status: found.request.status,
    user: user ? { id: user.id, name: fullName(user), email: user.email } : null,
    data: { ...found.request, ...extra },
    history: history.map((h) => ({
      version: h.version,
      erstellt: h.createdAt,
      snapshot: h.snapshot,
    })),
  });
}
