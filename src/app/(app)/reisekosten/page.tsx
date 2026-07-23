import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, expenseReports } from "@/db";
import { requireUser } from "@/lib/auth";
import { formatDateDE } from "@/lib/dates";
import { formatEuro } from "@/lib/expenses/calc";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata = { title: "Reisekosten" };

export default async function ReisekostenPage() {
  const user = await requireUser();
  const reports = await db
    .select()
    .from(expenseReports)
    .where(eq(expenseReports.userId, user.id))
    .orderBy(desc(expenseReports.createdAt));

  return (
    <div>
      <PageHeader
        title="Reisekosten"
        description="Abrechnung gemäß Reisekostenrichtlinie — Einreichung bis zum 5. des Folgemonats"
        action={{ href: "/reisekosten/neu", label: "Abrechnung erstellen" }}
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Meine Abrechnungen</CardTitle>
        </CardHeader>
        <CardContent>
          {reports.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Noch keine Reisekostenabrechnungen vorhanden.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reise</TableHead>
                  <TableHead className="hidden sm:table-cell">
                    Zeitraum
                  </TableHead>
                  <TableHead className="text-right">Erstattung</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      {r.destination}{" "}
                      <span className="text-muted-foreground">
                        ({r.customerPurpose})
                      </span>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {formatDateDE(r.departureDate)} –{" "}
                      {formatDateDE(r.returnDate)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatEuro(r.totalCents)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/reisekosten/${r.id}`}
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
