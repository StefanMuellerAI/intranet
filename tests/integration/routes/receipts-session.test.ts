import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getReceipt } from "@/app/api/receipts/[id]/route";
import { toISODate } from "@/lib/dates";
import { encryptDocument } from "@/lib/document-crypto";
import { signReceiptUrl } from "@/lib/signed-url";
import * as schema from "../../../src/db/schema";
import { actAs, auditFor, createUser, makeDeputy } from "../../helpers/actions";
import { resetDb, seedTestData, testDb, type SeedResult } from "../../helpers/db";
import { blobStore, failingBlobUrls, storeBlob } from "../../helpers/framework-fakes";
import { attachmentDisposition } from "@/lib/http";

let seed: SeedResult;

const PLAINTEXT = "%PDF-1.4 HOTELRECHNUNG";

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

/** Session-Aufruf ohne Signatur-Parameter */
function fetchReceipt(id: string, query = "") {
  return getReceipt(new Request(`http://localhost/api/receipts/${id}${query}`), ctx(id));
}

function daysFromToday(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return toISODate(d);
}

/** Abrechnung des Mitarbeiters mit einem verschlüsselt abgelegten Beleg */
async function createReceipt(
  opts: {
    status?: schema.RequestStatus;
    userId?: string;
    filename?: string;
    contentType?: string;
    blobBody?: Buffer;
  } = {}
) {
  const userId = opts.userId ?? seed.employee.id;
  const db = testDb();
  const [report] = await db
    .insert(schema.expenseReports)
    .values({
      userId,
      status: opts.status ?? "eingereicht",
      destination: "Berlin",
      customerPurpose: "Workshop",
      departureDate: "2026-07-01",
      departureTime: "08:00",
      returnDate: "2026-07-02",
      returnTime: "18:00",
    })
    .returning();
  const blobUrl = await storeBlob(
    `belege/${report.id}/${randomUUID()}.bin`,
    opts.blobBody ?? encryptDocument(Buffer.from(PLAINTEXT)),
    "application/octet-stream"
  );
  const [receipt] = await db
    .insert(schema.receipts)
    .values({
      reportId: report.id,
      userId,
      filename: opts.filename ?? "hotel.pdf",
      contentType: opts.contentType ?? "application/pdf",
      sizeBytes: PLAINTEXT.length,
      blobUrl,
    })
    .returning();
  return { report, receipt };
}

beforeAll(async () => {
  await resetDb();
  seed = await seedTestData();
});

beforeEach(async () => {
  const db = testDb();
  await db.delete(schema.receipts);
  await db.delete(schema.expenseReports);
  await db.delete(schema.deputyAssignments);
  await db.delete(schema.auditLog);
  blobStore.clear();
});

describe("GET /api/receipts/{id} — Session-Pfad", () => {
  it("liefert der Eigentümerin den entschlüsselten Beleg mit sicheren Headern", async () => {
    const { receipt } = await createReceipt();
    await actAs(seed.employee);

    const res = await fetchReceipt(receipt.id);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(PLAINTEXT);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe(attachmentDisposition("hotel.pdf"));
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("übernimmt den Klartext-MIME-Typ und entfernt Anführungszeichen aus dem Dateinamen", async () => {
    const { receipt } = await createReceipt({
      filename: 'Taxi "Nacht".png',
      contentType: "image/png",
    });
    await actAs(seed.employee);
    const res = await fetchReceipt(receipt.id);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-disposition")).toBe(attachmentDisposition("Taxi Nacht.png"));
  });

  it("protokolliert den Abruf als Beleg-Zugriff", async () => {
    const { report, receipt } = await createReceipt();
    await actAs(seed.employee);
    await fetchReceipt(receipt.id);

    const audits = await auditFor("beleg", receipt.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "abgerufen",
      actorUserId: seed.employee.id,
      actorLabel: "Max Mitarbeiter",
      source: "web",
      details: {
        userId: seed.employee.id,
        reportId: report.id,
        filename: "hotel.pdf",
      },
    });
  });

  it("protokolliert Abrufe über signierte Links nicht", async () => {
    const { receipt } = await createReceipt();
    const u = new URL(signReceiptUrl(receipt.id));
    const res = await getReceipt(
      new Request(`http://localhost${u.pathname}${u.search}`),
      ctx(receipt.id)
    );
    expect(res.status).toBe(200);
    expect(await auditFor("beleg", receipt.id)).toHaveLength(0);
  });

  it.each(["genehmigt", "beanstandet", "zurueckgezogen", "storniert"] as const)(
    "liefert dem Admin auch Belege abgeschlossener Abrechnungen (%s)",
    async (status) => {
      const { receipt } = await createReceipt({ status });
      await actAs(seed.admin);
      const res = await fetchReceipt(receipt.id);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(PLAINTEXT);
      expect((await auditFor("beleg", receipt.id))[0].actorUserId).toBe(seed.admin.id);
    }
  );

  it("liefert der Eigentümerin auch Belege genehmigter Abrechnungen", async () => {
    const { receipt } = await createReceipt({ status: "genehmigt" });
    await actAs(seed.employee);
    expect((await fetchReceipt(receipt.id)).status).toBe(200);
  });

  it.each(["eingereicht", "storno_beantragt"] as const)(
    "liefert der aktiven Vertretung Belege offener Abrechnungen (%s)",
    async (status) => {
      const deputy = await createUser();
      await makeDeputy(deputy, { startsOn: daysFromToday(-1), endsOn: daysFromToday(1) });
      const { receipt } = await createReceipt({ status });
      await actAs(deputy);

      const res = await fetchReceipt(receipt.id);

      expect(res.status).toBe(200);
      expect(await res.text()).toBe(PLAINTEXT);
      expect((await auditFor("beleg", receipt.id))[0].actorUserId).toBe(deputy.id);
    }
  );

  it.each(["genehmigt", "beanstandet", "zurueckgezogen", "storniert"] as const)(
    "verweigert der Vertretung Belege abgeschlossener Abrechnungen (%s)",
    async (status) => {
      const deputy = await createUser();
      await makeDeputy(deputy);
      const { receipt } = await createReceipt({ status });
      await actAs(deputy);

      const res = await fetchReceipt(receipt.id);

      expect(res.status).toBe(403);
      expect((await res.json()).fehler).toBe("Kein Zugriff.");
      expect(await auditFor("beleg", receipt.id)).toHaveLength(0);
    }
  );

  it("verweigert einer Vertretung außerhalb ihres Zeitraums den Zugriff", async () => {
    const deputy = await createUser();
    await makeDeputy(deputy, { endsOn: daysFromToday(-1) });
    const { receipt } = await createReceipt();
    await actAs(deputy);
    expect((await fetchReceipt(receipt.id)).status).toBe(403);
  });

  it("verweigert fremden Mitarbeitenden den Zugriff", async () => {
    const { receipt } = await createReceipt();
    await actAs(await createUser());
    const res = await fetchReceipt(receipt.id);
    expect(res.status).toBe(403);
    expect(await auditFor("beleg", receipt.id)).toHaveLength(0);
  });

  it("verweigert den Zugriff ohne Session (403)", async () => {
    const { receipt } = await createReceipt();
    await actAs(null);
    expect((await fetchReceipt(receipt.id)).status).toBe(403);
  });

  it("verweigert deaktivierten Eigentümer/innen den Zugriff", async () => {
    const former = await createUser({ status: "deaktiviert" });
    const { receipt } = await createReceipt({ userId: former.id });
    await actAs(former);
    expect((await fetchReceipt(receipt.id)).status).toBe(403);
  });

  it("nutzt die Session, wenn nur einer der Signatur-Parameter vorhanden ist", async () => {
    const { receipt } = await createReceipt();
    await actAs(seed.employee);
    expect((await fetchReceipt(receipt.id, "?sig=abc")).status).toBe(200);
    await actAs(await createUser());
    expect((await fetchReceipt(receipt.id, "?expires=9999999999")).status).toBe(403);
  });

  it("liefert 404 für unbekannte Belege", async () => {
    await actAs(seed.admin);
    const res = await fetchReceipt(randomUUID());
    expect(res.status).toBe(404);
    expect((await res.json()).fehler).toBe("Beleg nicht gefunden.");
  });

  it("antwortet mit 502, wenn der Blob-Store den Beleg nicht liefert", async () => {
    const { receipt } = await createReceipt();
    failingBlobUrls.add(receipt.blobUrl);
    await actAs(seed.employee);

    const res = await fetchReceipt(receipt.id);

    expect(res.status).toBe(502);
    expect((await res.json()).fehler).toBe("Beleg konnte nicht geladen werden.");
    expect(await auditFor("beleg", receipt.id)).toHaveLength(0);
  });

  it("antwortet mit 502, wenn der Blob fehlt", async () => {
    const { receipt } = await createReceipt();
    blobStore.delete(receipt.blobUrl);
    await actAs(seed.admin);
    expect((await fetchReceipt(receipt.id)).status).toBe(502);
  });

  it("antwortet mit 500, wenn der Beleg nicht entschlüsselt werden kann", async () => {
    const { receipt } = await createReceipt({
      blobBody: Buffer.from("kein gültiger Ciphertext, nur Klartext-Müll ..."),
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    await actAs(seed.employee);

    const res = await fetchReceipt(receipt.id);

    expect(res.status).toBe(500);
    expect(consoleError).toHaveBeenCalledWith(
      "Beleg-Entschlüsselung fehlgeschlagen:",
      expect.any(Error)
    );
    consoleError.mockRestore();
    expect((await res.json()).fehler).toBe("Beleg konnte nicht entschlüsselt werden.");
    expect(await auditFor("beleg", receipt.id)).toHaveLength(0);
  });

  it("antwortet mit 500 bei manipuliertem Ciphertext (Auth-Tag)", async () => {
    const tampered = encryptDocument(Buffer.from(PLAINTEXT));
    tampered[tampered.length - 1] ^= 0xff;
    const { receipt } = await createReceipt({ blobBody: tampered });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    await actAs(seed.employee);
    expect((await fetchReceipt(receipt.id)).status).toBe(500);
    expect(consoleError).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });
});

describe("GET /api/receipts/{id} — Datenbankzustand", () => {
  it("liest den Berichtsstatus bei jedem Abruf neu", async () => {
    const deputy = await createUser();
    await makeDeputy(deputy);
    const { report, receipt } = await createReceipt();
    await actAs(deputy);
    expect((await fetchReceipt(receipt.id)).status).toBe(200);

    await testDb()
      .update(schema.expenseReports)
      .set({ status: "genehmigt" })
      .where(eq(schema.expenseReports.id, report.id));
    expect((await fetchReceipt(receipt.id)).status).toBe(403);
  });
});
