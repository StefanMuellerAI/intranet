import { loadTestEnv } from "../helpers/env";

/**
 * Startet den lokalen Neon-HTTP-Proxy, wenn .env.test auf einen lokalen
 * Postgres zeigt (NEON_FETCH_ENDPOINT). Läuft auf dem Port schon ein Proxy
 * (z. B. parallel gestarteter Testlauf), wird dieser mitbenutzt. Gegen einen
 * echten Neon-Branch passiert hier nichts.
 */
export default async function setup() {
  loadTestEnv();
  const endpoint = process.env.NEON_FETCH_ENDPOINT;
  if (!endpoint) return;
  const { startLocalNeonProxy } = await import("../../scripts/local-neon-proxy.mjs");
  try {
    const stop: () => Promise<void> = await startLocalNeonProxy(
      Number(new URL(endpoint).port)
    );
    return stop;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") return;
    throw err;
  }
}
