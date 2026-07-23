import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL ist nicht gesetzt.");
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
