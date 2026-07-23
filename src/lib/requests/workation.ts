import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, workationRequests, type User } from "@/db";
import { writeAudit } from "@/lib/audit";
import { fullName } from "@/lib/auth";
import { formatDateDE } from "@/lib/dates";
import { saveHistorySnapshot } from "@/lib/history";
import { notifyRequestSubmitted } from "@/lib/notifications";
import type { RequestActorSource } from "@/lib/requests/types";
import { getSettings } from "@/lib/settings";
import { getUsedWorkationDays } from "@/lib/vacation";
import { classifyCountry, validateWorkation } from "@/lib/workation/validate";
import { dispatchWebhookEvent } from "@/lib/webhooks";
import { buildWebhookPayload } from "@/lib/workflow";

export const workationInputSchema = z
  .object({
    country: z.string().min(1, "Bitte Zielland angeben."),
    city: z.string().min(1, "Bitte Aufenthaltsort angeben."),
    accommodationAddress: z
      .string()
      .min(1, "Bitte Anschrift der Unterkunft angeben (für den A1-Antrag)."),
    startDate: z.string().min(1),
    endDate: z.string().min(1),
    workDays: z.coerce.number().positive("Arbeitstage müssen größer 0 sein."),
    vacationDays: z.coerce.number().min(0).default(0),
    timezoneAvailability: z
      .string()
      .min(1, "Bitte Zeitzone / zugesagte Erreichbarkeit angeben."),
    daysInCountryThisYear: z.coerce.number().min(0).default(0),
    emergencyContactName: z.string().min(1, "Bitte Notfallkontakt angeben."),
    emergencyContactPhone: z
      .string()
      .min(1, "Bitte Telefonnummer des Notfallkontakts angeben."),
    visaType: z.string().min(1, "Bitte Art des Visums/Aufenthaltstitels angeben."),
    visaValidUntil: z.string().optional(),
    insuranceDetails: z
      .string()
      .min(1, "Bitte Auslandskranken- und Rückholversicherung angeben."),
    plannedTasks: z.string().min(1, "Bitte geplante Aufgaben angeben."),
    domesticSubstitution: z
      .string()
      .min(1, "Bitte Vertretungsregelung im Inland angeben."),
    declResidence: z.boolean(),
    declVisa: z.boolean(),
    declWorkingTime: z.boolean(),
    declDataProtection: z.boolean(),
    declNoForbiddenActivities: z.boolean(),
    declReportChanges: z.boolean(),
    declCosts: z.boolean(),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: "Das Enddatum darf nicht vor dem Startdatum liegen.",
  })
  .superRefine((data, ctx) => {
    const allDeclared =
      data.declResidence &&
      data.declVisa &&
      data.declWorkingTime &&
      data.declDataProtection &&
      data.declNoForbiddenActivities &&
      data.declReportChanges &&
      data.declCosts;
    if (!allDeclared)
      ctx.addIssue({
        code: "custom",
        message:
          "Alle sieben Erklärungen müssen bestätigt werden, sonst ist keine Einreichung möglich.",
      });
  });

export type WorkationInput = z.infer<typeof workationInputSchema>;

async function validateOrThrow(
  userId: string,
  data: WorkationInput,
  excludeRequestId?: string
) {
  const settings = await getSettings();
  const year = Number(data.startDate.slice(0, 4));
  const used = await getUsedWorkationDays(userId, year, excludeRequestId);
  const result = validateWorkation({
    startDate: data.startDate,
    endDate: data.endDate,
    workDays: data.workDays,
    daysInCountryThisYear: data.daysInCountryThisYear,
    countryCategory: classifyCountry(data.country),
    usedWorkDaysThisYear: used,
    yearlyLimitDays: settings.workationYearlyLimitDays,
    consecutiveLimitDays: settings.workationConsecutiveLimitDays,
  });
  if (result.errors.length > 0) throw new Error(result.errors.join(" "));
  return result;
}

export async function createWorkationRequest(
  user: User,
  raw: WorkationInput,
  source: RequestActorSource = "web"
) {
  const data = workationInputSchema.parse(raw);
  await validateOrThrow(user.id, data);

  const [request] = await db
    .insert(workationRequests)
    .values({
      userId: user.id,
      ...data,
      countryCategory: classifyCountry(data.country),
      visaValidUntil: data.visaValidUntil ?? null,
    })
    .returning();

  await writeAudit({
    objectType: "workation",
    objectId: request.id,
    action: "eingereicht",
    actorUserId: user.id,
    actorLabel: fullName(user),
    source,
  });
  await notifyRequestSubmitted({
    type: "workation",
    requestId: request.id,
    applicant: user,
    resubmitted: false,
    summary: `${data.city}, ${data.country} · ${formatDateDE(data.startDate)} bis ${formatDateDE(data.endDate)} (${data.workDays} Arbeitstage).`,
  });
  await dispatchWebhookEvent(
    "workation",
    "eingereicht",
    await buildWebhookPayload("workation", request, user)
  );

  return request;
}

export async function resubmitWorkationRequestForUser(
  user: User,
  id: string,
  raw: WorkationInput,
  source: RequestActorSource = "web"
) {
  const existing = await db.query.workationRequests.findFirst({
    where: eq(workationRequests.id, id),
  });
  if (!existing || existing.userId !== user.id)
    throw new Error("Antrag nicht gefunden.");
  if (existing.status !== "beanstandet" && existing.status !== "zurueckgezogen")
    throw new Error(
      "Nur beanstandete oder zurückgezogene Anträge können korrigiert werden."
    );

  const data = workationInputSchema.parse(raw);
  await validateOrThrow(user.id, data, id);

  await saveHistorySnapshot("workation", id, existing.version, { ...existing });

  const [request] = await db
    .update(workationRequests)
    .set({
      status: "eingereicht",
      version: existing.version + 1,
      ...data,
      countryCategory: classifyCountry(data.country),
      visaValidUntil: data.visaValidUntil ?? null,
      updatedAt: new Date(),
    })
    .where(eq(workationRequests.id, id))
    .returning();

  await writeAudit({
    objectType: "workation",
    objectId: id,
    action: "korrigiert_erneut_eingereicht",
    actorUserId: user.id,
    actorLabel: fullName(user),
    source,
  });
  await notifyRequestSubmitted({
    type: "workation",
    requestId: id,
    applicant: user,
    resubmitted: true,
    summary: `${data.city}, ${data.country} · ${formatDateDE(data.startDate)} bis ${formatDateDE(data.endDate)} (Version ${request.version}).`,
  });
  await dispatchWebhookEvent(
    "workation",
    "eingereicht",
    await buildWebhookPayload("workation", request, user)
  );

  return request;
}

export async function withdrawWorkationRequestForUser(
  user: User,
  id: string,
  source: RequestActorSource = "web"
) {
  const existing = await db.query.workationRequests.findFirst({
    where: eq(workationRequests.id, id),
  });
  if (!existing || existing.userId !== user.id)
    throw new Error("Antrag nicht gefunden.");
  if (existing.status !== "eingereicht" && existing.status !== "beanstandet")
    throw new Error(
      "Nur eingereichte oder beanstandete Anträge können zurückgezogen werden."
    );

  await db
    .update(workationRequests)
    .set({ status: "zurueckgezogen", updatedAt: new Date() })
    .where(eq(workationRequests.id, id));

  await writeAudit({
    objectType: "workation",
    objectId: id,
    action: "zurueckgezogen",
    actorUserId: user.id,
    actorLabel: fullName(user),
    source,
  });

  return { id, status: "zurueckgezogen" as const };
}
