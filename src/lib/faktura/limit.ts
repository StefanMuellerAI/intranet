import "server-only";
import { and, eq, gte, lte, ne, sql } from "drizzle-orm";
import { db, fakturaTimeEntries, type FakturaProject } from "@/db";
import { formatMinutesAsHours, monthOf } from "@/lib/faktura/zeitfenster";

/** Letzter Kalendertag eines Monats (YYYY-MM → YYYY-MM-DD). */
function lastDayOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

/**
 * Gebuchte Minuten eines Projekts im Kalendermonat — aggregiert über alle
 * Mitarbeitenden, inkl. ausgeblendeter Buchungen (Entscheidung E-3), ohne
 * (soft-)gelöschte. Maßgeblich ist immer das Buchungsdatum (FA-4.6).
 */
export async function getMonthlyBookedMinutes(
  projectId: string,
  month: string,
  excludeEntryId?: string
): Promise<number> {
  const conditions = [
    eq(fakturaTimeEntries.projectId, projectId),
    eq(fakturaTimeEntries.deleted, false),
    gte(fakturaTimeEntries.entryDate, `${month}-01`),
    lte(fakturaTimeEntries.entryDate, lastDayOfMonth(month)),
  ];
  if (excludeEntryId)
    conditions.push(ne(fakturaTimeEntries.id, excludeEntryId));

  const [row] = await db
    .select({
      total: sql<number>`coalesce(sum(${fakturaTimeEntries.durationMinutes}), 0)`,
    })
    .from(fakturaTimeEntries)
    .where(and(...conditions));
  return Number(row?.total ?? 0);
}

export interface LimitCheckResult {
  /** Meldung, wenn die Buchung das Limit erreicht oder überschreitet (FA-4.2) */
  warning: string | null;
  /** Nur Buchungen oberhalb des Limits werden markiert (Edge Case 7) */
  overbooked: boolean;
}

/**
 * Limitprüfung zum Speicherzeitpunkt (Edge Case 8). Projekte ohne Limit
 * lösen keinerlei Warnungen oder Überbuchungslogik aus (Edge Case 20).
 * Teilmonate bei Projektstart/-ende: Limit gilt unverändert (FA-4.7).
 */
export async function checkMonthlyLimit(
  project: FakturaProject,
  entryDateISO: string,
  durationMinutes: number,
  excludeEntryId?: string
): Promise<LimitCheckResult> {
  if (project.monthlyLimitMinutes == null)
    return { warning: null, overbooked: false };

  const month = monthOf(entryDateISO);
  const booked = await getMonthlyBookedMinutes(project.id, month, excludeEntryId);
  const newTotal = booked + durationMinutes;
  const limit = project.monthlyLimitMinutes;

  if (newTotal < limit) return { warning: null, overbooked: false };

  const exceeded = newTotal > limit;
  return {
    warning: `Monatslimit des Projekts ${exceeded ? "überschritten" : "erreicht"}: Mit dieser Buchung sind ${formatMinutesAsHours(newTotal)} von ${formatMinutesAsHours(limit)} Stunden im Monat gebucht.`,
    overbooked: exceeded,
  };
}

export interface ProjectMonthSaldo {
  bookedMinutes: number;
  limitMinutes: number | null;
}

/** Monatssaldo „gebucht / Limit" für die Admin-Projektansicht (FA-4.3). */
export async function getProjectMonthSaldo(
  project: FakturaProject,
  month: string
): Promise<ProjectMonthSaldo> {
  return {
    bookedMinutes: await getMonthlyBookedMinutes(project.id, month),
    limitMinutes: project.monthlyLimitMinutes,
  };
}
