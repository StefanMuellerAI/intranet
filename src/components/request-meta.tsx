import { and, asc, eq } from "drizzle-orm";
import { auditLog, db } from "@/db";
import { getHistory } from "@/lib/history";
import type { RequestType } from "@/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const SOURCE_LABELS: Record<string, string> = {
  web: "Web-Oberfläche",
  api: "API (KI)",
  system: "System",
};

/** Audit-Log eines Vorgangs (Zeitstempel, Aktion, Akteur, Web/API-Kennzeichnung) */
export async function AuditTrail({
  objectType,
  objectId,
}: {
  objectType: string;
  objectId: string;
}) {
  const entries = await db
    .select()
    .from(auditLog)
    .where(
      and(eq(auditLog.objectType, objectType), eq(auditLog.objectId, objectId))
    )
    .orderBy(asc(auditLog.createdAt));

  if (entries.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Verlauf (Audit-Log)</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="space-y-2 text-sm">
          {entries.map((e) => (
            <li key={e.id} className="flex flex-wrap gap-x-2">
              <span className="text-muted-foreground tabular-nums">
                {e.createdAt.toLocaleString("de-DE")}
              </span>
              <span className="font-medium">{e.action.replaceAll("_", " ")}</span>
              <span>durch {e.actorLabel}</span>
              <span className="text-muted-foreground">
                ({SOURCE_LABELS[e.source] ?? e.source})
              </span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

/** Frühere Versionen eines Antrags nach Beanstandung/Korrektur */
export async function HistoryCard({
  requestType,
  requestId,
  renderSnapshot,
}: {
  requestType: RequestType;
  requestId: string;
  renderSnapshot: (snapshot: Record<string, unknown>, version: number) => React.ReactNode;
}) {
  const versions = await getHistory(requestType, requestId);
  if (versions.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Frühere Versionen</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {versions.map((v) => (
          <div key={v.id} className="rounded-md border p-3 text-sm">
            <p className="mb-1 font-medium">
              Version {v.version} ·{" "}
              <span className="text-muted-foreground font-normal">
                {v.createdAt.toLocaleString("de-DE")}
              </span>
            </p>
            {renderSnapshot(v.snapshot as Record<string, unknown>, v.version)}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
