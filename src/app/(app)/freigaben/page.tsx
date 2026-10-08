import Link from "next/link";
import { listOpenApprovals } from "@/lib/approvals";
import { requireApprover } from "@/lib/auth";
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

export default async function FreigabenPage() {
  await requireApprover();
  const rows = await listOpenApprovals();

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
                        href={r.href}
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
