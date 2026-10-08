// Wendet die Drizzle-Migrationen auf die Test-Datenbank aus .env.test an
// (über den Neon-HTTP-Treiber, funktioniert ohne Websocket).
// Aufruf: node scripts/migrate-test-db.mjs
import { neon, neonConfig } from "@neondatabase/serverless";
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

config({ path: process.env.TEST_ENV_FILE ?? ".env.test", override: true });

if (process.env.TEST_DB_RESET_ALLOWED !== "ja")
  throw new Error("TEST_DB_RESET_ALLOWED fehlt — ist .env.test korrekt?");

// Lokaler Postgres über scripts/local-neon-proxy.mjs (siehe .env.test.example)
let stopProxy;
if (process.env.NEON_FETCH_ENDPOINT) {
  neonConfig.fetchEndpoint = process.env.NEON_FETCH_ENDPOINT;
  const { startLocalNeonProxy } = await import("./local-neon-proxy.mjs");
  const port = Number(new URL(process.env.NEON_FETCH_ENDPOINT).port);
  stopProxy = await startLocalNeonProxy(port).catch(() => undefined);
}

const db = drizzle(neon(process.env.DATABASE_URL));
await migrate(db, { migrationsFolder: "./drizzle" });
console.log("Migrationen auf die Test-DB angewendet.");
await stopProxy?.();
