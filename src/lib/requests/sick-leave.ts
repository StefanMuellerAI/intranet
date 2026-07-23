import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, sickLeaves, type User } from "@/db";
import { writeAudit } from "@/lib/audit";
import { fullName } from "@/lib/auth";
import { formatDateDE } from "@/lib/dates";
import { notifySickLeave } from "@/lib/notifications";
import type { RequestActorSource } from "@/lib/requests/types";
import { dispatchWebhookEvent } from "@/lib/webhooks";

const TYPE_LABELS: Record<string, string> = {
  eigene_erkrankung: "eigene Erkrankung",
  kind_krank: "Kind krank",
};

export const sickLeaveInputSchema = z.object({
  startDate: z.string().min(1, "Bitte ersten Tag der Arbeitsunfähigkeit angeben."),
  endDate: z.string().optional(),
  type: z.enum(["eigene_erkrankung", "kind_krank"]),
  note: z.string().optional(),
});

export type SickLeaveInput = z.infer<typeof sickLeaveInputSchema>;

export async function createSickLeave(
  user: User,
  raw: SickLeaveInput,
  source: RequestActorSource = "web"
) {
  const data = sickLeaveInputSchema.parse(raw);

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
    source,
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

  return leave;
}

export async function closeSickLeaveForUser(
  user: User,
  id: string,
  endDate: string,
  source: RequestActorSource = "web"
) {
  const leave = await db.query.sickLeaves.findFirst({
    where: eq(sickLeaves.id, id),
  });
  if (!leave || leave.userId !== user.id)
    throw new Error("Krankmeldung nicht gefunden.");

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
    source,
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

  return updated;
}
