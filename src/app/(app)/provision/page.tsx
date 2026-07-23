import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { commissionClaims, db } from "@/db";
import { requireUser } from "@/lib/auth";
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

export const metadata = { title: "Provisionen" };

export default async function ProvisionPage() {
  const user = await requireUser();
  const year = new Date().getFullYear();
  const claims = await db
    .select()
    .from(commissionClaims)
    .where(eq(commissionClaims.userId, user.id))
    .orderBy(desc(commissionClaims.createdAt));

  const approvedThisYear = claims.filter(
    (c) =>
      c.status === "genehmigt" && c.orderDate.startsWith(String(year))
  );
  const approvedSumCents = approvedThisYear.reduce(
    (s, c) => s + (c.finalAmountCents ?? 0),
    0
  );
  const openCount = claims.filter((c) => c.status === "eingereicht").length;

  return (
    <div>
      <PageHeader
        title="Provisionen"
        description="Eigene Provisionsansprüche aus Folgegeschäften (Beratung und Schulung)"
        action={{ href: "/provision/neu", label: "Anspruch einreichen" }}
      />

      <div className="mb-6 grid gap-4 grid-cols-2 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-normal">
              Genehmigt {year}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {formatEuro(approvedSumCents)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-normal">
              Genehmigte Ansprüche {year}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {approvedThisYear.length}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-normal">
              Offen
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {openCount}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Meine Provisionsansprüche</CardTitle>
        </CardHeader>
        <CardContent>
          {claims.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Noch keine Provisionsansprüche eingereicht.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bestellung</TableHead>
                  <TableHead>Art</TableHead>
                  <TableHead className="hidden sm:table-cell">Kunde</TableHead>
                  <TableHead className="hidden sm:table-cell">
                    Kundenart
                  </TableHead>
                  <TableHead>Betrag</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {claims.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>{formatDateDE(c.orderDate)}</TableCell>
                    <TableCell>{BUSINESS_TYPE_LABELS[c.businessType]}</TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {c.customerName}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {CUSTOMER_TYPE_LABELS[c.customerType]}
                    </TableCell>
                    <TableCell>
                      {c.finalAmountCents != null
                        ? formatEuro(c.finalAmountCents)
                        : "individuell"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={c.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/provision/${c.id}`}
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
