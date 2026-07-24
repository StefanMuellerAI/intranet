import type { CalendarAbsence } from "@/lib/absences";

/**
 * openEnded: Eintrag ohne bekanntes Enddatum (offene Krankmeldung) —
 * wird als "seit dem …" statt mit einem vermeintlichen Enddatum formuliert.
 */
type BriefingEntry = CalendarAbsence & { openEnded?: boolean };

/** "2026-07-28" → "28.07." */
function shortDate(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
}

/**
 * Zeitraum als ausformulierte Angabe für Einzelpersonen,
 * z. B. "vom 28.07. bis 01.08." oder "noch bis 26.07.".
 */
function rangeLong(a: BriefingEntry, todayISO: string): string {
  if (a.openEnded) {
    if (a.from > todayISO) return `ab dem ${shortDate(a.from)}`;
    return a.from === todayISO ? "seit heute" : `seit dem ${shortDate(a.from)}`;
  }
  if (a.from === a.to) {
    return a.from === todayISO ? "heute" : `am ${shortDate(a.from)}`;
  }
  if (a.from <= todayISO) return `noch bis ${shortDate(a.to)}`;
  return `vom ${shortDate(a.from)} bis ${shortDate(a.to)}`;
}

/** Kompakte Zeitraum-Angabe für Aufzählungen, z. B. "28.07.–01.08." */
function rangeShort(a: BriefingEntry, todayISO: string): string {
  if (a.openEnded) {
    if (a.from > todayISO) return `ab ${shortDate(a.from)}`;
    return a.from === todayISO ? "seit heute" : `seit ${shortDate(a.from)}`;
  }
  if (a.from === a.to) {
    return a.from === todayISO ? "heute" : shortDate(a.from);
  }
  if (a.from <= todayISO) return `noch bis ${shortDate(a.to)}`;
  return `${shortDate(a.from)}–${shortDate(a.to)}`;
}

/** "A", "A und B", "A, B und C" */
function joinNames(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} und ${parts[parts.length - 1]}`;
}

/**
 * Satz für eine Gruppe gleichen Typs, z. B.
 * "Anna Muster ist vom 28.07. bis 01.08. im Urlaub." bzw. bei mehreren
 * Personen "Anna Muster (28.07.–01.08.) und Ben Beispiel (04.08.–08.08.)
 * sind im Urlaub."
 */
function groupSentence(
  entries: BriefingEntry[],
  todayISO: string,
  predicate: string
): string | null {
  if (entries.length === 0) return null;
  if (entries.length === 1) {
    const a = entries[0];
    return `${a.userName} ist ${rangeLong(a, todayISO)} ${predicate}.`;
  }
  const list = joinNames(
    entries.map((a) => `${a.userName} (${rangeShort(a, todayISO)})`)
  );
  return `${list} sind ${predicate}.`;
}

function birthdaySentence(
  entries: BriefingEntry[],
  todayISO: string
): string | null {
  if (entries.length === 0) return null;
  if (entries.length === 1) {
    const a = entries[0];
    return `${a.userName} hat ${rangeLong(a, todayISO)} Geburtstag.`;
  }
  const list = joinNames(
    entries.map((a) => `${a.userName} (${rangeShort(a, todayISO)})`)
  );
  return `${list} haben Geburtstag.`;
}

/** Baut das Kurzbriefing als Fließtext für den Zeitraum [todayISO, rangeEndISO]. */
export function buildBriefingText(
  absences: CalendarAbsence[],
  todayISO: string,
  rangeEndISO: string
): string {
  // Bereits beendete Einträge ausblenden — getCalendarAbsences liefert z. B.
  // Krankmeldungen mit Status "gemeldet" auch, wenn ihr Enddatum in der
  // Vergangenheit liegt (für die Kalenderansicht korrekt, hier nicht relevant).
  const sorted = absences
    .filter((a) => a.to >= todayISO)
    .sort(
      (a, b) =>
        a.from.localeCompare(b.from) || a.userName.localeCompare(b.userName)
    );

  const byType = (type: CalendarAbsence["type"]) =>
    sorted.filter((a) => a.type === type);

  // Krankmeldungen ohne Enddatum bekommen von getCalendarAbsences das
  // Bereichsende als "to" — solche Einträge als offen markieren.
  const markOpenEnded = (a: CalendarAbsence): BriefingEntry =>
    a.to >= rangeEndISO ? { ...a, openEnded: true } : a;

  const sentences = [
    groupSentence(byType("urlaub"), todayISO, "im Urlaub"),
    groupSentence(byType("workation"), todayISO, "auf Workation"),
    groupSentence(byType("krank").map(markOpenEnded), todayISO, "krankgemeldet"),
    groupSentence(byType("abwesend").map(markOpenEnded), todayISO, "abwesend"),
    birthdaySentence(byType("geburtstag"), todayISO),
  ].filter((s): s is string => s !== null);

  if (sentences.length === 0) {
    return "In den nächsten zwei Wochen stehen keine Abwesenheiten oder Geburtstage an.";
  }
  return sentences.join(" ");
}
