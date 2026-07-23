import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, workationRequests } from "@/db";
import { requireUser } from "@/lib/auth";
import { formatDateDE } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { getUsedWorkationDays } from "@/lib/vacation";
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

export const metadata = { title: "Workation" };

export default async function WorkationPage() {
  const user = await requireUser();
  const year = new Date().getFullYear();
  const settings = await getSettings();
  const used = await getUsedWorkationDays(user.id, year);
  const requests = await db
    .select()
    .from(workationRequests)
    .where(eq(workationRequests.userId, user.id))
    .orderBy(desc(workationRequests.createdAt));

  return (
    <div>
      <PageHeader
        title="Workation"
        description="Mobiles Arbeiten aus dem Ausland gemäß Workation-Richtlinie"
        action={{ href: "/workation/neu", label: "Workation beantragen" }}
      />

      <div className="mb-6 grid gap-4 grid-cols-2 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-normal">
              Kontingent {year}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {settings.workationYearlyLimitDays} AT
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-normal">
              Verplant
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {used} AT
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-normal">
              Verfügbar
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {settings.workationYearlyLimitDays - used} AT
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
              Noch keine Workation-Anträge vorhanden.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ziel</TableHead>
                  <TableHead className="hidden sm:table-cell">
                    Zeitraum
                  </TableHead>
                  <TableHead>AT</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      {r.city}, {r.country}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {formatDateDE(r.startDate)} – {formatDateDE(r.endDate)}
                    </TableCell>
                    <TableCell>{r.workDays}</TableCell>
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/workation/${r.id}`}
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
