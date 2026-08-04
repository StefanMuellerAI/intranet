import { describe, expect, it } from "vitest";
import {
  CSV_COLUMNS,
  buildEquipmentCsv,
  decodeCsvUpload,
  parseCsvTable,
  parseTableDate,
  planEquipmentImport,
  type ImportContext,
} from "./it-equipment-csv";

const USER_A = "3f1d0f6a-1f4e-4a71-9d0c-4c1f1a2b3c4d";
const USER_B = "6a2e1b7c-9d3f-4c58-8b1a-2d4e6f8a0b12";
const TYPE_LAPTOP = "8b2c5e10-7d3a-4f52-b6a1-9e8d7c6b5a40";
const TYPE_MAUS = "1c4d7e20-3f5a-4b61-9c2d-8e7f6a5b4c30";
const EQUIPMENT_1 = "a1b2c3d4-1111-4222-8333-444455556666";

function context(overrides: Partial<ImportContext> = {}): ImportContext {
  return {
    users: [
      { id: USER_A, email: "max@stefanai.de", active: true },
      { id: USER_B, email: "erika@stefanai.de", active: true },
    ],
    types: [
      { id: TYPE_LAPTOP, name: "Laptop", active: true },
      { id: TYPE_MAUS, name: "Maus", active: true },
    ],
    equipment: [
      {
        id: EQUIPMENT_1,
        deviceId: "IT-0001",
        userId: USER_A,
        typeId: TYPE_LAPTOP,
        serialNumber: "C02XL0THJGH5",
        notes: null,
        handoverDate: "2026-01-15",
        returnDate: null,
      },
    ],
    ...overrides,
  };
}

/** Baut eine Import-Datei aus Kopfzeile und Datenzeilen. */
function csv(rows: Record<string, string>[]): string {
  const header = [
    CSV_COLUMNS.deviceId,
    CSV_COLUMNS.newDeviceId,
    CSV_COLUMNS.email,
    CSV_COLUMNS.typeName,
    CSV_COLUMNS.serialNumber,
    CSV_COLUMNS.handoverDate,
    CSV_COLUMNS.returnDate,
    CSV_COLUMNS.notes,
  ];
  const lines = [
    header.join(";"),
    ...rows.map((row) =>
      header.map((name) => `"${(row[name] ?? "").replaceAll('"', '""')}"`).join(";")
    ),
  ];
  return lines.join("\r\n");
}

/** Zeile, die dem geseedeten Gerät IT-0001 unverändert entspricht. */
function unchangedRow(overrides: Record<string, string> = {}) {
  return {
    [CSV_COLUMNS.deviceId]: "IT-0001",
    [CSV_COLUMNS.email]: "max@stefanai.de",
    [CSV_COLUMNS.typeName]: "Laptop",
    [CSV_COLUMNS.serialNumber]: "C02XL0THJGH5",
    [CSV_COLUMNS.handoverDate]: "15.01.2026",
    ...overrides,
  };
}

describe("buildEquipmentCsv", () => {
  const row = {
    deviceId: "IT-0001",
    email: "max@stefanai.de",
    userName: "Max Mitarbeiter",
    typeName: "Laptop",
    serialNumber: "C02XL0THJGH5",
    handoverDate: "2026-01-15",
    returnDate: null,
    notes: null,
  };

  it("beginnt mit BOM und der Kopfzeile", () => {
    const csvText = buildEquipmentCsv([]);
    expect(csvText.startsWith("\uFEFF")).toBe(true);
    expect(csvText).toContain(CSV_COLUMNS.deviceId);
    expect(csvText).toContain(CSV_COLUMNS.newDeviceId);
  });

  it("schreibt deutsche Datumsangaben und den abgeleiteten Status", () => {
    const line = buildEquipmentCsv([row]).split("\r\n")[1];
    expect(line).toContain('"15.01.2026"');
    expect(line).toContain('"im Einsatz"');
    expect(buildEquipmentCsv([{ ...row, returnDate: "2026-06-30" }])).toContain(
      '"zurückgegeben"'
    );
  });

  it("lässt die Umbenennungsspalte leer", () => {
    const fields = buildEquipmentCsv([row]).split("\r\n")[1].split(";");
    expect(fields[1]).toBe('""');
  });

  it("verdoppelt Anführungszeichen im Freitext", () => {
    expect(buildEquipmentCsv([{ ...row, notes: 'Mit "Netzteil"' }])).toContain(
      '"Mit ""Netzteil"""'
    );
  });

  it("lässt sich mit dem eigenen Parser wieder einlesen", () => {
    const table = parseCsvTable(
      buildEquipmentCsv([{ ...row, notes: "Zeile 1\nZeile 2; mit Semikolon" }])
    );
    expect(table).toHaveLength(2);
    expect(table[1][8]).toBe("Zeile 1\nZeile 2; mit Semikolon");
  });
});

describe("parseCsvTable", () => {
  it("trennt an Semikolons", () => {
    expect(parseCsvTable("a;b;c")).toEqual([["a", "b", "c"]]);
  });

  it("entfernt das BOM", () => {
    expect(parseCsvTable("\uFEFFa;b")).toEqual([["a", "b"]]);
  });

  it("behandelt CRLF und leere Felder", () => {
    expect(parseCsvTable("a;\r\n;b\r\n")).toEqual([
      ["a", ""],
      ["", "b"],
    ]);
  });

  it("erlaubt Semikolon und Zeilenumbruch innerhalb von Anführungszeichen", () => {
    expect(parseCsvTable('"a;1";"b\nc"')).toEqual([["a;1", "b\nc"]]);
  });

  it("liest verdoppelte Anführungszeichen als eines", () => {
    expect(parseCsvTable('"sagt ""hallo"""')).toEqual([['sagt "hallo"']]);
  });
});

describe("decodeCsvUpload", () => {
  it("liest UTF-8", () => {
    expect(decodeCsvUpload(new TextEncoder().encode("Müller"))).toBe("Müller");
  });

  it("fällt bei ungültigem UTF-8 auf Windows-1252 zurück", () => {
    // "Müller" wie Excel es als ANSI speichert (ü = 0xFC)
    const ansi = new Uint8Array([0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72]);
    expect(decodeCsvUpload(ansi)).toBe("Müller");
  });
});

describe("parseTableDate", () => {
  it("akzeptiert TT.MM.JJJJ und JJJJ-MM-TT", () => {
    expect(parseTableDate("15.01.2026", "Übernahme")).toBe("2026-01-15");
    expect(parseTableDate("1.6.2026", "Übernahme")).toBe("2026-06-01");
    expect(parseTableDate("2026-01-15", "Übernahme")).toBe("2026-01-15");
  });

  it("lehnt zweistellige Jahre ab", () => {
    expect(() => parseTableDate("15.01.26", "Übernahme")).toThrow(
      "kein Datum im Format"
    );
  });

  it("lehnt ungültige Kalendertage ab", () => {
    expect(() => parseTableDate("30.02.2026", "Übernahme")).toThrow(
      "kein gültiger Kalendertag"
    );
  });

  it("verlangt einen Wert", () => {
    expect(() => parseTableDate("  ", "Übernahme")).toThrow("Übernahme fehlt.");
  });
});

describe("planEquipmentImport", () => {
  it("erkennt eine unveränderte Zeile", () => {
    const result = planEquipmentImport(csv([unchangedRow()]), context());
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.plan.unchanged).toEqual(["IT-0001"]);
    expect(result.plan.update).toHaveLength(0);
    expect(result.plan.create).toHaveLength(0);
    expect(result.plan.remove).toHaveLength(0);
  });

  it("erkennt Änderungen an einer bekannten Geräte-ID", () => {
    const result = planEquipmentImport(
      csv([
        unchangedRow({
          [CSV_COLUMNS.email]: "erika@stefanai.de",
          [CSV_COLUMNS.returnDate]: "30.06.2026",
        }),
      ]),
      context()
    );
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.plan.update).toHaveLength(1);
    expect(result.plan.update[0]).toMatchObject({
      id: EQUIPMENT_1,
      previousDeviceId: "IT-0001",
      values: { userId: USER_B, returnDate: "2026-06-30" },
    });
  });

  it("legt unbekannte Geräte-IDs neu an", () => {
    const result = planEquipmentImport(
      csv([
        unchangedRow(),
        {
          [CSV_COLUMNS.deviceId]: "IT-0002",
          [CSV_COLUMNS.email]: "erika@stefanai.de",
          [CSV_COLUMNS.typeName]: "Maus",
          [CSV_COLUMNS.handoverDate]: "2026-02-01",
        },
      ]),
      context()
    );
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.plan.create).toEqual([
      {
        deviceId: "IT-0002",
        userId: USER_B,
        typeId: TYPE_MAUS,
        serialNumber: null,
        notes: null,
        handoverDate: "2026-02-01",
        returnDate: null,
      },
    ]);
  });

  it("entfernt Geräte, die in der Datei fehlen", () => {
    const result = planEquipmentImport(
      csv([
        {
          [CSV_COLUMNS.deviceId]: "IT-0002",
          [CSV_COLUMNS.email]: "max@stefanai.de",
          [CSV_COLUMNS.typeName]: "Maus",
          [CSV_COLUMNS.handoverDate]: "01.02.2026",
        },
      ]),
      context()
    );
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.plan.remove).toEqual([
      { id: EQUIPMENT_1, deviceId: "IT-0001" },
    ]);
  });

  it("benennt über die Spalte „Geräte-ID neu“ um", () => {
    const result = planEquipmentImport(
      csv([unchangedRow({ [CSV_COLUMNS.newDeviceId]: "Laptop-07" })]),
      context()
    );
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.plan.update).toHaveLength(1);
    expect(result.plan.update[0].values.deviceId).toBe("Laptop-07");
    expect(result.plan.remove).toHaveLength(0);
  });

  it("lehnt das Umbenennen einer unbekannten Geräte-ID ab", () => {
    const result = planEquipmentImport(
      csv([
        {
          [CSV_COLUMNS.deviceId]: "IT-9999",
          [CSV_COLUMNS.newDeviceId]: "IT-0003",
          [CSV_COLUMNS.email]: "max@stefanai.de",
          [CSV_COLUMNS.typeName]: "Laptop",
          [CSV_COLUMNS.handoverDate]: "01.02.2026",
        },
      ]),
      context()
    );
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.errors[0]).toContain("lässt sie sich nicht umbenennen");
  });

  it("lehnt einen Ringtausch von Geräte-IDs ab", () => {
    const twoDevices = context({
      equipment: [
        ...context().equipment,
        {
          id: "b2c3d4e5-2222-4333-8444-555566667777",
          deviceId: "IT-0002",
          userId: USER_B,
          typeId: TYPE_MAUS,
          serialNumber: null,
          notes: null,
          handoverDate: "2026-02-01",
          returnDate: null,
        },
      ],
    });
    const result = planEquipmentImport(
      csv([
        unchangedRow({ [CSV_COLUMNS.newDeviceId]: "IT-0002" }),
        {
          [CSV_COLUMNS.deviceId]: "IT-0002",
          [CSV_COLUMNS.newDeviceId]: "IT-0001",
          [CSV_COLUMNS.email]: "erika@stefanai.de",
          [CSV_COLUMNS.typeName]: "Maus",
          [CSV_COLUMNS.handoverDate]: "01.02.2026",
        },
      ]),
      twoDevices
    );
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.errors.join(" ")).toContain("Tausch von Geräte-IDs");
  });

  it("meldet doppelte Geräte-IDs mit Zeilennummer", () => {
    const result = planEquipmentImport(
      csv([unchangedRow(), unchangedRow()]),
      context()
    );
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.errors[0]).toBe(
      "Zeile 3: Die Geräte-ID „IT-0001“ kommt schon in Zeile 2 vor."
    );
  });

  it("meldet unbekannte E-Mail-Adressen und Ausstattungsarten", () => {
    const result = planEquipmentImport(
      csv([
        unchangedRow({ [CSV_COLUMNS.email]: "fremd@stefanai.de" }),
        {
          [CSV_COLUMNS.deviceId]: "IT-0002",
          [CSV_COLUMNS.email]: "max@stefanai.de",
          [CSV_COLUMNS.typeName]: "Beamer",
          [CSV_COLUMNS.handoverDate]: "01.02.2026",
        },
      ]),
      context()
    );
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toContain("gibt es keine/n Mitarbeiter/in");
    expect(result.errors[1]).toContain("„Beamer“ ist unbekannt");
  });

  it("erkennt Ausstattungsarten unabhängig von der Groß- und Kleinschreibung", () => {
    const result = planEquipmentImport(
      csv([unchangedRow({ [CSV_COLUMNS.typeName]: "laptop" })]),
      context()
    );
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.plan.unchanged).toEqual(["IT-0001"]);
  });

  it("lehnt neue Zuordnungen an deaktivierte Zugänge ab", () => {
    const withInactive = context({
      users: [
        { id: USER_A, email: "max@stefanai.de", active: true },
        { id: USER_B, email: "erika@stefanai.de", active: false },
      ],
    });
    const result = planEquipmentImport(
      csv([unchangedRow({ [CSV_COLUMNS.email]: "erika@stefanai.de" })]),
      withInactive
    );
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.errors[0]).toContain("ist deaktiviert");
  });

  it("behält ausgeblendete Arten für bereits erfasste Geräte", () => {
    const hiddenType = context({
      types: [
        { id: TYPE_LAPTOP, name: "Laptop", active: false },
        { id: TYPE_MAUS, name: "Maus", active: true },
      ],
    });
    const result = planEquipmentImport(csv([unchangedRow()]), hiddenType);
    expect(result).toMatchObject({ ok: true });

    const neu = planEquipmentImport(
      csv([
        unchangedRow(),
        {
          [CSV_COLUMNS.deviceId]: "IT-0002",
          [CSV_COLUMNS.email]: "max@stefanai.de",
          [CSV_COLUMNS.typeName]: "Laptop",
          [CSV_COLUMNS.handoverDate]: "01.02.2026",
        },
      ]),
      hiddenType
    );
    expect(neu).toMatchObject({ ok: false });
    if (neu.ok) return;
    expect(neu.errors[0]).toContain("ist ausgeblendet");
  });

  it("lehnt eine Rückgabe vor der Übernahme ab", () => {
    const result = planEquipmentImport(
      csv([unchangedRow({ [CSV_COLUMNS.returnDate]: "01.01.2026" })]),
      context()
    );
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.errors[0]).toContain(
      "Rückgabedatum darf nicht vor dem Übernahmedatum"
    );
  });

  it("verlangt die Pflichtspalten in der Kopfzeile", () => {
    const result = planEquipmentImport(
      `${CSV_COLUMNS.deviceId};${CSV_COLUMNS.typeName}\r\n"IT-0001";"Laptop"`,
      context()
    );
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.errors[0]).toContain(CSV_COLUMNS.email);
    expect(result.errors[0]).toContain(CSV_COLUMNS.handoverDate);
  });

  it("führt ohne Datenzeilen bewusst keinen Import aus", () => {
    const result = planEquipmentImport(csv([]), context());
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.errors[0]).toContain("keine Datenzeilen");
  });

  it("ignoriert unbekannte Zusatzspalten", () => {
    const withExtra = `${CSV_COLUMNS.deviceId};${CSV_COLUMNS.email};${CSV_COLUMNS.typeName};${CSV_COLUMNS.handoverDate};Bemerkung intern\r\n"IT-0001";"max@stefanai.de";"Laptop";"15.01.2026";"egal"`;
    const result = planEquipmentImport(withExtra, context());
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    // Seriennummer fehlt in dieser Datei, wird also geleert
    expect(result.plan.update[0].values.serialNumber).toBeNull();
  });
});
