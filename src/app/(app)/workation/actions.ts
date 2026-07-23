"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, requestHistory, workationRequests } from "@/db";
import { writeAudit } from "@/lib/audit";
import { fullName, requireAdmin, requireUser } from "@/lib/auth";
import { formatDateDE } from "@/lib/dates";
import { saveHistorySnapshot } from "@/lib/history";
import { notifyRequestSubmitted } from "@/lib/notifications";
import { getSettings } from "@/lib/settings";
import { getUsedWorkationDays } from "@/lib/vacation";
import { classifyCountry, validateWorkation } from "@/lib/workation/validate";
import { dispatchWebhookEvent } from "@/lib/webhooks";
import { buildWebhookPayload } from "@/lib/workflow";

const workationSchema = z
  .object({
    country: z.string().min(1, "Bitte Zielland angeben."),
    city: z.string().min(1, "Bitte Aufenthaltsort angeben."),
    accommodationAddress: z
      .string()
      .min(1, "Bitte Anschrift der Unterkunft angeben (für den A1-Antrag)."),
    startDate: z.string().min(1),
    endDate: z.string().min(1),
    workDays: z.coerce.number().positive("Arbeitstage müssen größer 0 sein."),
    vacationDays: z.coerce.number().min(0),
    timezoneAvailability: z
      .string()
      .min(1, "Bitte Zeitzone / zugesagte Erreichbarkeit angeben."),
    daysInCountryThisYear: z.coerce.number().min(0),
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
  });

function parseForm(formData: FormData) {
  const bool = (k: string) => formData.get(k) === "on";
  const data = workationSchema.parse({
    country: String(formData.get("country") ?? ""),
    city: String(formData.get("city") ?? ""),
    accommodationAddress: String(formData.get("accommodationAddress") ?? ""),
    startDate: String(formData.get("startDate") ?? ""),
    endDate: String(formData.get("endDate") ?? ""),
    workDays: formData.get("workDays"),
    vacationDays: formData.get("vacationDays") || 0,
    timezoneAvailability: String(formData.get("timezoneAvailability") ?? ""),
    daysInCountryThisYear: formData.get("daysInCountryThisYear") || 0,
    emergencyContactName: String(formData.get("emergencyContactName") ?? ""),
    emergencyContactPhone: String(formData.get("emergencyContactPhone") ?? ""),
    visaType: String(formData.get("visaType") ?? ""),
    visaValidUntil: String(formData.get("visaValidUntil") ?? "") || undefined,
    insuranceDetails: String(formData.get("insuranceDetails") ?? ""),
    plannedTasks: String(formData.get("plannedTasks") ?? ""),
    domesticSubstitution: String(formData.get("domesticSubstitution") ?? ""),
    declResidence: bool("declResidence"),
    declVisa: bool("declVisa"),
    declWorkingTime: bool("declWorkingTime"),
    declDataProtection: bool("declDataProtection"),
    declNoForbiddenActivities: bool("declNoForbiddenActivities"),
    declReportChanges: bool("declReportChanges"),
    declCosts: bool("declCosts"),
  });

  // Ohne alle sieben Erklärungen keine Einreichung
  const allDeclared =
    data.declResidence &&
    data.declVisa &&
    data.declWorkingTime &&
    data.declDataProtection &&
    data.declNoForbiddenActivities &&
    data.declReportChanges &&
    data.declCosts;
  if (!allDeclared)
    throw new Error(
      "Alle sieben Erklärungen müssen bestätigt werden, sonst ist keine Einreichung möglich."
    );
  return data;
}

async function validateOrThrow(
  userId: string,
  data: ReturnType<typeof parseForm>,
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

export async function submitWorkationRequest(formData: FormData) {
  const user = await requireUser();
  const data = parseForm(formData);
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
    source: "web",
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

  revalidatePath("/workation");
  redirect(`/workation/${request.id}`);
}

export async function resubmitWorkationRequest(id: string, formData: FormData) {
  const user = await requireUser();
  const existing = await db.query.workationRequests.findFirst({
    where: eq(workationRequests.id, id),
  });
  if (!existing || existing.userId !== user.id)
    throw new Error("Antrag nicht gefunden.");
  if (existing.status !== "beanstandet" && existing.status !== "zurueckgezogen")
    throw new Error(
      "Nur beanstandete oder zurückgezogene Anträge können korrigiert werden."
    );

  const data = parseForm(formData);
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
    source: "web",
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

  revalidatePath("/workation");
  redirect(`/workation/${id}`);
}

/** Eingereichten oder beanstandeten Antrag zurückziehen. */
export async function withdrawWorkationRequest(id: string) {
  const user = await requireUser();
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
    source: "web",
  });

  revalidatePath(`/workation/${id}`);
  revalidatePath("/workation");
}

/** Zurückgezogenen Antrag endgültig löschen. */
export async function deleteWorkationRequest(id: string) {
  const user = await requireUser();
  const existing = await db.query.workationRequests.findFirst({
    where: eq(workationRequests.id, id),
  });
  if (!existing || existing.userId !== user.id)
    throw new Error("Antrag nicht gefunden.");
  if (existing.status !== "zurueckgezogen")
    throw new Error(
      "Nur zurückgezogene Anträge können endgültig gelöscht werden."
    );

  // Audit vor dem Löschen schreiben (Audit-Log hat keinen Fremdschlüssel)
  await writeAudit({
    objectType: "workation",
    objectId: id,
    action: "geloescht",
    actorUserId: user.id,
    actorLabel: fullName(user),
    source: "web",
    details: {
      country: existing.country,
      city: existing.city,
      startDate: existing.startDate,
      endDate: existing.endDate,
    },
  });

  await db
    .delete(requestHistory)
    .where(
      and(
        eq(requestHistory.requestType, "workation"),
        eq(requestHistory.requestId, id)
      )
    );
  await db.delete(workationRequests).where(eq(workationRequests.id, id));

  revalidatePath("/workation");
  redirect("/workation");
}

/** Admin pflegt A1-Status, Nachweise und EU-Beschränkung (Genehmigungsschritt). */
export async function updateWorkationAdminFields(id: string, formData: FormData) {
  const admin = await requireAdmin();
  const existing = await db.query.workationRequests.findFirst({
    where: eq(workationRequests.id, id),
  });
  if (!existing) throw new Error("Antrag nicht gefunden.");

  const a1Status = String(formData.get("a1Status") ?? "");
  const proofProvidedAt = String(formData.get("proofProvidedAt") ?? "");
  const excludedProjects = String(formData.get("excludedProjects") ?? "");

  await db
    .update(workationRequests)
    .set({
      // A1 nur bei EU/EWR/Schweiz
      a1Status:
        existing.countryCategory === "eu_ewr_ch" && a1Status
          ? (a1Status as "nicht_beantragt" | "beantragt" | "liegt_vor")
          : existing.countryCategory === "eu_ewr_ch"
            ? existing.a1Status
            : null,
      proofProvidedAt: proofProvidedAt || null,
      excludedProjects: excludedProjects || null,
      updatedAt: new Date(),
    })
    .where(eq(workationRequests.id, id));

  await writeAudit({
    objectType: "workation",
    objectId: id,
    action: "admin_felder_aktualisiert",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
    details: { a1Status, proofProvidedAt, excludedProjects },
  });

  revalidatePath(`/workation/${id}`);
  revalidatePath(`/freigaben/workation/${id}`);
}
