import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as getReceipt } from "@/app/api/receipts/[id]/route";
import { signReceiptUrl } from "@/lib/signed-url";
import { expenseReports, receipts } from "../../src/db/schema";
import {
  resetDb,
  seedTestData,
  testDb,
  type SeedResult,
} from "../helpers/db";

let seed: SeedResult;
let server: Server;
let receiptId: string;

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

/** URL-Parameter der signierten URL in eine Request auf die Route übertragen */
function requestFromSignedUrl(url: string): Request {
  const u = new URL(url);
  return new Request(`http://localhost${u.pathname}${u.search}`);
}

beforeAll(async () => {
  await resetDb();
  seed = await seedTestData();

  server = createServer((_req, res) => {
    res.setHeader("content-type", "application/pdf");
    res.end("PDF-TESTDATEN");
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Testserver ohne Port.");

  const db = testDb();
  const [report] = await db
    .insert(expenseReports)
    .values({
      userId: seed.employee.id,
      destination: "Berlin",
      customerPurpose: "Kundenworkshop",
      departureDate: "2026-07-01",
      departureTime: "08:00",
      returnDate: "2026-07-02",
      returnTime: "18:00",
    })
    .returning();
  const [receipt] = await db
    .insert(receipts)
    .values({
      reportId: report.id,
      userId: seed.employee.id,
      filename: "hotel.pdf",
      contentType: "application/pdf",
      sizeBytes: 13,
      blobUrl: `http://127.0.0.1:${address.port}/blob/hotel.pdf`,
    })
    .returning();
  receiptId = receipt.id;
});

afterAll(async () => {
  if (!server) return;
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
});

describe("GET /api/receipts/{id}", () => {
  it("liefert den Beleg über eine gültige signierte URL aus", async () => {
    const signed = signReceiptUrl(receiptId);
    const res = await getReceipt(requestFromSignedUrl(signed), ctx(receiptId));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain("hotel.pdf");
    expect(await res.text()).toBe("PDF-TESTDATEN");
  });

  it("verweigert manipulierte Signaturen", async () => {
    const u = new URL(signReceiptUrl(receiptId));
    u.searchParams.set("sig", "0".repeat(64));
    const res = await getReceipt(
      new Request(`http://localhost${u.pathname}${u.search}`),
      ctx(receiptId)
    );
    expect(res.status).toBe(403);
  });

  it("verweigert abgelaufene Signaturen", async () => {
    const signed = signReceiptUrl(receiptId, -60);
    const res = await getReceipt(requestFromSignedUrl(signed), ctx(receiptId));
    expect(res.status).toBe(403);
  });

  it("liefert 404 für unbekannte Belege", async () => {
    const id = randomUUID();
    const res = await getReceipt(
      new Request(`http://localhost/api/receipts/${id}?expires=1&sig=abc`),
      ctx(id)
    );
    expect(res.status).toBe(404);
  });
});
