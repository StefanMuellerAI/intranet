import Link from "next/link";
import { asc } from "drizzle-orm";
import { db, users } from "@/db";
import { fullName, requireAdmin } from "@/lib/auth";
import { formatDateDE } from "@/lib/dates";
import {
  FEEDBACK_SCALE_HINT,
  SEMINAR_REPORT_KINDS,
  SEMINAR_REPORT_KIND_LABELS,
  averageRating,
  formatDurationDays,
  type SeminarReportKind,
} from "@/lib/seminar-reports";
import {
  REPORT_SORT_ORDERS,
  listSeminarReports,
  type ReportSortOrder,
} from "@/lib/seminar-reports-store";
import { BerichteFilter } from "@/components/berichte/berichte-filter";
import { BerichteNav } from "@/components/berichte/berichte-nav";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata = { title: "Alle Berichte" };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

interface SearchParams {
  mitarbeiter?: string;
  art?: string;
  von?: string;
  bis?: string;
  sortierung?: string;
}

function isoOrEmpty(value: string | undefined): string {
  return value && ISO_DATE.test(value) ? value : "";
}

/** Link auf dieselbe Seite mit geänderter Sortierung, Filter bleiben erhalten. */
function sortHref(params: SearchParams, sort: ReportSortOrder): string {
  const query = new URLSearchParams();
  if (params.mitarbeiter) query.set("mitarbeiter", params.mitarbeiter);
  if (params.art) query.set("art", params.art);
  if (params.von) query.set("von", params.von);
  if (params.bis) query.set("bis", params.bis);
  query.set("sortierung", sort);
  return `/berichte/alle?${query.toString()}`;
}

export default async function AlleBerichtePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAdmin();
  const params = await searchParams;

  const sort: ReportSortOrder = (
    REPORT_SORT_ORDERS as readonly string[]
  ).includes(params.sortierung ?? "")
    ? (params.sortierung as ReportSortOrder)
    : "datum_neu";
  const kind = (SEMINAR_REPORT_KINDS as readonly string[]).includes(
    params.art ?? ""
  )
    ? (params.art as SeminarReportKind)
    : undefined;
  const from = isoOrEmpty(params.von);
  const to = isoOrEmpty(params.bis);

  const [reports, allUsers] = await Promise.all([
    listSeminarReports({
      userId: params.mitarbeiter || undefined,
      kind,
      from: from || undefined,
      to: to || undefined,
      sort,
    }),
    db.select().from(users).orderBy(asc(users.lastName)),
  ]);

  const employees = allUsers.map((employee) => ({
    id: employee.id,
    name: fullName(employee),
  }));
  const average = averageRating(reports.map((report) => report.feedbackRating));
  const quoteTotal = reports.reduce((sum, report) => sum + report.quoteCount, 0);

  const nextDateSort: ReportSortOrder =
    sort === "datum_neu" ? "datum_alt" : "datum_neu";

  return (
    <div>
      <PageHeader
        title="Alle Berichte"
        description="Berichte aller Mitarbeitenden zu Seminaren und Beratungen"
      />
      <BerichteNav isAdmin />

      <BerichteFilter
        employees={employees}
        values={{
          mitarbeiter: params.mitarbeiter ?? "",
          art: kind ?? "",
          von: from,
          bis: to,
          sortierung: sort,
        }}
      />

      <div className="mb-6 grid gap-4 grid-cols-2 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-normal">
              Berichte in der Auswahl
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {reports.length}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-normal">
              Ø Feedback
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              {average === null
                ? "—"
                : average.toLocaleString("de-DE", {
                    minimumFractionDigits: 1,
                  })}
            </p>
            <p className="text-xs text-muted-foreground">
              {FEEDBACK_SCALE_HINT}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-normal">
              Zitate
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {quoteTotal}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Berichte ({reports.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {reports.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Für diese Auswahl liegen keine Berichte vor.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <Link
                      href={sortHref(params, nextDateSort)}
                      className="underline underline-offset-4"
                    >
                      Datum {sort === "datum_alt" ? "▲" : "▼"}
                    </Link>
                  </TableHead>
                  <TableHead>
                    <Link
                      href={sortHref(params, "mitarbeiter")}
                      className="underline underline-offset-4"
                    >
                      Mitarbeiter/in {sort === "mitarbeiter" ? "▲" : ""}
                    </Link>
                  </TableHead>
                  <TableHead>Art</TableHead>
                  <TableHead>Titel</TableHead>
                  <TableHead className="hidden sm:table-cell">Kunde</TableHead>
                  <TableHead className="hidden sm:table-cell">Dauer</TableHead>
                  <TableHead>Feedback</TableHead>
                  <TableHead className="hidden sm:table-cell">Zitate</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map((report) => (
                  <TableRow key={report.id}>
                    <TableCell>{formatDateDE(report.eventDate)}</TableCell>
                    <TableCell>{report.userName}</TableCell>
                    <TableCell>
                      {SEMINAR_REPORT_KIND_LABELS[report.kind]}
                    </TableCell>
                    <TableCell>{report.title}</TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {report.customerName}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {formatDurationDays(report.durationDays)}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {report.feedbackRating}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell tabular-nums">
                      {report.quoteCount}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/berichte/${report.id}`}
                        className="text-sm underline underline-offset-4"
                      >
                        Details
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
