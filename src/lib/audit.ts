import "server-only";
import { auditLog } from "@/db";
import { db } from "@/db";

export interface AuditEntry {
  objectType:
    | "urlaub"
    | "workation"
    | "reisekosten"
    | "krankmeldung"
    | "provision"
    | "user"
    | "settings"
    | "api_key"
    | "webhook"
    | "vertretung";
  objectId?: string;
  action: string;
  actorUserId?: string | null;
  actorLabel: string;
  source: "web" | "api" | "system";
  apiKeyId?: string;
  details?: Record<string, unknown>;
}

/** Append-only Audit-Log — es gibt bewusst keine Update-/Delete-Funktionen. */
export async function writeAudit(entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    objectType: entry.objectType,
    objectId: entry.objectId,
    action: entry.action,
    actorUserId: entry.actorUserId ?? null,
    actorLabel: entry.actorLabel,
    source: entry.source,
    apiKeyId: entry.apiKeyId,
    details: entry.details,
  });
}
