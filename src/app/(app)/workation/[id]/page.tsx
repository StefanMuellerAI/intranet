import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, users, workationRequests } from "@/db";
import { fullName, requireUser } from "@/lib/auth";
import { formatDateDE } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { getUsedWorkationDays } from "@/lib/vacation";
import { DeleteRequestButton } from "@/components/delete-request-button";
import { PageHeader } from "@/components/page-header";
import { AuditTrail, HistoryCard } from "@/components/request-meta";
import { StatusBadge } from "@/components/status-badge";
import { WorkationDetails } from "@/components/workation-details";
import { WorkationForm } from "@/components/workation-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  deleteWorkationRequest,
  resubmitWorkationRequest,
  withdrawWorkationRequest,
} from "../actions";

export const metadata = { title: "Workation-Antrag" };

export default async function WorkationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const request = await db.query.workationRequests.findFirst({
    where: eq(workationRequests.id, id),
  });
  if (!request || (request.userId !== user.id && user.role !== "admin"))
    notFound();

  const applicant = await db.query.users.findFirst({
    where: eq(users.id, request.userId),
  });
  const canEdit =
    request.userId === user.id &&
    (request.status === "beanstandet" || request.status === "zurueckgezogen");
  const canWithdraw =
    request.userId === user.id &&
    (request.status === "eingereicht" || request.status === "beanstandet");
  const canDelete =
    request.userId === user.id && request.status === "zurueckgezogen";

  let editProps = null;
  if (canEdit) {
    const settings = await getSettings();
    const year = Number(request.startDate.slice(0, 4));
    const used = await getUsedWorkationDays(user.id, year, id);
    editProps = { settings, used };
  }

  const resubmitWithId = resubmitWorkationRequest.bind(null, id);
  const withdrawWithId = withdrawWorkationRequest.bind(null, id);
  const deleteWithId = deleteWorkationRequest.bind(null, id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workation-Antrag"
        description={`${request.city}, ${request.country} · ${formatDateDE(request.startDate)} bis ${formatDateDE(request.endDate)}`}
      />

      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={request.status} />
        <span className="text-sm text-muted-foreground">
          Version {request.version}
        </span>
        {request.status === "genehmigt" && (
          <Button
            variant="outline"
            size="sm"
            render={<Link href={`/workation/${id}/pdf`} target="_blank" />}
          >
            Genehmigungs-PDF herunterladen
          </Button>
        )}
      </div>

      {request.status === "beanstandet" && request.rejectionComment && (
        <Alert>
          <AlertTitle>Beanstandung</AlertTitle>
          <AlertDescription>{request.rejectionComment}</AlertDescription>
        </Alert>
      )}

      <WorkationDetails
        request={request}
        applicantName={applicant ? fullName(applicant) : "—"}
      />

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
          description="Der Workation-Antrag wird unwiderruflich gelöscht. Dieser Schritt kann nicht rückgängig gemacht werden."
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
            <WorkationForm
              action={resubmitWithId}
              usedWorkDaysThisYear={editProps.used}
              yearlyLimitDays={editProps.settings.workationYearlyLimitDays}
              consecutiveLimitDays={
                editProps.settings.workationConsecutiveLimitDays
              }
              defaults={request}
              submitLabel="Korrigiert erneut einreichen"
            />
          </CardContent>
        </Card>
      )}

      <HistoryCard
        requestType="workation"
        requestId={id}
        renderSnapshot={(s) => (
          <p>
            {String(s.city)}, {String(s.country)} ·{" "}
            {formatDateDE(String(s.startDate))} –{" "}
            {formatDateDE(String(s.endDate))} · {String(s.workDays)}{" "}
            Arbeitstage
          </p>
        )}
      />

      <AuditTrail objectType="workation" objectId={id} />
    </div>
  );
}
