import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  handoverProtocolFilename,
  renderHandoverProtocolPdf,
  type HandoverProtocolPdfDevice,
} from "./it-equipment-pdf";

// Klassisches pdf-parse (1.x) wie im E2E-Test — Textextraktion für PDFs
const nodeRequire = createRequire(import.meta.url);
const parsePdf = nodeRequire("pdf-parse/lib/pdf-parse.js") as (
  data: Buffer
) => Promise<{ text: string; numpages: number }>;

function device(
  overrides: Partial<HandoverProtocolPdfDevice> = {}
): HandoverProtocolPdfDevice {
  return {
    typeName: "Laptop",
    deviceId: "SA-IT-2026-01",
    serialNumber: "C02XL0THJGH5",
    handoverLabel: "01.08.2026",
    returnLabel: null,
    notes: 'MacBook Pro 14"',
    ...overrides,
  };
}

describe("renderHandoverProtocolPdf", () => {
  it("füllt das Übergabeprotokoll mit Briefkopf und Ausstattung", async () => {
    const pdf = await renderHandoverProtocolPdf({
      kind: "uebergabe",
      employeeName: "Erika Musterfrau",
      createdAtLabel: "06.08.2026",
      devices: [
        device(),
        device({
          typeName: "Maus",
          deviceId: "SA-IT-2026-02",
          serialNumber: null,
          notes: null,
        }),
      ],
    });

    const { text } = await parsePdf(pdf);
    expect(text).toContain("Übergabeprotokoll");
    expect(text).toContain("Erika Musterfrau");
    expect(text).toContain("2 Positionen");
    expect(text).toContain("06.08.2026");
    expect(text).toContain("SA-IT-2026-01");
    expect(text).toContain("C02XL0THJGH5");
    expect(text).toContain("SA-IT-2026-02");
    expect(text).toContain("Maus");
    // Briefkopf: Fußzeile mit den Pflichtangaben des Hauses
    expect(text).toContain("StefanAI Solutions GmbH");
    expect(text).toContain("Graeffstr. 5");
    expect(text).toContain("HRB 128408");
    // Unterschriftenzeilen für beide Seiten
    expect(text).toContain("Ort, Datum, Unterschrift Erika Musterfrau");
    expect(text).toContain("Ort, Datum, Unterschrift StefanAI Solutions GmbH");
    // Die Übergabe kennt keine Rückgabespalte und keine Rückgabetexte
    expect(text).not.toContain("Rückgabe");
  });

  it("zeigt bei der Rücknahme erfasste Daten und Leerfelder für offene", async () => {
    const pdf = await renderHandoverProtocolPdf({
      kind: "ruecknahme",
      employeeName: "Max Mustermann",
      createdAtLabel: "06.08.2026",
      devices: [
        device({ returnLabel: "05.08.2026" }),
        device({ deviceId: "SA-IT-2026-03", returnLabel: null }),
      ],
    });

    const { text } = await parsePdf(pdf);
    expect(text).toContain("Rücknahmeprotokoll");
    expect(text).toContain("Rückgabe am");
    expect(text).toContain("05.08.2026");
    // Offene Rückgabe: Leerfeld plus Hinweis auf handschriftliches Ergänzen
    expect(text).toContain("____");
    expect(text).toContain("handschriftlich");
  });

  it("lässt Hinweis und Leerfelder weg, wenn alles zurückgegeben ist", async () => {
    const pdf = await renderHandoverProtocolPdf({
      kind: "ruecknahme",
      employeeName: "Max Mustermann",
      createdAtLabel: "06.08.2026",
      devices: [device({ returnLabel: "05.08.2026" })],
    });

    const { text } = await parsePdf(pdf);
    expect(text).toContain("1 Position");
    expect(text).not.toContain("____");
    expect(text).not.toContain("handschriftlich");
  });
});

describe("handoverProtocolFilename", () => {
  const date = new Date(2026, 7, 6);

  it("transliteriert Umlaute und ersetzt Sonderzeichen", () => {
    expect(
      handoverProtocolFilename("uebergabe", "Jörg Müßig-Größe", date)
    ).toBe("Uebergabeprotokoll_Joerg-Muessig-Groesse_2026-08-06.pdf");
    expect(handoverProtocolFilename("ruecknahme", "René d'Étoile", date)).toBe(
      "Ruecknahmeprotokoll_Rene-d-Etoile_2026-08-06.pdf"
    );
  });

  it("fällt bei leerem Namen auf einen Platzhalter zurück", () => {
    expect(handoverProtocolFilename("uebergabe", "···", date)).toBe(
      "Uebergabeprotokoll_Unbekannt_2026-08-06.pdf"
    );
  });
});
