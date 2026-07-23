import { createHash, randomBytes } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../../src/db/schema";

export const E2E_ADMIN_EMAIL =
  process.env.E2E_ADMIN_EMAIL ?? "e2e-admin@stefanai.de";
export const E2E_USER_EMAIL =
  process.env.E2E_USER_EMAIL ?? "e2e-mitarbeiter@stefanai.de";

let _db: ReturnType<typeof createTestDb> | undefined;

function createTestDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL ist nicht gesetzt (.env.test fehlt?).");
  if (process.env.TEST_DB_RESET_ALLOWED !== "ja")
    throw new Error(
      "Sicherheitsstopp: TEST_DB_RESET_ALLOWED ist nicht auf 'ja' gesetzt. " +
        "Die Test-Helfer leeren die Datenbank und dürfen nur gegen einen " +
        "Neon-Test-Branch laufen (.env.test)."
    );
  return drizzle(neon(url), { schema });
}

/** Drizzle-Client auf die Test-Datenbank (nur mit Sicherheitsbestätigung). */
export function testDb() {
  _db ??= createTestDb();
  return _db;
}

/** Alle Tabellen leeren (Reihenfolge egal dank CASCADE). */
export async function resetDb(): Promise<void> {
  const db = testDb();
  await db.execute(`
    TRUNCATE TABLE
      webhook_deliveries,
      webhook_configs,
      request_history,
      audit_log,
      receipts,
      expense_items,
      expense_reports,
      vacation_requests,
      workation_requests,
      commission_claims,
      sick_leaves,
      deputy_assignments,
      api_keys,
      employee_documents,
      helpful_links,
      news_items,
      settings,
      users
    CASCADE
  `);
}

export interface SeedResult {
  admin: schema.User;
  employee: schema.User;
}

/**
 * Grunddaten: Settings-Zeile (id = 1, Standardsätze) sowie Admin- und
 * Mitarbeiter-User. Die E-Mails entsprechen den Clerk-E2E-Test-Usern,
 * da die App beim ersten Login über die E-Mail verknüpft (src/lib/auth.ts).
 */
export async function seedTestData(): Promise<SeedResult> {
  const db = testDb();
  await db.insert(schema.settings).values({ id: 1 });

  const [admin] = await db
    .insert(schema.users)
    .values({
      email: E2E_ADMIN_EMAIL,
      firstName: "Erika",
      lastName: "Admin",
      role: "admin",
      status: "aktiv",
      annualVacationDays: 30,
    })
    .returning();

  const [employee] = await db
    .insert(schema.users)
    .values({
      email: E2E_USER_EMAIL,
      firstName: "Max",
      lastName: "Mitarbeiter",
      role: "mitarbeiter",
      status: "aktiv",
      annualVacationDays: 30,
    })
    .returning();

  return { admin, employee };
}

/**
 * API-Key für Integrationstests anlegen; gibt den Klartext-Key zurück.
 * Hash-Verfahren identisch zu src/lib/api-keys.ts (SHA-256 hex).
 */
export async function createTestApiKey(
  createdById: string,
  name = "Integrationstest"
): Promise<{ key: string; id: string }> {
  const db = testDb();
  const key = `sk_test_${randomBytes(24).toString("hex")}`;
  const [row] = await db
    .insert(schema.apiKeys)
    .values({
      name,
      keyHash: createHash("sha256").update(key).digest("hex"),
      keyPrefix: key.slice(0, 12),
      createdById,
    })
    .returning();
  return { key, id: row.id };
}
