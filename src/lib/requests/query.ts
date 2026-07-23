import "server-only";
import { and, desc, eq } from "drizzle-orm";
import {
  commissionClaims,
  db,
  expenseItems,
  expenseReports,
  requestHistory,
  sickLeaves,
  vacationRequests,
  workationRequests,
  type User,
} from "@/db";
import { fullName } from "@/lib/auth";
import type { RequestType } from "@/lib/requests/types";
import { getSettings } from "@/lib/settings";
import { getUsedWorkationDays, getVacationAccount } from "@/lib/vacation";

export async function getMyProfile(user: User) {
  const year = new Date().getFullYear();
  const vacation = await getVacationAccount(user, year);
  const settings = await getSettings();
  const usedWorkation = await getUsedWorkationDays(user.id, year);

  return {
    id: user.id,
    name: fullName(user),
    email: user.email,
    role: user.role,
    vacation,
    workation: {
      year,
      usedDays: usedWorkation,
      yearlyLimitDays: settings.workationYearlyLimitDays,
      remainingDays: settings.workationYearlyLimitDays - usedWorkation,
      consecutiveLimitDays: settings.workationConsecutiveLimitDays,
    },
  };
}

export async function listMyRequests(
  user: User,
  opts: { type?: RequestType; status?: string } = {}
) {
  const results: {
    id: string;
    type: RequestType;
    status: string;
    summary: string;
    createdAt: Date;
    updatedAt: Date;
  }[] = [];

  const include = (t: RequestType) => !opts.type || opts.type === t;
  const statusOk = (s: string) => !opts.status || opts.status === s;

  if (include("vacation")) {
    const rows = await db
      .select()
      .from(vacationRequests)
      .where(eq(vacationRequests.userId, user.id))
      .orderBy(desc(vacationRequests.createdAt));
    for (const r of rows) {
      if (!statusOk(r.status)) continue;
      results.push({
        id: r.id,
        type: "vacation",
        status: r.status,
        summary: `${r.startDate}–${r.endDate} (${r.days} Tage)`,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      });
    }
  }

  if (include("workation")) {
    const rows = await db
      .select()
      .from(workationRequests)
      .where(eq(workationRequests.userId, user.id))
      .orderBy(desc(workationRequests.createdAt));
    for (const r of rows) {
      if (!statusOk(r.status)) continue;
      results.push({
        id: r.id,
        type: "workation",
        status: r.status,
        summary: `${r.city}, ${r.country} · ${r.startDate}–${r.endDate}`,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      });
    }
  }

  if (include("expense")) {
    const rows = await db
      .select()
      .from(expenseReports)
      .where(eq(expenseReports.userId, user.id))
      .orderBy(desc(expenseReports.createdAt));
    for (const r of rows) {
      if (!statusOk(r.status)) continue;
      results.push({
        id: r.id,
        type: "expense",
        status: r.status,
        summary: `${r.destination} · ${r.departureDate}–${r.returnDate} · ${(r.totalCents / 100).toFixed(2)} €`,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      });
    }
  }

  if (include("commission")) {
    const rows = await db
      .select()
      .from(commissionClaims)
      .where(eq(commissionClaims.userId, user.id))
      .orderBy(desc(commissionClaims.createdAt));
    for (const r of rows) {
      if (!statusOk(r.status)) continue;
      results.push({
        id: r.id,
        type: "commission",
        status: r.status,
        summary: `${r.customerName} · ${r.businessType} · ${r.orderDate}`,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      });
    }
  }

  if (include("sick_leave")) {
    const rows = await db
      .select()
      .from(sickLeaves)
      .where(eq(sickLeaves.userId, user.id))
      .orderBy(desc(sickLeaves.createdAt));
    for (const r of rows) {
      if (!statusOk(r.status)) continue;
      results.push({
        id: r.id,
        type: "sick_leave",
        status: r.status,
        summary: `${r.type} ab ${r.startDate}${r.endDate ? ` bis ${r.endDate}` : ""}`,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      });
    }
  }

  results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return results;
}

export async function getMyRequest(
  user: User,
  type: RequestType,
  id: string
) {
  if (type === "vacation") {
    const row = await db.query.vacationRequests.findFirst({
      where: eq(vacationRequests.id, id),
    });
    if (!row || row.userId !== user.id) throw new Error("Antrag nicht gefunden.");
    const history = await db
      .select()
      .from(requestHistory)
      .where(
        and(
          eq(requestHistory.requestType, "urlaub"),
          eq(requestHistory.requestId, id)
        )
      );
    return { type, data: row, history };
  }

  if (type === "workation") {
    const row = await db.query.workationRequests.findFirst({
      where: eq(workationRequests.id, id),
    });
    if (!row || row.userId !== user.id) throw new Error("Antrag nicht gefunden.");
    const history = await db
      .select()
      .from(requestHistory)
      .where(
        and(
          eq(requestHistory.requestType, "workation"),
          eq(requestHistory.requestId, id)
        )
      );
    return { type, data: row, history };
  }

  if (type === "expense") {
    const row = await db.query.expenseReports.findFirst({
      where: eq(expenseReports.id, id),
    });
    if (!row || row.userId !== user.id)
      throw new Error("Abrechnung nicht gefunden.");
    const items = await db
      .select()
      .from(expenseItems)
      .where(eq(expenseItems.reportId, id));
    const history = await db
      .select()
      .from(requestHistory)
      .where(
        and(
          eq(requestHistory.requestType, "reisekosten"),
          eq(requestHistory.requestId, id)
        )
      );
    return { type, data: { ...row, items }, history };
  }

  if (type === "commission") {
    const row = await db.query.commissionClaims.findFirst({
      where: eq(commissionClaims.id, id),
    });
    if (!row || row.userId !== user.id)
      throw new Error("Anspruch nicht gefunden.");
    const history = await db
      .select()
      .from(requestHistory)
      .where(
        and(
          eq(requestHistory.requestType, "provision"),
          eq(requestHistory.requestId, id)
        )
      );
    return { type, data: row, history };
  }

  const row = await db.query.sickLeaves.findFirst({
    where: eq(sickLeaves.id, id),
  });
  if (!row || row.userId !== user.id)
    throw new Error("Krankmeldung nicht gefunden.");
  return { type, data: row, history: [] };
}
