import Link from "next/link";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import {
  db,
  fakturaCustomers,
  fakturaProjects,
  fakturaTimeEntries,
} from "@/db";
import { requireUser } from "@/lib/auth";
import { formatDateDE } from "@/lib/dates";
import { getWeekApproval } from "@/lib/faktura/freigabe";
import { customerProjectLabel } from "@/lib/faktura/stammdaten";
import {
  addDaysISO,
  berlinTodayISO,
  currentNow,
  formatIsoWeek,
  formatMinutesAsHours,
  isoWeekOf,
  isoWeekday,
  mondayOfIsoWeek,
  validateBookingDate,
  weekdaysOfIsoWeek,
} from "@/lib/faktura/zeitfenster";
import { FakturaNav } from "@/components/faktura/faktura-nav";
import {
  Zeiterfassung,
  type DayView,
  type ProjectOption,
} from "@/components/faktura/zeiterfassung";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Faktura — Zeiterfassung" };

const WEEKDAY_LABELS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag"];

export default async function FakturaPage({
  searchParams,
}: {
  searchParams: Promise<{ jahr?: string; kw?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const todayISO = berlinTodayISO(currentNow());
  const currentWeek = isoWeekOf(todayISO);
  const isoYear = Number(params.jahr) || currentWeek.isoYear;
  const isoWeek = Number(params.kw) || currentWeek.isoWeek;

  const monday = mondayOfIsoWeek(isoYear, isoWeek);
  const sunday = addDaysISO(monday, 6);
  const weekdays = weekdaysOfIsoWeek(isoYear, isoWeek);

  const [entries, approval, projects, customers] = await Promise.all([
    db
      .select()
      .from(fakturaTimeEntries)
      .where(
        and(
          eq(fakturaTimeEntries.userId, user.id),
          eq(fakturaTimeEntries.deleted, false),
          gte(fakturaTimeEntries.entryDate, monday),
          lte(fakturaTimeEntries.entryDate, sunday)
        )
      )
      .orderBy(asc(fakturaTimeEntries.entryDate), asc(fakturaTimeEntries.createdAt)),
    getWeekApproval(isoYear, isoWeek),
    db.select().from(fakturaProjects).orderBy(asc(fakturaProjects.name)),
    db.select().from(fakturaCustomers).orderBy(asc(fakturaCustomers.name)),
  ]);

  const weekApproved = approval?.status === "freigegeben";

  const projectLabel = (projectId: string) => {
    const project = projects.find((p) => p.id === projectId);
    const customer = project
      ? customers.find((c) => c.id === project.customerId)
      : undefined;
    return customerProjectLabel(
      customer?.name ?? "Unbekannt",
      project?.name ?? "Unbekannt"
    );
  };

  // Alle Mitarbeitenden dürfen auf alle aktiven Projekte buchen (E-5)
  const projectOptions: ProjectOption[] = projects
    .filter(
      (p) => p.active && customers.find((c) => c.id === p.customerId)?.active
    )
    .map((p) => ({
      id: p.id,
      label: projectLabel(p.id),
      validFrom: p.validFrom,
      validTo: p.validTo,
      hasLimit: p.monthlyLimitMinutes != null,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "de"));

  const days: DayView[] = weekdays.map((dateISO, i) => {
    const dayEntries = entries.filter((e) => e.entryDate === dateISO);
    return {
      dateISO,
      label: `${WEEKDAY_LABELS[i]}, ${formatDateDE(dateISO)}`,
      totalHours: formatMinutesAsHours(
        dayEntries.reduce((s, e) => s + e.durationMinutes, 0)
      ),
      entries: dayEntries.map((e) => ({
        id: e.id,
        projectId: e.projectId,
        projectLabel: projectLabel(e.projectId),
        entryDate: e.entryDate,
        durationHours: formatMinutesAsHours(e.durationMinutes),
        description: e.description,
        status: e.status,
        visibleOnTimesheet: e.visibleOnTimesheet,
        overbooked: e.overbooked,
        editable:
          e.status === "offen" &&
          !weekApproved &&
          validateBookingDate(e.entryDate, currentNow()).ok,
      })),
    };
  });

  const bookingOpen =
    !weekApproved &&
    isoYear === currentWeek.isoYear &&
    isoWeek === currentWeek.isoWeek &&
    isoWeekday(todayISO) <= 5;

  const prevWeek = isoWeekOf(addDaysISO(monday, -7));
  const nextWeek = isoWeekOf(addDaysISO(monday, 7));
  const isCurrentWeek =
    isoYear === currentWeek.isoYear && isoWeek === currentWeek.isoWeek;

  return (
    <div>
      <PageHeader
        title="Zeiterfassung"
        description="Projektbezogene Zeitbuchungen im 15-Minuten-Raster. Buchbar sind der aktuelle Tag und zurückliegende Werktage der laufenden Kalenderwoche."
      />
      {user.role === "admin" && <FakturaNav />}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          render={
            <Link
              href={`/faktura?jahr=${prevWeek.isoYear}&kw=${prevWeek.isoWeek}`}
            />
          }
        >
          ← Vorwoche
        </Button>
        <span className="text-sm font-medium">
          {formatIsoWeek({ isoYear, isoWeek })} ({formatDateDE(monday)} –{" "}
          {formatDateDE(addDaysISO(monday, 4))})
        </span>
        {!isCurrentWeek && (
          <Button
            variant="outline"
            size="sm"
            render={
              <Link
                href={`/faktura?jahr=${nextWeek.isoYear}&kw=${nextWeek.isoWeek}`}
              />
            }
          >
            Folgewoche →
          </Button>
        )}
        {!isCurrentWeek && (
          <Button variant="ghost" size="sm" render={<Link href="/faktura" />}>
            Aktuelle Woche
          </Button>
        )}
      </div>

      <Zeiterfassung
        days={days}
        weekTotalHours={formatMinutesAsHours(
          entries.reduce((s, e) => s + e.durationMinutes, 0)
        )}
        weekApproved={weekApproved}
        bookingOpen={bookingOpen}
        defaultDate={bookingOpen ? todayISO : ""}
        projects={projectOptions}
      />
    </div>
  );
}
