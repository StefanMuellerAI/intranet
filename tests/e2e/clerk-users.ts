/**
 * Legt die E2E-Test-User in der Clerk-DEVELOPMENT-Instanz an (Backend-API)
 * bzw. setzt deren Passwort auf den Wert aus .env.test — idempotent.
 */
const CLERK_API = "https://api.clerk.com/v1";

function headers(): Record<string, string> {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key) throw new Error("CLERK_SECRET_KEY fehlt (.env.test).");
  if (!key.startsWith("sk_test_"))
    throw new Error(
      "Sicherheitsstopp: CLERK_SECRET_KEY ist kein sk_test_-Key. " +
        "E2E-Tests dürfen nur gegen eine Clerk-Development-Instanz laufen."
    );
  return { authorization: `Bearer ${key}`, "content-type": "application/json" };
}

export async function ensureClerkUser(opts: {
  email: string;
  firstName: string;
  lastName: string;
}): Promise<void> {
  const search = await fetch(
    `${CLERK_API}/users?email_address=${encodeURIComponent(opts.email)}`,
    { headers: headers() }
  );
  if (!search.ok)
    throw new Error(`Clerk-User-Suche fehlgeschlagen (${search.status}).`);
  const existing = (await search.json()) as { id: string }[];
  if (existing.length > 0) return;

  // Kein Passwort nötig — die Tests melden sich ticketbasiert an
  const res = await fetch(`${CLERK_API}/users`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      email_address: [opts.email],
      first_name: opts.firstName,
      last_name: opts.lastName,
    }),
  });
  if (!res.ok)
    throw new Error(
      `Clerk-User ${opts.email} konnte nicht angelegt werden (${res.status}): ${await res.text()}`
    );
}
