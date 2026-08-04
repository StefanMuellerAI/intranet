import { describe, expect, it } from "vitest";
import {
  equipmentStatus,
  parseDeviceId,
  parseEquipmentDates,
  parseEquipmentInput,
  parseEquipmentTypeName,
  suggestNextDeviceId,
} from "./it-equipment";

const USER_ID = "3f1d0f6a-1f4e-4a71-9d0c-4c1f1a2b3c4d";
const TYPE_ID = "8b2c5e10-7d3a-4f52-b6a1-9e8d7c6b5a40";

function input(overrides: Partial<Parameters<typeof parseEquipmentInput>[0]> = {}) {
  return parseEquipmentInput({
    userId: USER_ID,
    typeId: TYPE_ID,
    deviceId: "IT-0042",
    serialNumber: "",
    notes: "",
    handoverDate: "2026-08-03",
    returnDate: "",
    ...overrides,
  });
}

describe("equipmentStatus", () => {
  it("leitet den Status allein aus dem Rückgabedatum ab", () => {
    expect(equipmentStatus(null)).toBe("im_einsatz");
    expect(equipmentStatus("2026-08-03")).toBe("zurueckgegeben");
  });
});

describe("parseEquipmentDates", () => {
  it("akzeptiert eine Übernahme ohne Rückgabe", () => {
    expect(parseEquipmentDates("2026-08-03", "")).toEqual({
      handoverDate: "2026-08-03",
      returnDate: null,
    });
  });

  it("akzeptiert die Rückgabe am Tag der Übernahme", () => {
    expect(parseEquipmentDates("2026-08-03", "2026-08-03")).toEqual({
      handoverDate: "2026-08-03",
      returnDate: "2026-08-03",
    });
  });

  it("lehnt eine Rückgabe vor der Übernahme ab", () => {
    expect(() => parseEquipmentDates("2026-08-03", "2026-08-02")).toThrow(
      "Das Rückgabedatum darf nicht vor dem Übernahmedatum liegen."
    );
  });

  it("verlangt ein Übernahmedatum", () => {
    expect(() => parseEquipmentDates("", "")).toThrow(
      "Übernahmedatum ist erforderlich."
    );
  });

  it("lehnt ungültige Kalendertage ab", () => {
    expect(() => parseEquipmentDates("2026-02-30", "")).toThrow(
      "Übernahmedatum ist ungültig."
    );
  });
});

describe("parseDeviceId", () => {
  it("trimmt die Eingabe", () => {
    expect(parseDeviceId("  IT-0042 ")).toBe("IT-0042");
  });

  it("erlaubt Ziffern, Buchstaben und Bindestriche", () => {
    expect(parseDeviceId("Laptop-2026-07")).toBe("Laptop-2026-07");
    expect(parseDeviceId("4711")).toBe("4711");
  });

  it("verlangt eine Geräte-ID", () => {
    expect(() => parseDeviceId("   ")).toThrow("Geräte-ID ist erforderlich.");
  });

  it("lehnt Leerzeichen und Sonderzeichen ab", () => {
    for (const invalid of ["IT 0042", "IT_0042", "IT/0042", "IT.0042", "IT+ä"]) {
      expect(() => parseDeviceId(invalid)).toThrow(
        "Die Geräte-ID darf nur Ziffern, Buchstaben und Bindestriche enthalten."
      );
    }
  });

  it("lehnt eine überlange Geräte-ID ab", () => {
    expect(() => parseDeviceId("A".repeat(41))).toThrow(
      "Die Geräte-ID ist zu lang (max. 40 Zeichen)."
    );
  });
});

describe("suggestNextDeviceId", () => {
  it("beginnt bei 01 im laufenden Jahr", () => {
    expect(suggestNextDeviceId([], 2026)).toBe("SA-IT-2026-01");
  });

  it("zählt die laufende Nummer über den Jahreswechsel hinweg weiter", () => {
    expect(
      suggestNextDeviceId(
        ["SA-IT-2025-01", "SA-IT-2025-02", "SA-IT-2025-03"],
        2026
      )
    ).toBe("SA-IT-2026-04");
  });

  it("nimmt die höchste Nummer unabhängig von der Reihenfolge", () => {
    expect(
      suggestNextDeviceId(["SA-IT-2026-07", "SA-IT-2025-02"], 2026)
    ).toBe("SA-IT-2026-08");
  });

  it("ignoriert IDs außerhalb des Schemas", () => {
    expect(
      suggestNextDeviceId(["Laptop-07", "IT-0042", "SA-IT-2026-02"], 2026)
    ).toBe("SA-IT-2026-03");
  });

  it("wächst über zwei Stellen hinaus", () => {
    expect(suggestNextDeviceId(["SA-IT-2026-99"], 2026)).toBe(
      "SA-IT-2026-100"
    );
  });

  it("liefert eine gültige Geräte-ID", () => {
    expect(parseDeviceId(suggestNextDeviceId([], 2026))).toBe("SA-IT-2026-01");
  });
});

describe("parseEquipmentInput", () => {
  it("übernimmt die Geräte-ID", () => {
    expect(input({ deviceId: " IT-0001 " }).deviceId).toBe("IT-0001");
  });

  it("verlangt eine Geräte-ID", () => {
    expect(() => input({ deviceId: "" })).toThrow(
      "Geräte-ID ist erforderlich."
    );
  });

  it("wandelt leere Freitextfelder in null", () => {
    const parsed = input();
    expect(parsed.serialNumber).toBeNull();
    expect(parsed.notes).toBeNull();
    expect(parsed.returnDate).toBeNull();
  });

  it("trimmt Seriennummer und Zusatzinformationen", () => {
    const parsed = input({
      serialNumber: "  C02XL0THJGH5  ",
      notes: "  Mit Netzteil  ",
    });
    expect(parsed.serialNumber).toBe("C02XL0THJGH5");
    expect(parsed.notes).toBe("Mit Netzteil");
  });

  it("verlangt eine Mitarbeiter- und eine Art-Auswahl", () => {
    expect(() => input({ userId: "" })).toThrow(
      "Bitte eine/n Mitarbeiter/in auswählen."
    );
    expect(() => input({ typeId: "" })).toThrow(
      "Bitte eine Ausstattungsart auswählen."
    );
  });

  it("lehnt eine überlange Seriennummer ab", () => {
    expect(() => input({ serialNumber: "X".repeat(121) })).toThrow(
      "Die Seriennummer ist zu lang (max. 120 Zeichen)."
    );
  });
});

describe("parseEquipmentTypeName", () => {
  it("trimmt die Bezeichnung", () => {
    expect(parseEquipmentTypeName("  Dockingstation ")).toBe("Dockingstation");
  });

  it("verlangt eine Bezeichnung", () => {
    expect(() => parseEquipmentTypeName("   ")).toThrow(
      "Bezeichnung ist erforderlich."
    );
  });

  it("lehnt zu lange Bezeichnungen ab", () => {
    expect(() => parseEquipmentTypeName("A".repeat(81))).toThrow(
      "Die Bezeichnung ist zu lang (max. 80 Zeichen)."
    );
  });
});
