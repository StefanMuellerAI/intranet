"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, requestHistory, vacationRequests } from "@/db";
import { writeAudit } from "@/lib/audit";
import { fullName, requireUser } from "@/lib/auth";
import { countVacationDays, formatDateDE } from "@/lib/dates";
import { saveHistorySnapshot } from "@/lib/history";
import { notifyRequestSubmitted } from "@/lib/notifications";
import { getVacationAccount } from "@/lib/vacation";
import { dispatchWebhookEvent } from "@/lib/webhooks";
import { buildWebhookPayload } from "@/lib/workflow";

const vacationSchema = z
  .object({
    startDate: z.string().min(1, "Bitte Startdatum angeben."),
    endDate: z.string().min(1, "Bitte Enddatum angeben."),
    halfDayStart: z.boolean(),
    halfDayEnd: z.boolean(),
    substituteUserId: z.string().optional(),
    substituteText: z.string().optional(),
    note: z.string().optional(),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: "Das Enddatum darf nicht vor dem Startdatum liegen.",
  });

function parseForm(formData: FormData) {
  return vacationSchema.parse({
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
  const data = parseForm(formData);
  const days = countVacationDays(
    data.startDate,
    data.endDate,
    data.halfDayStart,
    data.halfDayEnd
  );
  if (days <= 0)
    throw new Error(
      "Der gewählte Zeitraum enthält keine Arbeitstage (Wochenenden und Feiertage NRW zählen nicht)."
    );

  const year = Number(data.startDate.slice(0, 4));
  const account = await getVacationAccount(user, year);
  if (account.remaining - days < 0)
    throw new Error(
      `Der Antrag über ${days} Tage übersteigt Ihren Resturlaub von ${account.remaining} Tagen.`
    );

  const [request] = await db
    .insert(vacationRequests)
    .values({
      userId: user.id,
      startDate: data.startDate,
      endDate: data.endDate,
      halfDayStart: data.halfDayStart,
      halfDayEnd: data.halfDayEnd,
      days,
      substituteUserId: data.substituteUserId,
      substituteText: data.substituteText,
      note: data.note,
    })
    .returning();

  await writeAudit({
    objectType: "urlaub",
    objectId: request.id,
    action: "eingereicht",
    actorUserId: user.id,
    actorLabel: fullName(user),
    source: "web",
  });
  await notifyRequestSubmitted({
    type: "urlaub",
    requestId: request.id,
    applicant: user,
    resubmitted: false,
    summary: `Zeitraum ${formatDateDE(data.startDate)} bis ${formatDateDE(data.endDate)}, ${days} Urlaubstage.`,
  });
  await dispatchWebhookEvent(
    "urlaub",
    "eingereicht",
    await buildWebhookPayload("urlaub", request, user)
  );

  revalidatePath("/urlaub");
  redirect(`/urlaub/${request.id}`);
}

/** Beanstandeten Antrag korrigieren und erneut einreichen (mit Historie). */
export async function resubmitVacationRequest(id: string, formData: FormData) {
  const user = await requireUser();
  const existing = await db.query.vacationRequests.findFirst({
    where: eq(vacationRequests.id, id),
  });
  if (!existing || existing.userId !== user.id)
    throw new Error("Antrag nicht gefunden.");
  if (existing.status !== "beanstandet" && existing.status !== "zurueckgezogen")
    throw new Error(
      "Nur beanstandete oder zurückgezogene Anträge können korrigiert werden."
    );

  const data = parseForm(formData);
  const days = countVacationDays(
    data.startDate,
    data.endDate,
    data.halfDayStart,
    data.halfDayEnd
  );
  if (days <= 0)
    throw new Error("Der gewählte Zeitraum enthält keine Arbeitstage.");

  await saveHistorySnapshot("urlaub", id, existing.version, {
    ...existing,
  });

  const [request] = await db
    .update(vacationRequests)
    .set({
      status: "eingereicht",
      version: existing.version + 1,
      startDate: data.startDate,
      endDate: data.endDate,
      halfDayStart: data.halfDayStart,
      halfDayEnd: data.halfDayEnd,
      days,
      substituteUserId: data.substituteUserId ?? null,
      substituteText: data.substituteText ?? null,
      note: data.note ?? null,
      updatedAt: new Date(),
    })
    .where(eq(vacationRequests.id, id))
    .returning();

  await writeAudit({
    objectType: "urlaub",
    objectId: id,
    action: "korrigiert_erneut_eingereicht",
    actorUserId: user.id,
    actorLabel: fullName(user),
    source: "web",
  });
  await notifyRequestSubmitted({
    type: "urlaub",
    requestId: id,
    applicant: user,
    resubmitted: true,
    summary: `Zeitraum ${formatDateDE(data.startDate)} bis ${formatDateDE(data.endDate)}, ${days} Urlaubstage (Version ${request.version}).`,
  });
  await dispatchWebhookEvent(
    "urlaub",
    "eingereicht",
    await buildWebhookPayload("urlaub", request, user)
  );

  revalidatePath("/urlaub");
  redirect(`/urlaub/${id}`);
}

/** Eingereichten oder beanstandeten Antrag zurückziehen. */
export async function withdrawVacationRequest(id: string) {
  const user = await requireUser();
  const existing = await db.query.vacationRequests.findFirst({
    where: eq(vacationRequests.id, id),
  });
  if (!existing || existing.userId !== user.id)
    throw new Error("Antrag nicht gefunden.");
  if (existing.status !== "eingereicht" && existing.status !== "beanstandet")
    throw new Error(
      "Nur eingereichte oder beanstandete Anträge können zurückgezogen werden."
    );

  await db
    .update(vacationRequests)
    .set({ status: "zurueckgezogen", updatedAt: new Date() })
    .where(eq(vacationRequests.id, id));

  await writeAudit({
    objectType: "urlaub",
    objectId: id,
    action: "zurueckgezogen",
    actorUserId: user.id,
    actorLabel: fullName(user),
    source: "web",
  });

  revalidatePath(`/urlaub/${id}`);
  revalidatePath("/urlaub");
}

/** Zurückgezogenen Antrag endgültig löschen. */
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

  // Audit vor dem Löschen schreiben (Audit-Log hat keinen Fremdschlüssel)
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

/** Stornierung eines genehmigten Urlaubs beantragen. */
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
