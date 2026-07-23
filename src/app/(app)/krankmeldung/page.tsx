import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, sickLeaves, users } from "@/db";
import { fullName, requireUser } from "@/lib/auth";
import { formatDateDE } from "@/lib/dates";
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

export const metadata = { title: "Krankmeldung" };

const TYPE_LABELS: Record<string, string> = {
  eigene_erkrankung: "eigene Erkrankung",
  kind_krank: "Kind krank",
};

export default async function KrankmeldungPage() {
  const user = await requireUser();
  const isAdmin = user.role === "admin";

  // Sichtbarkeit: nur Admin und betroffene Person sehen Krankmeldungen im Detail
  const leaves = isAdmin
    ? await db.select().from(sickLeaves).orderBy(desc(sickLeaves.createdAt))
    : await db
        .select()
        .from(sickLeaves)
        .where(eq(sickLeaves.userId, user.id))
        .orderBy(desc(sickLeaves.createdAt));

  const allUsers = isAdmin ? await db.select().from(users) : [];
  const nameOf = (id: string) => {
    const u = allUsers.find((x) => x.id === id);
    return u ? fullName(u) : "—";
  };

  return (
    <div>
      <PageHeader
        title="Krankmeldung"
        description="Krankheitsbedingte Abwesenheit wird gemeldet, nicht beantragt — es gibt keinen Genehmigungsprozess. Der Nachweis läuft über das eAU-Verfahren."
        action={{ href: "/krankmeldung/neu", label: "Krank melden" }}
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {isAdmin ? "Alle Krankmeldungen" : "Meine Krankmeldungen"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {leaves.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Keine Krankmeldungen vorhanden.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {isAdmin && <TableHead>Mitarbeiter/in</TableHead>}
                  <TableHead>Zeitraum</TableHead>
                  <TableHead>Typ</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {leaves.map((l) => (
                  <TableRow key={l.id}>
                    {isAdmin && <TableCell>{nameOf(l.userId)}</TableCell>}
                    <TableCell>
                      ab {formatDateDE(l.startDate)}
                      {l.endDate
                        ? ` bis ${formatDateDE(l.endDate)}`
                        : " (Ende offen)"}
                    </TableCell>
                    <TableCell>{TYPE_LABELS[l.type]}</TableCell>
                    <TableCell>
                      <StatusBadge status={l.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/krankmeldung/${l.id}`}
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
