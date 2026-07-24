/**
 * Buchungsfenster- und Kalenderlogik für das Modul Faktura.
 *
 * Alle Regeln werden serverseitig in der Referenz-Zeitzone Europe/Berlin
 * ausgewertet (FA-3.1) — die Gerätezeitzone der Mitarbeitenden ist nie
 * maßgeblich (Workation im Ausland). Kalenderwoche = ISO 8601 (Mo–So).
 *
 * Pure Funktionen mit injizierbarem "Jetzt" für deterministische Tests.
 */

const DAY_MS = 86_400_000;

/** Für E2E-Tests übersteuerbarer Jetzt-Zeitpunkt (ISO-Timestamp). */
export function currentNow(): Date {
  const fake = process.env.FAKTURA_TEST_NOW;
  return fake ? new Date(fake) : new Date();
}

/** Heutiges Kalenderdatum (YYYY-MM-DD) in Europe/Berlin. */
export function berlinTodayISO(now: Date = currentNow()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function isValidISODate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

/** ISO-Wochentag: 1 = Montag … 7 = Sonntag */
export function isoWeekday(dateISO: string): number {
  const [y, m, d] = dateISO.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7;
}

export interface IsoWeek {
  isoYear: number;
  isoWeek: number;
}

/**
 * ISO-8601-Kalenderwoche eines Datums — korrekt über den Jahreswechsel
 * (KW 52/53 ↔ KW 1, FA-3.6): der Donnerstag der Woche bestimmt das Jahr.
 */
export function isoWeekOf(dateISO: string): IsoWeek {
  const [y, m, d] = dateISO.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const isoYear = date.getUTCFullYear();
  const yearStart = Date.UTC(isoYear, 0, 1);
  const isoWeek = Math.ceil(((date.getTime() - yearStart) / DAY_MS + 1) / 7);
  return { isoYear, isoWeek };
}

/** Montag (YYYY-MM-DD) der angegebenen ISO-Kalenderwoche. */
export function mondayOfIsoWeek(isoYear: number, isoWeek: number): string {
  // Der 4. Januar liegt immer in KW 1
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const week1Monday =
    jan4.getTime() - ((jan4.getUTCDay() || 7) - 1) * DAY_MS;
  return toUTCDateISO(new Date(week1Monday + (isoWeek - 1) * 7 * DAY_MS));
}

/** Alle Werktage (Mo–Fr) der ISO-Kalenderwoche als YYYY-MM-DD. */
export function weekdaysOfIsoWeek(isoYear: number, isoWeek: number): string[] {
  const monday = mondayOfIsoWeek(isoYear, isoWeek);
  return [0, 1, 2, 3, 4].map((offset) => addDaysISO(monday, offset));
}

export function addDaysISO(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  return toUTCDateISO(new Date(Date.UTC(y, m - 1, d + days)));
}

function toUTCDateISO(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Kalendermonat (YYYY-MM) des Buchungsdatums — maßgeblich für das Limit (FA-4.6). */
export function monthOf(dateISO: string): string {
  return dateISO.slice(0, 7);
}

export function formatIsoWeek(week: IsoWeek): string {
  return `KW ${String(week.isoWeek).padStart(2, "0")}/${week.isoYear}`;
}

/**
 * Prüft, ob eine ISO-Kalenderwoche abgeschlossen ist (ab Samstag 00:00 Uhr
 * Europe/Berlin, Entscheidung E-6). Nur abgeschlossene Wochen sind freigebbar.
 */
export function isWeekClosed(
  isoYear: number,
  isoWeek: number,
  now: Date = currentNow()
): boolean {
  const saturday = addDaysISO(mondayOfIsoWeek(isoYear, isoWeek), 5);
  return berlinTodayISO(now) >= saturday;
}

export type BookingDateResult = { ok: true } | { ok: false; error: string };

/**
 * Buchungsfenster (FA-3.3 bis FA-3.5):
 * - nur Werktage Mo–Fr (Sa/So grundsätzlich unzulässig, Entscheidung E-1)
 * - nur der aktuelle Tag und zurückliegende Werktage der laufenden KW
 * - keine Zukunft; ab Samstag 00:00 Uhr ist die Woche vollständig geschlossen
 */
export function validateBookingDate(
  dateISO: string,
  now: Date = currentNow()
): BookingDateResult {
  if (!isValidISODate(dateISO))
    return { ok: false, error: "Ungültiges Buchungsdatum." };

  const weekday = isoWeekday(dateISO);
  if (weekday >= 6)
    return {
      ok: false,
      error:
        "Samstage und Sonntage sind keine gültigen Buchungstage. Am Wochenende geleistete Zeit buchen Sie bitte auf einen Werktag der Folgewoche.",
    };

  const todayISO = berlinTodayISO(now);
  const todayWeekday = isoWeekday(todayISO);

  if (todayWeekday >= 6)
    return {
      ok: false,
      error:
        "Am Wochenende ist keine Buchung möglich — die Woche ist seit Samstag 00:00 Uhr geschlossen. Die nächste Buchungsmöglichkeit beginnt am Montag der Folgewoche.",
    };

  if (dateISO > todayISO)
    return { ok: false, error: "Buchungen in der Zukunft sind nicht möglich." };

  const entryWeek = isoWeekOf(dateISO);
  const currentWeek = isoWeekOf(todayISO);
  if (
    entryWeek.isoYear !== currentWeek.isoYear ||
    entryWeek.isoWeek !== currentWeek.isoWeek
  )
    return {
      ok: false,
      error:
        "Das Datum liegt außerhalb der laufenden Kalenderwoche. Buchbar sind nur der aktuelle Tag und zurückliegende Werktage der laufenden Woche.",
    };

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Dauer-Raster (0,25-h-Schritte = 15 Minuten)
// ---------------------------------------------------------------------------

export const QUARTER_HOUR_MINUTES = 15;
/** Hartes Tagesmaximum je Mitarbeiter/in über alle Projekte (FA-2.5) */
export const MAX_DAY_MINUTES = 24 * 60;
/** Warnschwelle je Mitarbeiter/in und Tag (FA-2.5) */
export const WARN_DAY_MINUTES = 10 * 60;

/** Prüft die Dauer einer Einzelbuchung; liefert Fehlermeldung oder null. */
export function validateDurationMinutes(minutes: number): string | null {
  if (!Number.isInteger(minutes) || minutes <= 0)
    return "Die Dauer muss größer als 0 sein.";
  if (minutes % QUARTER_HOUR_MINUTES !== 0)
    return "Die Dauer muss im 0,25-Stunden-Raster (15 Minuten) liegen.";
  if (minutes > MAX_DAY_MINUTES)
    return "Die Dauer darf 24 Stunden nicht überschreiten.";
  return null;
}

/** Stunden-Eingabe (z. B. "1,25" oder "1.25") in Minuten; null bei ungültig. */
export function parseHoursToMinutes(input: string | number): number | null {
  const value =
    typeof input === "number" ? input : Number(String(input).replace(",", "."));
  if (!Number.isFinite(value)) return null;
  const minutes = Math.round(value * 60);
  // Nur exakte Viertelstunden akzeptieren (kein stilles Runden)
  if (Math.abs(value * 60 - minutes) > 1e-6) return null;
  return minutes;
}

/** Minuten als Dezimalstunden mit deutschem Komma, z. B. 75 → "1,25" */
export function formatMinutesAsHours(minutes: number): string {
  return (minutes / 60).toFixed(2).replace(".", ",");
}
