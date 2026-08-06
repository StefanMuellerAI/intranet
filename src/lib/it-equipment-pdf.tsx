import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  Document,
  Image,
  Page,
  renderToBuffer,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import type { HandoverProtocolKind } from "@/db/schema";
import { toISODate } from "@/lib/dates";

/** Eine Zeile der Ausstattungstabelle im Protokoll. */
export interface HandoverProtocolPdfDevice {
  typeName: string;
  deviceId: string;
  serialNumber: string | null;
  handoverLabel: string;
  /** Nur Rücknahme: ohne erfasstes Datum bleibt ein Feld zum Handausfüllen */
  returnLabel: string | null;
  notes: string | null;
}

export interface HandoverProtocolPdfData {
  kind: HandoverProtocolKind;
  employeeName: string;
  /** Erstellungsdatum der Vorlage, z. B. "06.08.2026" */
  createdAtLabel: string;
  devices: HandoverProtocolPdfDevice[];
}

export const PROTOCOL_PDF_TITLES: Record<HandoverProtocolKind, string> = {
  uebergabe: "Übergabeprotokoll",
  ruecknahme: "Rücknahmeprotokoll",
};

/** Briefkopf-Fußzeile — identisch mit den übrigen Dokumenten des Hauses. */
export const PROTOCOL_FOOTER_TEXT =
  "StefanAI Solutions GmbH · Graeffstr. 5 · 50823 Köln · HRB 128408, Amtsgericht Köln · USt-IdNr. DE463775332 · info@stefanai.de · 0221/5702984";

const INTRO_TEXTS: Record<HandoverProtocolKind, string> = {
  uebergabe:
    "Der/Dem Mitarbeitenden wird die folgende IT-Ausstattung übergeben:",
  ruecknahme:
    "Die/Der Mitarbeitende gibt die folgende IT-Ausstattung zurück:",
};

const CONFIRMATION_TEXTS: Record<HandoverProtocolKind, string> = {
  uebergabe:
    "Die aufgeführte Ausstattung bleibt Eigentum der StefanAI Solutions GmbH und ist sorgfältig zu behandeln. Mit den Unterschriften wird die Übergabe der oben aufgeführten Ausstattung bestätigt.",
  ruecknahme:
    "Mit den Unterschriften wird die Rückgabe der oben aufgeführten Ausstattung bestätigt.",
};

/** Wird angehängt, sobald Zeilen ohne erfasstes Rückgabedatum dabei sind. */
const OPEN_RETURN_HINT =
  "Noch offene Rückgabedaten werden bei der Rückgabe handschriftlich ergänzt.";

/** Platzhalter zum handschriftlichen Eintragen des Rückgabedatums. */
const RETURN_DATE_BLANK = "____________";

const styles = StyleSheet.create({
  page: {
    paddingTop: 48,
    paddingHorizontal: 48,
    paddingBottom: 72,
    fontSize: 9,
    fontFamily: "Helvetica",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  logo: { width: 48, height: 48 },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  subtitle: { fontSize: 9, color: "#444" },
  metaBlock: { marginBottom: 14 },
  metaRow: { flexDirection: "row", marginBottom: 2 },
  metaLabel: { width: 130, color: "#444" },
  metaValue: { flex: 1, fontFamily: "Helvetica-Bold" },
  intro: { marginBottom: 8 },
  tableHeader: {
    flexDirection: "row",
    borderBottom: "1 solid #000",
    paddingVertical: 3,
    fontFamily: "Helvetica-Bold",
  },
  row: {
    flexDirection: "row",
    borderBottom: "0.5 solid #ccc",
    paddingVertical: 3,
  },
  confirmation: { marginTop: 14, textAlign: "justify" },
  signatures: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 48,
    gap: 24,
  },
  signatureBox: { width: "45%" },
  signatureLine: {
    borderTop: "1 solid #000",
    marginTop: 40,
    paddingTop: 4,
    fontSize: 8,
    color: "#444",
  },
  footer: {
    position: "absolute",
    bottom: 32,
    left: 48,
    right: 48,
    fontSize: 7,
    color: "#555",
    textAlign: "center",
    borderTop: "0.5 solid #999",
    paddingTop: 6,
  },
  pageNumber: {
    position: "absolute",
    bottom: 20,
    left: 48,
    right: 48,
    fontSize: 7,
    color: "#555",
    textAlign: "center",
  },
});

/**
 * Spaltenbreiten je Protokollart — die Rücknahme braucht zusätzlich die
 * Spalte "Rückgabe am", dafür rückt die Zusatzinfo etwas zusammen.
 */
const COLUMN_WIDTHS: Record<
  HandoverProtocolKind,
  { type: string; device: string; serial: string; handover: string; ret: string; notes: string }
> = {
  uebergabe: {
    type: "20%",
    device: "16%",
    serial: "20%",
    handover: "14%",
    ret: "0%",
    notes: "30%",
  },
  ruecknahme: {
    type: "17%",
    device: "14%",
    serial: "16%",
    handover: "14%",
    ret: "14%",
    notes: "25%",
  },
};

function loadLogo(): Buffer | null {
  // Identisches Branding-Asset wie im Intranet und auf den Stundenzetteln
  try {
    return readFileSync(path.join(process.cwd(), "public", "logo.png"));
  } catch {
    return null;
  }
}

function HandoverProtocolPdf({ data }: { data: HandoverProtocolPdfData }) {
  const logo = loadLogo();
  const title = PROTOCOL_PDF_TITLES[data.kind];
  const cols = COLUMN_WIDTHS[data.kind];
  const withReturnColumn = data.kind === "ruecknahme";
  const hasOpenReturns =
    withReturnColumn && data.devices.some((d) => d.returnLabel === null);

  return (
    <Document title={`${title} IT-Ausstattung — ${data.employeeName}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>
              StefanAI Solutions GmbH — IT-Ausstattung
            </Text>
          </View>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image kennt kein alt */}
          {logo && <Image style={styles.logo} src={logo} />}
        </View>

        <View style={styles.metaBlock}>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Mitarbeiter/in</Text>
            <Text style={styles.metaValue}>{data.employeeName}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Ausstattung</Text>
            <Text style={styles.metaValue}>
              {data.devices.length === 1
                ? "1 Position"
                : `${data.devices.length} Positionen`}
            </Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Stand</Text>
            <Text style={styles.metaValue}>{data.createdAtLabel}</Text>
          </View>
        </View>

        <Text style={styles.intro}>{INTRO_TEXTS[data.kind]}</Text>

        <View style={styles.tableHeader}>
          <Text style={{ width: cols.type, paddingRight: 4 }}>Ausstattung</Text>
          <Text style={{ width: cols.device, paddingRight: 4 }}>Geräte-ID</Text>
          <Text style={{ width: cols.serial, paddingRight: 4 }}>
            Seriennummer
          </Text>
          <Text style={{ width: cols.handover, paddingRight: 4 }}>
            Übernahme am
          </Text>
          {withReturnColumn && (
            <Text style={{ width: cols.ret, paddingRight: 4 }}>
              Rückgabe am
            </Text>
          )}
          <Text style={{ width: cols.notes }}>Zusatzinfo</Text>
        </View>
        {data.devices.map((device) => (
          <View key={device.deviceId} style={styles.row} wrap={false}>
            <Text style={{ width: cols.type, paddingRight: 4 }}>
              {device.typeName}
            </Text>
            <Text style={{ width: cols.device, paddingRight: 4 }}>
              {device.deviceId}
            </Text>
            <Text style={{ width: cols.serial, paddingRight: 4 }}>
              {device.serialNumber ?? "—"}
            </Text>
            <Text style={{ width: cols.handover, paddingRight: 4 }}>
              {device.handoverLabel}
            </Text>
            {withReturnColumn && (
              <Text style={{ width: cols.ret, paddingRight: 4 }}>
                {device.returnLabel ?? RETURN_DATE_BLANK}
              </Text>
            )}
            <Text style={{ width: cols.notes }}>{device.notes ?? "—"}</Text>
          </View>
        ))}

        <Text style={styles.confirmation}>
          {CONFIRMATION_TEXTS[data.kind]}
          {hasOpenReturns ? ` ${OPEN_RETURN_HINT}` : ""}
        </Text>

        <View style={styles.signatures} wrap={false}>
          <View style={styles.signatureBox}>
            <Text style={styles.signatureLine}>
              Ort, Datum, Unterschrift {data.employeeName}
            </Text>
          </View>
          <View style={styles.signatureBox}>
            <Text style={styles.signatureLine}>
              Ort, Datum, Unterschrift StefanAI Solutions GmbH
            </Text>
          </View>
        </View>

        <Text style={styles.footer} fixed>
          {PROTOCOL_FOOTER_TEXT}
        </Text>
        <Text
          style={styles.pageNumber}
          fixed
          render={({ pageNumber, totalPages }) =>
            `Seite ${pageNumber} von ${totalPages}`
          }
        />
      </Page>
    </Document>
  );
}

export async function renderHandoverProtocolPdf(
  data: HandoverProtocolPdfData
): Promise<Buffer> {
  return renderToBuffer(<HandoverProtocolPdf data={data} />);
}

const FILENAME_PREFIXES: Record<HandoverProtocolKind, string> = {
  uebergabe: "Uebergabeprotokoll",
  ruecknahme: "Ruecknahmeprotokoll",
};

/**
 * ASCII-sicherer Dateiname: Umlaute transliterieren, übrige Akzente
 * abstreifen und alles außer Buchstaben/Ziffern zu Bindestrichen eindampfen.
 */
export function handoverProtocolFilename(
  kind: HandoverProtocolKind,
  employeeName: string,
  date: Date
): string {
  const name = employeeName
    .replaceAll("ä", "ae")
    .replaceAll("ö", "oe")
    .replaceAll("ü", "ue")
    .replaceAll("Ä", "Ae")
    .replaceAll("Ö", "Oe")
    .replaceAll("Ü", "Ue")
    .replaceAll("ß", "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${FILENAME_PREFIXES[kind]}_${name || "Unbekannt"}_${toISODate(date)}.pdf`;
}
