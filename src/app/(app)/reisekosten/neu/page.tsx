import { requireUser } from "@/lib/auth";
import { getSettings, ratesFromSettings } from "@/lib/settings";
import { ExpenseForm } from "@/components/expense-form";
import { PageHeader } from "@/components/page-header";
import { submitExpenseReport } from "../actions";

export const metadata = { title: "Reisekostenabrechnung erstellen" };

export default async function NeueAbrechnungPage() {
  await requireUser();
  const settings = await getSettings();

  return (
    <div>
      <PageHeader
        title="Reisekostenabrechnung"
        description="Für Essen und Trinken sammeln Sie keine Belege — Sie tragen nur ein, wie lange Sie unterwegs waren und ob jemand anderes eine Mahlzeit bezahlt hat."
      />
      <ExpenseForm
        action={submitExpenseReport}
        rates={ratesFromSettings(settings)}
        submitLabel="Abrechnung einreichen"
      />
    </div>
  );
}
