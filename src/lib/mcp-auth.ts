import "server-only";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { eq } from "drizzle-orm";
import { db, users, type User } from "@/db";
import { hasEntered } from "@/lib/auth";
import { formatDateDE } from "@/lib/dates";

/**
 * Löst den lokalen Intranet-User aus dem Clerk-OAuth-Token des MCP-Clients.
 * Deaktivierte Konten, fehlende Verknüpfung und noch nicht erreichte
 * Eintrittsdaten werden abgelehnt.
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
  if (user.entryDate && !hasEntered(user))
    throw new Error(
      `Der Zugang ist erst ab dem Eintrittsdatum (${formatDateDE(user.entryDate)}) freigeschaltet.`
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
