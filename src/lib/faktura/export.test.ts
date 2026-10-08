import { describe, expect, it } from "vitest";
import type { FakturaTimeEntry } from "@/db";
import { buildFakturaCsv, type ExportRow } from "./export";

const CREATED = new Date("2026-07-20T08:15:00.000Z");
const UPDATED = new Date("2026-07-21T09:30:00.000Z");

function row(
  entry: Partial<FakturaTimeEntry> = {},
  names: Partial<Omit<ExportRow, "entry">> = {}
): ExportRow {
  return {
    entry: {
      id: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      projectId: "33333333-3333-4333-8333-333333333333",
      entryDate: "2026-07-20",
      durationMinutes: 90,
      description: "Konzeptarbeit",
      status: "offen",
      visibleOnTimesheet: true,
      overbooked: false,
      deleted: false,
      createdById: "22222222-2222-4222-8222-222222222222",
      updatedById: "22222222-2222-4222-8222-222222222222",
      createdAt: CREATED,
      updatedAt: UPDATED,
      ...entry,
    },
    userName: "Max Mitarbeiter",
    customerName: "ACME GmbH",
    projectName: "Website-Relaunch",
    ...names,
  };
}

/** Datenzeilen ohne BOM und Kopfzeile */
function dataLines(csv: string): string[] {
  return csv.slice(1).split("\r\n").slice(1);
}

describe("buildFakturaCsv", () => {
  it("beginnt mit BOM, trennt mit Semikolon und CRLF und hat deutsche Spaltenköpfe", () => {
    const csv = buildFakturaCsv([row(), row()]);
    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[0].split(";")).toEqual([
      "Datum",
      "Kalenderwoche",
      "Mitarbeiter/in",
      "Kunde",
      "Projekt",
      "Tätigkeit",
      "Dauer (h)",
      "Status",
      "Im Stundenzettel sichtbar",
      "Überbuchung",
      "Gelöscht",
      "Erstellt am",
      "Zuletzt geändert am",
      "Buchungs-ID",
    ]);
  });

  it("liefert ohne Buchungen nur die Kopfzeile", () => {
    const csv = buildFakturaCsv([]);
    expect(csv.slice(1).split("\r\n")).toHaveLength(1);
  });

  it("formatiert eine Buchung mit deutschem Datum, KW und Dezimalkomma", () => {
    expect(dataLines(buildFakturaCsv([row()]))[0]).toBe(
      [
        "20.07.2026",
        "KW 30/2026",
        "Max Mitarbeiter",
        "ACME GmbH",
        "Website-Relaunch",
        "Konzeptarbeit",
        "1,50",
        "offen",
        "ja",
        "nein",
        "nein",
        "2026-07-20T08:15:00.000Z",
        "2026-07-21T09:30:00.000Z",
        "11111111-1111-4111-8111-111111111111",
      ]
        .map((v) => `"${v}"`)
        .join(";")
    );
  });

  it("maskiert Anführungszeichen und schützt Semikolons und Zeilenumbrüche durch Quoting", () => {
    const [line] = dataLines(
      buildFakturaCsv([
        row(
          { description: 'Workshop "KI"; Teil 1' },
          { customerName: 'Müller "&" Söhne; GmbH', projectName: "A;B" }
        ),
      ])
    );
    expect(line).toContain(
      '"Müller ""&"" Söhne; GmbH";"A;B";"Workshop ""KI""; Teil 1"'
    );

    const multiline = buildFakturaCsv([
      row({ description: "Zeile 1\nZeile 2" }),
    ]);
    expect(multiline).toContain('"Zeile 1\nZeile 2"');
  });

  it("kennzeichnet ausgeblendete, überbuchte und gelöschte Buchungen", () => {
    const [line] = dataLines(
      buildFakturaCsv([
        row({
          status: "freigegeben",
          visibleOnTimesheet: false,
          overbooked: true,
          deleted: true,
        }),
      ])
    );
    expect(line).toContain(
      '"freigegeben";"nein (ausgeblendet)";"ja";"ja (soft-delete)"'
    );
  });

  it("verwendet die ISO-Kalenderwoche über den Jahreswechsel", () => {
    const [line] = dataLines(
      buildFakturaCsv([row({ entryDate: "2027-01-01" })])
    );
    expect(line.startsWith('"01.01.2027";"KW 53/2026"')).toBe(true);
  });
});
