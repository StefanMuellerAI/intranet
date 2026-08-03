import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User, VacationRequest } from "@/db";

const rows: Partial<VacationRequest>[] = [];

vi.mock("@/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db")>();
  return {
    ...actual,
    db: {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve(rows),
        }),
      }),
    },
  };
});

import { getVacationAccount, getVacationEntitlement } from "./vacation";

const user = {
  id: "user-1",
  annualVacationDays: 30,
  vacationCarryoverDays: 2,
  entryDate: null,
  entryYearVacationDays: null,
} as User;

/** Mitarbeiter/in mit Eintritt am 01.08.2026 und 12 Tagen Resturlaub */
const newHire = {
  ...user,
  entryDate: "2026-08-01",
  entryYearVacationDays: 12,
} as User;

function request(
  status: VacationRequest["status"],
  days: number,
  startDate = "2026-06-01"
): Partial<VacationRequest> {
  return { userId: user.id, status, days, startDate };
}

describe("getVacationAccount", () => {
  beforeEach(() => {
    rows.length = 0;
  });

  it("berechnet den Anspruch aus Jahresurlaub plus Übertrag", async () => {
    const account = await getVacationAccount(user, 2026);
    expect(account.entitlement).toBe(32);
    expect(account.used).toBe(0);
    expect(account.remaining).toBe(32);
  });

  it("zählt genehmigte Anträge und beantragte Stornos als verbraucht", async () => {
    rows.push(
      request("genehmigt", 5),
      request("storno_beantragt", 3),
      request("beanstandet", 10),
      request("storniert", 7)
    );
    const account = await getVacationAccount(user, 2026);
    expect(account.used).toBe(8);
    expect(account.remaining).toBe(24);
  });

  it("weist eingereichte Anträge separat als geplant aus", async () => {
    rows.push(request("eingereicht", 4), request("genehmigt", 6));
    const account = await getVacationAccount(user, 2026);
    expect(account.pending).toBe(4);
    expect(account.remaining).toBe(26);
    expect(account.remainingAfterPending).toBe(22);
  });

  it("ignoriert Anträge anderer Jahre", async () => {
    rows.push(
      request("genehmigt", 5, "2025-12-20"),
      request("genehmigt", 2, "2026-01-05")
    );
    const account = await getVacationAccount(user, 2026);
    expect(account.used).toBe(2);
  });

  it("nutzt im Eintrittsjahr den Resturlaub als Anspruch", async () => {
    rows.push(request("genehmigt", 4, "2026-09-01"));
    const account = await getVacationAccount(newHire, 2026);
    expect(account.entitlement).toBe(12);
    expect(account.remaining).toBe(8);
  });
});

describe("getVacationEntitlement", () => {
  it("gibt vor dem Eintrittsjahr keinen Anspruch", () => {
    expect(getVacationEntitlement(newHire, 2025)).toBe(0);
  });

  it("gibt im Eintrittsjahr nur den Resturlaub, ohne Übertrag", () => {
    expect(getVacationEntitlement(newHire, 2026)).toBe(12);
  });

  it("gibt ab dem Folgejahr Jahresanspruch plus Übertrag", () => {
    expect(getVacationEntitlement(newHire, 2027)).toBe(32);
  });

  it("behandelt einen fehlenden Resturlaub im Eintrittsjahr als 0 Tage", () => {
    expect(
      getVacationEntitlement({ ...newHire, entryYearVacationDays: null }, 2026)
    ).toBe(0);
  });

  it("gilt ohne Eintrittsdatum in jedem Jahr voll", () => {
    expect(getVacationEntitlement(user, 2025)).toBe(32);
    expect(getVacationEntitlement(user, 2030)).toBe(32);
  });
});
