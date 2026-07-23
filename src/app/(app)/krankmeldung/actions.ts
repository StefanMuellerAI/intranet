"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, sickLeaves } from "@/db";
import { writeAudit } from "@/lib/audit";
import { fullName, requireAdmin, requireUser } from "@/lib/auth";
import { formatDateDE } from "@/lib/dates";
import { notifySickLeave } from "@/lib/notifications";
import { dispatchWebhookEvent } from "@/lib/webhooks";

const TYPE_LABELS: Record<string, string> = {
  eigene_erkrankung: "eigene Erkrankung",
  kind_krank: "Kind krank",
};

const sickLeaveSchema = z.object({
  startDate: z.string().min(1, "Bitte ersten Tag der Arbeitsunfähigkeit angeben."),
  endDate: z.string().optional(),
  type: z.enum(["eigene_erkrankung", "kind_krank"]),
  note: z.string().optional(),
});

export async function submitSickLeave(formData: FormData) {
  const user = await requireUser();
  const data = sickLeaveSchema.parse({
    startDate: String(formData.get("startDate") ?? ""),
    endDate: String(formData.get("endDate") ?? "") || undefined,
    type: String(formData.get("type") ?? "eigene_erkrankung"),
    note: String(formData.get("note") ?? "") || undefined,
  });

  const [leave] = await db
    .insert(sickLeaves)
    .values({
      userId: user.id,
      startDate: data.startDate,
      endDate: data.endDate ?? null,
      type: data.type,
      note: data.note,
    })
    .returning();

  await writeAudit({
    objectType: "krankmeldung",
    objectId: leave.id,
    action: "gemeldet",
    actorUserId: user.id,
    actorLabel: fullName(user),
    source: "web",
  });
  await notifySickLeave({
    sickLeaveId: leave.id,
    applicant: user,
    kind: "gemeldet",
    summary: `${TYPE_LABELS[data.type]}, ab ${formatDateDE(data.startDate)}${
      data.endDate
        ? `, voraussichtlich bis ${formatDateDE(data.endDate)}`
        : ", Ende offen"
    }. Der Nachweis läuft über das eAU-Verfahren.`,
  });
  await dispatchWebhookEvent("krankmeldung", "gemeldet", {
    vorgangs_id: leave.id,
    status: leave.status,
    user: { id: user.id, name: fullName(user), email: user.email },
    formulardaten: leave,
  });

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
    applicant: user,
    kind: "abgeschlossen",
    summary: `Abwesenheit von ${formatDateDE(leave.startDate)} bis ${formatDateDE(endDate)} wurde abgeschlossen.`,
  });
  await dispatchWebhookEvent("krankmeldung", "abgeschlossen", {
    vorgangs_id: id,
    status: updated.status,
    user: { id: user.id, name: fullName(user), email: user.email },
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

  const data = sickLeaveSchema.parse({
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
