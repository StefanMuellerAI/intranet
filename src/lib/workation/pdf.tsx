import "server-only";
import {
  Document,
  Page,
  renderToBuffer,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import type { User, WorkationRequest } from "@/db/schema";
import { formatDateDE } from "@/lib/dates";
import {
  WORKATION_AGREEMENT_TEXT,
  WORKATION_DECLARATIONS,
} from "@/lib/workation/validate";

const styles = StyleSheet.create({
  page: { padding: 48, fontSize: 10, fontFamily: "Helvetica", lineHeight: 1.5 },
  header: { fontSize: 8, color: "#555", marginBottom: 16 },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  subtitle: { fontSize: 10, color: "#444", marginBottom: 16 },
  section: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    marginTop: 14,
    marginBottom: 6,
  },
  row: { flexDirection: "row", marginBottom: 3 },
  label: { width: 200, color: "#444" },
  value: { flex: 1, fontFamily: "Helvetica-Bold" },
  decl: { flexDirection: "row", marginBottom: 4 },
  declMark: { width: 16 },
  declText: { flex: 1 },
  agreement: { marginTop: 8, textAlign: "justify" },
  approval: {
    marginTop: 20,
    padding: 10,
    border: "1 solid #333",
    backgroundColor: "#f4f4f4",
  },
});

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value || "—"}</Text>
    </View>
  );
}

function WorkationPdf({
  request,
  applicant,
  approverName,
}: {
  request: WorkationRequest;
  applicant: User;
  approverName: string;
}) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.header}>
          StefanAI Solutions GmbH, Graeffstr. 5, 50823 Köln · Tel.:
          0221/5702984 · E-Mail: info@stefanai.de{"\n"}
          Amtsgericht Köln, HRB 128408 · Geschäftsführer: Stefan Müller
        </Text>

        <Text style={styles.title}>
          Antrag und Einzelvereinbarung Workation
        </Text>
        <Text style={styles.subtitle}>
          Genehmigungsnachweis gemäß Workation-Richtlinie, Anlage 1 · Vorgang{" "}
          {request.id}
        </Text>

        <Text style={styles.section}>
          Angaben zur Person und zum Aufenthalt
        </Text>
        <Row
          label="Name, Vorname"
          value={`${applicant.lastName}, ${applicant.firstName}`}
        />
        <Row
          label="Zielland"
          value={`${request.country} (${
            request.countryCategory === "eu_ewr_ch"
              ? "EU/EWR/Schweiz"
              : "Drittstaat"
          })`}
        />
        <Row label="Aufenthaltsort (Stadt)" value={request.city} />
        <Row
          label="Anschrift der Unterkunft"
          value={request.accommodationAddress}
        />
        <Row
          label="Zeitraum von — bis (Enddatum verbindlich)"
          value={`${formatDateDE(request.startDate)} — ${formatDateDE(request.endDate)}`}
        />
        <Row label="davon Arbeitstage" value={String(request.workDays)} />
        <Row
          label="davon beantragte Urlaubstage"
          value={String(request.vacationDays)}
        />
        <Row
          label="Zeitzone / zugesagte Erreichbarkeit"
          value={request.timezoneAvailability}
        />
        <Row
          label="Bisherige Tage in diesem Land (lfd. Kalenderjahr)"
          value={String(request.daysInCountryThisYear)}
        />
        <Row
          label="Notfallkontakt (Name, Telefon)"
          value={`${request.emergencyContactName}, ${request.emergencyContactPhone}`}
        />

        <Text style={styles.section}>Aufenthaltsrecht und Versicherung</Text>
        <Row
          label="Art des Visums / Aufenthaltstitels"
          value={request.visaType}
        />
        <Row
          label="gültig bis"
          value={request.visaValidUntil ? formatDateDE(request.visaValidUntil) : "—"}
        />
        <Row
          label="Auslandskranken- und Rückholversicherung"
          value={request.insuranceDetails}
        />
        <Row
          label="Nachweise vorgelegt am"
          value={
            request.proofProvidedAt ? formatDateDE(request.proofProvidedAt) : "—"
          }
        />

        <Text style={styles.section}>Tätigkeit im Aufenthaltszeitraum</Text>
        <Row label="Geplante Aufgaben" value={request.plannedTasks} />
        <Row
          label="Ausgeschlossene Projekte / Mandate (EU-Beschränkung)"
          value={request.excludedProjects ?? "—"}
        />
        <Row
          label="Vertretungsregelung im Inland"
          value={request.domesticSubstitution}
        />

        <Text style={styles.section}>
          Erklärungen der Mitarbeiterin / des Mitarbeiters
        </Text>
        <Text style={{ marginBottom: 6 }}>
          Ich erkläre, dass ich die Workation-Richtlinie der StefanAI Solutions
          GmbH gelesen habe und ihre Regelungen einhalte. Insbesondere
          bestätige ich:
        </Text>
        {WORKATION_DECLARATIONS.map((d) => (
          <View key={d.key} style={styles.decl}>
            <Text style={styles.declMark}>[X]</Text>
            <Text style={styles.declText}>{d.text}</Text>
          </View>
        ))}

        <Text style={styles.section}>Vereinbarung</Text>
        <Text style={styles.agreement}>{WORKATION_AGREEMENT_TEXT}</Text>

        <View style={styles.approval}>
          <Text style={{ fontFamily: "Helvetica-Bold", marginBottom: 4 }}>
            Genehmigungsvermerk
          </Text>
          <Text>
            Digital eingereicht von {applicant.firstName} {applicant.lastName}{" "}
            am {request.createdAt.toLocaleDateString("de-DE")} (alle sieben
            Erklärungen bestätigt).
          </Text>
          <Text>
            Genehmigt durch {approverName} am{" "}
            {request.decidedAt
              ? request.decidedAt.toLocaleDateString("de-DE")
              : "—"}
            . Die Genehmigung im System ersetzt die schriftliche
            Einzelgenehmigung; Einreichung und Genehmigung sind im Audit-Log
            dokumentiert.
          </Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderWorkationPdf(
  request: WorkationRequest,
  applicant: User,
  approverName: string
): Promise<Buffer> {
  return renderToBuffer(
    <WorkationPdf
      request={request}
      applicant={applicant}
      approverName={approverName}
    />
  );
}
