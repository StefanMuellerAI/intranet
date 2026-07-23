import "server-only";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { eq } from "drizzle-orm";
import { db, users, type User } from "@/db";

/**
 * Löst den lokalen Intranet-User aus dem Clerk-OAuth-Token des MCP-Clients.
 * Deaktivierte Konten und fehlende Verknüpfung werden abgelehnt.
 */
export async function resolveUserFromMcpAuth(
  authInfo: AuthInfo | undefined
): Promise<User> {
  const clerkId = authInfo?.extra?.userId;
  if (typeof clerkId !== "string" || !clerkId)
    throw new Error("Nicht angemeldet (fehlendes OAuth-Token).");

  const user = await db.query.users.findFirst({
    where: eq(users.clerkId, clerkId),
  });
  if (!user || user.status === "deaktiviert")
    throw new Error(
      "Kein aktives Intranet-Konto für diesen Clerk-User. Bitte zuerst im Browser anmelden."
    );
  return user;
}

/** Stellt sicher, dass ein Datensatz dem authentifizierten User gehört. */
export function assertOwnResource(
  ownerUserId: string,
  currentUser: User,
  label = "Datensatz"
): void {
  if (ownerUserId !== currentUser.id)
    throw new Error(`${label} nicht gefunden.`);
}
