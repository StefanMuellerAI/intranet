import { requireUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { getUsedWorkationDays } from "@/lib/vacation";
import { PageHeader } from "@/components/page-header";
import { WorkationForm } from "@/components/workation-form";
import { submitWorkationRequest } from "../actions";

export const metadata = { title: "Workation beantragen" };

export default async function NeueWorkationPage() {
  const user = await requireUser();
  const settings = await getSettings();
  const year = new Date().getFullYear();
  const used = await getUsedWorkationDays(user.id, year);

  return (
    <div>
      <PageHeader
        title="Workation beantragen"
        description="Antrag und Einzelvereinbarung gemäß Anlage 1 der Workation-Richtlinie"
      />
      <WorkationForm
        action={submitWorkationRequest}
        usedWorkDaysThisYear={used}
        yearlyLimitDays={settings.workationYearlyLimitDays}
        consecutiveLimitDays={settings.workationConsecutiveLimitDays}
        submitLabel="Antrag einreichen"
      />
    </div>
  );
}
