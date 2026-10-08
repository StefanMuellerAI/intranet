import { clerkSetup } from "@clerk/testing/playwright";
import { E2E_ADMIN_EMAIL, E2E_USER_EMAIL, resetDb, seedTestData } from "../helpers/db";
import { loadTestEnv } from "../helpers/env";
import { ensureClerkUser } from "./clerk-users";

/**
 * Läuft einmal vor allen E2E-Tests:
 * 1. Clerk Testing Token holen (umgeht Bot-Schutz beim programmatischen Login)
 * 2. E2E-User in der Clerk-Dev-Instanz sicherstellen (ticketbasierter Login,
 *    kein Passwort nötig)
 * 3. Test-Datenbank leeren und Grunddaten einspielen
 */
export default async function globalSetup() {
  loadTestEnv();
  await ensureLocalNeonProxy();
  await clerkSetup();

  await ensureClerkUser({
    email: E2E_ADMIN_EMAIL,
    firstName: "Erika",
    lastName: "Admin",
  });
  await ensureClerkUser({
    email: E2E_USER_EMAIL,
    firstName: "Max",
    lastName: "Mitarbeiter",
  });

  await resetDb();
  await seedTestData();
}

/**
 * Lokaler Postgres (NEON_FETCH_ENDPOINT): Proxy starten, falls der
 * webServer-Eintrag ihn noch nicht gestartet hat — die Reihenfolge von
 * globalSetup und webServer ist so egal.
 */
async function ensureLocalNeonProxy(): Promise<void> {
  const endpoint = process.env.NEON_FETCH_ENDPOINT;
  if (!endpoint) return;
  const { startLocalNeonProxy } = await import("../../scripts/local-neon-proxy.mjs");
  try {
    await startLocalNeonProxy(Number(new URL(endpoint).port));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
  }
}
