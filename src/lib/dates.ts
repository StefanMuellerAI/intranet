import { isHoliday } from "feiertagejs";

/** Datum aus ISO-String (YYYY-MM-DD) als lokale Mitternacht */
export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatDateDE(iso: string): string {
  const d = parseISODate(iso);
  return d.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** Arbeitstag = Mo–Fr und kein gesetzlicher Feiertag in NRW */
export function isWorkday(d: Date): boolean {
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return false;
  return !isHoliday(d, "NW");
}

/** Alle Kalendertage von from bis to (inklusive) */
export function eachDay(fromISO: string, toISO: string): Date[] {
  const days: Date[] = [];
  const end = parseISODate(toISO);
  for (
    let d = parseISODate(fromISO);
    d.getTime() <= end.getTime();
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
  ) {
    days.push(d);
  }
  return days;
}

/** Anzahl Arbeitstage (Mo–Fr ohne NRW-Feiertage) im Zeitraum, inklusive Grenzen */
export function countWorkdays(fromISO: string, toISO: string): number {
  return eachDay(fromISO, toISO).filter(isWorkday).length;
}

/**
 * Urlaubstage im Zeitraum: Arbeitstage abzüglich halber erster/letzter Tag.
 * Halbe Tage zählen nur, wenn der jeweilige Tag ein Arbeitstag ist.
 */
export function countVacationDays(
  fromISO: string,
  toISO: string,
  halfDayStart: boolean,
  halfDayEnd: boolean
): number {
  const days = eachDay(fromISO, toISO);
  let total = days.filter(isWorkday).length;
  if (halfDayStart && days.length > 0 && isWorkday(days[0])) total -= 0.5;
  if (
    halfDayEnd &&
    days.length > 1 &&
    isWorkday(days[days.length - 1])
  )
    total -= 0.5;
  return total;
}
