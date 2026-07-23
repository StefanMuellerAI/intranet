import { requireUser } from "@/lib/auth";
import { commissionRatesFromSettings, getSettings } from "@/lib/settings";
import { PageHeader } from "@/components/page-header";
import { CommissionForm } from "@/components/commission-form";
import { Card, CardContent } from "@/components/ui/card";
import { submitCommissionClaim } from "../actions";

export const metadata = { title: "Provisionsanspruch einreichen" };

export default async function ProvisionNeuPage() {
  await requireUser();
  const settings = await getSettings();
  const rates = commissionRatesFromSettings(settings);

  return (
    <div>
      <PageHeader
        title="Provisionsanspruch einreichen"
        description="Folgegeschäft aus Beratung oder Schulung melden — der Anspruch wird nach den vereinbarten Sätzen berechnet und von der Geschäftsführung freigegeben"
      />
      <Card>
        <CardContent className="pt-6">
          <CommissionForm
            action={submitCommissionClaim}
            rates={rates}
            submitLabel="Anspruch einreichen"
          />
        </CardContent>
      </Card>
    </div>
  );
}
