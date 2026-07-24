import { describe, expect, it } from "vitest";
import {
  addDaysISO,
  berlinTodayISO,
  formatIsoWeek,
  formatMinutesAsHours,
  isValidISODate,
  isWeekClosed,
  isoWeekOf,
  isoWeekday,
  mondayOfIsoWeek,
  parseHoursToMinutes,
  validateBookingDate,
  validateDurationMinutes,
  weekdaysOfIsoWeek,
} from "./zeitfenster";

// Referenz-"Jetzt": Mittwoch, 22.07.2026, 12:00 Europe/Berlin (KW 30)
const WEDNESDAY = new Date("2026-07-22T12:00:00+02:00");

describe("berlinTodayISO", () => {
  it("wertet den Zeitpunkt in Europe/Berlin aus, nicht in UTC", () => {
    // 23:30 UTC am Freitag = 01:30 Samstag in Berlin (Sommerzeit)
    expect(berlinTodayISO(new Date("2026-07-24T23:30:00Z"))).toBe("2026-07-25");
    expect(berlinTodayISO(new Date("2026-07-24T21:59:00Z"))).toBe("2026-07-24");
  });
});

describe("isoWeekOf — ISO-8601-Kalenderwochen", () => {
  it("berechnet reguläre Wochen", () => {
    expect(isoWeekOf("2026-07-22")).toEqual({ isoYear: 2026, isoWeek: 30 });
    expect(isoWeekOf("2026-07-20")).toEqual({ isoYear: 2026, isoWeek: 30 });
    expect(isoWeekOf("2026-07-26")).toEqual({ isoYear: 2026, isoWeek: 30 });
  });

  it("ordnet Jahreswechsel korrekt zu (KW 52/53 ↔ KW 1)", () => {
    // 1.1.2026 ist ein Donnerstag → KW 1/2026; 29.12.2025 (Mo) gehört dazu
    expect(isoWeekOf("2026-01-01")).toEqual({ isoYear: 2026, isoWeek: 1 });
    expect(isoWeekOf("2025-12-29")).toEqual({ isoYear: 2026, isoWeek: 1 });
    // 1.1.2027 ist ein Freitag → KW 53/2026
    expect(isoWeekOf("2027-01-01")).toEqual({ isoYear: 2026, isoWeek: 53 });
    expect(isoWeekOf("2026-12-28")).toEqual({ isoYear: 2026, isoWeek: 53 });
    // 1.1.2021 ist ein Freitag → KW 53/2020
    expect(isoWeekOf("2021-01-01")).toEqual({ isoYear: 2020, isoWeek: 53 });
  });
});

describe("mondayOfIsoWeek / weekdaysOfIsoWeek", () => {
  it("liefert den Montag der KW (Roundtrip mit isoWeekOf)", () => {
    expect(mondayOfIsoWeek(2026, 30)).toBe("2026-07-20");
    expect(mondayOfIsoWeek(2026, 1)).toBe("2025-12-29");
    expect(mondayOfIsoWeek(2026, 53)).toBe("2026-12-28");
    for (const date of ["2026-07-22", "2025-12-31", "2027-01-01"]) {
      const week = isoWeekOf(date);
      const monday = mondayOfIsoWeek(week.isoYear, week.isoWeek);
      expect(isoWeekday(monday)).toBe(1);
      expect(isoWeekOf(monday)).toEqual(week);
    }
  });

  it("liefert die fünf Werktage Mo–Fr", () => {
    expect(weekdaysOfIsoWeek(2026, 30)).toEqual([
      "2026-07-20",
      "2026-07-21",
      "2026-07-22",
      "2026-07-23",
      "2026-07-24",
    ]);
  });
});

describe("validateBookingDate — Buchungsfenster (FA-3.3 bis FA-3.6)", () => {
  it("erlaubt den heutigen Tag", () => {
    expect(validateBookingDate("2026-07-22", WEDNESDAY)).toEqual({ ok: true });
  });

  it("erlaubt zurückliegende Werktage der laufenden KW", () => {
    expect(validateBookingDate("2026-07-20", WEDNESDAY)).toEqual({ ok: true });
    expect(validateBookingDate("2026-07-21", WEDNESDAY)).toEqual({ ok: true });
  });

  it("lehnt Zukunft ab — auch innerhalb der laufenden KW", () => {
    const result = validateBookingDate("2026-07-23", WEDNESDAY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Zukunft");
  });

  it("lehnt die Vorwoche ab", () => {
    const result = validateBookingDate("2026-07-17", WEDNESDAY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("laufenden Kalenderwoche");
  });

  it("lehnt Sa/So mit Hinweis auf Werktag der Folgewoche ab (Edge Case 1)", () => {
    for (const date of ["2026-07-18", "2026-07-19", "2026-07-25", "2026-07-26"]) {
      const result = validateBookingDate(date, WEDNESDAY);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("Werktag der Folgewoche");
    }
  });

  it("Freitag 23:59 Berlin: Freitag noch buchbar", () => {
    const fridayNight = new Date("2026-07-24T21:59:00Z"); // 23:59 Berlin
    expect(validateBookingDate("2026-07-24", fridayNight)).toEqual({ ok: true });
  });

  it("ab Samstag 00:00 Berlin ist die Woche vollständig geschlossen (FA-3.5)", () => {
    const saturdayEarly = new Date("2026-07-24T22:30:00Z"); // Sa 00:30 Berlin
    const result = validateBookingDate("2026-07-24", saturdayEarly);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("geschlossen");
  });

  it("Jahreswechsel: Montag der KW 1 aus dem Vorjahr bleibt buchbar", () => {
    // Mittwoch, 31.12.2025 (KW 1/2026) — Montag 29.12.2025 gehört zur selben KW
    const now = new Date("2025-12-31T12:00:00+01:00");
    expect(validateBookingDate("2025-12-29", now)).toEqual({ ok: true });
    // Freitag 26.12.2025 liegt in KW 52/2025 → abgelehnt
    expect(validateBookingDate("2025-12-26", now).ok).toBe(false);
  });

  it("lehnt ungültige Datumswerte ab", () => {
    expect(validateBookingDate("2026-02-30", WEDNESDAY).ok).toBe(false);
    expect(validateBookingDate("quatsch", WEDNESDAY).ok).toBe(false);
  });
});

describe("isWeekClosed (E-6)", () => {
  it("Woche erst ab Samstag 00:00 Berlin abgeschlossen", () => {
    expect(isWeekClosed(2026, 30, new Date("2026-07-24T21:59:00Z"))).toBe(false);
    expect(isWeekClosed(2026, 30, new Date("2026-07-24T22:00:00Z"))).toBe(true);
    expect(isWeekClosed(2026, 29, WEDNESDAY)).toBe(true);
  });
});

describe("Dauer-Raster (FA-2.1, Edge Case 12)", () => {
  it("akzeptiert nur positive Vielfache von 15 Minuten", () => {
    expect(validateDurationMinutes(15)).toBeNull();
    expect(validateDurationMinutes(75)).toBeNull();
    expect(validateDurationMinutes(0)).toContain("größer als 0");
    expect(validateDurationMinutes(-15)).toContain("größer als 0");
    expect(validateDurationMinutes(20)).toContain("Raster");
    expect(validateDurationMinutes(1440)).toBeNull();
    expect(validateDurationMinutes(1455)).toContain("24 Stunden");
  });

  it("parseHoursToMinutes akzeptiert Komma und Punkt", () => {
    expect(parseHoursToMinutes("1,25")).toBe(75);
    expect(parseHoursToMinutes("0,25")).toBe(15);
    expect(parseHoursToMinutes("1.5")).toBe(90);
    expect(parseHoursToMinutes(8)).toBe(480);
    expect(parseHoursToMinutes("abc")).toBeNull();
    // "1,3" ergibt 78 Minuten — wird anschließend vom Raster abgelehnt
    expect(validateDurationMinutes(parseHoursToMinutes("1,3")!)).toContain(
      "Raster"
    );
  });

  it("formatMinutesAsHours nutzt deutsches Komma", () => {
    expect(formatMinutesAsHours(75)).toBe("1,25");
    expect(formatMinutesAsHours(60)).toBe("1,00");
    expect(formatMinutesAsHours(0)).toBe("0,00");
  });
});

describe("Hilfsfunktionen", () => {
  it("addDaysISO über Monats- und Jahresgrenzen", () => {
    expect(addDaysISO("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDaysISO("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("isValidISODate", () => {
    expect(isValidISODate("2026-07-22")).toBe(true);
    expect(isValidISODate("2026-02-30")).toBe(false);
    expect(isValidISODate("22.07.2026")).toBe(false);
  });

  it("formatIsoWeek", () => {
    expect(formatIsoWeek({ isoYear: 2026, isoWeek: 5 })).toBe("KW 05/2026");
  });
});
