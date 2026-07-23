import { describe, expect, it } from "vitest";
import { countVacationDays, countWorkdays } from "./dates";

describe("Urlaubstage-Berechnung (NRW)", () => {
  it("Woche Mo–Fr = 5 Arbeitstage", () => {
    expect(countWorkdays("2026-07-20", "2026-07-24")).toBe(5);
  });

  it("Wochenende zählt nicht", () => {
    expect(countWorkdays("2026-07-18", "2026-07-19")).toBe(0);
  });

  it("Feiertag NRW zählt nicht (Allerheiligen 01.11.2027 fällt auf Mo)", () => {
    // 01.11.2027 ist ein Montag und in NRW gesetzlicher Feiertag
    expect(countWorkdays("2027-11-01", "2027-11-01")).toBe(0);
  });

  it("Tag der Deutschen Einheit (Sa 03.10.2026) im Zeitraum ändert nichts", () => {
    expect(countWorkdays("2026-10-01", "2026-10-05")).toBe(3); // Do, Fr, Mo
  });

  it("halber erster und letzter Tag", () => {
    expect(countVacationDays("2026-07-20", "2026-07-24", true, true)).toBe(4);
  });

  it("halber Tag bei eintägigem Urlaub", () => {
    expect(countVacationDays("2026-07-20", "2026-07-20", true, false)).toBe(0.5);
  });
});
