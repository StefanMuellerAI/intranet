// Wendet die Drizzle-Migrationen auf die Test-Datenbank aus .env.test an
// (über den Neon-HTTP-Treiber, funktioniert ohne Websocket).
// Aufruf: node scripts/migrate-test-db.mjs
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

config({ path: ".env.test", override: true });

if (process.env.TEST_DB_RESET_ALLOWED !== "ja")
  throw new Error("TEST_DB_RESET_ALLOWED fehlt — ist .env.test korrekt?");

const db = drizzle(neon(process.env.DATABASE_URL));
await migrate(db, { migrationsFolder: "./drizzle" });
console.log("Migrationen auf die Test-DB angewendet.");
