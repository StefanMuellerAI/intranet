import { notFound } from "next/navigation";
import { and, eq, ne } from "drizzle-orm";
import { db, users, vacationRequests } from "@/db";
import { fullName, requireUser } from "@/lib/auth";
import { formatDateDE } from "@/lib/dates";
import { getOverlappingAbsences, getVacationAccount } from "@/lib/vacation";
import { DeleteRequestButton } from "@/components/delete-request-button";
import { PageHeader } from "@/components/page-header";
import { AuditTrail, HistoryCard } from "@/components/request-meta";
import { StatusBadge } from "@/components/status-badge";
import { VacationForm } from "@/components/vacation-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  deleteVacationRequest,
  requestVacationCancellation,
  resubmitVacationRequest,
  withdrawVacationRequest,
} from "../actions";

export const metadata = { title: "Urlaubsantrag" };

export default async function UrlaubDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const request = await db.query.vacationRequests.findFirst({
    where: eq(vacationRequests.id, id),
  });
  // Strikte Trennung: Mitarbeitende sehen nur eigene Anträge
  if (!request || (request.userId !== user.id && user.role !== "admin"))
    notFound();

  const substitute = request.substituteUserId
    ? await db.query.users.findFirst({
        where: eq(users.id, request.substituteUserId),
      })
    : null;

  const canEdit =
    request.userId === user.id &&
    (request.status === "beanstandet" || request.status === "zurueckgezogen");
  const canCancel =
    request.userId === user.id && request.status === "genehmigt";
  const canWithdraw =
    request.userId === user.id &&
    (request.status === "eingereicht" || request.status === "beanstandet");
  const canDelete =
    request.userId === user.id && request.status === "zurueckgezogen";

  let editProps = null;
  if (canEdit) {
    const year = Number(request.startDate.slice(0, 4));
    const account = await getVacationAccount(user, year);
    // Korrekturen können in das Folgejahr verschoben werden — dort gilt ein
    // eigener Anspruch (im Eintrittsjahr weicht er vom Folgejahr ab).
    const nextYearAccount = await getVacationAccount(user, year + 1);
    const colleagues = await db
      .select()
      .from(users)
      .where(and(ne(users.id, user.id), eq(users.status, "aktiv")));
    const absences = await getOverlappingAbsences(
      user.id,
      `${year}-01-01`,
      `${year + 1}-12-31`
    );
    editProps = { year, account, nextYearAccount, colleagues, absences };
  }

  const resubmitWithId = resubmitVacationRequest.bind(null, id);
  const cancelWithId = requestVacationCancellation.bind(null, id);
  const withdrawWithId = withdrawVacationRequest.bind(null, id);
  const deleteWithId = deleteVacationRequest.bind(null, id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Urlaubsantrag"
        description={`${formatDateDE(request.startDate)} bis ${formatDateDE(request.endDate)} · ${request.days} Tage`}
      />

      <div className="flex items-center gap-3">
        <StatusBadge status={request.status} />
        <span className="text-sm text-muted-foreground">
          Version {request.version}
        </span>
      </div>

      {request.status === "beanstandet" && request.rejectionComment && (
        <Alert>
          <AlertTitle>Beanstandung</AlertTitle>
          <AlertDescription>{request.rejectionComment}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Antragsdaten</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
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

      {canCancel && (
        <form action={cancelWithId}>
          <Button type="submit" variant="outline">
            Stornierung beantragen
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            Die Stornierung wird erst nach Bestätigung durch die
            Geschäftsführung wirksam; die Tage werden dann wieder
            gutgeschrieben.
          </p>
        </form>
      )}

      {canWithdraw && (
        <form action={withdrawWithId}>
          <Button type="submit" variant="outline">
            Antrag zurückziehen
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            Der Antrag wird aus der Freigabe genommen und kann danach
            korrigiert erneut eingereicht oder endgültig gelöscht werden.
          </p>
        </form>
      )}

      {canDelete && (
        <DeleteRequestButton
          action={deleteWithId}
          description="Der Urlaubsantrag wird unwiderruflich gelöscht. Dieser Schritt kann nicht rückgängig gemacht werden."
        />
      )}

      {canEdit && editProps && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Antrag korrigieren und erneut einreichen
            </CardTitle>
          </CardHeader>
          <CardContent>
            <VacationForm
              action={resubmitWithId}
              users={editProps.colleagues.map((c) => ({
                id: c.id,
                name: fullName(c),
              }))}
              remainingDays={editProps.account.remaining + request.days}
              remainingByYear={{
                // Die Tage dieses Antrags stehen für eine Korrektur wieder bereit
                [editProps.year]: editProps.account.remaining + request.days,
                [editProps.year + 1]: editProps.nextYearAccount.remaining,
              }}
              minDate={user.entryDate ?? undefined}
              absences={editProps.absences}
              defaults={{
                startDate: request.startDate,
                endDate: request.endDate,
                halfDayStart: request.halfDayStart,
                halfDayEnd: request.halfDayEnd,
                substituteUserId: request.substituteUserId ?? undefined,
                substituteText: request.substituteText ?? undefined,
                note: request.note ?? undefined,
              }}
              submitLabel="Korrigiert erneut einreichen"
            />
          </CardContent>
        </Card>
      )}

      <HistoryCard
        requestType="urlaub"
        requestId={id}
        renderSnapshot={(s) => (
          <p>
            {formatDateDE(String(s.startDate))} –{" "}
            {formatDateDE(String(s.endDate))} · {String(s.days)} Tage
            {s.note ? ` · Bemerkung: ${String(s.note)}` : ""}
          </p>
        )}
      />

      <AuditTrail objectType="urlaub" objectId={id} />
    </div>
  );
}
