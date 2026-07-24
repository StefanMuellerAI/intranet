import { describe, expect, it } from "vitest";
import type { CalendarAbsence } from "@/lib/absences";
import { buildBriefingText } from "@/lib/briefing";

const TODAY = "2026-07-24";
const RANGE_END = "2026-08-07";

function entry(
  type: CalendarAbsence["type"],
  userName: string,
  from: string,
  to: string
): CalendarAbsence {
  return { userId: `id-${userName}`, userName, type, from, to };
}

describe("buildBriefingText", () => {
  it("liefert den Leer-Zustand ohne Einträge", () => {
    expect(buildBriefingText([], TODAY, RANGE_END)).toBe(
      "In den nächsten zwei Wochen stehen keine Abwesenheiten oder Geburtstage an."
    );
  });

  it("formuliert einen einzelnen zukünftigen Urlaub als Satz", () => {
    const text = buildBriefingText(
      [entry("urlaub", "Anna Muster", "2026-07-28", "2026-08-01")],
      TODAY,
      RANGE_END
    );
    expect(text).toBe("Anna Muster ist vom 28.07. bis 01.08. im Urlaub.");
  });

  it("formuliert bereits laufende Einträge mit 'noch bis'", () => {
    const text = buildBriefingText(
      [entry("urlaub", "Anna Muster", "2026-07-20", "2026-07-26")],
      TODAY,
      RANGE_END
    );
    expect(text).toBe("Anna Muster ist noch bis 26.07. im Urlaub.");
  });

  it("fasst mehrere Personen desselben Typs sortiert zusammen", () => {
    const text = buildBriefingText(
      [
        entry("urlaub", "Ben Beispiel", "2026-08-04", "2026-08-05"),
        entry("urlaub", "Anna Muster", "2026-07-28", "2026-08-01"),
        entry("urlaub", "Carla Christ", "2026-08-06", "2026-08-06"),
      ],
      TODAY,
      RANGE_END
    );
    expect(text).toBe(
      "Anna Muster (28.07.–01.08.), Ben Beispiel (04.08.–05.08.) und Carla Christ (06.08.) sind im Urlaub."
    );
  });

  it("formuliert Workation und Geburtstag korrekt", () => {
    const text = buildBriefingText(
      [
        entry("workation", "Clara Muster", "2026-07-27", "2026-08-06"),
        entry("geburtstag", "Max Muster", "2026-07-30", "2026-07-30"),
      ],
      TODAY,
      RANGE_END
    );
    expect(text).toBe(
      "Clara Muster ist vom 27.07. bis 06.08. auf Workation. Max Muster hat am 30.07. Geburtstag."
    );
  });

  it("nennt heutige Geburtstage als 'heute'", () => {
    const text = buildBriefingText(
      [entry("geburtstag", "Max Muster", TODAY, TODAY)],
      TODAY,
      RANGE_END
    );
    expect(text).toBe("Max Muster hat heute Geburtstag.");
  });

  it("formuliert offene Krankmeldungen mit 'seit' statt Enddatum", () => {
    // getCalendarAbsences setzt bei fehlendem Enddatum to = Bereichsende
    const text = buildBriefingText(
      [entry("krank", "Lisa List", "2026-07-22", RANGE_END)],
      TODAY,
      RANGE_END
    );
    expect(text).toBe("Lisa List ist seit dem 22.07. krankgemeldet.");
  });

  it("formuliert Krankmeldungen mit bekanntem Ende mit 'noch bis'", () => {
    const text = buildBriefingText(
      [entry("krank", "Lisa List", "2026-07-22", "2026-07-25")],
      TODAY,
      RANGE_END
    );
    expect(text).toBe("Lisa List ist noch bis 25.07. krankgemeldet.");
  });

  it("zeigt Abwesenheiten anderer neutral als 'abwesend'", () => {
    const text = buildBriefingText(
      [entry("abwesend", "Lisa List", "2026-07-22", "2026-07-25")],
      TODAY,
      RANGE_END
    );
    expect(text).toBe("Lisa List ist noch bis 25.07. abwesend.");
  });

  it("kombiniert alle Gruppen in fester Reihenfolge", () => {
    const text = buildBriefingText(
      [
        entry("geburtstag", "Max Muster", "2026-07-30", "2026-07-30"),
        entry("krank", "Lisa List", "2026-07-22", RANGE_END),
        entry("urlaub", "Anna Muster", "2026-07-28", "2026-08-01"),
        entry("workation", "Clara Muster", "2026-07-27", "2026-08-06"),
      ],
      TODAY,
      RANGE_END
    );
    expect(text).toBe(
      "Anna Muster ist vom 28.07. bis 01.08. im Urlaub. " +
        "Clara Muster ist vom 27.07. bis 06.08. auf Workation. " +
        "Lisa List ist seit dem 22.07. krankgemeldet. " +
        "Max Muster hat am 30.07. Geburtstag."
    );
  });
});
