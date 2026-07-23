import Link from "next/link";
import { asc, inArray } from "drizzle-orm";
import {
  commissionClaims,
  db,
  expenseReports,
  users,
  vacationRequests,
  workationRequests,
} from "@/db";
import { fullName, requireApprover } from "@/lib/auth";
import {
  BUSINESS_TYPE_LABELS,
  CUSTOMER_TYPE_LABELS,
} from "@/lib/commissions/calc";
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

export const metadata = { title: "Freigaben" };

const OPEN = ["eingereicht", "storno_beantragt"] as const;

export default async function FreigabenPage() {
  await requireApprover();

  const [vacations, workations, expenses, commissions, allUsers] =
    await Promise.all([
      db
        .select()
        .from(vacationRequests)
        .where(inArray(vacationRequests.status, [...OPEN]))
        .orderBy(asc(vacationRequests.createdAt)),
      db
        .select()
        .from(workationRequests)
        .where(inArray(workationRequests.status, [...OPEN]))
        .orderBy(asc(workationRequests.createdAt)),
      db
        .select()
        .from(expenseReports)
        .where(inArray(expenseReports.status, [...OPEN]))
        .orderBy(asc(expenseReports.createdAt)),
      db
        .select()
        .from(commissionClaims)
        .where(inArray(commissionClaims.status, [...OPEN]))
        .orderBy(asc(commissionClaims.createdAt)),
      db.select().from(users),
    ]);

  const nameOf = (id: string) => {
    const u = allUsers.find((x) => x.id === id);
    return u ? fullName(u) : "Unbekannt";
  };

  const rows = [
    ...vacations.map((r) => ({
      type: "urlaub" as const,
      typeLabel: "Urlaub",
      id: r.id,
      user: nameOf(r.userId),
      status: r.status,
      createdAt: r.createdAt,
      summary: `${formatDateDE(r.startDate)} – ${formatDateDE(r.endDate)} (${r.days} Tage)`,
    })),
    ...workations.map((r) => ({
      type: "workation" as const,
      typeLabel: "Workation",
      id: r.id,
      user: nameOf(r.userId),
      status: r.status,
      createdAt: r.createdAt,
      summary: `${r.city}, ${r.country} · ${formatDateDE(r.startDate)} – ${formatDateDE(r.endDate)} (${r.workDays} AT)`,
    })),
    ...expenses.map((r) => ({
      type: "reisekosten" as const,
      typeLabel: "Reisekosten",
      id: r.id,
      user: nameOf(r.userId),
      status: r.status,
      createdAt: r.createdAt,
      summary: `${r.destination} (${r.customerPurpose}) · ${formatEuro(r.totalCents)}`,
    })),
    ...commissions.map((r) => ({
      type: "provision" as const,
      typeLabel: "Provision",
      id: r.id,
      user: nameOf(r.userId),
      status: r.status,
      createdAt: r.createdAt,
      summary: `${BUSINESS_TYPE_LABELS[r.businessType]} · ${r.customerName} (${CUSTOMER_TYPE_LABELS[r.customerType]}) · ${
        r.finalAmountCents != null
          ? formatEuro(r.finalAmountCents)
          : "Betrag individuell"
      }`,
    })),
  ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  return (
    <div>
      <PageHeader
        title="Freigaben"
        description="Alle offenen Anträge mit Direktzugriff auf die Freigabe"
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Offene Anträge ({rows.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aktuell liegen keine offenen Anträge vor.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kategorie</TableHead>
                  <TableHead>Mitarbeiter/in</TableHead>
                  <TableHead className="hidden sm:table-cell">Antrag</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={`${r.type}-${r.id}`}>
                    <TableCell>{r.typeLabel}</TableCell>
                    <TableCell>{r.user}</TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {r.summary}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/freigaben/${r.type}/${r.id}`}
                        className="text-sm underline underline-offset-4"
                      >
                        Prüfen
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
