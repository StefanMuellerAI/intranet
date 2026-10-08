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
  const [used, usedNextYear] = await Promise.all([
    getUsedWorkationDays(user.id, year),
    getUsedWorkationDays(user.id, year + 1),
  ]);

  return (
    <div>
      <PageHeader
        title="Workation beantragen"
        description="Antrag und Einzelvereinbarung gemäß Anlage 1 der Workation-Richtlinie"
      />
      <WorkationForm
        action={submitWorkationRequest}
        usedWorkDaysThisYear={used}
        usedWorkDaysByYear={{ [year]: used, [year + 1]: usedNextYear }}
        yearlyLimitDays={settings.workationYearlyLimitDays}
        consecutiveLimitDays={settings.workationConsecutiveLimitDays}
        submitLabel="Antrag einreichen"
      />
    </div>
  );
}
