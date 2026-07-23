"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, sickLeaves, users } from "@/db";
import { writeAudit } from "@/lib/audit";
import { fullName, requireAdmin, requireUser } from "@/lib/auth";
import { formatDateDE } from "@/lib/dates";
import { notifySickLeave } from "@/lib/notifications";
import {
  createSickLeave,
  sickLeaveInputSchema,
} from "@/lib/requests/sick-leave";
import { dispatchWebhookEvent } from "@/lib/webhooks";

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
  const leave = await db.query.sickLeaves.findFirst({
    where: eq(sickLeaves.id, id),
  });
  if (!leave || (leave.userId !== user.id && user.role !== "admin"))
    throw new Error("Krankmeldung nicht gefunden.");

  const endDate = String(formData.get("endDate") ?? "");
  if (!endDate) throw new Error("Bitte das tatsächliche Enddatum angeben.");
  if (endDate < leave.startDate)
    throw new Error("Das Enddatum darf nicht vor dem ersten Tag liegen.");

  const [updated] = await db
    .update(sickLeaves)
    .set({ endDate, status: "abgeschlossen", updatedAt: new Date() })
    .where(eq(sickLeaves.id, id))
    .returning();

  const applicant =
    leave.userId === user.id
      ? user
      : ((await db.query.users.findFirst({
          where: eq(users.id, leave.userId),
        })) ?? user);

  await writeAudit({
    objectType: "krankmeldung",
    objectId: id,
    action: "abgeschlossen",
    actorUserId: user.id,
    actorLabel: fullName(user),
    source: "web",
  });
  await notifySickLeave({
    sickLeaveId: id,
    applicant,
    kind: "abgeschlossen",
    summary: `Abwesenheit von ${formatDateDE(leave.startDate)} bis ${formatDateDE(endDate)} wurde abgeschlossen.`,
  });
  await dispatchWebhookEvent("krankmeldung", "abgeschlossen", {
    vorgangs_id: id,
    status: updated.status,
    user: { id: applicant.id, name: fullName(applicant), email: applicant.email },
    formulardaten: updated,
  });

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
