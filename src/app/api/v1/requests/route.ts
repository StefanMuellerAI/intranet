import { NextResponse } from "next/server";
import { asc, inArray } from "drizzle-orm";
import {
  commissionClaims,
  db,
  expenseItems,
  expenseReports,
  users,
  vacationRequests,
  workationRequests,
} from "@/db";
import { authenticateApiRequest } from "@/lib/api-auth";
import { fullName } from "@/lib/auth";

export const preferredRegion = "fra1";

const STATUS_MAP: Record<string, string[]> = {
  pending: ["eingereicht", "storno_beantragt"],
  approved: ["genehmigt"],
  rejected: ["beanstandet"],
  withdrawn: ["zurueckgezogen"],
};

/**
 * GET /api/v1/requests?status=pending&type=vacation|workation|expense|commission
 * Offene Anträge inkl. aller Formulardaten.
 */
export async function GET(req: Request) {
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status") ?? "pending";
  const typeParam = url.searchParams.get("type");
  const statuses = STATUS_MAP[statusParam] ?? [statusParam];

  const allUsers = await db.select().from(users);
  const userInfo = (id: string) => {
    const u = allUsers.find((x) => x.id === id);
    return u ? { id: u.id, name: fullName(u), email: u.email } : null;
  };

  const results: Record<string, unknown>[] = [];

  if (!typeParam || typeParam === "vacation") {
    const rows = await db
      .select()
      .from(vacationRequests)
      .where(inArray(vacationRequests.status, statuses as never[]))
      .orderBy(asc(vacationRequests.createdAt));
    results.push(
      ...rows.map((r) => ({
        id: r.id,
        type: "vacation",
        status: r.status,
        user: userInfo(r.userId),
        data: r,
      }))
    );
  }
  if (!typeParam || typeParam === "workation") {
    const rows = await db
      .select()
      .from(workationRequests)
      .where(inArray(workationRequests.status, statuses as never[]))
      .orderBy(asc(workationRequests.createdAt));
    results.push(
      ...rows.map((r) => ({
        id: r.id,
        type: "workation",
        status: r.status,
        user: userInfo(r.userId),
        data: r,
      }))
    );
  }
  if (!typeParam || typeParam === "commission") {
    const rows = await db
      .select()
      .from(commissionClaims)
      .where(inArray(commissionClaims.status, statuses as never[]))
      .orderBy(asc(commissionClaims.createdAt));
    results.push(
      ...rows.map((r) => ({
        id: r.id,
        type: "commission",
        status: r.status,
        user: userInfo(r.userId),
        data: r,
      }))
    );
  }
  if (!typeParam || typeParam === "expense") {
    const rows = await db
      .select()
      .from(expenseReports)
      .where(inArray(expenseReports.status, statuses as never[]))
      .orderBy(asc(expenseReports.createdAt));
    for (const r of rows) {
      const items = await db
        .select()
        .from(expenseItems)
        .where(inArray(expenseItems.reportId, [r.id]))
        .orderBy(asc(expenseItems.position));
      results.push({
        id: r.id,
        type: "expense",
        status: r.status,
        user: userInfo(r.userId),
        data: { ...r, items },
      });
    }
  }

  return NextResponse.json({ requests: results });
}
