import path from "node:path";
import { config } from "dotenv";

/**
 * Lädt .env.test mit override, damit Test-Läufe garantiert gegen die
 * Test-Datenbank und die Clerk-Dev-Instanz laufen — unabhängig davon,
 * was in der Shell oder in .env.local gesetzt ist.
 * TEST_ENV_FILE wählt eine andere Datei (z. B. eigene DB je paralleler Lauf).
 */
export function loadTestEnv(): void {
  const file = process.env.TEST_ENV_FILE ?? ".env.test";
  config({ path: path.resolve(process.cwd(), file), override: true, quiet: true });
}
