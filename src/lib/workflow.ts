import "server-only";
import { asc, eq } from "drizzle-orm";
import {
  db,
  expenseItems,
  expenseReports,
  receipts,
  users,
  vacationRequests,
  workationRequests,
  type ExpenseReport,
  type User,
  type VacationRequest,
  type WorkationRequest,
} from "@/db";
import { writeAudit } from "@/lib/audit";
import { fullName } from "@/lib/auth";
import { formatDateDE } from "@/lib/dates";
import { formatEuro } from "@/lib/expenses/calc";
import {
  notifyCancellationConfirmed,
  notifyRequestApproved,
  notifyRequestRejected,
  TYPE_LABELS,
} from "@/lib/notifications";
import { signReceiptUrl } from "@/lib/signed-url";
import { dispatchWebhookEvent } from "@/lib/webhooks";

export type WorkflowType = "urlaub" | "workation" | "reisekosten";

export interface Actor {
  user: User;
  source: "web" | "api";
  apiKeyId?: string;
}

type AnyRequest = VacationRequest | WorkationRequest | ExpenseReport;

const TABLES = {
  urlaub: vacationRequests,
  workation: workationRequests,
  reisekosten: expenseReports,
} as const;

export async function loadRequest(
  type: WorkflowType,
  id: string
): Promise<AnyRequest | null> {
  if (type === "urlaub")
    return (
      (await db.query.vacationRequests.findFirst({
        where: eq(vacationRequests.id, id),
      })) ?? null
    );
  if (type === "workation")
    return (
      (await db.query.workationRequests.findFirst({
        where: eq(workationRequests.id, id),
      })) ?? null
    );
  return (
    (await db.query.expenseReports.findFirst({
      where: eq(expenseReports.id, id),
    })) ?? null
  );
}

async function loadApplicant(userId: string): Promise<User> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw new Error("Antragsteller nicht gefunden.");
  return user;
}

function summaryFor(type: WorkflowType, request: AnyRequest): string {
  if (type === "urlaub") {
    const r = request as VacationRequest;
    return `Urlaub vom ${formatDateDE(r.startDate)} bis ${formatDateDE(r.endDate)} (${r.days} Tage).`;
  }
  if (type === "workation") {
    const r = request as WorkationRequest;
    return `Workation in ${r.city}, ${r.country} vom ${formatDateDE(r.startDate)} bis ${formatDateDE(r.endDate)} (${r.workDays} Arbeitstage).`;
  }
  const r = request as ExpenseReport;
  return `Reisekostenabrechnung ${r.destination} (${r.customerPurpose}), Gesamterstattung ${formatEuro(r.totalCents)}.`;
}

/** Vollständige Formulardaten + Metadaten + signierte Beleg-Links für n8n. */
export async function buildWebhookPayload(
  type: WorkflowType,
  request: AnyRequest,
  applicant: User
): Promise<Record<string, unknown>> {
  const base = {
    vorgangs_id: request.id,
    status: request.status,
    user: {
      id: applicant.id,
      name: fullName(applicant),
      email: applicant.email,
    },
    formulardaten: request,
  };
  if (type !== "reisekosten") return base;

  const items = await db
    .select()
    .from(expenseItems)
    .where(eq(expenseItems.reportId, request.id))
    .orderBy(asc(expenseItems.position));
  const receiptRows = await db
    .select()
    .from(receipts)
    .where(eq(receipts.reportId, request.id));
  return {
    ...base,
    positionen: items,
    belege: receiptRows.map((r) => ({
      id: r.id,
      dateiname: r.filename,
      content_type: r.contentType,
      download_url: signReceiptUrl(r.id),
    })),
  };
}

/** Genehmigen — zentral für Web-UI und API (Vier-Augen-Prinzip inklusive). */
export async function approveRequest(
  type: WorkflowType,
  id: string,
  actor: Actor
): Promise<AnyRequest> {
  const request = await loadRequest(type, id);
  if (!request) throw new Error("Antrag nicht gefunden.");
  if (request.status !== "eingereicht" && request.status !== "storno_beantragt")
    throw new Error(`Antrag ist nicht offen (Status: ${request.status}).`);
  if (request.userId === actor.user.id)
    throw new Error(
      "Eigene Anträge dürfen nicht selbst genehmigt werden (Vier-Augen-Prinzip)."
    );

  const isCancellation = request.status === "storno_beantragt";
  const newStatus = isCancellation ? "storniert" : "genehmigt";
  const table = TABLES[type];
  const [updated] = await db
    .update(table)
    .set({
      status: newStatus,
      decidedById: actor.user.id,
      decidedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(table.id, id))
    .returning();

  const applicant = await loadApplicant(request.userId);
  await writeAudit({
    objectType: type,
    objectId: id,
    action: isCancellation ? "storno_bestaetigt" : "genehmigt",
    actorUserId: actor.user.id,
    actorLabel: fullName(actor.user),
    source: actor.source,
    apiKeyId: actor.apiKeyId,
  });

  if (isCancellation) {
    await notifyCancellationConfirmed({
      requestId: id,
      applicant,
      summary: summaryFor(type, updated as AnyRequest),
    });
    await dispatchWebhookEvent(
      type,
      "storniert",
      await buildWebhookPayload(type, updated as AnyRequest, applicant)
    );
  } else {
    await notifyRequestApproved({
      type,
      requestId: id,
      applicant,
      summary: summaryFor(type, updated as AnyRequest),
    });
    await dispatchWebhookEvent(
      type,
      "genehmigt",
      await buildWebhookPayload(type, updated as AnyRequest, applicant)
    );
  }
  return updated as AnyRequest;
}

/** Beanstanden — Pflicht-Kommentar, zentral für Web-UI und API. */
export async function rejectRequest(
  type: WorkflowType,
  id: string,
  comment: string,
  actor: Actor
): Promise<AnyRequest> {
  if (!comment.trim())
    throw new Error("Eine Beanstandung erfordert einen Kommentar (Grund).");
  const request = await loadRequest(type, id);
  if (!request) throw new Error("Antrag nicht gefunden.");
  if (request.status !== "eingereicht" && request.status !== "storno_beantragt")
    throw new Error(`Antrag ist nicht offen (Status: ${request.status}).`);
  if (request.userId === actor.user.id)
    throw new Error(
      "Eigene Anträge dürfen nicht selbst bearbeitet werden (Vier-Augen-Prinzip)."
    );

  // Beanstandung eines Storno-Antrags: Urlaub bleibt genehmigt
  const wasCancellation = request.status === "storno_beantragt";
  const newStatus = wasCancellation ? "genehmigt" : "beanstandet";
  const table = TABLES[type];
  const [updated] = await db
    .update(table)
    .set({
      status: newStatus,
      rejectionComment: comment.trim(),
      decidedById: actor.user.id,
      decidedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(table.id, id))
    .returning();

  const applicant = await loadApplicant(request.userId);
  await writeAudit({
    objectType: type,
    objectId: id,
    action: wasCancellation ? "storno_abgelehnt" : "beanstandet",
    actorUserId: actor.user.id,
    actorLabel: fullName(actor.user),
    source: actor.source,
    apiKeyId: actor.apiKeyId,
    details: { kommentar: comment.trim() },
  });
  await notifyRequestRejected({ type, requestId: id, applicant, comment });
  await dispatchWebhookEvent(
    type,
    "beanstandet",
    await buildWebhookPayload(type, updated as AnyRequest, applicant)
  );
  return updated as AnyRequest;
}

/** Vorgang anhand der ID typübergreifend finden (für die API). */
export async function findRequestWithType(
  id: string
): Promise<{ type: WorkflowType; request: AnyRequest } | null> {
  for (const type of ["urlaub", "workation", "reisekosten"] as WorkflowType[]) {
    const request = await loadRequest(type, id);
    if (request) return { type, request };
  }
  return null;
}

export { TYPE_LABELS };
