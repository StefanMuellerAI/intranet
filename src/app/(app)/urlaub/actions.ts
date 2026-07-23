"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, requestHistory, vacationRequests } from "@/db";
import { writeAudit } from "@/lib/audit";
import { fullName, requireUser } from "@/lib/auth";
import { formatDateDE } from "@/lib/dates";
import { notifyRequestSubmitted } from "@/lib/notifications";
import {
  createVacationRequest,
  resubmitVacationRequestForUser,
  vacationInputSchema,
  withdrawVacationRequestForUser,
} from "@/lib/requests/vacation";

function parseForm(formData: FormData) {
  return vacationInputSchema.parse({
    startDate: String(formData.get("startDate") ?? ""),
    endDate: String(formData.get("endDate") ?? ""),
    halfDayStart: formData.get("halfDayStart") === "on",
    halfDayEnd: formData.get("halfDayEnd") === "on",
    substituteUserId: String(formData.get("substituteUserId") ?? "") || undefined,
    substituteText: String(formData.get("substituteText") ?? "") || undefined,
    note: String(formData.get("note") ?? "") || undefined,
  });
}

export async function submitVacationRequest(formData: FormData) {
  const user = await requireUser();
  const request = await createVacationRequest(user, parseForm(formData), "web");
  revalidatePath("/urlaub");
  redirect(`/urlaub/${request.id}`);
}

export async function resubmitVacationRequest(id: string, formData: FormData) {
  const user = await requireUser();
  await resubmitVacationRequestForUser(user, id, parseForm(formData), "web");
  revalidatePath("/urlaub");
  redirect(`/urlaub/${id}`);
}

export async function withdrawVacationRequest(id: string) {
  const user = await requireUser();
  await withdrawVacationRequestForUser(user, id, "web");
  revalidatePath(`/urlaub/${id}`);
  revalidatePath("/urlaub");
}

export async function deleteVacationRequest(id: string) {
  const user = await requireUser();
  const existing = await db.query.vacationRequests.findFirst({
    where: eq(vacationRequests.id, id),
  });
  if (!existing || existing.userId !== user.id)
    throw new Error("Antrag nicht gefunden.");
  if (existing.status !== "zurueckgezogen")
    throw new Error(
      "Nur zurückgezogene Anträge können endgültig gelöscht werden."
    );

  await writeAudit({
    objectType: "urlaub",
    objectId: id,
    action: "geloescht",
    actorUserId: user.id,
    actorLabel: fullName(user),
    source: "web",
    details: {
      startDate: existing.startDate,
      endDate: existing.endDate,
      days: existing.days,
    },
  });

  await db
    .delete(requestHistory)
    .where(
      and(
        eq(requestHistory.requestType, "urlaub"),
        eq(requestHistory.requestId, id)
      )
    );
  await db.delete(vacationRequests).where(eq(vacationRequests.id, id));

  revalidatePath("/urlaub");
  redirect("/urlaub");
}

export async function requestVacationCancellation(id: string) {
  const user = await requireUser();
  const existing = await db.query.vacationRequests.findFirst({
    where: eq(vacationRequests.id, id),
  });
  if (!existing || existing.userId !== user.id)
    throw new Error("Antrag nicht gefunden.");
  if (existing.status !== "genehmigt")
    throw new Error("Nur genehmigte Urlaube können storniert werden.");

  await db
    .update(vacationRequests)
    .set({ status: "storno_beantragt", updatedAt: new Date() })
    .where(eq(vacationRequests.id, id));

  await writeAudit({
    objectType: "urlaub",
    objectId: id,
    action: "storno_beantragt",
    actorUserId: user.id,
    actorLabel: fullName(user),
    source: "web",
  });
  await notifyRequestSubmitted({
    type: "urlaub",
    requestId: id,
    applicant: user,
    resubmitted: false,
    summary: `Storno beantragt für Urlaub ${formatDateDE(existing.startDate)} bis ${formatDateDE(existing.endDate)} (${existing.days} Tage).`,
  });

  revalidatePath(`/urlaub/${id}`);
  revalidatePath("/urlaub");
}
