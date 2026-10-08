import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL ist nicht gesetzt.");
  // Nur Entwicklung/Tests: Anfragen an einen lokalen Postgres über
  // scripts/local-neon-proxy.mjs statt an Neon schicken
  if (process.env.NEON_FETCH_ENDPOINT)
    neonConfig.fetchEndpoint = process.env.NEON_FETCH_ENDPOINT;
  return drizzle(neon(url), { schema });
}

let _db: ReturnType<typeof createDb> | undefined;

/** Lazy initialisierter Drizzle-Client (Neon HTTP, serverless-tauglich). */
export const db: ReturnType<typeof createDb> = new Proxy(
  {} as ReturnType<typeof createDb>,
  {
    get(_target, prop) {
      _db ??= createDb();
      const value = Reflect.get(_db, prop, _db);
      return typeof value === "function" ? value.bind(_db) : value;
    },
  }
);

export * from "./schema";
