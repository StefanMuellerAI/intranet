import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getItDocument } from "@/app/api/it-dokumente/[id]/route";
import { encryptDocument } from "@/lib/document-crypto";
import * as schema from "../../../src/db/schema";
import { actAs, auditFor, createUser } from "../../helpers/actions";
import { resetDb, seedTestData, testDb, type SeedResult } from "../../helpers/db";
import { failingBlobUrls, storeBlob } from "../../helpers/framework-fakes";

const PLAINTEXT = "%PDF-1.4 Unterschriebenes Übergabeprotokoll";

let seed: SeedResult;

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function request(id: string) {
  return new Request(`http://localhost/api/it-dokumente/${id}`);
}

/** Protokoll wie nach dem Upload: Ciphertext im Blob-Store, Metadaten in der DB. */
async function insertDocument(
  values: Partial<typeof schema.itEquipmentDocuments.$inferInsert> = {},
  blobBody: Buffer = encryptDocument(Buffer.from(PLAINTEXT))
) {
  const blobUrl = await storeBlob(
    `it-protokolle/${seed.employee.id}/uebergabe-${randomUUID()}.bin`,
    blobBody,
    "application/octet-stream"
  );
  const [doc] = await testDb()
    .insert(schema.itEquipmentDocuments)
    .values({
      userId: seed.employee.id,
      kind: "uebergabe",
      filename: "uebergabe.pdf",
      contentType: "application/pdf",
      sizeBytes: Buffer.byteLength(PLAINTEXT),
      blobUrl,
      uploadedById: seed.admin.id,
      ...values,
    })
    .returning();
  return doc;
}

beforeAll(async () => {
  await resetDb();
  seed = await seedTestData();
});

beforeEach(async () => {
  const db = testDb();
  await db.delete(schema.itEquipmentDocuments);
  await db.delete(schema.auditLog);
});

describe("GET /api/it-dokumente/[id]", () => {
  it("liefert auch Protokolle mit Sonderzeichen im Dateinamen aus", async () => {
    const doc = await insertDocument({ filename: "Übergabe – Max €.pdf" });
    await actAs(seed.admin);
    const res = await getItDocument(request(doc.id), ctx(doc.id));
    expect(res.status).toBe(200);
    const disposition = res.headers.get("content-disposition") ?? "";
    expect(disposition).toMatch(/^attachment; filename="[\x20-\x7e]+";/);
    expect(disposition).toContain(
      `filename*=UTF-8''${encodeURIComponent("Übergabe – Max €.pdf")}`
    );
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe(PLAINTEXT);
  });

  it("antwortet bei einer ID, die keine UUID ist, mit 404 statt 500", async () => {
    await actAs(seed.admin);
    const res = await getItDocument(request("keine-uuid"), ctx("keine-uuid"));
    expect(res.status).toBe(404);
  });

  it("liefert dem Admin das entschlüsselte Protokoll als Download und auditiert", async () => {
    const doc = await insertDocument({ filename: 'Uebergabe "Max".pdf' });
    await actAs(seed.admin);

    const res = await getItDocument(request(doc.id), ctx(doc.id));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    // Immer als Download; Anführungszeichen im Dateinamen werden entfernt
    const disposition = res.headers.get("content-disposition");
    expect(disposition).toMatch(/^attachment;/);
    expect(disposition).toContain('filename="Uebergabe Max.pdf"');
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe(PLAINTEXT);

    const audit = await auditFor("it_dokument", doc.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "abgerufen",
      actorUserId: seed.admin.id,
      actorLabel: "Erika Admin",
      source: "web",
      details: {
        userId: seed.employee.id,
        kind: "uebergabe",
        filename: 'Uebergabe "Max".pdf',
      },
    });
  });

  it("liefert Bilder mit ihrem Original-Typ aus", async () => {
    const doc = await insertDocument({
      kind: "ruecknahme",
      filename: "scan.png",
      contentType: "image/png",
    });
    await actAs(seed.admin);
    const res = await getItDocument(request(doc.id), ctx(doc.id));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
  });

  it("verweigert ohne Session den Zugriff — auch für unbekannte IDs", async () => {
    const doc = await insertDocument();
    await actAs(null);

    for (const id of [doc.id, randomUUID()]) {
      const res = await getItDocument(request(id), ctx(id));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ fehler: "Kein Zugriff." });
    }
    expect(await auditFor("it_dokument")).toHaveLength(0);
  });

  it("verweigert Mitarbeitenden den Zugriff — auch auf das eigene Protokoll und unbekannte IDs (F6)", async () => {
    const doc = await insertDocument();
    const colleague = await createUser();

    for (const user of [seed.employee, colleague]) {
      await actAs(user);
      for (const id of [doc.id, randomUUID()]) {
        const res = await getItDocument(request(id), ctx(id));
        expect(res.status).toBe(403);
      }
    }
    expect(await auditFor("it_dokument")).toHaveLength(0);
  });

  it("sperrt deaktivierte Admins", async () => {
    const formerAdmin = await createUser({ role: "admin", status: "deaktiviert" });
    const doc = await insertDocument();
    await actAs(formerAdmin);
    expect((await getItDocument(request(doc.id), ctx(doc.id))).status).toBe(403);
  });

  it("meldet dem Admin unbekannte Protokolle mit 404", async () => {
    await actAs(seed.admin);
    const id = randomUUID();
    const res = await getItDocument(request(id), ctx(id));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ fehler: "Protokoll nicht gefunden." });
    expect(await auditFor("it_dokument")).toHaveLength(0);
  });

  it("antwortet mit 502, wenn der Blob-Store nicht liefert", async () => {
    const doc = await insertDocument();
    failingBlobUrls.add(doc.blobUrl);
    await actAs(seed.admin);

    const res = await getItDocument(request(doc.id), ctx(doc.id));

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ fehler: "Protokoll konnte nicht geladen werden." });
    expect(await auditFor("it_dokument", doc.id)).toHaveLength(0);
  });

  it("antwortet mit 500, wenn die Datei nicht entschlüsselt werden kann", async () => {
    // Klartext statt Ciphertext im Blob → Auth-Tag passt nicht
    const doc = await insertDocument({}, Buffer.from(PLAINTEXT.repeat(4)));
    await actAs(seed.admin);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await getItDocument(request(doc.id), ctx(doc.id));

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        fehler: "Protokoll konnte nicht entschlüsselt werden.",
      });
      expect(consoleError).toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
    expect(await auditFor("it_dokument", doc.id)).toHaveLength(0);
  });
});
