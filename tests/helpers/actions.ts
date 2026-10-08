import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { expect } from "vitest";
import * as schema from "../../src/db/schema";
import { testDb } from "./db";
import { RedirectSignal, session } from "./framework-fakes";

/**
 * Hilfen für Integrationstests von Server-Actions und Route-Handlern.
 * Die Rechteprüfung läuft echt über src/lib/auth.ts; actAs() setzt nur die
 * Clerk-Session, die der Fake von auth() zurückgibt.
 */

/** Als dieser User "anmelden" (null = abmelden). Verknüpft bei Bedarf eine Clerk-ID. */
export async function actAs(user: schema.User | null): Promise<void> {
  if (!user) {
    session.clerkId = null;
    return;
  }
  let clerkId = user.clerkId;
  if (!clerkId) {
    clerkId = `user_test_${user.id.slice(0, 8)}`;
    await testDb()
      .update(schema.users)
      .set({ clerkId })
      .where(eq(schema.users.id, user.id));
    user.clerkId = clerkId;
  }
  session.clerkId = clerkId;
}

/** FormData aus einem Objekt; Arrays werden als Mehrfachwerte angehängt. */
export function formData(
  values: Record<string, string | number | boolean | Blob | (string | Blob)[] | null | undefined>
): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    for (const v of Array.isArray(value) ? value : [value]) {
      fd.append(key, v instanceof Blob ? v : String(v));
    }
  }
  return fd;
}

/** Datei für Upload-Tests */
export function testFile(
  name: string,
  content: string | Buffer = "%PDF-1.4 Testinhalt",
  type = "application/pdf"
): File {
  const bytes = typeof content === "string" ? content : new Uint8Array(content);
  return new File([bytes], name, { type });
}

/** Erwartet, dass die Action per redirect() endet; liefert die Ziel-URL. */
export async function expectRedirect(
  promise: Promise<unknown>,
  pattern?: RegExp | string
): Promise<string> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof RedirectSignal) {
      if (pattern instanceof RegExp) expect(err.url).toMatch(pattern);
      else if (pattern) expect(err.url).toBe(pattern);
      return err.url;
    }
    throw err;
  }
  throw new Error("Erwartete eine Weiterleitung, die Action endete normal.");
}

/** ID aus einer Redirect-URL wie /urlaub/<uuid> */
export function idFromUrl(url: string): string {
  const id = url.split("/").pop();
  if (!id) throw new Error(`Keine ID in ${url}`);
  return id;
}

/** Audit-Einträge zu einem Objekt, neueste zuerst */
export async function auditFor(objectType: string, objectId?: string) {
  const db = testDb();
  return db
    .select()
    .from(schema.auditLog)
    .where(
      objectId
        ? and(
            eq(schema.auditLog.objectType, objectType),
            eq(schema.auditLog.objectId, objectId)
          )
        : eq(schema.auditLog.objectType, objectType)
    )
    .orderBy(desc(schema.auditLog.createdAt));
}

/** Weitere User anlegen (Standard: aktive/r Mitarbeiter/in). */
export async function createUser(
  overrides: Partial<typeof schema.users.$inferInsert> = {}
): Promise<schema.User> {
  const suffix = randomUUID().slice(0, 8);
  const [user] = await testDb()
    .insert(schema.users)
    .values({
      email: `test-${suffix}@stefanai.de`,
      firstName: "Test",
      lastName: `Person ${suffix}`,
      role: "mitarbeiter",
      status: "aktiv",
      annualVacationDays: 30,
      ...overrides,
    })
    .returning();
  return user;
}

/** Aktive Vertretung für den User einrichten. */
export async function makeDeputy(
  user: schema.User,
  range: { startsOn?: string; endsOn?: string } = {}
): Promise<void> {
  const db = testDb();
  await db
    .update(schema.deputyAssignments)
    .set({ active: false })
    .where(eq(schema.deputyAssignments.active, true));
  await db.insert(schema.deputyAssignments).values({
    userId: user.id,
    active: true,
    startsOn: range.startsOn ?? null,
    endsOn: range.endsOn ?? null,
  });
}
