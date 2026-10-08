"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import {
  apiKeys,
  db,
  deputyAssignments,
  settings,
  users,
  webhookConfigs,
  WEBHOOK_CATEGORIES,
  WEBHOOK_EVENTS,
} from "@/db";
import { hashApiKey } from "@/lib/api-keys";
import { isApiKeyScope } from "@/lib/api-scopes";
import { writeAudit } from "@/lib/audit";
import { fullName, requireAdmin } from "@/lib/auth";
import { parseEuroToCents } from "@/lib/form-patterns";
import { isUuid } from "@/lib/http";
import { assertSafeWebhookUrl } from "@/lib/webhooks";

// ---------------------------------------------------------------------------
// Sätze und Kontingente
// ---------------------------------------------------------------------------

function euroToCents(value: FormDataEntryValue | null): number {
  // Leeres Feld zählt wie bisher als 0 €
  const cents = parseEuroToCents(String(value ?? "")) ?? 0;
  if (!Number.isFinite(cents) || cents < 0) throw new Error("Ungültiger Betrag.");
  return cents;
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

export async function updateCommissionRates(formData: FormData) {
  const admin = await requireAdmin();
  const percent = Number(
    String(formData.get("commissionConsultingPercent") ?? "").replace(",", ".")
  );
  if (!Number.isFinite(percent) || percent < 0 || percent > 100)
    throw new Error("Ungültiger Prozentsatz.");

  await db
    .update(settings)
    .set({
      commissionHalfDayCents: euroToCents(formData.get("commissionHalfDay")),
      commissionFullDayCents: euroToCents(formData.get("commissionFullDay")),
      commissionTwoDayCents: euroToCents(formData.get("commissionTwoDay")),
      commissionConsultingPercent: percent,
      updatedAt: new Date(),
    })
    .where(eq(settings.id, 1));

  await writeAudit({
    objectType: "settings",
    action: "provisionssaetze_geaendert",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
  });
  revalidatePath("/einstellungen");
}

export async function updateQuotas(formData: FormData) {
  const admin = await requireAdmin();
  // Leere Felder zählen bewusst als 0 (Number("") === 0)
  const defaultVacation = Number(formData.get("defaultAnnualVacationDays"));
  const yearly = Number(formData.get("workationYearlyLimitDays"));
  const consecutive = Number(formData.get("workationConsecutiveLimitDays"));
  if (
    !Number.isFinite(defaultVacation) ||
    defaultVacation < 0 ||
    // Workation-Grenzen sind ganze Arbeitstage (Integer-Spalten)
    !Number.isInteger(yearly) ||
    yearly < 0 ||
    !Number.isInteger(consecutive) ||
    consecutive < 0
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
  // Ganze Jahre ab 1 — eine Frist von 0 oder weniger würde aktuelle
  // Datensätze als löschbar ausweisen
  const years = (name: string) => {
    const raw = String(formData.get(name) ?? "").trim();
    const n = Number(raw);
    if (!raw || !Number.isInteger(n) || n < 1)
      throw new Error("Aufbewahrungsfristen müssen ganze Jahre ab 1 sein.");
    return n;
  };
  const retentionExpenseYears = years("retentionExpenseYears");
  const retentionSickLeaveYears = years("retentionSickLeaveYears");
  const retentionRequestYears = years("retentionRequestYears");

  await db
    .update(settings)
    .set({
      retentionExpenseYears,
      retentionSickLeaveYears,
      retentionRequestYears,
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
  if (!userId || !isUuid(userId))
    throw new Error("Bitte eine/n Mitarbeiter/in auswählen.");
  // Erst vollständig prüfen — sonst wäre die bisherige Vertretung schon
  // beendet, wenn das Anlegen der neuen scheitert
  const deputy = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!deputy || deputy.status !== "aktiv")
    throw new Error("Die ausgewählte Person ist nicht aktiv.");
  if (deputy.id === admin.id)
    throw new Error("Der Admin kann nicht die eigene Vertretung sein.");
  if (startsOn && endsOn && endsOn < startsOn)
    throw new Error("Das Enddatum darf nicht vor dem Startdatum liegen.");

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
  assertSafeWebhookUrl(url);
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
  const deleted = await db
    .delete(webhookConfigs)
    .where(eq(webhookConfigs.id, id))
    .returning({ id: webhookConfigs.id });
  if (deleted.length === 0) throw new Error("Webhook nicht gefunden.");
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
  const updated = await db
    .update(webhookConfigs)
    .set({ active })
    .where(eq(webhookConfigs.id, id))
    .returning({ id: webhookConfigs.id });
  if (updated.length === 0) throw new Error("Webhook nicht gefunden.");
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
  // Standard ist der geringstmögliche Umfang (readonly); jeder andere Umfang
  // muss der Admin beim Anlegen bewusst wählen. Unbekannte Werte — etwa aus
  // einem handgebauten Formular-Post — fallen auf readonly zurück.
  const rawScope = formData.get("scope");
  const scope = isApiKeyScope(rawScope) ? rawScope : "readonly";

  const plaintext = `sk_stefanai_${randomBytes(32).toString("hex")}`;
  await db.insert(apiKeys).values({
    name,
    keyHash: hashApiKey(plaintext),
    keyPrefix: plaintext.slice(0, 16),
    scope,
    createdById: admin.id,
  });

  await writeAudit({
    objectType: "api_key",
    action: "api_key_erstellt",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
    details: { name, scope },
  });
  revalidatePath("/einstellungen");
  return plaintext;
}

export async function revokeApiKey(id: string) {
  const admin = await requireAdmin();
  // Nur noch nicht widerrufene Keys — der ursprüngliche Zeitpunkt bleibt
  const revoked = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)))
    .returning({ id: apiKeys.id });
  if (revoked.length === 0)
    throw new Error("API-Key nicht gefunden oder bereits widerrufen.");
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
