// Lokaler Ersatz für den Neon-HTTP-Endpunkt: nimmt Anfragen des
// @neondatabase/serverless-Treibers (neon()) entgegen und führt sie gegen
// einen normalen Postgres aus. Damit laufen Integrations- und E2E-Tests ohne
// Neon-Branch, z. B. lokal, in Cloud-Sessions oder mit einem Postgres-Service
// in CI.
//
// Aufruf: node scripts/local-neon-proxy.mjs  (Port über LOCAL_NEON_PROXY_PORT)
// Die App leitet ihre Anfragen hierher um, sobald NEON_FETCH_ENDPOINT gesetzt
// ist (siehe src/db/index.ts). Nur für Entwicklung und Tests gedacht.
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import pg from "pg";

const ERROR_FIELDS = [
  "severity",
  "code",
  "detail",
  "hint",
  "position",
  "internalPosition",
  "internalQuery",
  "where",
  "schema",
  "table",
  "column",
  "dataType",
  "constraint",
  "file",
  "line",
  "routine",
];

// Wie Neon mit "Neon-Raw-Text-Output: true": alle Werte als Text, das Parsen
// übernimmt der Treiber anhand der dataTypeID.
const RAW_TEXT_TYPES = { getTypeParser: () => (value) => value };

const pools = new Map();

function poolFor(connectionString) {
  let pool = pools.get(connectionString);
  if (!pool) {
    const url = new URL(connectionString);
    url.searchParams.delete("sslmode");
    url.searchParams.delete("channel_binding");
    pool = new pg.Pool({
      connectionString: url.toString(),
      max: 10,
      // Neon antwortet in UTC — lokal genauso, damit timestamptz identisch ist
      options: "-c TimeZone=UTC",
    });
    pools.set(connectionString, pool);
  }
  return pool;
}

async function runQuery(client, { query, params }) {
  const raw = await client.query({
    text: query,
    values: params ?? [],
    rowMode: "array",
    types: RAW_TEXT_TYPES,
  });
  // Ohne Parameter nutzt pg das einfache Protokoll; mehrere Statements
  // liefern dann ein Array — Neon gibt nur das letzte Ergebnis zurück.
  const result = Array.isArray(raw) ? raw[raw.length - 1] : raw;
  return {
    command: result.command,
    rowCount: result.rowCount,
    rowAsArray: true,
    fields: (result.fields ?? []).map((f) => ({
      name: f.name,
      dataTypeID: f.dataTypeID,
      tableID: f.tableID,
      columnID: f.columnID,
      dataTypeSize: f.dataTypeSize,
      dataTypeModifier: f.dataTypeModifier,
      format: "text",
    })),
    rows: result.rows ?? [],
  };
}

function beginStatement(headers) {
  const parts = ["BEGIN"];
  const isolation = headers["neon-batch-isolation-level"];
  if (isolation) {
    const level = isolation.replace(/([a-z])([A-Z])/g, "$1 $2").toUpperCase();
    parts.push(`ISOLATION LEVEL ${level}`);
  }
  if (headers["neon-batch-read-only"] === "true") parts.push("READ ONLY");
  if (headers["neon-batch-deferrable"] === "true") parts.push("DEFERRABLE");
  return parts.join(" ");
}

async function handle(body, headers) {
  const connectionString = headers["neon-connection-string"];
  if (!connectionString) throw new Error("Neon-Connection-String fehlt.");
  const pool = poolFor(connectionString);

  if (Array.isArray(body.queries)) {
    const client = await pool.connect();
    try {
      await client.query(beginStatement(headers));
      const results = [];
      for (const q of body.queries) results.push(await runQuery(client, q));
      await client.query("COMMIT");
      return { results };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
  return runQuery(pool, body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Startet den Proxy und liefert eine Funktion zum Beenden. */
export async function startLocalNeonProxy(port = 4444) {
  const server = createServer(async (req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    try {
      const body = JSON.parse(await readBody(req));
      const result = await handle(body, req.headers);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      const payload = { message: err?.message ?? String(err) };
      for (const key of ERROR_FIELDS)
        if (err?.[key] !== undefined) payload[key] = err[key];
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return async () => {
    await new Promise((resolve) => server.close(resolve));
    await Promise.all([...pools.values()].map((p) => p.end()));
    pools.clear();
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const port = Number(process.env.LOCAL_NEON_PROXY_PORT ?? 4444);
  await startLocalNeonProxy(port);
  console.log(`Lokaler Neon-HTTP-Proxy läuft auf http://127.0.0.1:${port}/sql`);
}
