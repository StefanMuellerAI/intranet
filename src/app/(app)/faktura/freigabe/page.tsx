import { asc } from "drizzle-orm";
import { db, fakturaCustomers, fakturaProjects, users } from "@/db";
import { fullName, requireAdmin } from "@/lib/auth";
import { formatDateDE } from "@/lib/dates";
import { getWeekOverview, listRecentWeeks } from "@/lib/faktura/freigabe";
import { customerProjectLabel } from "@/lib/faktura/stammdaten";
import {
  addDaysISO,
  berlinTodayISO,
  currentNow,
  formatIsoWeek,
  formatMinutesAsHours,
  isWeekClosed,
  isoWeekOf,
} from "@/lib/faktura/zeitfenster";
import { FakturaNav } from "@/components/faktura/faktura-nav";
import {
  FreigabeAdmin,
  WeekNav,
  type FreigabeCustomerView,
  type FreigabeWeekView,
} from "@/components/faktura/freigabe-admin";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Faktura — Wochenfreigabe" };

export default async function FakturaFreigabePage({
  searchParams,
}: {
  searchParams: Promise<{ jahr?: string; kw?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;

  // Default: die zuletzt abgeschlossene Woche (freigebbar ab Samstag 00:00)
  const todayISO = berlinTodayISO(currentNow());
  const currentWeek = isoWeekOf(todayISO);
  const defaultWeek = isWeekClosed(
    currentWeek.isoYear,
    currentWeek.isoWeek,
    currentNow()
  )
    ? currentWeek
    : isoWeekOf(addDaysISO(todayISO, -7));

  const isoYear = Number(params.jahr) || defaultWeek.isoYear;
  const isoWeek = Number(params.kw) || defaultWeek.isoWeek;

  const [overview, weeks, allUsers, allProjects, allCustomers] =
    await Promise.all([
      getWeekOverview(isoYear, isoWeek),
      listRecentWeeks(8),
      db.select().from(users).orderBy(asc(users.lastName)),
      db.select().from(fakturaProjects).orderBy(asc(fakturaProjects.name)),
      db.select().from(fakturaCustomers).orderBy(asc(fakturaCustomers.name)),
    ]);

  const week: FreigabeWeekView = {
    isoYear,
    isoWeek,
    weekLabel: formatIsoWeek({ isoYear, isoWeek }),
    rangeLabel: `${formatDateDE(overview.mondayISO)} – ${formatDateDE(overview.fridayISO)}`,
    closed: overview.closed,
    empty: overview.empty,
    approvalStatus: overview.approval?.status ?? null,
    approvedInfo:
      overview.approval?.status === "freigegeben" && overview.approval.approvedAt
        ? `Freigegeben am ${overview.approval.approvedAt.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })}`
        : overview.approval?.status === "widerrufen" &&
            overview.approval.revokeReason
          ? `Widerrufen: ${overview.approval.revokeReason}`
          : null,
    totalHours: formatMinutesAsHours(overview.totalMinutes),
    overbookedCount: overview.overbookedCount,
  };

  const customers: FreigabeCustomerView[] = overview.customers.map((c) => ({
    customerId: c.customerId,
    customerName: c.customerName,
    totalHours: formatMinutesAsHours(c.totalMinutes),
    projects: c.projects.map((p) => ({
      projectId: p.projectId,
      label: customerProjectLabel(c.customerName, p.projectName),
      totalHours: formatMinutesAsHours(p.totalMinutes),
      limitHours:
        p.monthlyLimitMinutes != null
          ? formatMinutesAsHours(p.monthlyLimitMinutes)
          : null,
      entries: p.entries.map((e) => ({
        id: e.id,
        userId: e.userId,
        userName: e.userName,
        projectId: e.projectId,
        entryDate: e.entryDate,
        dateLabel: formatDateDE(e.entryDate),
        durationHours: formatMinutesAsHours(e.durationMinutes),
        description: e.description,
        status: e.status,
        visibleOnTimesheet: e.visibleOnTimesheet,
        overbooked: e.overbooked,
      })),
    })),
  }));

  const projectOptions = allProjects
    .filter(
      (p) =>
        p.active && allCustomers.find((c) => c.id === p.customerId)?.active
    )
    .map((p) => ({
      id: p.id,
      label: customerProjectLabel(
        allCustomers.find((c) => c.id === p.customerId)?.name ?? "Unbekannt",
        p.name
      ),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "de"));

  const employees = allUsers
    .filter((u) => u.status !== "deaktiviert")
    .map((u) => ({ id: u.id, name: fullName(u) }));

  return (
    <div data-page-width="wide">
      <PageHeader
        title="Wochenfreigabe"
        description="Alle Buchungen aller Mitarbeitenden je Kalenderwoche — gruppiert nach Kunde, Projekt und Tag. Freigaben erfolgen immer für die gesamte Woche."
      />
      <FakturaNav />
      <WeekNav
        weeks={weeks.map((w) => ({
          isoYear: w.isoYear,
          isoWeek: w.isoWeek,
          label: formatIsoWeek({ isoYear: w.isoYear, isoWeek: w.isoWeek }),
          status: w.status,
          overbookedCount: w.overbookedCount,
        }))}
        activeYear={isoYear}
        activeWeek={isoWeek}
      />
      <FreigabeAdmin
        week={week}
        customers={customers}
        projects={projectOptions}
        employees={employees}
      />
    </div>
  );
}
