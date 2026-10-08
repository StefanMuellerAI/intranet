import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getDocument } from "@/app/api/dokumente/[id]/route";
import { encryptDocument } from "@/lib/document-crypto";
import * as schema from "../../../src/db/schema";
import { actAs, auditFor, createUser, makeDeputy } from "../../helpers/actions";
import { resetDb, seedTestData, testDb, type SeedResult } from "../../helpers/db";
import { failingBlobUrls, storeBlob } from "../../helpers/framework-fakes";
import { attachmentDisposition } from "@/lib/http";

let seed: SeedResult;

const PLAINTEXT = "%PDF-1.4 Arbeitsvertrag Max Mitarbeiter";
const UNKNOWN_ID = "00000000-0000-4000-8000-0000000000dd";

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function request(id: string) {
  return new Request(`http://localhost/api/dokumente/${id}`);
}

/** Verschlüsseltes Dokument im Fake-Blob-Store ablegen und in der DB anlegen. */
async function insertDocument(
  opts: { userId?: string; filename?: string; body?: Buffer; contentType?: string } = {}
) {
  const userId = opts.userId ?? seed.employee.id;
  const blobUrl = await storeBlob(
    `dokumente/${userId}/${crypto.randomUUID()}.bin`,
    opts.body ?? encryptDocument(Buffer.from(PLAINTEXT)),
    "application/octet-stream"
  );
  const [doc] = await testDb()
    .insert(schema.employeeDocuments)
    .values({
      userId,
      category: "arbeitsvertrag",
      filename: opts.filename ?? "vertrag.pdf",
      contentType: opts.contentType ?? "application/pdf",
      sizeBytes: Buffer.byteLength(PLAINTEXT),
      blobUrl,
      uploadedById: seed.admin.id,
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
  await db.delete(schema.employeeDocuments);
  await db.delete(schema.auditLog);
  await db.delete(schema.deputyAssignments);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/dokumente/{id}", () => {
  it("liefert Dokumente mit Sonderzeichen im Dateinamen aus", async () => {
    const doc = await insertDocument({ filename: "Vertrag – Änderung €.pdf" });
    await actAs(seed.employee);
    const res = await getDocument(request(doc.id), ctx(doc.id));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe(
      attachmentDisposition("Vertrag – Änderung €.pdf")
    );
  });

  it("antwortet bei einer ID, die keine UUID ist, mit 404 statt 500", async () => {
    await actAs(seed.employee);
    const res = await getDocument(request("keine-uuid"), ctx("keine-uuid"));
    expect(res.status).toBe(404);
  });

  it("liefert der Eigentümerin das entschlüsselte Dokument als Download und auditiert", async () => {
    const doc = await insertDocument();
    await actAs(seed.employee);

    const res = await getDocument(request(doc.id), ctx(doc.id));

    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe(PLAINTEXT);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe(attachmentDisposition("vertrag.pdf"));
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("private, no-store");

    expect((await auditFor("dokument", doc.id))[0]).toMatchObject({
      action: "abgerufen",
      actorUserId: seed.employee.id,
      actorLabel: "Max Mitarbeiter",
      source: "web",
      details: { userId: seed.employee.id, filename: "vertrag.pdf" },
    });
  });

  it("liefert dem Admin fremde Dokumente und protokolliert den Admin als Abrufer", async () => {
    const doc = await insertDocument();
    await actAs(seed.admin);

    const res = await getDocument(request(doc.id), ctx(doc.id));

    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe(PLAINTEXT);
    expect((await auditFor("dokument", doc.id))[0]).toMatchObject({
      action: "abgerufen",
      actorUserId: seed.admin.id,
      details: { userId: seed.employee.id },
    });
  });

  it("entfernt Anführungszeichen aus dem Dateinamen im Header", async () => {
    const doc = await insertDocument({ filename: 'vertrag "final".pdf' });
    await actAs(seed.employee);
    const res = await getDocument(request(doc.id), ctx(doc.id));
    expect(res.headers.get("content-disposition")).toBe(attachmentDisposition("vertrag final.pdf"));
  });

  it("liefert auch Bilder nur als Attachment mit nosniff aus", async () => {
    const doc = await insertDocument({ filename: "ausweis.png", contentType: "image/png" });
    await actAs(seed.employee);
    const res = await getDocument(request(doc.id), ctx(doc.id));
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("antwortet ohne Session mit 403 — noch vor der Suche nach dem Dokument", async () => {
    const doc = await insertDocument();
    await actAs(null);

    const existing = await getDocument(request(doc.id), ctx(doc.id));
    const unknown = await getDocument(request(UNKNOWN_ID), ctx(UNKNOWN_ID));

    expect(existing.status).toBe(403);
    expect(await existing.json()).toEqual({ fehler: "Kein Zugriff." });
    // Gleiche Antwort für vorhandene und unbekannte IDs: verrät keine IDs
    expect(unknown.status).toBe(403);
    expect(await auditFor("dokument")).toHaveLength(0);
  });

  it("antwortet deaktivierten Konten mit 403", async () => {
    const inactive = await createUser({ status: "deaktiviert" });
    const doc = await insertDocument({ userId: inactive.id });
    await actAs(inactive);
    const res = await getDocument(request(doc.id), ctx(doc.id));
    expect(res.status).toBe(403);
  });

  it("behandelt fremde Dokumente für Mitarbeitende wie nicht vorhandene (404)", async () => {
    const doc = await insertDocument();
    await actAs(await createUser());

    const res = await getDocument(request(doc.id), ctx(doc.id));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ fehler: "Dokument nicht gefunden." });
    expect(await auditFor("dokument")).toHaveLength(0);
  });

  it("gewährt auch der aktiven Vertretung keinen Zugriff auf fremde Dokumente (404)", async () => {
    const deputy = await createUser();
    await makeDeputy(deputy);
    const doc = await insertDocument();
    await actAs(deputy);

    const res = await getDocument(request(doc.id), ctx(doc.id));

    expect(res.status).toBe(404);
  });

  it("antwortet bei unbekannter ID mit 404", async () => {
    await actAs(seed.admin);
    const res = await getDocument(request(UNKNOWN_ID), ctx(UNKNOWN_ID));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ fehler: "Dokument nicht gefunden." });
  });

  it("antwortet mit 502, wenn der Blob-Speicher einen Fehler liefert", async () => {
    const doc = await insertDocument();
    failingBlobUrls.add(doc.blobUrl);
    await actAs(seed.employee);

    const res = await getDocument(request(doc.id), ctx(doc.id));

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ fehler: "Dokument konnte nicht geladen werden." });
    expect(await auditFor("dokument")).toHaveLength(0);
  });

  it.each([
    ["Klartext statt Ciphertext", Buffer.from("x".repeat(64))],
    ["zu kurzes Payload", Buffer.from("kaputt")],
    [
      "manipulierter Ciphertext",
      (() => {
        const enc = encryptDocument(Buffer.from(PLAINTEXT));
        enc[enc.length - 1] ^= 0xff;
        return enc;
      })(),
    ],
  ])("antwortet mit 500, wenn die Entschlüsselung scheitert (%s)", async (_label, body) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const doc = await insertDocument({ body });
    await actAs(seed.employee);

    const res = await getDocument(request(doc.id), ctx(doc.id));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      fehler: "Dokument konnte nicht entschlüsselt werden.",
    });
    expect(await auditFor("dokument")).toHaveLength(0);
  });

  it("protokolliert jeden einzelnen Abruf", async () => {
    const doc = await insertDocument();
    await actAs(seed.employee);
    await getDocument(request(doc.id), ctx(doc.id));
    await getDocument(request(doc.id), ctx(doc.id));
    const entries = await auditFor("dokument", doc.id);
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.action === "abgerufen")).toBe(true);
  });
});
