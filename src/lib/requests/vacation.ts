import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, vacationRequests, type User } from "@/db";
import { writeAudit } from "@/lib/audit";
import { fullName } from "@/lib/auth";
import { countVacationDays, formatDateDE } from "@/lib/dates";
import { saveHistorySnapshot } from "@/lib/history";
import { notifyRequestSubmitted } from "@/lib/notifications";
import type { RequestActorSource } from "@/lib/requests/types";
import { getVacationAccount } from "@/lib/vacation";
import { dispatchWebhookEvent } from "@/lib/webhooks";
import { buildWebhookPayload } from "@/lib/workflow";

export const vacationInputSchema = z
  .object({
    startDate: z.string().min(1, "Bitte Startdatum angeben."),
    endDate: z.string().min(1, "Bitte Enddatum angeben."),
    halfDayStart: z.boolean().default(false),
    halfDayEnd: z.boolean().default(false),
    substituteUserId: z.string().optional(),
    substituteText: z.string().optional(),
    note: z.string().optional(),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: "Das Enddatum darf nicht vor dem Startdatum liegen.",
  });

export type VacationInput = z.infer<typeof vacationInputSchema>;

/** Urlaub kann frühestens ab dem Eintrittsdatum genommen werden. */
function assertOnOrAfterEntryDate(user: User, startDate: string): void {
  if (user.entryDate && startDate < user.entryDate)
    throw new Error(
      `Urlaub ist erst ab Ihrem Eintrittsdatum (${formatDateDE(user.entryDate)}) möglich.`
    );
}

export async function createVacationRequest(
  user: User,
  raw: VacationInput,
  source: RequestActorSource = "web"
) {
  const data = vacationInputSchema.parse(raw);
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

  assertOnOrAfterEntryDate(user, data.startDate);

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
    source,
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

  return request;
}

export async function resubmitVacationRequestForUser(
  user: User,
  id: string,
  raw: VacationInput,
  source: RequestActorSource = "web"
) {
  const existing = await db.query.vacationRequests.findFirst({
    where: eq(vacationRequests.id, id),
  });
  if (!existing || existing.userId !== user.id)
    throw new Error("Antrag nicht gefunden.");
  if (existing.status !== "beanstandet" && existing.status !== "zurueckgezogen")
    throw new Error(
      "Nur beanstandete oder zurückgezogene Anträge können korrigiert werden."
    );

  const data = vacationInputSchema.parse(raw);
  const days = countVacationDays(
    data.startDate,
    data.endDate,
    data.halfDayStart,
    data.halfDayEnd
  );
  if (days <= 0)
    throw new Error("Der gewählte Zeitraum enthält keine Arbeitstage.");

  assertOnOrAfterEntryDate(user, data.startDate);

  await saveHistorySnapshot("urlaub", id, existing.version, { ...existing });

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
    source,
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

  return request;
}

export async function withdrawVacationRequestForUser(
  user: User,
  id: string,
  source: RequestActorSource = "web"
) {
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
    source,
  });

  return { id, status: "zurueckgezogen" as const };
}
