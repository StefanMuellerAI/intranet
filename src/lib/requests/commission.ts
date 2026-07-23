import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { commissionClaims, db, type User } from "@/db";
import { writeAudit } from "@/lib/audit";
import { fullName } from "@/lib/auth";
import {
  calcCommissionCents,
  type CommissionRates,
} from "@/lib/commissions/calc";
import { formatEuro } from "@/lib/expenses/calc";
import { saveHistorySnapshot } from "@/lib/history";
import { notifyRequestSubmitted } from "@/lib/notifications";
import type { RequestActorSource } from "@/lib/requests/types";
import { commissionRatesFromSettings, getSettings } from "@/lib/settings";
import { dispatchWebhookEvent } from "@/lib/webhooks";
import { buildWebhookPayload } from "@/lib/workflow";

export const commissionInputSchema = z
  .object({
    businessType: z.enum(["beratung", "schulung"]),
    customerType: z.enum(["neukunde", "bestandskunde"]),
    customerName: z.string().min(1, "Bitte Kunde/Organisation angeben."),
    orderDate: z.string().min(1, "Bitte das Datum der Bestellung angeben."),
    unit: z.enum(["tage", "liefergegenstaende"]),
    quantity: z
      .number({ message: "Bitte den Umfang angeben." })
      .positive("Der Umfang muss größer als 0 sein."),
    trainingFormat: z
      .enum(["halbtaegig", "ganztaegig", "zweitaegig", "abweichend"])
      .optional(),
    trainingCount: z.number().int().positive().optional(),
    netOrderValueCents: z.number().int().nonnegative().optional(),
    note: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.businessType === "schulung") {
      if (!v.trainingFormat)
        ctx.addIssue({
          code: "custom",
          path: ["trainingFormat"],
          message: "Bitte das Trainingsformat wählen.",
        });
      if (!v.trainingCount)
        ctx.addIssue({
          code: "custom",
          path: ["trainingCount"],
          message: "Bitte die Anzahl der bestellten Trainings angeben.",
        });
    }
    if (v.businessType === "beratung" && v.netOrderValueCents == null)
      ctx.addIssue({
        code: "custom",
        path: ["netOrderValueCents"],
        message: "Bitte den Nettoauftragswert angeben.",
      });
  });

export type CommissionInput = z.infer<typeof commissionInputSchema>;

function summaryText(
  data: CommissionInput,
  calculated: number | null
): string {
  const amount =
    calculated != null
      ? `Berechneter Anspruch: ${formatEuro(calculated)}.`
      : "Betrag individuell zu vereinbaren.";
  const extra =
    data.customerType === "neukunde"
      ? " Neukunden-Vermittlung: Vermittlungsprovision wird im Einzelfall abgestimmt."
      : "";
  return `${data.businessType === "beratung" ? "Folgeberatung" : "Folge-Training"} für ${data.customerName}. ${amount}${extra}`;
}

export async function createCommissionClaim(
  user: User,
  raw: CommissionInput,
  source: RequestActorSource = "web"
) {
  const data = commissionInputSchema.parse(raw);
  const settings = await getSettings();
  const rates: CommissionRates = commissionRatesFromSettings(settings);
  const calculated = calcCommissionCents(data, rates);

  const [claim] = await db
    .insert(commissionClaims)
    .values({
      userId: user.id,
      businessType: data.businessType,
      customerType: data.customerType,
      customerName: data.customerName,
      orderDate: data.orderDate,
      unit: data.unit,
      quantity: data.quantity,
      trainingFormat: data.trainingFormat,
      trainingCount: data.trainingCount,
      netOrderValueCents: data.netOrderValueCents,
      note: data.note,
      ratesSnapshot: rates,
      calculatedAmountCents: calculated,
      finalAmountCents: calculated,
    })
    .returning();

  await writeAudit({
    objectType: "provision",
    objectId: claim.id,
    action: "eingereicht",
    actorUserId: user.id,
    actorLabel: fullName(user),
    source,
  });
  await notifyRequestSubmitted({
    type: "provision",
    requestId: claim.id,
    applicant: user,
    resubmitted: false,
    summary: summaryText(data, calculated),
  });
  await dispatchWebhookEvent(
    "provision",
    "eingereicht",
    await buildWebhookPayload("provision", claim, user)
  );

  return claim;
}

export async function resubmitCommissionClaimForUser(
  user: User,
  id: string,
  raw: CommissionInput,
  source: RequestActorSource = "web"
) {
  const existing = await db.query.commissionClaims.findFirst({
    where: eq(commissionClaims.id, id),
  });
  if (!existing || existing.userId !== user.id)
    throw new Error("Anspruch nicht gefunden.");
  if (existing.status !== "beanstandet" && existing.status !== "zurueckgezogen")
    throw new Error(
      "Nur beanstandete oder zurückgezogene Ansprüche können korrigiert werden."
    );

  const data = commissionInputSchema.parse(raw);
  const settings = await getSettings();
  const rates: CommissionRates = commissionRatesFromSettings(settings);
  const calculated = calcCommissionCents(data, rates);

  await saveHistorySnapshot("provision", id, existing.version, { ...existing });

  const [claim] = await db
    .update(commissionClaims)
    .set({
      status: "eingereicht",
      version: existing.version + 1,
      businessType: data.businessType,
      customerType: data.customerType,
      customerName: data.customerName,
      orderDate: data.orderDate,
      unit: data.unit,
      quantity: data.quantity,
      trainingFormat: data.trainingFormat ?? null,
      trainingCount: data.trainingCount ?? null,
      netOrderValueCents: data.netOrderValueCents ?? null,
      note: data.note ?? null,
      ratesSnapshot: rates,
      calculatedAmountCents: calculated,
      referralBonusCents: null,
      finalAmountCents: calculated,
      updatedAt: new Date(),
    })
    .where(eq(commissionClaims.id, id))
    .returning();

  await writeAudit({
    objectType: "provision",
    objectId: id,
    action: "korrigiert_erneut_eingereicht",
    actorUserId: user.id,
    actorLabel: fullName(user),
    source,
  });
  await notifyRequestSubmitted({
    type: "provision",
    requestId: id,
    applicant: user,
    resubmitted: true,
    summary: `${summaryText(data, calculated)} (Version ${claim.version})`,
  });
  await dispatchWebhookEvent(
    "provision",
    "eingereicht",
    await buildWebhookPayload("provision", claim, user)
  );

  return claim;
}

export async function withdrawCommissionClaimForUser(
  user: User,
  id: string,
  source: RequestActorSource = "web"
) {
  const existing = await db.query.commissionClaims.findFirst({
    where: eq(commissionClaims.id, id),
  });
  if (!existing || existing.userId !== user.id)
    throw new Error("Anspruch nicht gefunden.");
  if (existing.status !== "eingereicht" && existing.status !== "beanstandet")
    throw new Error(
      "Nur eingereichte oder beanstandete Ansprüche können zurückgezogen werden."
    );

  await db
    .update(commissionClaims)
    .set({ status: "zurueckgezogen", updatedAt: new Date() })
    .where(eq(commissionClaims.id, id));

  await writeAudit({
    objectType: "provision",
    objectId: id,
    action: "zurueckgezogen",
    actorUserId: user.id,
    actorLabel: fullName(user),
    source,
  });

  return { id, status: "zurueckgezogen" as const };
}
