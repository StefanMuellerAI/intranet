import "server-only";
import { eq } from "drizzle-orm";
import { db, settings, type Settings } from "@/db";
import type { MealRates } from "@/lib/expenses/calc";

export async function getSettings(): Promise<Settings> {
  const row = await db.query.settings.findFirst({
    where: eq(settings.id, 1),
  });
  if (row) return row;
  const [created] = await db
    .insert(settings)
    .values({ id: 1 })
    .onConflictDoNothing({ target: settings.id })
    .returning();
  return created ?? (await db.query.settings.findFirst({
    where: eq(settings.id, 1),
  }))!;
}

export function ratesFromSettings(s: Settings): MealRates {
  return {
    fullDayCents: s.rateFullDayCents,
    partialDayCents: s.ratePartialDayCents,
    breakfastCents: s.rateReductionBreakfastCents,
    lunchCents: s.rateReductionLunchCents,
    dinnerCents: s.rateReductionDinnerCents,
    kmCents: s.rateKmCents,
    passengerKmCents: s.ratePassengerKmCents,
    employerDailySupplementCents: s.employerDailySupplementCents,
  };
}
