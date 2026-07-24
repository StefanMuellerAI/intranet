import Link from "next/link";
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import {
  db,
  expenseReports,
  fakturaTimeEntries,
  helpfulLinks,
  newsItems,
  vacationRequests,
  workationRequests,
} from "@/db";
import { getCalendarAbsences } from "@/lib/absences";
import { getActiveDeputy, requireUser } from "@/lib/auth";
import { formatDateDE, toISODate } from "@/lib/dates";
import {
  addDaysISO,
  berlinTodayISO,
  currentNow,
  isoWeekOf,
  isoWeekday,
  mondayOfIsoWeek,
} from "@/lib/faktura/zeitfenster";
import { formatEuro } from "@/lib/expenses/calc";
import { getSettings } from "@/lib/settings";
import { getUsedWorkationDays, getVacationAccount } from "@/lib/vacation";
import { DashboardBriefing } from "@/components/dashboard-briefing";
import { DashboardHelpfulLinks } from "@/components/dashboard-helpful-links";
import { DashboardNewsTicker } from "@/components/dashboard-news-ticker";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await requireUser();
  const now = new Date();
  const year = now.getFullYear();
  const todayISO = toISODate(now);
  const briefingEndISO = toISODate(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + 14)
  );
  const settings = await getSettings();
  const deputy = await getActiveDeputy();
  const canApprove = user.role === "admin" || deputy?.id === user.id;

  // Freitags-Erinnerung (E-7): Hinweis, wenn in der laufenden Woche noch
  // keine Zeiten erfasst wurden — ausgewertet in Europe/Berlin, keine E-Mail.
  const berlinToday = berlinTodayISO(currentNow());
  let showFridayReminder = false;
  if (isoWeekday(berlinToday) === 5) {
    const week = isoWeekOf(berlinToday);
    const monday = mondayOfIsoWeek(week.isoYear, week.isoWeek);
    const weekEntries = await db
      .select({ id: fakturaTimeEntries.id })
      .from(fakturaTimeEntries)
      .where(
        and(
          eq(fakturaTimeEntries.userId, user.id),
          eq(fakturaTimeEntries.deleted, false),
          gte(fakturaTimeEntries.entryDate, monday),
          lte(fakturaTimeEntries.entryDate, addDaysISO(monday, 6))
        )
      )
      .limit(1);
    showFridayReminder = weekEntries.length === 0;
  }

  const [
    account,
    usedWorkation,
    myVacations,
    myWorkations,
    myExpenses,
    activeLinks,
    activeNews,
    briefingAbsences,
  ] = await Promise.all([
    getVacationAccount(user, year),
    getUsedWorkationDays(user.id, year),
    db
      .select()
      .from(vacationRequests)
      .where(eq(vacationRequests.userId, user.id))
      .orderBy(desc(vacationRequests.createdAt))
      .limit(5),
    db
      .select()
      .from(workationRequests)
      .where(eq(workationRequests.userId, user.id))
      .orderBy(desc(workationRequests.createdAt))
      .limit(5),
    db
      .select()
      .from(expenseReports)
      .where(eq(expenseReports.userId, user.id))
      .orderBy(desc(expenseReports.createdAt))
      .limit(5),
    db
      .select()
      .from(helpfulLinks)
      .where(eq(helpfulLinks.active, true))
      .orderBy(asc(helpfulLinks.sortOrder), asc(helpfulLinks.title)),
    db
      .select()
      .from(newsItems)
      .where(eq(newsItems.active, true))
      .orderBy(desc(newsItems.createdAt))
      .limit(10),
    getCalendarAbsences(user, todayISO, briefingEndISO),
  ]);

  let openApprovals: { label: string; href: string; status: string }[] = [];
  if (canApprove) {
    const OPEN = ["eingereicht", "storno_beantragt"] as const;
    const [v, w, e] = await Promise.all([
      db
        .select()
        .from(vacationRequests)
        .where(inArray(vacationRequests.status, [...OPEN])),
      db
        .select()
        .from(workationRequests)
        .where(inArray(workationRequests.status, [...OPEN])),
      db
        .select()
        .from(expenseReports)
        .where(inArray(expenseReports.status, [...OPEN])),
    ]);
    openApprovals = [
      ...v.map((r) => ({
        label: `Urlaub · ${formatDateDE(r.startDate)} – ${formatDateDE(r.endDate)}`,
        href: `/freigaben/urlaub/${r.id}`,
        status: r.status,
      })),
      ...w.map((r) => ({
        label: `Workation · ${r.city}, ${r.country}`,
        href: `/freigaben/workation/${r.id}`,
        status: r.status,
      })),
      ...e.map((r) => ({
        label: `Reisekosten · ${r.destination} (${formatEuro(r.totalCents)})`,
        href: `/freigaben/reisekosten/${r.id}`,
        status: r.status,
      })),
    ];
  }

  const myRequests = [
    ...myVacations.map((r) => ({
      href: `/urlaub/${r.id}`,
      label: `Urlaub · ${formatDateDE(r.startDate)} – ${formatDateDE(r.endDate)} (${r.days} Tage)`,
      status: r.status,
      createdAt: r.createdAt,
    })),
    ...myWorkations.map((r) => ({
      href: `/workation/${r.id}`,
      label: `Workation · ${r.city}, ${r.country}`,
      status: r.status,
      createdAt: r.createdAt,
    })),
    ...myExpenses.map((r) => ({
      href: `/reisekosten/${r.id}`,
      label: `Reisekosten · ${r.destination} (${formatEuro(r.totalCents)})`,
      status: r.status,
      createdAt: r.createdAt,
    })),
  ]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 8);

  return (
    <div>
      <PageHeader
        title={`Willkommen, ${user.firstName}!`}
        description="Ihr Überblick über Anträge, Kontingente und Abwesenheiten"
      />

      {showFridayReminder && (
        <div
          data-testid="freitags-erinnerung"
          className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border-2 border-amber-400 bg-amber-50 p-4 dark:border-amber-600 dark:bg-amber-950"
        >
          <div>
            <p className="font-semibold">
              Du hast diese Woche noch keine Zeiten gebucht
            </p>
            <p className="text-sm text-muted-foreground">
              Bitte erfasse deine Projektzeiten für die laufende Kalenderwoche
              — das Buchungsfenster schließt am Samstag um 00:00 Uhr.
            </p>
          </div>
          <Link
            href="/faktura"
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
          >
            Jetzt Zeiten buchen
          </Link>
        </div>
      )}

      <DashboardBriefing
        absences={briefingAbsences}
        todayISO={todayISO}
        rangeEndISO={briefingEndISO}
      />

      <div className="mb-6 grid gap-4 grid-cols-2 sm:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-normal">
              Resturlaub {year}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {account.remaining}{" "}
            <span className="text-sm font-normal text-muted-foreground">
              / {account.entitlement} Tagen
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-normal">
              Workation-Kontingent
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {settings.workationYearlyLimitDays - usedWorkation}{" "}
            <span className="text-sm font-normal text-muted-foreground">
              / {settings.workationYearlyLimitDays} AT
            </span>
          </CardContent>
        </Card>
        <Card className="col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-normal">
              Schnellzugriff
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 text-sm">
            <Link className="underline underline-offset-4" href="/urlaub/neu">
              Urlaub beantragen
            </Link>
            <span className="text-muted-foreground">·</span>
            <Link
              className="underline underline-offset-4"
              href="/workation/neu"
            >
              Workation beantragen
            </Link>
            <span className="text-muted-foreground">·</span>
            <Link
              className="underline underline-offset-4"
              href="/reisekosten/neu"
            >
              Reisekosten abrechnen
            </Link>
            <span className="text-muted-foreground">·</span>
            <Link
              className="underline underline-offset-4"
              href="/krankmeldung/neu"
            >
              Krank melden
            </Link>
            <span className="text-muted-foreground">·</span>
            <Link className="underline underline-offset-4" href="/faktura">
              Zeiten buchen
            </Link>
          </CardContent>
        </Card>
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <DashboardHelpfulLinks links={activeLinks} />
        <DashboardNewsTicker items={activeNews} />
      </div>

      {canApprove && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">
              Offene Freigaben ({openApprovals.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {openApprovals.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Keine offenen Anträge.
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {openApprovals.map((r) => (
                  <li
                    key={r.href}
                    className="flex items-center justify-between gap-3"
                  >
                    <Link
                      href={r.href}
                      className="underline underline-offset-4"
                    >
                      {r.label}
                    </Link>
                    <StatusBadge status={r.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Meine letzten Anträge</CardTitle>
        </CardHeader>
        <CardContent>
          {myRequests.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Noch keine Anträge vorhanden.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {myRequests.map((r) => (
                <li
                  key={r.href}
                  className="flex items-center justify-between gap-3"
                >
                  <Link href={r.href} className="underline underline-offset-4">
                    {r.label}
                  </Link>
                  <StatusBadge status={r.status} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
