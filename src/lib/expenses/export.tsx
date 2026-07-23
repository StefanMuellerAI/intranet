import "server-only";
import {
  Document,
  Page,
  renderToBuffer,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import type { ExpenseReport } from "@/db/schema";
import { formatDateDE } from "@/lib/dates";
import { formatEuro } from "@/lib/expenses/calc";

export interface ExportRow {
  report: ExpenseReport;
  userName: string;
}

/** Beleg-Erstattungen = Fahrt + Privat-Pkw + Übernachtung + Nebenkosten */
export function receiptReimbursementCents(r: ExpenseReport): number {
  return r.transportCents + r.carCents + r.lodgingCents + r.incidentalsCents;
}

/**
 * CSV-Export mit getrenntem Ausweis von steuerfreien Pauschalen, pauschal
 * versteuertem Zuschlag und Beleg-Erstattungen (Semikolon, deutsche Beträge).
 */
export function buildExpensesCsv(rows: ExportRow[]): string {
  const euro = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
  const lines = [
    [
      "Mitarbeiter/in",
      "Reiseziel",
      "Kunde/Anlass",
      "Abreise",
      "Rückkehr",
      "Verpflegungspauschale steuerfrei (EUR)",
      "Arbeitgeber-Zuschlag pauschal versteuert (EUR)",
      "Beleg-Erstattungen (EUR)",
      "Gesamterstattung (EUR)",
      "Vorgangs-ID",
    ].join(";"),
    ...rows.map(({ report, userName }) =>
      [
        userName,
        report.destination,
        report.customerPurpose,
        formatDateDE(report.departureDate),
        formatDateDE(report.returnDate),
        euro(report.mealAllowanceCents),
        euro(report.employerSupplementCents),
        euro(receiptReimbursementCents(report)),
        euro(report.totalCents),
        report.id,
      ]
        .map((v) => `"${String(v).replaceAll('"', '""')}"`)
        .join(";")
    ),
  ];
  return "\uFEFF" + lines.join("\r\n");
}

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 9, fontFamily: "Helvetica" },
  title: { fontSize: 14, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  subtitle: { fontSize: 9, color: "#555", marginBottom: 12 },
  row: {
    flexDirection: "row",
    borderBottom: "0.5 solid #ccc",
    paddingVertical: 3,
  },
  header: {
    flexDirection: "row",
    borderBottom: "1 solid #000",
    paddingVertical: 3,
    fontFamily: "Helvetica-Bold",
  },
  cName: { width: "16%" },
  cDest: { width: "20%" },
  cDate: { width: "16%" },
  cNum: { width: "12%", textAlign: "right" },
  total: {
    flexDirection: "row",
    paddingVertical: 4,
    fontFamily: "Helvetica-Bold",
    borderTop: "1 solid #000",
  },
});

export async function buildExpensesPdf(
  rows: ExportRow[],
  monthLabel: string
): Promise<Buffer> {
  const sum = (f: (r: ExpenseReport) => number) =>
    rows.reduce((s, { report }) => s + f(report), 0);

  return renderToBuffer(
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <Text style={styles.title}>
          Reisekosten-Export {monthLabel} — StefanAI Solutions GmbH
        </Text>
        <Text style={styles.subtitle}>
          Genehmigte Abrechnungen für die Lohnabrechnung. Erstattung über die
          Gehaltsüberweisung. Getrennter Ausweis: steuerfreie
          Verpflegungspauschale, pauschal versteuerter Zuschlag,
          Beleg-Erstattungen.
        </Text>
        <View style={styles.header}>
          <Text style={styles.cName}>Mitarbeiter/in</Text>
          <Text style={styles.cDest}>Reiseziel / Anlass</Text>
          <Text style={styles.cDate}>Zeitraum</Text>
          <Text style={styles.cNum}>Pauschale (steuerfrei)</Text>
          <Text style={styles.cNum}>Zuschlag (pauschal verst.)</Text>
          <Text style={styles.cNum}>Beleg-Erstattungen</Text>
          <Text style={styles.cNum}>Gesamt</Text>
        </View>
        {rows.map(({ report, userName }) => (
          <View key={report.id} style={styles.row}>
            <Text style={styles.cName}>{userName}</Text>
            <Text style={styles.cDest}>
              {report.destination} ({report.customerPurpose})
            </Text>
            <Text style={styles.cDate}>
              {formatDateDE(report.departureDate)} –{" "}
              {formatDateDE(report.returnDate)}
            </Text>
            <Text style={styles.cNum}>
              {formatEuro(report.mealAllowanceCents)}
            </Text>
            <Text style={styles.cNum}>
              {formatEuro(report.employerSupplementCents)}
            </Text>
            <Text style={styles.cNum}>
              {formatEuro(receiptReimbursementCents(report))}
            </Text>
            <Text style={styles.cNum}>{formatEuro(report.totalCents)}</Text>
          </View>
        ))}
        <View style={styles.total}>
          <Text style={styles.cName}>Summe</Text>
          <Text style={styles.cDest} />
          <Text style={styles.cDate} />
          <Text style={styles.cNum}>
            {formatEuro(sum((r) => r.mealAllowanceCents))}
          </Text>
          <Text style={styles.cNum}>
            {formatEuro(sum((r) => r.employerSupplementCents))}
          </Text>
          <Text style={styles.cNum}>
            {formatEuro(sum(receiptReimbursementCents))}
          </Text>
          <Text style={styles.cNum}>{formatEuro(sum((r) => r.totalCents))}</Text>
        </View>
        {rows.length === 0 && (
          <Text style={{ marginTop: 12 }}>
            Keine genehmigten Abrechnungen in diesem Monat.
          </Text>
        )}
      </Page>
    </Document>
  );
}
