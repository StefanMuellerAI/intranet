import { requireUser } from "@/lib/auth";
import { listCustomerSuggestions } from "@/lib/seminar-reports-store";
import { BerichtForm } from "@/components/berichte/bericht-form";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { submitSeminarReport } from "../actions";

export const metadata = { title: "Bericht erfassen" };

export default async function BerichtNeuPage() {
  await requireUser();
  const customerSuggestions = await listCustomerSuggestions();

  return (
    <div>
      <PageHeader
        title="Bericht erfassen"
        description="Rückblick auf ein gehaltenes Seminar oder eine Beratung — inklusive anonymer Zitate von Teilnehmenden"
      />
      <Card>
        <CardContent className="pt-6">
          <BerichtForm
            action={submitSeminarReport}
            customerSuggestions={customerSuggestions}
            submitLabel="Bericht speichern"
          />
        </CardContent>
      </Card>
    </div>
  );
}
