import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db, expenseItems, expenseReports, receipts } from "@/db";
import { requireUser } from "@/lib/auth";
import { formatDateDE } from "@/lib/dates";
import { formatEuro, type MealDayInput, type AbsenceType } from "@/lib/expenses/calc";
import { getSettings, ratesFromSettings } from "@/lib/settings";
import { ExpenseDetails } from "@/components/expense-details";
import { ExpenseForm, type ExpenseFormDefaults } from "@/components/expense-form";
import { PageHeader } from "@/components/page-header";
import { AuditTrail, HistoryCard } from "@/components/request-meta";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { resubmitExpenseReport } from "../actions";

export const metadata = { title: "Reisekostenabrechnung" };

export default async function AbrechnungDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const report = await db.query.expenseReports.findFirst({
    where: eq(expenseReports.id, id),
  });
  if (!report || (report.userId !== user.id && user.role !== "admin"))
    notFound();

  const [items, receiptRows] = await Promise.all([
    db
      .select()
      .from(expenseItems)
      .where(eq(expenseItems.reportId, id))
      .orderBy(asc(expenseItems.position)),
    db.select().from(receipts).where(eq(receipts.reportId, id)),
  ]);

  const canEdit = report.userId === user.id && report.status === "beanstandet";

  let editDefaults: ExpenseFormDefaults | null = null;
  let editRates = null;
  if (canEdit) {
    const settings = await getSettings();
    editRates = ratesFromSettings(settings);
    const belegDefaults = (kind: string) =>
      items
        .filter((i) => i.kind === kind)
        .map((i) => {
          const receipt = receiptRows.find((r) => r.itemId === i.id);
          return {
            date: i.itemDate ?? "",
            description: i.description ?? "",
            amountCents: i.amountCents ?? 0,
            receiptId: receipt?.id,
            receiptName: receipt?.filename,
          };
        });
    const carRow = items.find((i) => i.kind === "pkw");
    editDefaults = {
      destination: report.destination,
      customerPurpose: report.customerPurpose,
      departureDate: report.departureDate,
      departureTime: report.departureTime,
      returnDate: report.returnDate,
      returnTime: report.returnTime,
      isAbroad: report.isAbroad,
      mealDays: items
        .filter((i) => i.kind === "verpflegung")
        .map(
          (i): MealDayInput => ({
            date: i.itemDate ?? "",
            absenceType: (i.absenceType ?? "unter_8_std") as AbsenceType,
            breakfastProvided: i.breakfastProvided,
            lunchProvided: i.lunchProvided,
            dinnerProvided: i.dinnerProvided,
          })
        ),
      transport: belegDefaults("fahrt"),
      carKilometers: carRow?.kilometers ?? 0,
      carPassengers: carRow?.passengers ?? 0,
      lodging: belegDefaults("uebernachtung"),
      incidentals: belegDefaults("nebenkosten"),
    };
  }

  const resubmitWithId = resubmitExpenseReport.bind(null, id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reisekostenabrechnung"
        description={`${report.destination} (${report.customerPurpose}) · ${formatDateDE(report.departureDate)} bis ${formatDateDE(report.returnDate)} · ${formatEuro(report.totalCents)}`}
      />

      <div className="flex items-center gap-3">
        <StatusBadge status={report.status} />
        <span className="text-sm text-muted-foreground">
          Version {report.version}
        </span>
      </div>

      {report.status === "beanstandet" && report.rejectionComment && (
        <Alert>
          <AlertTitle>Beanstandung</AlertTitle>
          <AlertDescription>{report.rejectionComment}</AlertDescription>
        </Alert>
      )}

      {canEdit && editDefaults && editRates ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Abrechnung korrigieren und erneut einreichen
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ExpenseForm
              action={resubmitWithId}
              rates={editRates}
              defaults={editDefaults}
              submitLabel="Korrigiert erneut einreichen"
            />
          </CardContent>
        </Card>
      ) : (
        <ExpenseDetails report={report} items={items} receipts={receiptRows} />
      )}

      <HistoryCard
        requestType="reisekosten"
        requestId={id}
        renderSnapshot={(s) => (
          <p>
            {String(s.destination)} ({String(s.customerPurpose)}) ·{" "}
            {formatDateDE(String(s.departureDate))} –{" "}
            {formatDateDE(String(s.returnDate))} · Gesamterstattung{" "}
            {formatEuro(Number(s.totalCents))}
          </p>
        )}
      />

      <AuditTrail objectType="reisekosten" objectId={id} />
    </div>
  );
}
