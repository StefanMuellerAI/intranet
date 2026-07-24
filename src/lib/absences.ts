import "server-only";
import { and, eq, gte, inArray, lte, or } from "drizzle-orm";
import {
  db,
  sickLeaves,
  users,
  vacationRequests,
  workationRequests,
  type User,
} from "@/db";

export interface CalendarAbsence {
  userId: string;
  userName: string;
  /** urlaub | workation | krank | abwesend (neutral) | geburtstag */
  type: "urlaub" | "workation" | "krank" | "abwesend" | "geburtstag";
  from: string;
  to: string;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Geburtstage als jährlich wiederkehrende Eintagseinträge im Bereich
 * [fromISO, toISO]. Nur Monat/Tag werden übernommen — das Geburtsjahr
 * verlässt diese Funktion nicht. 29.02. wird in Nicht-Schaltjahren am
 * 28.02. angezeigt.
 */
function birthdayEntries(
  allUsers: User[],
  fromISO: string,
  toISO: string
): CalendarAbsence[] {
  const fromYear = Number(fromISO.slice(0, 4));
  const toYear = Number(toISO.slice(0, 4));
  const entries: CalendarAbsence[] = [];

  for (const u of allUsers) {
    if (!u.birthDate || u.status === "deaktiviert") continue;
    const monthDay = u.birthDate.slice(5); // "MM-TT"
    for (let year = fromYear; year <= toYear; year++) {
      const dayInYear =
        monthDay === "02-29" && !isLeapYear(year) ? "02-28" : monthDay;
      const iso = `${year}-${dayInYear}`;
      if (iso < fromISO || iso > toISO) continue;
      entries.push({
        userId: u.id,
        userName: `${u.firstName} ${u.lastName}`,
        type: "geburtstag",
        from: iso,
        to: iso,
      });
    }
  }
  return entries;
}

/**
 * Genehmigte Abwesenheiten für den Kalender — Sichtbarkeitsregel:
 * Krankheit sehen nur Admin und die betroffene Person als "krank",
 * alle anderen (inkl. Vertretung) nur neutral als "abwesend".
 */
export async function getCalendarAbsences(
  viewer: User,
  fromISO: string,
  toISO: string
): Promise<CalendarAbsence[]> {
  const [vacations, workations, sick, allUsers] = await Promise.all([
    db
      .select()
      .from(vacationRequests)
      .where(
        and(
          inArray(vacationRequests.status, ["genehmigt", "storno_beantragt"]),
          lte(vacationRequests.startDate, toISO),
          gte(vacationRequests.endDate, fromISO)
        )
      ),
    db
      .select()
      .from(workationRequests)
      .where(
        and(
          eq(workationRequests.status, "genehmigt"),
          lte(workationRequests.startDate, toISO),
          gte(workationRequests.endDate, fromISO)
        )
      ),
    db
      .select()
      .from(sickLeaves)
      .where(
        and(
          lte(sickLeaves.startDate, toISO),
          or(
            gte(sickLeaves.endDate, fromISO),
            eq(sickLeaves.status, "gemeldet")
          )
        )
      ),
    db.select().from(users),
  ]);

  const nameOf = (id: string) => {
    const u = allUsers.find((x) => x.id === id);
    return u ? `${u.firstName} ${u.lastName}` : "—";
  };
  const isAdmin = viewer.role === "admin";

  return [
    ...vacations.map(
      (v): CalendarAbsence => ({
        userId: v.userId,
        userName: nameOf(v.userId),
        type: "urlaub",
        from: v.startDate,
        to: v.endDate,
      })
    ),
    ...workations.map(
      (w): CalendarAbsence => ({
        userId: w.userId,
        userName: nameOf(w.userId),
        type: "workation",
        from: w.startDate,
        to: w.endDate,
      })
    ),
    ...sick.map(
      (s): CalendarAbsence => ({
        userId: s.userId,
        userName: nameOf(s.userId),
        type: isAdmin || s.userId === viewer.id ? "krank" : "abwesend",
        from: s.startDate,
        to: s.endDate ?? toISO,
      })
    ),
    ...birthdayEntries(allUsers, fromISO, toISO),
  ];
}
