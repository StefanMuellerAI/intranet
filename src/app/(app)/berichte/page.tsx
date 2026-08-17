import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { formatDateDE } from "@/lib/dates";
import {
  FEEDBACK_SCALE_HINT,
  SEMINAR_REPORT_KIND_LABELS,
  averageRating,
  formatDurationDays,
} from "@/lib/seminar-reports";
import { listMySeminarReports } from "@/lib/seminar-reports-store";
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

export const metadata = { title: "Berichte" };

export default async function BerichtePage() {
  const user = await requireUser();
  const year = new Date().getFullYear();
  const reports = await listMySeminarReports(user.id);

  const thisYear = reports.filter((report) =>
    report.eventDate.startsWith(String(year))
  );
  const average = averageRating(reports.map((report) => report.feedbackRating));
  const quoteTotal = reports.reduce((sum, report) => sum + report.quoteCount, 0);

  return (
    <div>
      <PageHeader
        title="Berichte"
        description="Eigene Berichte zu gehaltenen Seminaren und Beratungen"
        action={{ href: "/berichte/neu", label: "Bericht erfassen" }}
      />
      <BerichteNav isAdmin={user.role === "admin"} />

      <div className="mb-6 grid gap-4 grid-cols-2 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-normal">
              Berichte {year}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {thisYear.length}
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
              Gesammelte Zitate
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {quoteTotal}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Meine Berichte</CardTitle>
        </CardHeader>
        <CardContent>
          {reports.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Noch keine Berichte erfasst.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Datum</TableHead>
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
