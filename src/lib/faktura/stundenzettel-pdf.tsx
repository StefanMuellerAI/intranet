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
import { formatMinutesAsHours } from "@/lib/faktura/zeitfenster";

export interface TimesheetPdfRow {
  dateLabel: string;
  userName: string;
  description: string;
  durationMinutes: number;
}

export interface TimesheetPdfProject {
  name: string;
  totalMinutes: number;
  rows: TimesheetPdfRow[];
}

export interface TimesheetPdfData {
  customerName: string;
  customerAddress: string | null;
  contactPerson: string | null;
  periodLabel: string;
  docNumber: string;
  version: number;
  createdAtLabel: string;
  isDraft: boolean;
  projects: TimesheetPdfProject[];
  totalMinutes: number;
}

/** Pflichtangaben laut FA-6.5 — exakt dieser Footer auf jeder Seite. */
export const TIMESHEET_FOOTER_TEXT =
  "StefanAI Solutions GmbH · Graeffstr. 5 · 50823 Köln · HRB 128408, Amtsgericht Köln · USt-IdNr. DE463775332 · info@stefanai.de · 0221/5702984";

export const DRAFT_WATERMARK_TEXT = "ENTWURF – nicht freigegeben";

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
  projectTitle: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    marginTop: 12,
    marginBottom: 4,
  },
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
  subtotal: {
    flexDirection: "row",
    paddingVertical: 3,
    fontFamily: "Helvetica-Bold",
    borderTop: "1 solid #666",
  },
  total: {
    flexDirection: "row",
    paddingVertical: 5,
    marginTop: 12,
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    borderTop: "2 solid #000",
  },
  cDate: { width: "13%" },
  cUser: { width: "20%" },
  cDesc: { width: "55%", paddingRight: 6 },
  cDur: { width: "12%", textAlign: "right" },
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
  watermark: {
    position: "absolute",
    top: 320,
    left: 40,
    transform: "rotate(-30deg)",
    fontSize: 42,
    fontFamily: "Helvetica-Bold",
    color: "#cc0000",
    opacity: 0.25,
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

function loadLogo(): Buffer | null {
  // Identisches Branding-Asset wie im Intranet (FA-6.5)
  try {
    return readFileSync(path.join(process.cwd(), "public", "logo.png"));
  } catch {
    return null;
  }
}

function TimesheetPdf({ data }: { data: TimesheetPdfData }) {
  const logo = loadLogo();
  return (
    <Document
      title={`Stundenzettel ${data.docNumber} v${data.version} — ${data.customerName}`}
    >
      <Page size="A4" style={styles.page}>
        {data.isDraft && (
          <Text style={styles.watermark} fixed>
            {DRAFT_WATERMARK_TEXT}
          </Text>
        )}

        <View style={styles.headerRow}>
          <View>
            <Text style={styles.title}>Stundenzettel</Text>
            <Text style={styles.subtitle}>
              StefanAI Solutions GmbH — Nachweis erbrachter Leistungen
            </Text>
          </View>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image kennt kein alt */}
          {logo && <Image style={styles.logo} src={logo} />}
        </View>

        <View style={styles.metaBlock}>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Kunde</Text>
            <Text style={styles.metaValue}>{data.customerName}</Text>
          </View>
          {data.customerAddress ? (
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Anschrift</Text>
              <Text style={styles.metaValue}>{data.customerAddress}</Text>
            </View>
          ) : null}
          {data.contactPerson ? (
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Ansprechpartner/in</Text>
              <Text style={styles.metaValue}>{data.contactPerson}</Text>
            </View>
          ) : null}
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Zeitraum</Text>
            <Text style={styles.metaValue}>{data.periodLabel}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Dokumentnummer</Text>
            <Text style={styles.metaValue}>
              {data.docNumber} · Version {data.version}
            </Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Erstellt am</Text>
            <Text style={styles.metaValue}>{data.createdAtLabel}</Text>
          </View>
        </View>

        {data.projects.map((project) => (
          <View key={project.name} wrap>
            <Text style={styles.projectTitle}>
              Projekt: {data.customerName} – {project.name}
            </Text>
            <View style={styles.tableHeader}>
              <Text style={styles.cDate}>Datum</Text>
              <Text style={styles.cUser}>Mitarbeiter:in</Text>
              <Text style={styles.cDesc}>Tätigkeit</Text>
              <Text style={styles.cDur}>Dauer (h)</Text>
            </View>
            {project.rows.map((row, i) => (
              <View key={i} style={styles.row} wrap={false}>
                <Text style={styles.cDate}>{row.dateLabel}</Text>
                <Text style={styles.cUser}>{row.userName}</Text>
                <Text style={styles.cDesc}>{row.description}</Text>
                <Text style={styles.cDur}>
                  {formatMinutesAsHours(row.durationMinutes)}
                </Text>
              </View>
            ))}
            <View style={styles.subtotal}>
              <Text style={styles.cDate} />
              <Text style={styles.cUser} />
              <Text style={styles.cDesc}>Zwischensumme {project.name}</Text>
              <Text style={styles.cDur}>
                {formatMinutesAsHours(project.totalMinutes)}
              </Text>
            </View>
          </View>
        ))}

        <View style={styles.total}>
          <Text style={{ flex: 1 }}>
            Gesamtsumme über alle Projekte ({data.customerName})
          </Text>
          <Text style={styles.cDur}>
            {formatMinutesAsHours(data.totalMinutes)}
          </Text>
        </View>

        <View style={styles.signatures} wrap={false}>
          <View style={styles.signatureBox}>
            <Text style={styles.signatureLine}>
              Ort, Datum, Unterschrift Kunde
            </Text>
          </View>
          <View style={styles.signatureBox}>
            <Text style={styles.signatureLine}>
              Ort, Datum, Unterschrift StefanAI Solutions GmbH
            </Text>
          </View>
        </View>

        <Text style={styles.footer} fixed>
          {TIMESHEET_FOOTER_TEXT}
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

export async function renderTimesheetPdf(
  data: TimesheetPdfData
): Promise<Buffer> {
  return renderToBuffer(<TimesheetPdf data={data} />);
}
