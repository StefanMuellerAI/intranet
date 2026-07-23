"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import {
  apiKeys,
  db,
  deputyAssignments,
  settings,
  webhookConfigs,
  WEBHOOK_CATEGORIES,
  WEBHOOK_EVENTS,
} from "@/db";
import { hashApiKey } from "@/lib/api-keys";
import { writeAudit } from "@/lib/audit";
import { fullName, requireAdmin } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Sätze und Kontingente
// ---------------------------------------------------------------------------

function euroToCents(value: FormDataEntryValue | null): number {
  const n = Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(n) || n < 0) throw new Error("Ungültiger Betrag.");
  return Math.round(n * 100);
}

export async function updateRates(formData: FormData) {
  const admin = await requireAdmin();
  await db
    .update(settings)
    .set({
      rateFullDayCents: euroToCents(formData.get("rateFullDay")),
      ratePartialDayCents: euroToCents(formData.get("ratePartialDay")),
      rateReductionBreakfastCents: euroToCents(
        formData.get("rateReductionBreakfast")
      ),
      rateReductionLunchCents: euroToCents(formData.get("rateReductionLunch")),
      rateReductionDinnerCents: euroToCents(
        formData.get("rateReductionDinner")
      ),
      rateKmCents: euroToCents(formData.get("rateKm")),
      ratePassengerKmCents: euroToCents(formData.get("ratePassengerKm")),
      employerDailySupplementCents: euroToCents(
        formData.get("employerDailySupplement")
      ),
      updatedAt: new Date(),
    })
    .where(eq(settings.id, 1));

  await writeAudit({
    objectType: "settings",
    action: "saetze_geaendert",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
  });
  revalidatePath("/einstellungen");
}

export async function updateQuotas(formData: FormData) {
  const admin = await requireAdmin();
  const defaultVacation = Number(formData.get("defaultAnnualVacationDays"));
  const yearly = Number(formData.get("workationYearlyLimitDays"));
  const consecutive = Number(formData.get("workationConsecutiveLimitDays"));
  if (
    !Number.isFinite(defaultVacation) ||
    !Number.isFinite(yearly) ||
    !Number.isFinite(consecutive)
  )
    throw new Error("Ungültige Werte.");

  await db
    .update(settings)
    .set({
      defaultAnnualVacationDays: defaultVacation,
      workationYearlyLimitDays: yearly,
      workationConsecutiveLimitDays: consecutive,
      updatedAt: new Date(),
    })
    .where(eq(settings.id, 1));

  await writeAudit({
    objectType: "settings",
    action: "kontingente_geaendert",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
  });
  revalidatePath("/einstellungen");
}

export async function updateRetention(formData: FormData) {
  const admin = await requireAdmin();
  await db
    .update(settings)
    .set({
      retentionExpenseYears: Number(formData.get("retentionExpenseYears")) || 8,
      retentionSickLeaveYears:
        Number(formData.get("retentionSickLeaveYears")) || 5,
      retentionRequestYears: Number(formData.get("retentionRequestYears")) || 3,
      updatedAt: new Date(),
    })
    .where(eq(settings.id, 1));

  await writeAudit({
    objectType: "settings",
    action: "aufbewahrungsfristen_geaendert",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
  });
  revalidatePath("/einstellungen");
}

// ---------------------------------------------------------------------------
// Vertretung
// ---------------------------------------------------------------------------

export async function setDeputy(formData: FormData) {
  const admin = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const startsOn = String(formData.get("startsOn") ?? "") || null;
  const endsOn = String(formData.get("endsOn") ?? "") || null;
  if (!userId) throw new Error("Bitte eine/n Mitarbeiter/in auswählen.");

  // Bestehende Vertretungen beenden, dann neue aktivieren
  await db
    .update(deputyAssignments)
    .set({ active: false })
    .where(eq(deputyAssignments.active, true));
  await db.insert(deputyAssignments).values({
    userId,
    active: true,
    startsOn,
    endsOn,
  });

  await writeAudit({
    objectType: "vertretung",
    action: "vertretung_aktiviert",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
    details: { userId, startsOn, endsOn },
  });
  revalidatePath("/einstellungen");
}

export async function clearDeputy() {
  const admin = await requireAdmin();
  await db
    .update(deputyAssignments)
    .set({ active: false })
    .where(eq(deputyAssignments.active, true));

  await writeAudit({
    objectType: "vertretung",
    action: "vertretung_entzogen",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
  });
  revalidatePath("/einstellungen");
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export async function addWebhook(formData: FormData) {
  const admin = await requireAdmin();
  const category = String(formData.get("category") ?? "");
  const event = String(formData.get("event") ?? "");
  const url = String(formData.get("url") ?? "");
  const secret = String(formData.get("secret") ?? "");

  if (!(WEBHOOK_CATEGORIES as readonly string[]).includes(category))
    throw new Error("Ungültige Kategorie.");
  if (!(WEBHOOK_EVENTS as readonly string[]).includes(event))
    throw new Error("Ungültiges Ereignis.");
  if (!url.startsWith("https://"))
    throw new Error("Die Webhook-URL muss mit https:// beginnen.");
  if (secret.length < 16)
    throw new Error("Das Secret muss mindestens 16 Zeichen lang sein.");

  await db.insert(webhookConfigs).values({
    category: category as (typeof WEBHOOK_CATEGORIES)[number],
    event: event as (typeof WEBHOOK_EVENTS)[number],
    url,
    secret,
  });

  await writeAudit({
    objectType: "webhook",
    action: "webhook_angelegt",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
    details: { category, event, url },
  });
  revalidatePath("/einstellungen");
}

export async function deleteWebhook(id: string) {
  const admin = await requireAdmin();
  await db.delete(webhookConfigs).where(eq(webhookConfigs.id, id));
  await writeAudit({
    objectType: "webhook",
    objectId: id,
    action: "webhook_geloescht",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
  });
  revalidatePath("/einstellungen");
}

export async function toggleWebhook(id: string, active: boolean) {
  const admin = await requireAdmin();
  await db
    .update(webhookConfigs)
    .set({ active })
    .where(eq(webhookConfigs.id, id));
  await writeAudit({
    objectType: "webhook",
    objectId: id,
    action: active ? "webhook_aktiviert" : "webhook_deaktiviert",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
  });
  revalidatePath("/einstellungen");
}

// ---------------------------------------------------------------------------
// API-Keys
// ---------------------------------------------------------------------------

/** Erzeugt einen API-Key; der Klartext wird nur einmalig zurückgegeben. */
export async function createApiKey(formData: FormData): Promise<string> {
  const admin = await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Bitte einen Namen für den Key angeben.");

  const plaintext = `sk_stefanai_${randomBytes(32).toString("hex")}`;
  await db.insert(apiKeys).values({
    name,
    keyHash: hashApiKey(plaintext),
    keyPrefix: plaintext.slice(0, 16),
    createdById: admin.id,
  });

  await writeAudit({
    objectType: "api_key",
    action: "api_key_erstellt",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
    details: { name },
  });
  revalidatePath("/einstellungen");
  return plaintext;
}

export async function revokeApiKey(id: string) {
  const admin = await requireAdmin();
  await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(eq(apiKeys.id, id));
  await writeAudit({
    objectType: "api_key",
    objectId: id,
    action: "api_key_widerrufen",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
  });
  revalidatePath("/einstellungen");
}
