import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db, requestHistory, type RequestType } from "@/db";

/** Snapshot einer Antragsversion ablegen (vor Korrektur/erneuter Einreichung). */
export async function saveHistorySnapshot(
  requestType: RequestType,
  requestId: string,
  version: number,
  snapshot: Record<string, unknown>
): Promise<void> {
  await db.insert(requestHistory).values({
    requestType,
    requestId,
    version,
    snapshot,
  });
}

export async function getHistory(requestType: RequestType, requestId: string) {
  return db
    .select()
    .from(requestHistory)
    .where(
      and(
        eq(requestHistory.requestType, requestType),
        eq(requestHistory.requestId, requestId)
      )
    )
    .orderBy(asc(requestHistory.version));
}
