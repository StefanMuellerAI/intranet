import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { commissionClaims, db } from "@/db";
import { requireUser } from "@/lib/auth";
import {
  BUSINESS_TYPE_LABELS,
  type TrainingFormat,
} from "@/lib/commissions/calc";
import { formatEuro } from "@/lib/expenses/calc";
import { commissionRatesFromSettings, getSettings } from "@/lib/settings";
import { DeleteRequestButton } from "@/components/delete-request-button";
import { PageHeader } from "@/components/page-header";
import { CommissionDetails } from "@/components/commission-details";
import { CommissionForm } from "@/components/commission-form";
import { AuditTrail, HistoryCard } from "@/components/request-meta";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  deleteCommissionClaim,
  resubmitCommissionClaim,
  withdrawCommissionClaim,
} from "../actions";

export const metadata = { title: "Provisionsanspruch" };

export default async function ProvisionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const claim = await db.query.commissionClaims.findFirst({
    where: eq(commissionClaims.id, id),
  });
  // Strikte Trennung: Mitarbeitende sehen nur eigene Ansprüche
  if (!claim || (claim.userId !== user.id && user.role !== "admin"))
    notFound();

  const canEdit =
    claim.userId === user.id &&
    (claim.status === "beanstandet" || claim.status === "zurueckgezogen");
  const canWithdraw =
    claim.userId === user.id &&
    (claim.status === "eingereicht" || claim.status === "beanstandet");
  const canDelete =
    claim.userId === user.id && claim.status === "zurueckgezogen";

  let rates = null;
  if (canEdit) {
    rates = commissionRatesFromSettings(await getSettings());
  }

  const resubmitWithId = resubmitCommissionClaim.bind(null, id);
  const withdrawWithId = withdrawCommissionClaim.bind(null, id);
  const deleteWithId = deleteCommissionClaim.bind(null, id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Provisionsanspruch"
        description={`${BUSINESS_TYPE_LABELS[claim.businessType]} · ${claim.customerName}${
          claim.finalAmountCents != null
            ? ` · ${formatEuro(claim.finalAmountCents)}`
            : ""
        }`}
      />

      <div className="flex items-center gap-3">
        <StatusBadge status={claim.status} />
        <span className="text-sm text-muted-foreground">
          Version {claim.version}
        </span>
      </div>

      {claim.status === "beanstandet" && claim.rejectionComment && (
        <Alert>
          <AlertTitle>Beanstandung</AlertTitle>
          <AlertDescription>{claim.rejectionComment}</AlertDescription>
        </Alert>
      )}

      <CommissionDetails claim={claim} />

      {canWithdraw && (
        <form action={withdrawWithId}>
          <Button type="submit" variant="outline">
            Anspruch zurückziehen
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            Der Anspruch wird aus der Freigabe genommen und kann danach
            korrigiert erneut eingereicht oder endgültig gelöscht werden.
          </p>
        </form>
      )}

      {canDelete && (
        <DeleteRequestButton
          action={deleteWithId}
          description="Der Provisionsanspruch wird unwiderruflich gelöscht. Dieser Schritt kann nicht rückgängig gemacht werden."
        />
      )}

      {canEdit && rates && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Anspruch korrigieren und erneut einreichen
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CommissionForm
              action={resubmitWithId}
              rates={rates}
              defaults={{
                businessType: claim.businessType,
                customerType: claim.customerType,
                customerName: claim.customerName,
                orderDate: claim.orderDate,
                unit: claim.unit,
                quantity: claim.quantity,
                trainingFormat:
                  (claim.trainingFormat as TrainingFormat) ?? undefined,
                trainingCount: claim.trainingCount ?? undefined,
                netOrderValue:
                  claim.netOrderValueCents != null
                    ? (claim.netOrderValueCents / 100)
                        .toFixed(2)
                        .replace(".", ",")
                    : undefined,
                note: claim.note ?? undefined,
              }}
              submitLabel="Korrigiert erneut einreichen"
            />
          </CardContent>
        </Card>
      )}

      <HistoryCard
        requestType="provision"
        requestId={id}
        renderSnapshot={(s) => (
          <p>
            {String(s.customerName)} ·{" "}
            {s.finalAmountCents != null
              ? formatEuro(Number(s.finalAmountCents))
              : "Betrag offen"}
            {s.note ? ` · Bemerkung: ${String(s.note)}` : ""}
          </p>
        )}
      />

      <AuditTrail objectType="provision" objectId={id} />
    </div>
  );
}
