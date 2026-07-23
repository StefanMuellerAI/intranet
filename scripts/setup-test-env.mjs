// Einmalige Einrichtung der Test-Umgebung:
// 1. legt die Datenbank "intranet_test" auf dem Neon-Endpoint aus .env.local an
// 2. schreibt .env.test mit Test-DB-URL, Clerk-Dev-Keys und Test-Secrets
// Aufruf: node scripts/setup-test-env.mjs
import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

const TEST_DB_NAME = "intranet_test";

config({ path: ".env.local" });

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL fehlt in .env.local");

const url = new URL(baseUrl);
if (url.pathname === `/${TEST_DB_NAME}`)
  throw new Error("DATABASE_URL zeigt bereits auf die Test-DB.");

const sql = neon(baseUrl);
try {
  await sql.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  console.log(`Datenbank ${TEST_DB_NAME} angelegt.`);
} catch (err) {
  if (String(err).includes("already exists")) {
    console.log(`Datenbank ${TEST_DB_NAME} existiert bereits.`);
  } else {
    throw err;
  }
}

const testUrl = new URL(baseUrl);
testUrl.pathname = `/${TEST_DB_NAME}`;

if (existsSync(".env.test")) {
  console.log(".env.test existiert bereits — wird nicht überschrieben.");
  process.exit(0);
}

const domain = process.env.ALLOWED_EMAIL_DOMAIN ?? "stefanai.de";

const lines = [
  `DATABASE_URL=${testUrl.toString()}`,
  `TEST_DB_RESET_ALLOWED=ja`,
  ``,
  `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=${process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? ""}`,
  `CLERK_SECRET_KEY=${process.env.CLERK_SECRET_KEY ?? ""}`,
  `NEXT_PUBLIC_CLERK_SIGN_IN_URL=${process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL ?? "/anmelden"}`,
  ``,
  `E2E_ADMIN_EMAIL=e2e-admin@${domain}`,
  `E2E_USER_EMAIL=e2e-mitarbeiter@${domain}`,
  ``,
  `ALLOWED_EMAIL_DOMAIN=${domain}`,
  `APP_BASE_URL=http://localhost:3100`,
  `DOWNLOAD_URL_SECRET=test-${randomBytes(16).toString("hex")}`,
  `CRON_SECRET=test-${randomBytes(16).toString("hex")}`,
  ``,
];

writeFileSync(".env.test", lines.join("\n"));
console.log(".env.test geschrieben (Publishable Key der Clerk-Dev-Instanz übernommen).");

const pk = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
if (!pk.startsWith("pk_test_"))
  console.warn(
    "WARNUNG: Der Clerk Publishable Key ist kein pk_test_-Key. " +
      "E2E-Tests sollten nur gegen eine Development-Instanz laufen!"
  );
