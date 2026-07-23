import type { CommissionClaim } from "@/db";
import {
  BUSINESS_TYPE_LABELS,
  CUSTOMER_TYPE_LABELS,
  TRAINING_FORMAT_LABELS,
  UNIT_LABELS,
} from "@/lib/commissions/calc";
import { formatDateDE } from "@/lib/dates";
import { formatEuro } from "@/lib/expenses/calc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function CommissionDetails({ claim }: { claim: CommissionClaim }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Angaben zum Folgegeschäft</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Art</dt>
            <dd>{BUSINESS_TYPE_LABELS[claim.businessType]}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Kundenart</dt>
            <dd>{CUSTOMER_TYPE_LABELS[claim.customerType]}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Kunde / Organisation</dt>
            <dd>{claim.customerName}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Datum der Bestellung</dt>
            <dd>{formatDateDE(claim.orderDate)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Umfang</dt>
            <dd>
              {claim.quantity} {UNIT_LABELS[claim.unit]}
            </dd>
          </div>
          {claim.businessType === "schulung" ? (
            <div>
              <dt className="text-muted-foreground">Trainings</dt>
              <dd>
                {claim.trainingCount ?? "—"} ×{" "}
                {claim.trainingFormat
                  ? TRAINING_FORMAT_LABELS[claim.trainingFormat]
                  : "—"}
              </dd>
            </div>
          ) : (
            <div>
              <dt className="text-muted-foreground">Nettoauftragswert</dt>
              <dd>
                {claim.netOrderValueCents != null
                  ? formatEuro(claim.netOrderValueCents)
                  : "—"}
              </dd>
            </div>
          )}
          <div>
            <dt className="text-muted-foreground">Berechneter Anspruch</dt>
            <dd>
              {claim.calculatedAmountCents != null
                ? formatEuro(claim.calculatedAmountCents)
                : "individuell zu vereinbaren"}
            </dd>
          </div>
          {claim.customerType === "neukunde" && (
            <div>
              <dt className="text-muted-foreground">
                Vermittlungsprovision (Einzelfall)
              </dt>
              <dd>
                {claim.referralBonusCents != null
                  ? formatEuro(claim.referralBonusCents)
                  : "noch nicht festgelegt"}
              </dd>
            </div>
          )}
          <div>
            <dt className="text-muted-foreground">Finaler Betrag</dt>
            <dd className="font-medium">
              {claim.finalAmountCents != null
                ? formatEuro(claim.finalAmountCents)
                : "noch offen"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Bemerkung</dt>
            <dd>{claim.note || "—"}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
