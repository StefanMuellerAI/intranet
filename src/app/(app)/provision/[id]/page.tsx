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
import { PageHeader } from "@/components/page-header";
import { CommissionDetails } from "@/components/commission-details";
import { CommissionForm } from "@/components/commission-form";
import { AuditTrail, HistoryCard } from "@/components/request-meta";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { resubmitCommissionClaim } from "../actions";

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

  const canEdit = claim.userId === user.id && claim.status === "beanstandet";

  let rates = null;
  if (canEdit) {
    rates = commissionRatesFromSettings(await getSettings());
  }

  const resubmitWithId = resubmitCommissionClaim.bind(null, id);

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
