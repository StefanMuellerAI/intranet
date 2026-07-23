import type { WorkationRequest } from "@/db/schema";
import { formatDateDE } from "@/lib/dates";
import { WORKATION_DECLARATIONS } from "@/lib/workation/validate";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const A1_LABELS: Record<string, string> = {
  nicht_beantragt: "nicht beantragt",
  beantragt: "beantragt",
  liegt_vor: "liegt vor",
};

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value || "—"}</dd>
    </div>
  );
}

export function WorkationDetails({
  request,
  applicantName,
  showA1Panel,
}: {
  request: WorkationRequest;
  applicantName: string;
  /** A1-relevante Kompaktansicht für den Admin (Übertrag ins SV-Meldeportal) */
  showA1Panel?: boolean;
}) {
  const isEu = request.countryCategory === "eu_ewr_ch";
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Angaben zur Person und zum Aufenthalt
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <Item label="Name, Vorname" value={applicantName} />
            <Item
              label="Zielland"
              value={
                <span className="inline-flex items-center gap-2">
                  {request.country}
                  <Badge variant="outline">
                    {isEu ? "EU/EWR/Schweiz" : "Drittstaat"}
                  </Badge>
                </span>
              }
            />
            <Item label="Aufenthaltsort (Stadt)" value={request.city} />
            <Item
              label="Anschrift der Unterkunft"
              value={request.accommodationAddress}
            />
            <Item
              label="Zeitraum (Enddatum verbindlich)"
              value={`${formatDateDE(request.startDate)} – ${formatDateDE(request.endDate)}`}
            />
            <Item label="davon Arbeitstage" value={String(request.workDays)} />
            <Item
              label="davon beantragte Urlaubstage"
              value={String(request.vacationDays)}
            />
            <Item
              label="Zeitzone / Erreichbarkeit"
              value={request.timezoneAvailability}
            />
            <Item
              label="Bisherige Tage in diesem Land (lfd. Jahr)"
              value={String(request.daysInCountryThisYear)}
            />
            <Item
              label="Notfallkontakt"
              value={`${request.emergencyContactName}, ${request.emergencyContactPhone}`}
            />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Aufenthaltsrecht und Versicherung
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <Item
              label="Art des Visums / Aufenthaltstitels"
              value={request.visaType}
            />
            <Item
              label="gültig bis"
              value={
                request.visaValidUntil
                  ? formatDateDE(request.visaValidUntil)
                  : "—"
              }
            />
            <Item
              label="Versicherung (Anbieter, Police)"
              value={request.insuranceDetails}
            />
            <Item
              label="Nachweise vorgelegt am"
              value={
                request.proofProvidedAt
                  ? formatDateDE(request.proofProvidedAt)
                  : "noch nicht vorgelegt"
              }
            />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Tätigkeit im Aufenthaltszeitraum
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 text-sm">
            <Item label="Geplante Aufgaben" value={request.plannedTasks} />
            <Item
              label="Ausgeschlossene Projekte / Mandate (EU-Beschränkung)"
              value={request.excludedProjects ?? "—"}
            />
            <Item
              label="Vertretungsregelung im Inland"
              value={request.domesticSubstitution}
            />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Bestätigte Erklärungen</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            {WORKATION_DECLARATIONS.map((d) => (
              <li key={d.key} className="flex gap-2">
                <span aria-hidden>☑</span>
                <span>{d.text}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {isEu ? (
        <Alert>
          <AlertTitle>
            A1-Bescheinigung:{" "}
            {A1_LABELS[request.a1Status ?? "nicht_beantragt"]}
          </AlertTitle>
          <AlertDescription>
            Aufenthalte in EU/EWR/Schweiz sind sozialversicherungsrechtlich
            unkritisch; die Gesellschaft beantragt die A1-Bescheinigung.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert>
          <AlertTitle>Drittstaat — gesonderte Prüfung erforderlich</AlertTitle>
          <AlertDescription>
            Für dieses Zielland ist eine gesonderte Prüfung
            (Sozialversicherung/Visum) durch die Geschäftsführung erforderlich,
            erforderlichenfalls unter Einbindung der Steuerberatung.
          </AlertDescription>
        </Alert>
      )}

      {showA1Panel && isEu && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              A1-relevante Daten (Übertrag SV-Meldeportal / Lohnabrechnung)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <Item label="Person" value={applicantName} />
              <Item
                label="Beschäftigungsstaat"
                value={request.country}
              />
              <Item
                label="Entsendezeitraum"
                value={`${formatDateDE(request.startDate)} – ${formatDateDE(request.endDate)}`}
              />
              <Item
                label="Anschrift im Ausland"
                value={`${request.accommodationAddress}, ${request.city}, ${request.country}`}
              />
            </dl>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
