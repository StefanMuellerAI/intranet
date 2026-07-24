import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getCalendarAbsences, type CalendarAbsence } from "@/lib/absences";
import { isWorkday, toISODate } from "@/lib/dates";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const metadata = { title: "Abwesenheitskalender" };

const TYPE_STYLES: Record<string, { label: string; className: string }> = {
  urlaub: { label: "Urlaub", className: "bg-green-200 text-green-900" },
  workation: { label: "Workation", className: "bg-blue-200 text-blue-900" },
  krank: { label: "Krank", className: "bg-red-200 text-red-900" },
  abwesend: { label: "abwesend", className: "bg-gray-200 text-gray-700" },
  geburtstag: {
    label: "Geburtstag",
    className: "bg-amber-200 text-amber-900",
  },
};

const MONTH_NAMES = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

function MonthGrid({
  year,
  month,
  absences,
  large = false,
}: {
  year: number;
  month: number; // 0-basiert
  absences: CalendarAbsence[];
  large?: boolean;
}) {
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const offset = (first.getDay() + 6) % 7; // Montag = 0

  const cells: (Date | null)[] = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from(
      { length: daysInMonth },
      (_, i) => new Date(year, month, i + 1)
    ),
  ];

  return (
    <div>
      <h3 className="mb-2 font-medium">
        {MONTH_NAMES[month]} {year}
      </h3>
      <div
        className={cn(
          "grid grid-cols-7 gap-px rounded-md border bg-border overflow-hidden",
          large ? "text-sm" : "text-xs"
        )}
      >
        {["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((d) => (
          <div
            key={d}
            className={cn(
              "bg-muted text-center font-medium text-muted-foreground",
              large ? "p-2" : "p-1"
            )}
          >
            {d}
          </div>
        ))}
        {cells.map((date, i) => {
          if (!date)
            return (
              <div
                key={i}
                className={cn("bg-background", large ? "p-2" : "p-1")}
              />
            );
          const iso = toISODate(date);
          const dayAbsences = absences.filter(
            (a) => a.from <= iso && a.to >= iso
          );
          const weekend = !isWorkday(date);
          return (
            <div
              key={i}
              className={cn(
                "bg-background align-top",
                large ? "min-h-24 p-2" : "min-h-14 p-1",
                weekend && "bg-muted/50"
              )}
            >
              <span className="text-muted-foreground">{date.getDate()}</span>
              <div className="mt-0.5 space-y-0.5">
                {dayAbsences.map((a, j) => (
                  <div
                    key={j}
                    title={`${a.userName}: ${TYPE_STYLES[a.type].label}`}
                    className={cn(
                      "truncate rounded px-1 leading-4",
                      TYPE_STYLES[a.type].className
                    )}
                  >
                    {a.userName.split(" ")[0]}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function calendarHref({
  year,
  month,
  yearView,
}: {
  year: number;
  month: number; // 0-basiert
  yearView: boolean;
}) {
  const params = new URLSearchParams({ jahr: String(year) });
  if (yearView) params.set("ansicht", "jahr");
  else params.set("monat", String(month + 1));
  return `/kalender?${params.toString()}`;
}

export default async function KalenderPage({
  searchParams,
}: {
  searchParams: Promise<{ jahr?: string; monat?: string; ansicht?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const now = new Date();
  const year = Number(params.jahr) || now.getFullYear();
  const yearView = params.ansicht === "jahr";
  const parsedMonth = Number(params.monat);
  const month =
    Number.isInteger(parsedMonth) && parsedMonth >= 1 && parsedMonth <= 12
      ? parsedMonth - 1
      : now.getFullYear() === year
        ? now.getMonth()
        : 0;

  const absences = await getCalendarAbsences(
    user,
    `${year}-01-01`,
    `${year}-12-31`
  );

  const months = yearView
    ? Array.from({ length: 12 }, (_, i) => i)
    : [month];

  const prevMonth =
    month === 0
      ? { year: year - 1, month: 11 }
      : { year, month: month - 1 };
  const nextMonth =
    month === 11
      ? { year: year + 1, month: 0 }
      : { year, month: month + 1 };

  return (
    <div>
      <PageHeader
        title="Abwesenheitskalender"
        description="Genehmigte Urlaube, Workations, Krankheitszeiten und Geburtstage aller Mitarbeitenden"
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button
          variant={yearView ? "outline" : "default"}
          size="sm"
          render={
            <Link href={calendarHref({ year, month, yearView: false })} />
          }
        >
          Monatsansicht
        </Button>
        <Button
          variant={yearView ? "default" : "outline"}
          size="sm"
          render={
            <Link href={calendarHref({ year, month, yearView: true })} />
          }
        >
          Jahresansicht
        </Button>
        <span className="mx-2 text-sm text-muted-foreground">|</span>
        {!yearView && (
          <>
            <Button
              variant="outline"
              size="sm"
              render={
                <Link
                  href={calendarHref({
                    year: prevMonth.year,
                    month: prevMonth.month,
                    yearView: false,
                  })}
                />
              }
            >
              ← {MONTH_NAMES[prevMonth.month]}
            </Button>
            <span className="text-sm font-medium">{MONTH_NAMES[month]}</span>
            <Button
              variant="outline"
              size="sm"
              render={
                <Link
                  href={calendarHref({
                    year: nextMonth.year,
                    month: nextMonth.month,
                    yearView: false,
                  })}
                />
              }
            >
              {MONTH_NAMES[nextMonth.month]} →
            </Button>
            <span className="mx-2 text-sm text-muted-foreground">|</span>
          </>
        )}
        <Button
          variant="outline"
          size="sm"
          render={
            <Link
              href={calendarHref({ year: year - 1, month, yearView })}
            />
          }
        >
          ← {year - 1}
        </Button>
        <span className="text-sm font-medium">{year}</span>
        <Button
          variant="outline"
          size="sm"
          render={
            <Link
              href={calendarHref({ year: year + 1, month, yearView })}
            />
          }
        >
          {year + 1} →
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap gap-3 text-xs">
        {Object.entries(TYPE_STYLES)
          .filter(([k]) => (user.role === "admin" ? k !== "abwesend" : k !== "krank"))
          .map(([k, v]) => (
            <span key={k} className="flex items-center gap-1">
              <span className={cn("h-3 w-3 rounded", v.className)} />
              {v.label}
            </span>
          ))}
      </div>

      <Card>
        <CardContent
          className={cn(
            "grid gap-6 pt-6",
            yearView && "md:grid-cols-2 xl:grid-cols-3"
          )}
        >
          {months.map((m) => (
            <MonthGrid
              key={m}
              year={year}
              month={m}
              absences={absences}
              large={!yearView}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
