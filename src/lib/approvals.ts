import "server-only";
import { asc, inArray } from "drizzle-orm";
import {
  commissionClaims,
  db,
  expenseReports,
  users,
  vacationRequests,
  workationRequests,
  type RequestStatus,
} from "@/db";
import { fullName } from "@/lib/auth";
import {
  BUSINESS_TYPE_LABELS,
  CUSTOMER_TYPE_LABELS,
} from "@/lib/commissions/calc";
import { formatDateDE } from "@/lib/dates";
import { formatEuro } from "@/lib/expenses/calc";
import type { WorkflowType } from "@/lib/workflow";

/** Status, die auf eine Entscheidung von Admin oder Vertretung warten */
export const OPEN_APPROVAL_STATUSES = ["eingereicht", "storno_beantragt"] as const;

export interface OpenApproval {
  type: WorkflowType;
  typeLabel: string;
  id: string;
  user: string;
  status: RequestStatus;
  createdAt: Date;
  summary: string;
  href: string;
}

/**
 * Alle offenen Freigaben über alle Antragsarten, älteste zuerst. Einzige
 * Quelle für die Freigaben-Seite, die Dashboard-Karte und den Sidebar-Zähler,
 * damit alle drei dieselben Anträge zeigen.
 */
export async function listOpenApprovals(): Promise<OpenApproval[]> {
  const open = [...OPEN_APPROVAL_STATUSES];
  const [vacations, workations, expenses, commissions, allUsers] =
    await Promise.all([
      db
        .select()
        .from(vacationRequests)
        .where(inArray(vacationRequests.status, open))
        .orderBy(asc(vacationRequests.createdAt)),
      db
        .select()
        .from(workationRequests)
        .where(inArray(workationRequests.status, open))
        .orderBy(asc(workationRequests.createdAt)),
      db
        .select()
        .from(expenseReports)
        .where(inArray(expenseReports.status, open))
        .orderBy(asc(expenseReports.createdAt)),
      db
        .select()
        .from(commissionClaims)
        .where(inArray(commissionClaims.status, open))
        .orderBy(asc(commissionClaims.createdAt)),
      db.select().from(users),
    ]);

  const nameOf = (id: string) => {
    const u = allUsers.find((x) => x.id === id);
    return u ? fullName(u) : "Unbekannt";
  };
  const row = (
    type: WorkflowType,
    typeLabel: string,
    r: { id: string; userId: string; status: RequestStatus; createdAt: Date },
    summary: string
  ): OpenApproval => ({
    type,
    typeLabel,
    id: r.id,
    user: nameOf(r.userId),
    status: r.status,
    createdAt: r.createdAt,
    summary,
    href: `/freigaben/${type}/${r.id}`,
  });

  return [
    ...vacations.map((r) =>
      row(
        "urlaub",
        "Urlaub",
        r,
        `${formatDateDE(r.startDate)} – ${formatDateDE(r.endDate)} (${r.days} Tage)`
      )
    ),
    ...workations.map((r) =>
      row(
        "workation",
        "Workation",
        r,
        `${r.city}, ${r.country} · ${formatDateDE(r.startDate)} – ${formatDateDE(r.endDate)} (${r.workDays} AT)`
      )
    ),
    ...expenses.map((r) =>
      row(
        "reisekosten",
        "Reisekosten",
        r,
        `${r.destination} (${r.customerPurpose}) · ${formatEuro(r.totalCents)}`
      )
    ),
    ...commissions.map((r) =>
      row(
        "provision",
        "Provision",
        r,
        `${BUSINESS_TYPE_LABELS[r.businessType]} · ${r.customerName} (${CUSTOMER_TYPE_LABELS[r.customerType]}) · ${
          r.finalAmountCents != null
            ? formatEuro(r.finalAmountCents)
            : "Betrag individuell"
        }`
      )
    ),
  ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}
