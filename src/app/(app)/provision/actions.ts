"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { commissionClaims, db, requestHistory } from "@/db";
import { writeAudit } from "@/lib/audit";
import { fullName, requireAdmin, requireUser } from "@/lib/auth";
import {
  commissionInputSchema,
  createCommissionClaim,
  resubmitCommissionClaimForUser,
  withdrawCommissionClaimForUser,
} from "@/lib/requests/commission";

function parseEuroToCents(value: FormDataEntryValue | null): number | undefined {
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;
  const n = Number(raw.replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(n) || n < 0) throw new Error("Ungültiger Betrag.");
  return Math.round(n * 100);
}

function parseForm(formData: FormData) {
  const businessType = String(formData.get("businessType") ?? "");
  return commissionInputSchema.parse({
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

export async function submitCommissionClaim(formData: FormData) {
  const user = await requireUser();
  const claim = await createCommissionClaim(user, parseForm(formData), "web");
  revalidatePath("/provision");
  redirect(`/provision/${claim.id}`);
}

export async function resubmitCommissionClaim(id: string, formData: FormData) {
  const user = await requireUser();
  await resubmitCommissionClaimForUser(user, id, parseForm(formData), "web");
  revalidatePath("/provision");
  redirect(`/provision/${id}`);
}

export async function withdrawCommissionClaim(id: string) {
  const user = await requireUser();
  await withdrawCommissionClaimForUser(user, id, "web");
  revalidatePath(`/provision/${id}`);
  revalidatePath("/provision");
}

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
