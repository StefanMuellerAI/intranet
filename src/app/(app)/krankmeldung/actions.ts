"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, sickLeaves } from "@/db";
import { writeAudit } from "@/lib/audit";
import { fullName, requireAdmin, requireUser } from "@/lib/auth";
import {
  closeSickLeaveForUser,
  createSickLeave,
  sickLeaveInputSchema,
} from "@/lib/requests/sick-leave";

export async function submitSickLeave(formData: FormData) {
  const user = await requireUser();
  const leave = await createSickLeave(
    user,
    sickLeaveInputSchema.parse({
      startDate: String(formData.get("startDate") ?? ""),
      endDate: String(formData.get("endDate") ?? "") || undefined,
      type: String(formData.get("type") ?? "eigene_erkrankung"),
      note: String(formData.get("note") ?? "") || undefined,
    }),
    "web"
  );
  revalidatePath("/krankmeldung");
  redirect(`/krankmeldung/${leave.id}`);
}

/** Tatsächliches Enddatum nachtragen → Status Abgeschlossen, Info an Admin. */
export async function closeSickLeave(id: string, formData: FormData) {
  const user = await requireUser();
  await closeSickLeaveForUser(
    user,
    id,
    String(formData.get("endDate") ?? ""),
    "web"
  );
  revalidatePath(`/krankmeldung/${id}`);
  revalidatePath("/krankmeldung");
}

/** Admin kann Meldungen bei Bedarf korrigieren. */
export async function correctSickLeave(id: string, formData: FormData) {
  const admin = await requireAdmin();
  const leave = await db.query.sickLeaves.findFirst({
    where: eq(sickLeaves.id, id),
  });
  if (!leave) throw new Error("Krankmeldung nicht gefunden.");

  const data = sickLeaveInputSchema.parse({
    startDate: String(formData.get("startDate") ?? ""),
    endDate: String(formData.get("endDate") ?? "") || undefined,
    type: String(formData.get("type") ?? leave.type),
    note: String(formData.get("note") ?? "") || undefined,
  });

  await db
    .update(sickLeaves)
    .set({
      startDate: data.startDate,
      endDate: data.endDate ?? null,
      type: data.type,
      note: data.note ?? null,
      status: data.endDate ? "abgeschlossen" : "gemeldet",
      updatedAt: new Date(),
    })
    .where(eq(sickLeaves.id, id));

  await writeAudit({
    objectType: "krankmeldung",
    objectId: id,
    action: "durch_admin_korrigiert",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
  });

  revalidatePath(`/krankmeldung/${id}`);
  revalidatePath("/krankmeldung");
}
