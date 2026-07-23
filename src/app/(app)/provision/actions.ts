"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { commissionClaims, db, requestHistory } from "@/db";
import { writeAudit } from "@/lib/audit";
import { fullName, requireAdmin, requireUser } from "@/lib/auth";
import {
  calcCommissionCents,
  type CommissionRates,
} from "@/lib/commissions/calc";
import { formatEuro } from "@/lib/expenses/calc";
import { saveHistorySnapshot } from "@/lib/history";
import { notifyRequestSubmitted } from "@/lib/notifications";
import { commissionRatesFromSettings, getSettings } from "@/lib/settings";
import { dispatchWebhookEvent } from "@/lib/webhooks";
import { buildWebhookPayload } from "@/lib/workflow";

const commissionSchema = z
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

function parseEuroToCents(value: FormDataEntryValue | null): number | undefined {
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;
  const n = Number(raw.replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(n) || n < 0) throw new Error("Ungültiger Betrag.");
  return Math.round(n * 100);
}

function parseForm(formData: FormData) {
  const businessType = String(formData.get("businessType") ?? "");
  return commissionSchema.parse({
    businessType,
    customerType: String(formData.get("customerType") ?? ""),
    customerName: String(formData.get("customerName") ?? "").trim(),
    orderDate: String(formData.get("orderDate") ?? ""),
    unit: String(formData.get("unit") ?? ""),
    quantity: Number(String(formData.get("quantity") ?? "").replace(",", ".")),
    trainingFormat:
      businessType === "schulung"
        ? String(formData.get("trainingFormat") ?? "") || undefined
        : undefined,
    trainingCount:
      businessType === "schulung"
        ? Number(formData.get("trainingCount")) || undefined
        : undefined,
    netOrderValueCents:
      businessType === "beratung"
        ? parseEuroToCents(formData.get("netOrderValue"))
        : undefined,
    note: String(formData.get("note") ?? "") || undefined,
  });
}

function summaryText(
  data: ReturnType<typeof parseForm>,
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

export async function submitCommissionClaim(formData: FormData) {
  const user = await requireUser();
  const data = parseForm(formData);

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
    source: "web",
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

  revalidatePath("/provision");
  redirect(`/provision/${claim.id}`);
}

/** Beanstandeten Anspruch korrigieren und erneut einreichen (mit Historie). */
export async function resubmitCommissionClaim(id: string, formData: FormData) {
  const user = await requireUser();
  const existing = await db.query.commissionClaims.findFirst({
    where: eq(commissionClaims.id, id),
  });
  if (!existing || existing.userId !== user.id)
    throw new Error("Anspruch nicht gefunden.");
  if (existing.status !== "beanstandet" && existing.status !== "zurueckgezogen")
    throw new Error(
      "Nur beanstandete oder zurückgezogene Ansprüche können korrigiert werden."
    );

  const data = parseForm(formData);
  const settings = await getSettings();
  const rates: CommissionRates = commissionRatesFromSettings(settings);
  const calculated = calcCommissionCents(data, rates);

  await saveHistorySnapshot("provision", id, existing.version, {
    ...existing,
  });

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
      // Admin-gepflegte Beträge verfallen mit der Korrektur
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
    source: "web",
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

  revalidatePath("/provision");
  redirect(`/provision/${id}`);
}

/** Eingereichten oder beanstandeten Anspruch zurückziehen. */
export async function withdrawCommissionClaim(id: string) {
  const user = await requireUser();
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
    source: "web",
  });

  revalidatePath(`/provision/${id}`);
  revalidatePath("/provision");
}

/** Zurückgezogenen Anspruch endgültig löschen. */
export async function deleteCommissionClaim(id: string) {
  const user = await requireUser();
  const existing = await db.query.commissionClaims.findFirst({
    where: eq(commissionClaims.id, id),
  });
  if (!existing || existing.userId !== user.id)
    throw new Error("Anspruch nicht gefunden.");
  if (existing.status !== "zurueckgezogen")
    throw new Error(
      "Nur zurückgezogene Ansprüche können endgültig gelöscht werden."
    );

  // Audit vor dem Löschen schreiben (Audit-Log hat keinen Fremdschlüssel)
  await writeAudit({
    objectType: "provision",
    objectId: id,
    action: "geloescht",
    actorUserId: user.id,
    actorLabel: fullName(user),
    source: "web",
    details: {
      customerName: existing.customerName,
      orderDate: existing.orderDate,
      businessType: existing.businessType,
    },
  });

  await db
    .delete(requestHistory)
    .where(
      and(
        eq(requestHistory.requestType, "provision"),
        eq(requestHistory.requestId, id)
      )
    );
  await db.delete(commissionClaims).where(eq(commissionClaims.id, id));

  revalidatePath("/provision");
  redirect("/provision");
}

/**
 * Vom Admin zu pflegende Beträge: Vermittlungsprovision (Neukunde,
 * Einzelfall) und finaler Gesamtbetrag (Override der Berechnung).
 */
export async function updateCommissionAdminFields(
  id: string,
  formData: FormData
) {
  const admin = await requireAdmin();
  const existing = await db.query.commissionClaims.findFirst({
    where: eq(commissionClaims.id, id),
  });
  if (!existing) throw new Error("Anspruch nicht gefunden.");

  const referralBonusCents =
    parseEuroToCents(formData.get("referralBonus")) ?? null;
  const finalOverrideCents = parseEuroToCents(formData.get("finalAmount"));

  // Ohne Override: Berechnung + ggf. Vermittlungsprovision; bleibt null,
  // wenn weder Berechnung noch Vermittlungsprovision vorliegen.
  const finalAmountCents =
    finalOverrideCents ??
    (existing.calculatedAmountCents != null || referralBonusCents != null
      ? (existing.calculatedAmountCents ?? 0) + (referralBonusCents ?? 0)
      : null);

  await db
    .update(commissionClaims)
    .set({
      referralBonusCents,
      finalAmountCents,
      updatedAt: new Date(),
    })
    .where(eq(commissionClaims.id, id));

  await writeAudit({
    objectType: "provision",
    objectId: id,
    action: "admin_betraege_aktualisiert",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
    details: { referralBonusCents, finalAmountCents },
  });

  revalidatePath(`/provision/${id}`);
  revalidatePath(`/freigaben/provision/${id}`);
}
