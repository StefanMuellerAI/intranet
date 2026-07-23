import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, sickLeaves, users } from "@/db";
import { fullName, requireUser } from "@/lib/auth";
import { formatDateDE } from "@/lib/dates";
import { PageHeader } from "@/components/page-header";
import { AuditTrail } from "@/components/request-meta";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { closeSickLeave, correctSickLeave } from "../actions";

export const metadata = { title: "Krankmeldung" };

const TYPE_LABELS: Record<string, string> = {
  eigene_erkrankung: "eigene Erkrankung",
  kind_krank: "Kind krank",
};

export default async function KrankmeldungDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const leave = await db.query.sickLeaves.findFirst({
    where: eq(sickLeaves.id, id),
  });
  // Nur Admin und betroffene Person — Vertretung und andere sehen keine Details
  if (!leave || (leave.userId !== user.id && user.role !== "admin"))
    notFound();

  const owner = await db.query.users.findFirst({
    where: eq(users.id, leave.userId),
  });
  const closeWithId = closeSickLeave.bind(null, id);
  const correctWithId = correctSickLeave.bind(null, id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Krankmeldung"
        description={owner ? fullName(owner) : undefined}
      />
      <div className="flex items-center gap-3">
        <StatusBadge status={leave.status} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Meldung</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Erster Tag</dt>
              <dd>{formatDateDE(leave.startDate)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Ende</dt>
              <dd>
                {leave.endDate ? formatDateDE(leave.endDate) : "offen"}
                {leave.status === "gemeldet" && leave.endDate
                  ? " (voraussichtlich)"
                  : ""}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Typ</dt>
              <dd>{TYPE_LABELS[leave.type]}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Bemerkung</dt>
              <dd>{leave.note || "—"}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {leave.status === "gemeldet" && leave.userId === user.id && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Tatsächliches Enddatum nachtragen
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form action={closeWithId} className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="endDate">Letzter Tag der Abwesenheit</Label>
                <Input
                  id="endDate"
                  name="endDate"
                  type="date"
                  required
                  defaultValue={leave.endDate ?? ""}
                />
              </div>
              <Button type="submit">Abschließen</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {user.role === "admin" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Meldung korrigieren (Admin)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form action={correctWithId} className="space-y-4 max-w-xl">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="c-startDate">Erster Tag</Label>
                  <Input
                    id="c-startDate"
                    name="startDate"
                    type="date"
                    required
                    defaultValue={leave.startDate}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="c-endDate">Ende (leer = offen)</Label>
                  <Input
                    id="c-endDate"
                    name="endDate"
                    type="date"
                    defaultValue={leave.endDate ?? ""}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="c-type">Typ</Label>
                <select
                  id="c-type"
                  name="type"
                  defaultValue={leave.type}
                  className="border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                >
                  <option value="eigene_erkrankung">eigene Erkrankung</option>
                  <option value="kind_krank">Kind krank</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="c-note">Bemerkung (keine Diagnosen)</Label>
                <Textarea
                  id="c-note"
                  name="note"
                  defaultValue={leave.note ?? ""}
                />
              </div>
              <Button type="submit" variant="outline">
                Korrektur speichern
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <AuditTrail objectType="krankmeldung" objectId={id} />
    </div>
  );
}
