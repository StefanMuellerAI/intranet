import "server-only";
import { auth, currentUser } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { db, deputyAssignments, users, type User } from "@/db";
import { toISODate } from "@/lib/dates";

export const ALLOWED_EMAIL_DOMAIN =
  process.env.ALLOWED_EMAIL_DOMAIN ?? "stefanai.de";

export function isAllowedEmail(email: string): boolean {
  return email.toLowerCase().endsWith(`@${ALLOWED_EMAIL_DOMAIN.toLowerCase()}`);
}

/** Zugang gilt erst ab dem Eintrittsdatum; ohne Eintrittsdatum sofort. */
export function hasEntered(
  user: Pick<User, "entryDate">,
  today: string = toISODate(new Date())
): boolean {
  return !user.entryDate || user.entryDate <= today;
}

export type AccessResult =
  | { user: User }
  | {
      user: null;
      reason: "kein_konto" | "deaktiviert" | "vor_eintritt";
      entryDate?: string;
    };

/** Zugangsentscheidung für einen bereits verknüpften DB-User. */
function accessFor(user: User): AccessResult {
  if (user.status === "deaktiviert") return { user: null, reason: "deaktiviert" };
  if (!hasEntered(user))
    return {
      user: null,
      reason: "vor_eintritt",
      entryDate: user.entryDate ?? undefined,
    };
  return { user };
}

/**
 * Liefert den DB-User zum angemeldeten Clerk-User — inklusive Begründung,
 * falls der Zugang verweigert wird (für die Meldung im App-Layout).
 * Verknüpft beim ersten Login ab dem Eintrittstag den Clerk-Account mit dem
 * eingeladenen DB-User (Abgleich über die E-Mail-Adresse) und setzt den Status
 * auf "aktiv".
 */
export async function resolveAccess(): Promise<AccessResult> {
  const { userId: clerkId } = await auth();
  if (!clerkId) return { user: null, reason: "kein_konto" };

  const existing = await db.query.users.findFirst({
    where: eq(users.clerkId, clerkId),
  });
  if (existing) return accessFor(existing);

  // Erster Login nach Einladung: über E-Mail verknüpfen — aber nur, wenn die
  // primäre Adresse von Clerk verifiziert ist. Ohne diesen Check könnte ein
  // Konto mit (noch) unbestätigter Adresse den DB-Datensatz eines eingeladenen,
  // aber noch nicht angemeldeten Mitarbeitenden übernehmen (Kontoübernahme).
  const clerkUser = await currentUser();
  const primaryEmail = clerkUser?.primaryEmailAddress;
  const email = primaryEmail?.emailAddress?.toLowerCase();
  if (
    !email ||
    !isAllowedEmail(email) ||
    primaryEmail?.verification?.status !== "verified"
  )
    return { user: null, reason: "kein_konto" };

  const invited = await db.query.users.findFirst({
    where: eq(users.email, email),
  });
  if (!invited) return { user: null, reason: "kein_konto" };

  // Vor dem Eintritt wird bewusst nicht verknüpft: der Status bleibt
  // "eingeladen", bis sich die Person ab dem Eintrittstag erstmals anmeldet.
  const access = accessFor(invited);
  if (access.user === null) return access;

  const [linked] = await db
    .update(users)
    .set({ clerkId, status: "aktiv", updatedAt: new Date() })
    .where(eq(users.id, invited.id))
    .returning();
  return linked ? { user: linked } : { user: null, reason: "kein_konto" };
}

/** Liefert den DB-User zum angemeldeten Clerk-User oder null. */
export async function getCurrentUser(): Promise<User | null> {
  return (await resolveAccess()).user;
}

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user)
    throw new Error(
      "Nicht angemeldet, Konto deaktiviert oder Eintrittsdatum noch nicht erreicht."
    );
  return user;
}

export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (user.role !== "admin") throw new Error("Nur für den Admin zulässig.");
  return user;
}

/** Aktive Vertretung (Toggle aktiv und, falls gesetzt, heutiges Datum im Zeitraum) */
export async function getActiveDeputy(): Promise<User | null> {
  const assignments = await db
    .select()
    .from(deputyAssignments)
    .where(and(eq(deputyAssignments.active, true)));
  const today = toISODate(new Date());
  const current = assignments.find(
    (a) =>
      (!a.startsOn || a.startsOn <= today) && (!a.endsOn || a.endsOn >= today)
  );
  if (!current) return null;
  const user = await db.query.users.findFirst({
    where: eq(users.id, current.userId),
  });
  return user && user.status === "aktiv" ? user : null;
}

/** Darf der User freigeben? Admin immer, Vertretung solange aktiv. */
export async function isApprover(user: User): Promise<boolean> {
  if (user.role === "admin") return true;
  const deputy = await getActiveDeputy();
  return deputy?.id === user.id;
}

/** Freigabe-Kontext anfordern; Mitarbeitende ohne aktive Vertretung werden abgelehnt. */
export async function requireApprover(): Promise<User> {
  const user = await requireUser();
  if (!(await isApprover(user)))
    throw new Error("Keine Berechtigung für Freigaben.");
  return user;
}

export function fullName(user: Pick<User, "firstName" | "lastName">): string {
  return `${user.firstName} ${user.lastName}`.trim();
}
