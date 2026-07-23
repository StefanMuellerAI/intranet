import path from "node:path";
import { config } from "dotenv";

/**
 * Lädt .env.test mit override, damit Test-Läufe garantiert gegen die
 * Test-Datenbank und die Clerk-Dev-Instanz laufen — unabhängig davon,
 * was in der Shell oder in .env.local gesetzt ist.
 */
export function loadTestEnv(): void {
  config({ path: path.resolve(process.cwd(), ".env.test"), override: true });
}
