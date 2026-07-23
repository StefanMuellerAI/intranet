"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, requestHistory, workationRequests } from "@/db";
import { writeAudit } from "@/lib/audit";
import { fullName, requireAdmin, requireUser } from "@/lib/auth";
import {
  createWorkationRequest,
  resubmitWorkationRequestForUser,
  withdrawWorkationRequestForUser,
  workationInputSchema,
} from "@/lib/requests/workation";

function parseForm(formData: FormData) {
  const bool = (k: string) => formData.get(k) === "on";
  return workationInputSchema.parse({
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
}

export async function submitWorkationRequest(formData: FormData) {
  const user = await requireUser();
  const request = await createWorkationRequest(user, parseForm(formData), "web");
  revalidatePath("/workation");
  redirect(`/workation/${request.id}`);
}

export async function resubmitWorkationRequest(id: string, formData: FormData) {
  const user = await requireUser();
  await resubmitWorkationRequestForUser(user, id, parseForm(formData), "web");
  revalidatePath("/workation");
  redirect(`/workation/${id}`);
}

export async function withdrawWorkationRequest(id: string) {
  const user = await requireUser();
  await withdrawWorkationRequestForUser(user, id, "web");
  revalidatePath(`/workation/${id}`);
  revalidatePath("/workation");
}

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
