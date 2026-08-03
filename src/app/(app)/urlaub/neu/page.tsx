import { eq, ne, and } from "drizzle-orm";
import { db, users } from "@/db";
import { fullName, requireUser } from "@/lib/auth";
import { toISODate } from "@/lib/dates";
import { getOverlappingAbsences, getVacationAccount } from "@/lib/vacation";
import { PageHeader } from "@/components/page-header";
import { VacationForm } from "@/components/vacation-form";
import { submitVacationRequest } from "../actions";

export const metadata = { title: "Urlaub beantragen" };

export default async function NeuerUrlaubPage() {
  const user = await requireUser();
  const year = new Date().getFullYear();
  const account = await getVacationAccount(user, year);
  // Anträge über den Jahreswechsel hinaus rechnen gegen den Anspruch des
  // Folgejahres — im Eintrittsjahr sind das andere Werte als im laufenden Jahr.
  const nextYearAccount = await getVacationAccount(user, year + 1);
  const colleagues = await db
    .select()
    .from(users)
    .where(and(ne(users.id, user.id), eq(users.status, "aktiv")));

  // Alle genehmigten Abwesenheiten anderer im laufenden und nächsten Jahr
  const absences = await getOverlappingAbsences(
    user.id,
    `${year}-01-01`,
    `${year + 1}-12-31`
  );

  return (
    <div>
      <PageHeader
        title="Urlaub beantragen"
        description={`Resturlaub ${year}: ${account.remaining} Tage (Stand ${toISODate(new Date())})`}
      />
      <VacationForm
        action={submitVacationRequest}
        users={colleagues.map((c) => ({ id: c.id, name: fullName(c) }))}
        remainingDays={account.remaining}
        remainingByYear={{
          [year]: account.remaining,
          [year + 1]: nextYearAccount.remaining,
        }}
        minDate={user.entryDate ?? undefined}
        absences={absences}
        submitLabel="Antrag einreichen"
      />
    </div>
  );
}
