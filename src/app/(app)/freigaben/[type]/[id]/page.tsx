import { notFound } from "next/navigation";
import { and, asc, eq, gte, inArray, lt, ne } from "drizzle-orm";
import {
  db,
  expenseItems,
  expenseReports,
  receipts,
  users,
  vacationRequests,
  workationRequests,
} from "@/db";
import { fullName, requireApprover } from "@/lib/auth";
import { formatDateDE } from "@/lib/dates";
import { getVacationAccount } from "@/lib/vacation";
import type { WorkflowType } from "@/lib/workflow";
import { ApprovalButtons } from "@/components/approval-buttons";
import { ExpenseDetails } from "@/components/expense-details";
import { PageHeader } from "@/components/page-header";
import { AuditTrail, HistoryCard } from "@/components/request-meta";
import { StatusBadge } from "@/components/status-badge";
import { WorkationDetails } from "@/components/workation-details";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { updateWorkationAdminFields } from "@/app/(app)/workation/actions";
import { formatEuro } from "@/lib/expenses/calc";

export const metadata = { title: "Freigabe prüfen" };

const TYPES: WorkflowType[] = ["urlaub", "workation", "reisekosten"];

export default async function FreigabeDetailPage({
  params,
}: {
  params: Promise<{ type: string; id: string }>;
}) {
  const { type, id } = await params;
  if (!TYPES.includes(type as WorkflowType)) notFound();
  const workflowType = type as WorkflowType;
  const approver = await requireApprover();

  let content: React.ReactNode = null;
  let applicantId: string | null = null;
  let title = "";
  let status = "";

  if (workflowType === "urlaub") {
    const request = await db.query.vacationRequests.findFirst({
      where: eq(vacationRequests.id, id),
    });
    if (!request) notFound();
    applicantId = request.userId;
    status = request.status;
    const applicant = (await db.query.users.findFirst({
      where: eq(users.id, request.userId),
    }))!;
    const account = await getVacationAccount(
      applicant,
      Number(request.startDate.slice(0, 4))
    );
    const substitute = request.substituteUserId
      ? await db.query.users.findFirst({
          where: eq(users.id, request.substituteUserId),
        })
      : null;
    title = `Urlaub: ${fullName(applicant)}`;
    content = (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Antragsdaten</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Zeitraum</dt>
              <dd>
                {formatDateDE(request.startDate)} –{" "}
                {formatDateDE(request.endDate)}
                {request.halfDayStart && " (erster Tag halb)"}
                {request.halfDayEnd && " (letzter Tag halb)"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Urlaubstage</dt>
              <dd>{request.days}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">
                Resturlaub der Person (aktuell)
              </dt>
              <dd>{account.remaining} Tage</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Vertretung</dt>
              <dd>
                {substitute
                  ? fullName(substitute)
                  : request.substituteText || "—"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Bemerkung</dt>
              <dd>{request.note || "—"}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    );
  } else if (workflowType === "workation") {
    const request = await db.query.workationRequests.findFirst({
      where: eq(workationRequests.id, id),
    });
    if (!request) notFound();
    applicantId = request.userId;
    status = request.status;
    const applicant = (await db.query.users.findFirst({
      where: eq(users.id, request.userId),
    }))!;
    title = `Workation: ${fullName(applicant)}`;
    const updateWithId = updateWorkationAdminFields.bind(null, id);
    content = (
      <>
        <WorkationDetails
          request={request}
          applicantName={fullName(applicant)}
          showA1Panel={approver.role === "admin"}
        />
        {approver.role === "admin" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Vom Admin zu pflegende Felder
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form action={updateWithId} className="space-y-4 max-w-xl">
                {request.countryCategory === "eu_ewr_ch" && (
                  <div className="space-y-1">
                    <Label htmlFor="a1Status">A1-Bescheinigung</Label>
                    <select
                      id="a1Status"
                      name="a1Status"
                      defaultValue={request.a1Status ?? "nicht_beantragt"}
                      className="border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                    >
                      <option value="nicht_beantragt">nicht beantragt</option>
                      <option value="beantragt">beantragt</option>
                      <option value="liegt_vor">liegt vor</option>
                    </select>
                  </div>
                )}
                <div className="space-y-1">
                  <Label htmlFor="proofProvidedAt">
                    Nachweise vorgelegt am (spätestens zwei Wochen vor Antritt)
                  </Label>
                  <Input
                    id="proofProvidedAt"
                    name="proofProvidedAt"
                    type="date"
                    defaultValue={request.proofProvidedAt ?? ""}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="excludedProjects">
                    Von der Bearbeitung ausgeschlossene Projekte / Mandate
                    (EU-Beschränkung)
                  </Label>
                  <Textarea
                    id="excludedProjects"
                    name="excludedProjects"
                    defaultValue={request.excludedProjects ?? ""}
                  />
                </div>
                <Button type="submit" variant="outline">
                  Felder speichern
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </>
    );
  } else {
    const report = await db.query.expenseReports.findFirst({
      where: eq(expenseReports.id, id),
    });
    if (!report) notFound();
    applicantId = report.userId;
    status = report.status;
    const applicant = (await db.query.users.findFirst({
      where: eq(users.id, report.userId),
    }))!;
    title = `Reisekosten: ${fullName(applicant)} · ${formatEuro(report.totalCents)}`;
    const [items, receiptRows] = await Promise.all([
      db
        .select()
        .from(expenseItems)
        .where(eq(expenseItems.reportId, id))
        .orderBy(asc(expenseItems.position)),
      db.select().from(receipts).where(eq(receipts.reportId, id)),
    ]);

    // Dreimonatsfrist-Hinweis: frühere Reisen zum selben Einsatzort in den
    // letzten drei Monaten vor Abreise (kein automatischer Ausschluss).
    const threeMonthsBefore = new Date(report.departureDate);
    threeMonthsBefore.setMonth(threeMonthsBefore.getMonth() - 3);
    const priorTrips = await db
      .select()
      .from(expenseReports)
      .where(
        and(
          eq(expenseReports.userId, report.userId),
          ne(expenseReports.id, report.id),
          inArray(expenseReports.status, ["eingereicht", "genehmigt"]),
          gte(
            expenseReports.departureDate,
            threeMonthsBefore.toISOString().slice(0, 10)
          ),
          lt(expenseReports.departureDate, report.departureDate)
        )
      );
    const sameDestination = priorTrips.filter(
      (t) =>
        t.destination.trim().toLowerCase() ===
        report.destination.trim().toLowerCase()
    );

    content = (
      <>
        {sameDestination.length > 0 && (
          <Alert>
            <AlertTitle>Prüfhinweis: Dreimonatsfrist</AlertTitle>
            <AlertDescription>
              {sameDestination.length} weitere Reise(n) zum Einsatzort „
              {report.destination}“ in den letzten drei Monaten. Bei
              längerfristigem Einsatz am selben auswärtigen Einsatzort besteht
              der Anspruch auf die Verpflegungspauschale nur für die ersten
              drei Monate (Ziffer 5 der Reisekostenrichtlinie). Bitte prüfen —
              keine automatische Sperre.
            </AlertDescription>
          </Alert>
        )}
        <ExpenseDetails report={report} items={items} receipts={receiptRows} />
      </>
    );
  }

  const isOpen = status === "eingereicht" || status === "storno_beantragt";

  return (
    <div className="space-y-6">
      <PageHeader title={title} />
      <div className="flex items-center gap-3">
        <StatusBadge status={status} />
      </div>

      {content}

      {isOpen ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Entscheidung</CardTitle>
          </CardHeader>
          <CardContent>
            <ApprovalButtons
              type={workflowType}
              id={id}
              isOwn={applicantId === approver.id}
              isCancellation={status === "storno_beantragt"}
            />
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground">
          Dieser Vorgang ist bereits entschieden.
        </p>
      )}

      <HistoryCard
        requestType={workflowType}
        requestId={id}
        renderSnapshot={(s) => (
          <pre className="whitespace-pre-wrap text-xs text-muted-foreground">
            {JSON.stringify(
              Object.fromEntries(
                Object.entries(s).filter(
                  ([k]) => !["id", "userId", "ratesSnapshot", "items"].includes(k)
                )
              ),
              null,
              2
            )}
          </pre>
        )}
      />
      <AuditTrail objectType={workflowType} objectId={id} />
    </div>
  );
}
