import "server-only";
import { and, eq, gte, lte, ne, or } from "drizzle-orm";
import {
  db,
  sickLeaves,
  vacationRequests,
  workationRequests,
  users,
  type User,
} from "@/db";

/**
 * Urlaubskonto: Jahresanspruch + Übertrag − verbrauchte Tage.
 * Verbraucht zählen genehmigte Anträge und Anträge mit beantragtem Storno
 * (Tage erst nach bestätigtem Storno wieder gutgeschrieben); eingereichte
 * Anträge werden als "geplant" separat ausgewiesen.
 */
export async function getVacationAccount(user: User, year: number) {
  const requests = await db
    .select()
    .from(vacationRequests)
    .where(eq(vacationRequests.userId, user.id));
  const inYear = requests.filter((r) => r.startDate.startsWith(String(year)));

  const used = inYear
    .filter((r) => r.status === "genehmigt" || r.status === "storno_beantragt")
    .reduce((s, r) => s + r.days, 0);
  const pending = inYear
    .filter((r) => r.status === "eingereicht")
    .reduce((s, r) => s + r.days, 0);

  const entitlement = user.annualVacationDays + user.vacationCarryoverDays;
  return {
    year,
    entitlement,
    used,
    pending,
    remaining: entitlement - used,
    remainingAfterPending: entitlement - used - pending,
  };
}

/**
 * Genehmigte Abwesenheiten anderer Mitarbeitender, die sich mit dem Zeitraum
 * überschneiden (für den Überschneidungshinweis im Formular).
 */
export async function getOverlappingAbsences(
  excludeUserId: string,
  fromISO: string,
  toISO: string
): Promise<{ name: string; type: string; from: string; to: string }[]> {
  const [vacations, workations, sick] = await Promise.all([
    db
      .select({
        userId: vacationRequests.userId,
        from: vacationRequests.startDate,
        to: vacationRequests.endDate,
      })
      .from(vacationRequests)
      .where(
        and(
          eq(vacationRequests.status, "genehmigt"),
          ne(vacationRequests.userId, excludeUserId),
          lte(vacationRequests.startDate, toISO),
          gte(vacationRequests.endDate, fromISO)
        )
      ),
    db
      .select({
        userId: workationRequests.userId,
        from: workationRequests.startDate,
        to: workationRequests.endDate,
      })
      .from(workationRequests)
      .where(
        and(
          eq(workationRequests.status, "genehmigt"),
          ne(workationRequests.userId, excludeUserId),
          lte(workationRequests.startDate, toISO),
          gte(workationRequests.endDate, fromISO)
        )
      ),
    db
      .select({
        userId: sickLeaves.userId,
        from: sickLeaves.startDate,
        to: sickLeaves.endDate,
      })
      .from(sickLeaves)
      .where(
        and(
          ne(sickLeaves.userId, excludeUserId),
          lte(sickLeaves.startDate, toISO),
          or(gte(sickLeaves.endDate, fromISO), eq(sickLeaves.status, "gemeldet"))
        )
      ),
  ]);

  const allUsers = await db.select().from(users);
  const nameOf = (id: string) => {
    const u = allUsers.find((x) => x.id === id);
    return u ? `${u.firstName} ${u.lastName}` : "Unbekannt";
  };

  return [
    ...vacations.map((v) => ({
      name: nameOf(v.userId),
      type: "Urlaub",
      from: v.from,
      to: v.to,
    })),
    ...workations.map((w) => ({
      name: nameOf(w.userId),
      type: "Workation",
      from: w.from,
      to: w.to,
    })),
    // Krankheit wird für andere neutral als "abwesend" ausgewiesen
    ...sick.map((s) => ({
      name: nameOf(s.userId),
      type: "abwesend",
      from: s.from,
      to: s.to ?? s.from,
    })),
  ];
}

/** Bereits verplante Workation-Arbeitstage im Kalenderjahr (ohne einen Antrag) */
export async function getUsedWorkationDays(
  userId: string,
  year: number,
  excludeRequestId?: string
): Promise<number> {
  const requests = await db
    .select()
    .from(workationRequests)
    .where(eq(workationRequests.userId, userId));
  return requests
    .filter(
      (r) =>
        r.id !== excludeRequestId &&
        r.startDate.startsWith(String(year)) &&
        (r.status === "genehmigt" || r.status === "eingereicht")
    )
    .reduce((s, r) => s + r.workDays, 0);
}
