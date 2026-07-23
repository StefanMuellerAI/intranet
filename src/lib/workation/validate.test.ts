import { describe, expect, it } from "vitest";
import { classifyCountry, validateWorkation } from "./validate";

const BASE = {
  startDate: "2026-11-02",
  endDate: "2026-11-13",
  workDays: 10,
  daysInCountryThisYear: 0,
  countryCategory: "eu_ewr_ch" as const,
  usedWorkDaysThisYear: 0,
  yearlyLimitDays: 30,
  consecutiveLimitDays: 20,
  today: new Date(2026, 6, 22), // 22.07.2026
};

describe("Workation-Validierung (Abnahmekriterium 5)", () => {
  it("regulärer Antrag: keine Fehler, keine Warnungen", () => {
    const r = validateWorkation(BASE);
    expect(r.errors).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
    expect(r.remainingWorkDays).toBe(20);
  });

  it("mehr als 20 zusammenhängende Arbeitstage blockiert", () => {
    const r = validateWorkation({ ...BASE, workDays: 21, endDate: "2026-11-27" });
    expect(r.errors.some((e) => e.includes("20 zusammenhängende"))).toBe(true);
  });

  it("Jahreskontingent 30 Arbeitstage blockiert", () => {
    const r = validateWorkation({ ...BASE, usedWorkDaysThisYear: 25 });
    expect(r.errors.some((e) => e.includes("Jahreskontingent"))).toBe(true);
  });

  it("90-Tage-Grenze erzeugt Warnung (keine Blockade)", () => {
    const r = validateWorkation({ ...BASE, daysInCountryThisYear: 85 });
    expect(r.errors).toHaveLength(0);
    expect(r.warnings.some((w) => w.includes("90-Tage-Grenze"))).toBe(true);
  });

  it("Vorlauf unter 4 Wochen bei EU-Ziel erzeugt Warnung", () => {
    const r = validateWorkation({
      ...BASE,
      startDate: "2026-08-03",
      endDate: "2026-08-14",
    });
    expect(r.warnings.some((w) => w.includes("4 Wochen"))).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it("Drittstaat verlangt 8 Wochen Vorlauf", () => {
    const r = validateWorkation({
      ...BASE,
      countryCategory: "drittstaat",
      startDate: "2026-09-01",
      endDate: "2026-09-11",
    });
    expect(r.warnings.some((w) => w.includes("8 Wochen"))).toBe(true);
  });

  it("Jahreswechsel erzeugt Warnung zur steuerlichen Prüfung", () => {
    const r = validateWorkation({
      ...BASE,
      startDate: "2026-12-28",
      endDate: "2027-01-08",
    });
    expect(r.warnings.some((w) => w.includes("Jahreswechsel"))).toBe(true);
  });
});

describe("Länderklassifikation", () => {
  it("EU/EWR/Schweiz wird erkannt", () => {
    expect(classifyCountry("Spanien")).toBe("eu_ewr_ch");
    expect(classifyCountry("schweiz")).toBe("eu_ewr_ch");
    expect(classifyCountry("Norwegen")).toBe("eu_ewr_ch");
  });
  it("Drittstaaten werden erkannt", () => {
    expect(classifyCountry("Thailand")).toBe("drittstaat");
    expect(classifyCountry("USA")).toBe("drittstaat");
  });
});
