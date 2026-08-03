import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, vacationRequests } from "@/db";
import { requireUser } from "@/lib/auth";
import { formatDateDE } from "@/lib/dates";
import { getVacationAccount } from "@/lib/vacation";
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

export const metadata = { title: "Urlaub" };

export default async function UrlaubPage() {
  const user = await requireUser();
  const year = new Date().getFullYear();
  const account = await getVacationAccount(user, year);
  const isEntryYear =
    user.entryDate !== null && Number(user.entryDate.slice(0, 4)) === year;
  const requests = await db
    .select()
    .from(vacationRequests)
    .where(eq(vacationRequests.userId, user.id))
    .orderBy(desc(vacationRequests.createdAt));

  return (
    <div>
      <PageHeader
        title="Urlaub"
        description="Eigene Urlaubsanträge und Urlaubskonto"
        action={{ href: "/urlaub/neu", label: "Urlaub beantragen" }}
      />

      <div className="mb-6 grid gap-4 grid-cols-2 sm:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-normal">
              Anspruch {year}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {account.entitlement} Tage
            {isEntryYear && (
              <p className="text-xs font-normal text-muted-foreground">
                Eintrittsjahr — ab {year + 1} gelten{" "}
                {user.annualVacationDays} Tage
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-normal">
              Genommen
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {account.used} Tage
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-normal">
              Beantragt
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {account.pending} Tage
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-normal">
              Resturlaub
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {account.remaining} Tage
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Meine Anträge</CardTitle>
        </CardHeader>
        <CardContent>
          {requests.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Noch keine Urlaubsanträge vorhanden.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Zeitraum</TableHead>
                  <TableHead>Tage</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      {formatDateDE(r.startDate)} – {formatDateDE(r.endDate)}
                    </TableCell>
                    <TableCell>{r.days}</TableCell>
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/urlaub/${r.id}`}
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
