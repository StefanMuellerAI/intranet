import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  analyzeEquipmentImport,
  applyEquipmentImport,
  createEquipment,
  createEquipmentType,
  deleteEquipment,
  deleteEquipmentType,
  deleteHandoverProtocol,
  markEquipmentReturned,
  toggleEquipmentType,
  undoEquipmentReturn,
  updateEquipment,
  updateEquipmentType,
  uploadHandoverProtocol,
} from "@/app/(app)/it-management/actions";
import { decryptDocument } from "@/lib/document-crypto";
import { CSV_COLUMNS } from "@/lib/it-equipment-csv";
import * as schema from "../../../src/db/schema";
import { actAs, auditFor, createUser, formData, testFile } from "../../helpers/actions";
import { resetDb, seedTestData, testDb, type SeedResult } from "../../helpers/db";
import { blobModule, blobStore, nextCacheModule } from "../../helpers/framework-fakes";

let seed: SeedResult;
/** Ausstattungsarten nach Name — werden vor jedem Test frisch angelegt */
let types: Record<string, schema.ItEquipmentType>;

const DEFAULT_TYPES = ["Laptop", "Maus", "Kopfhörer", "Peripherie", "Rucksack", "Koffer"];
const PROTOCOL_PDF = "%PDF-1.4 Übergabeprotokoll Max Mitarbeiter";

function equipmentForm(overrides: Record<string, string> = {}) {
  return formData({
    userId: seed.employee.id,
    typeId: types.Laptop.id,
    deviceId: "SA-IT-2026-01",
    serialNumber: "C02XL0THJGH5",
    notes: 'MacBook Pro 14"',
    handoverDate: "2026-08-03",
    returnDate: "",
    ...overrides,
  });
}

async function insertEquipment(
  values: Partial<typeof schema.itEquipment.$inferInsert> = {}
): Promise<schema.ItEquipment> {
  const [row] = await testDb()
    .insert(schema.itEquipment)
    .values({
      userId: seed.employee.id,
      typeId: types.Laptop.id,
      deviceId: "SA-IT-2026-01",
      handoverDate: "2026-08-03",
      createdById: seed.admin.id,
      ...values,
    })
    .returning();
  return row;
}

async function allEquipment() {
  return testDb().select().from(schema.itEquipment);
}

async function loadEquipment(id: string) {
  const [row] = await testDb()
    .select()
    .from(schema.itEquipment)
    .where(eq(schema.itEquipment.id, id));
  if (!row) throw new Error("Ausstattung fehlt");
  return row;
}

async function allDocuments() {
  return testDb().select().from(schema.itEquipmentDocuments);
}

async function loadType(name: string) {
  const [row] = await testDb()
    .select()
    .from(schema.itEquipmentTypes)
    .where(eq(schema.itEquipmentTypes.name, name));
  return row;
}

function protocolForm(file: File | File[] = testFile("uebergabe.pdf", PROTOCOL_PDF)) {
  return formData({ document: file });
}

/** Protokoll als Admin hochladen und die gespeicherte Zeile liefern. */
async function uploadProtocol(
  kind: schema.HandoverProtocolKind = "uebergabe",
  file = testFile("uebergabe.pdf", PROTOCOL_PDF),
  userId = seed.employee.id
) {
  await uploadHandoverProtocol(userId, kind, protocolForm(file));
  const [doc] = await testDb()
    .select()
    .from(schema.itEquipmentDocuments)
    .where(
      and(
        eq(schema.itEquipmentDocuments.userId, userId),
        eq(schema.itEquipmentDocuments.kind, kind)
      )
    );
  if (!doc) throw new Error("Protokoll fehlt");
  return doc;
}

/** Mitarbeitende dürfen keine IT-Management-Action ausführen. */
async function expectAdminOnly(run: () => Promise<unknown>) {
  await actAs(seed.employee);
  await expect(run()).rejects.toThrow("Nur für den Admin zulässig.");
  expect(await testDb().select().from(schema.auditLog)).toHaveLength(0);
}

/** Import-Datei im Format des Exports (Semikolon, CRLF). */
function importCsv(rows: Partial<Record<keyof typeof CSV_COLUMNS, string>>[]): string {
  const keys = Object.keys(CSV_COLUMNS) as (keyof typeof CSV_COLUMNS)[];
  return [
    keys.map((key) => CSV_COLUMNS[key]).join(";"),
    ...rows.map((row) => keys.map((key) => `"${row[key] ?? ""}"`).join(";")),
  ].join("\r\n");
}

function importForm(text: string | Buffer, name = "ausstattung.csv") {
  return formData({ file: testFile(name, text, "text/csv") });
}

async function importAudits() {
  return (await auditFor("it_ausstattung")).filter((a) => a.action === "importiert");
}

beforeAll(async () => {
  await resetDb();
  seed = await seedTestData();
});

beforeEach(async () => {
  const db = testDb();
  await db.delete(schema.itEquipmentDocuments);
  await db.delete(schema.itEquipment);
  await db.delete(schema.itEquipmentTypes);
  await db.delete(schema.auditLog);
  const rows = await db
    .insert(schema.itEquipmentTypes)
    .values(DEFAULT_TYPES.map((name, i) => ({ name, sortOrder: (i + 1) * 10 })))
    .returning();
  types = Object.fromEntries(rows.map((t) => [t.name, t]));
  blobStore.clear();
  await actAs(seed.admin);
});

// ---------------------------------------------------------------------------
// Ausstattung
// ---------------------------------------------------------------------------

describe("createEquipment", () => {
  it("legt die Ausstattung an, auditiert und aktualisiert die Übersicht", async () => {
    await createEquipment(equipmentForm());

    const [item] = await allEquipment();
    expect(item).toMatchObject({
      userId: seed.employee.id,
      typeId: types.Laptop.id,
      deviceId: "SA-IT-2026-01",
      serialNumber: "C02XL0THJGH5",
      notes: 'MacBook Pro 14"',
      handoverDate: "2026-08-03",
      returnDate: null,
      createdById: seed.admin.id,
    });
    expect((await auditFor("it_ausstattung", item.id))[0]).toMatchObject({
      action: "erstellt",
      actorUserId: seed.admin.id,
      actorLabel: "Erika Admin",
      source: "web",
      details: {
        deviceId: "SA-IT-2026-01",
        userId: seed.employee.id,
        typeId: types.Laptop.id,
        handoverDate: "2026-08-03",
      },
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/it-management");
  });

  it("speichert leere Zusatzfelder als null und übernimmt ein Rückgabedatum", async () => {
    await createEquipment(
      equipmentForm({ serialNumber: "  ", notes: "", returnDate: "2026-08-03" })
    );
    expect((await allEquipment())[0]).toMatchObject({
      serialNumber: null,
      notes: null,
      returnDate: "2026-08-03",
    });
  });

  it("meldet unbekannte Personen und Ausstattungsarten", async () => {
    await expect(createEquipment(equipmentForm({ userId: randomUUID() }))).rejects.toThrow(
      "Mitarbeiter/in nicht gefunden."
    );
    await expect(createEquipment(equipmentForm({ typeId: randomUUID() }))).rejects.toThrow(
      "Ausstattungsart nicht gefunden."
    );
    expect(await allEquipment()).toHaveLength(0);
  });

  it("verlangt Person und Art aus der Auswahl", async () => {
    await expect(createEquipment(equipmentForm({ userId: "" }))).rejects.toThrow(
      "Bitte eine/n Mitarbeiter/in auswählen."
    );
    await expect(createEquipment(equipmentForm({ typeId: "Laptop" }))).rejects.toThrow(
      "Bitte eine Ausstattungsart auswählen."
    );
  });

  it("lehnt eine bereits vergebene Geräte-ID ab", async () => {
    await insertEquipment({ deviceId: "SA-IT-2026-01" });
    await expect(createEquipment(equipmentForm())).rejects.toThrow(
      "Die Geräte-ID „SA-IT-2026-01“ ist bereits vergeben."
    );
    expect(await allEquipment()).toHaveLength(1);
  });

  it("lehnt ungültige Geräte-IDs ab", async () => {
    await expect(createEquipment(equipmentForm({ deviceId: "" }))).rejects.toThrow(
      "Geräte-ID ist erforderlich."
    );
    await expect(createEquipment(equipmentForm({ deviceId: "SA IT/01" }))).rejects.toThrow(
      "Die Geräte-ID darf nur Ziffern, Buchstaben und Bindestriche enthalten."
    );
    await expect(
      createEquipment(equipmentForm({ deviceId: "A".repeat(41) }))
    ).rejects.toThrow("Die Geräte-ID ist zu lang (max. 40 Zeichen).");
    expect(await allEquipment()).toHaveLength(0);
  });

  it("lehnt eine Rückgabe vor der Übernahme und ungültige Daten ab", async () => {
    await expect(
      createEquipment(equipmentForm({ returnDate: "2026-08-02" }))
    ).rejects.toThrow("Das Rückgabedatum darf nicht vor dem Übernahmedatum liegen.");
    await expect(createEquipment(equipmentForm({ handoverDate: "" }))).rejects.toThrow(
      "Übernahmedatum ist erforderlich."
    );
    await expect(
      createEquipment(equipmentForm({ handoverDate: "2026-02-30" }))
    ).rejects.toThrow("Übernahmedatum ist ungültig.");
  });

  it("begrenzt Seriennummer und Zusatzinformationen", async () => {
    await expect(
      createEquipment(equipmentForm({ serialNumber: "S".repeat(121) }))
    ).rejects.toThrow("Die Seriennummer ist zu lang (max. 120 Zeichen).");
    await expect(
      createEquipment(equipmentForm({ notes: "N".repeat(2001) }))
    ).rejects.toThrow("Die Zusatzinformationen sind zu lang (max. 2000 Zeichen).");
  });

  it("lehnt neue Zuordnungen an deaktivierte Personen und ausgeblendete Arten ab (wie der CSV-Import)", async () => {
    const inactive = await createUser({ status: "deaktiviert" });
    await expect(
      createEquipment(equipmentForm({ userId: inactive.id }))
    ).rejects.toThrow("ist deaktiviert und kann keine weitere Ausstattung übernehmen.");

    await testDb()
      .update(schema.itEquipmentTypes)
      .set({ active: false })
      .where(eq(schema.itEquipmentTypes.id, types.Koffer.id));
    await expect(
      createEquipment(equipmentForm({ typeId: types.Koffer.id }))
    ).rejects.toThrow("ist ausgeblendet und für neue Zuordnungen nicht verfügbar.");

    expect(await allEquipment()).toHaveLength(0);
  });

  it("lehnt Mitarbeitende ab", async () => {
    await expectAdminOnly(() => createEquipment(equipmentForm()));
    expect(await allEquipment()).toHaveLength(0);
  });
});

describe("updateEquipment", () => {
  it("ordnet die Ausstattung neu zu und auditiert alte und neue Werte", async () => {
    const item = await insertEquipment({ serialNumber: "ALT" });
    const colleague = await createUser({ firstName: "Clara", lastName: "Kollegin" });

    await updateEquipment(
      equipmentForm({
        id: item.id,
        userId: colleague.id,
        typeId: types.Maus.id,
        deviceId: "SA-IT-2026-07",
        serialNumber: "",
        notes: "kabellos",
        handoverDate: "2026-08-10",
        returnDate: "2026-08-20",
      })
    );

    expect(await loadEquipment(item.id)).toMatchObject({
      userId: colleague.id,
      typeId: types.Maus.id,
      deviceId: "SA-IT-2026-07",
      serialNumber: null,
      notes: "kabellos",
      handoverDate: "2026-08-10",
      returnDate: "2026-08-20",
      createdById: seed.admin.id,
    });
    expect((await auditFor("it_ausstattung", item.id))[0]).toMatchObject({
      action: "aktualisiert",
      actorUserId: seed.admin.id,
      details: {
        alt: {
          deviceId: "SA-IT-2026-01",
          userId: seed.employee.id,
          typeId: types.Laptop.id,
          handoverDate: "2026-08-03",
          returnDate: null,
        },
        neu: {
          deviceId: "SA-IT-2026-07",
          userId: colleague.id,
          typeId: types.Maus.id,
          handoverDate: "2026-08-10",
          returnDate: "2026-08-20",
        },
      },
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/it-management");
  });

  it("erlaubt die eigene Geräte-ID", async () => {
    const item = await insertEquipment();
    await updateEquipment(equipmentForm({ id: item.id, notes: "neu" }));
    expect(await loadEquipment(item.id)).toMatchObject({
      deviceId: "SA-IT-2026-01",
      notes: "neu",
    });
  });

  it("lehnt die Geräte-ID eines anderen Geräts ab", async () => {
    const item = await insertEquipment();
    await insertEquipment({ deviceId: "SA-IT-2026-02" });
    await expect(
      updateEquipment(equipmentForm({ id: item.id, deviceId: "SA-IT-2026-02" }))
    ).rejects.toThrow("Die Geräte-ID „SA-IT-2026-02“ ist bereits vergeben.");
    expect((await loadEquipment(item.id)).deviceId).toBe("SA-IT-2026-01");
  });

  it("meldet unbekannte Personen und Ausstattungsarten", async () => {
    const item = await insertEquipment();
    await expect(
      updateEquipment(equipmentForm({ id: item.id, userId: randomUUID() }))
    ).rejects.toThrow("Mitarbeiter/in nicht gefunden.");
    await expect(
      updateEquipment(equipmentForm({ id: item.id, typeId: randomUUID() }))
    ).rejects.toThrow("Ausstattungsart nicht gefunden.");
  });

  it("lehnt eine Rückgabe vor der Übernahme ab", async () => {
    const item = await insertEquipment();
    await expect(
      updateEquipment(equipmentForm({ id: item.id, returnDate: "2026-08-01" }))
    ).rejects.toThrow("Das Rückgabedatum darf nicht vor dem Übernahmedatum liegen.");
    expect((await loadEquipment(item.id)).returnDate).toBeNull();
  });

  it("meldet unbekannte Ausstattung und verlangt eine ID", async () => {
    await expect(updateEquipment(equipmentForm({ id: randomUUID() }))).rejects.toThrow(
      "Ausstattung nicht gefunden."
    );
    await expect(updateEquipment(equipmentForm())).rejects.toThrow("ID ist erforderlich.");
  });

  it("lehnt Mitarbeitende ab", async () => {
    const item = await insertEquipment();
    await expectAdminOnly(() =>
      updateEquipment(equipmentForm({ id: item.id, notes: "manipuliert" }))
    );
    expect((await loadEquipment(item.id)).notes).toBeNull();
  });
});

describe("markEquipmentReturned", () => {
  it("erfasst die Rückgabe und auditiert", async () => {
    const item = await insertEquipment();

    await markEquipmentReturned(item.id, formData({ returnDate: "2026-09-30" }));

    expect((await loadEquipment(item.id)).returnDate).toBe("2026-09-30");
    expect((await auditFor("it_ausstattung", item.id))[0]).toMatchObject({
      action: "zurueckgegeben",
      actorUserId: seed.admin.id,
      details: { returnDate: "2026-09-30" },
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/it-management");
  });

  it("erlaubt die Rückgabe am Übernahmetag", async () => {
    const item = await insertEquipment();
    await markEquipmentReturned(item.id, formData({ returnDate: "2026-08-03" }));
    expect((await loadEquipment(item.id)).returnDate).toBe("2026-08-03");
  });

  it("verlangt ein Rückgabedatum", async () => {
    const item = await insertEquipment();
    await expect(
      markEquipmentReturned(item.id, formData({ returnDate: " " }))
    ).rejects.toThrow("Bitte ein Rückgabedatum angeben.");
    await expect(markEquipmentReturned(item.id, formData({}))).rejects.toThrow(
      "Bitte ein Rückgabedatum angeben."
    );
  });

  it("lehnt eine Rückgabe vor der Übernahme und ungültige Daten ab", async () => {
    const item = await insertEquipment();
    await expect(
      markEquipmentReturned(item.id, formData({ returnDate: "2026-08-02" }))
    ).rejects.toThrow("Das Rückgabedatum darf nicht vor dem Übernahmedatum liegen.");
    await expect(
      markEquipmentReturned(item.id, formData({ returnDate: "2026-13-01" }))
    ).rejects.toThrow("Rückgabedatum ist ungültig.");
    expect((await loadEquipment(item.id)).returnDate).toBeNull();
  });

  it("meldet unbekannte Ausstattung", async () => {
    await expect(
      markEquipmentReturned(randomUUID(), formData({ returnDate: "2026-09-30" }))
    ).rejects.toThrow("Ausstattung nicht gefunden.");
  });

  it("lehnt Mitarbeitende ab", async () => {
    const item = await insertEquipment();
    await expectAdminOnly(() =>
      markEquipmentReturned(item.id, formData({ returnDate: "2026-09-30" }))
    );
    expect((await loadEquipment(item.id)).returnDate).toBeNull();
  });
});

describe("undoEquipmentReturn", () => {
  it("nimmt die Rückgabe zurück und auditiert das alte Datum", async () => {
    const item = await insertEquipment({ returnDate: "2026-09-30" });

    await undoEquipmentReturn(item.id);

    expect((await loadEquipment(item.id)).returnDate).toBeNull();
    expect((await auditFor("it_ausstattung", item.id))[0]).toMatchObject({
      action: "rueckgabe_zurueckgenommen",
      actorUserId: seed.admin.id,
      details: { alt: { returnDate: "2026-09-30" } },
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/it-management");
  });

  it("meldet unbekannte Ausstattung", async () => {
    await expect(undoEquipmentReturn(randomUUID())).rejects.toThrow(
      "Ausstattung nicht gefunden."
    );
  });

  it("lehnt Mitarbeitende ab", async () => {
    const item = await insertEquipment({ returnDate: "2026-09-30" });
    await expectAdminOnly(() => undoEquipmentReturn(item.id));
    expect((await loadEquipment(item.id)).returnDate).toBe("2026-09-30");
  });
});

describe("deleteEquipment", () => {
  it("löscht die Ausstattung, auditiert und lässt die Protokolle der Person stehen", async () => {
    const item = await insertEquipment();
    const doc = await uploadProtocol();
    await testDb().delete(schema.auditLog);

    await deleteEquipment(item.id);

    expect(await allEquipment()).toHaveLength(0);
    expect((await auditFor("it_ausstattung", item.id))[0]).toMatchObject({
      action: "geloescht",
      actorUserId: seed.admin.id,
      details: {
        deviceId: "SA-IT-2026-01",
        userId: seed.employee.id,
        typeId: types.Laptop.id,
      },
    });
    expect(await allDocuments()).toEqual([expect.objectContaining({ id: doc.id })]);
    expect(blobStore.has(doc.blobUrl)).toBe(true);
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/it-management");
  });

  it("meldet unbekannte Ausstattung", async () => {
    const id = randomUUID();
    await expect(deleteEquipment(id)).rejects.toThrow("Ausstattung nicht gefunden.");
    expect(await auditFor("it_ausstattung", id)).toHaveLength(0);
  });

  it("lehnt Mitarbeitende ab", async () => {
    const item = await insertEquipment();
    await expectAdminOnly(() => deleteEquipment(item.id));
    expect(await allEquipment()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Übergabe- und Rücknahmeprotokolle
// ---------------------------------------------------------------------------

describe("uploadHandoverProtocol", () => {
  it("speichert das Protokoll verschlüsselt und auditiert den Upload", async () => {
    const doc = await uploadProtocol();

    expect(doc).toMatchObject({
      userId: seed.employee.id,
      kind: "uebergabe",
      filename: "uebergabe.pdf",
      contentType: "application/pdf",
      sizeBytes: Buffer.byteLength(PROTOCOL_PDF),
      keyVersion: 1,
      uploadedById: seed.admin.id,
    });
    // Im Blob liegt nur Ciphertext unter einem nichtssagenden Pfad
    const blob = blobStore.get(doc.blobUrl);
    if (!blob) throw new Error("Blob fehlt");
    expect(blob.pathname).toMatch(
      new RegExp(`^it-protokolle/${seed.employee.id}/uebergabe-[0-9a-f-]{36}\\.bin$`)
    );
    expect(blob.contentType).toBe("application/octet-stream");
    expect(blob.body.includes(Buffer.from(PROTOCOL_PDF))).toBe(false);
    expect(blob.body.includes(Buffer.from("%PDF"))).toBe(false);
    expect(decryptDocument(blob.body).toString()).toBe(PROTOCOL_PDF);

    const audit = await auditFor("it_dokument", doc.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "hochgeladen",
      actorUserId: seed.admin.id,
      source: "web",
      details: { userId: seed.employee.id, kind: "uebergabe", filename: "uebergabe.pdf" },
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/it-management");
  });

  it("nimmt auch JPG und PNG an und führt je Art ein eigenes Protokoll", async () => {
    await uploadProtocol("uebergabe", testFile("scan.jpg", "JPEGDATEN", "image/jpeg"));
    await uploadProtocol("ruecknahme", testFile("scan.png", "PNGDATEN", "image/png"));

    const docs = await allDocuments();
    expect(docs.map((d) => [d.kind, d.contentType]).sort()).toEqual([
      ["ruecknahme", "image/png"],
      ["uebergabe", "image/jpeg"],
    ]);
    expect(blobStore.size).toBe(2);
  });

  it("ersetzt ein vorhandenes Protokoll derselben Art samt verschlüsselter Datei", async () => {
    const first = await uploadProtocol("uebergabe", testFile("alt.pdf", "%PDF alt"));
    const second = await uploadProtocol("uebergabe", testFile("neu.pdf", "%PDF neu"));

    expect(second.id).not.toBe(first.id);
    const docs = await allDocuments();
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ id: second.id, filename: "neu.pdf" });

    expect(blobStore.has(first.blobUrl)).toBe(false);
    const blob = blobStore.get(second.blobUrl);
    if (!blob) throw new Error("Blob fehlt");
    expect(decryptDocument(blob.body).toString()).toBe("%PDF neu");
    expect(blobStore.size).toBe(1);

    expect((await auditFor("it_dokument", first.id)).map((a) => a.action)).toEqual([
      "ersetzt",
      "hochgeladen",
    ]);
    expect((await auditFor("it_dokument", first.id))[0].details).toEqual({
      userId: seed.employee.id,
      kind: "uebergabe",
      filename: "alt.pdf",
    });
    expect((await auditFor("it_dokument", second.id))[0]).toMatchObject({
      action: "hochgeladen",
      details: { filename: "neu.pdf" },
    });
  });

  it("lässt das alte Protokoll unberührt, wenn das Speichern der neuen Datei scheitert", async () => {
    const first = await uploadProtocol("uebergabe", testFile("alt.pdf", "%PDF alt"));
    vi.mocked(blobModule.put).mockRejectedValueOnce(new Error("Blob-Speicher nicht erreichbar"));

    await expect(
      uploadHandoverProtocol(
        seed.employee.id,
        "uebergabe",
        protocolForm(testFile("neu.pdf", "%PDF neu"))
      )
    ).rejects.toThrow("Blob-Speicher nicht erreichbar");

    expect(await allDocuments()).toEqual([first]);
    const blob = blobStore.get(first.blobUrl);
    if (!blob) throw new Error("Blob fehlt");
    expect(decryptDocument(blob.body).toString()).toBe("%PDF alt");
    expect(blobStore.size).toBe(1);
    expect((await auditFor("it_dokument")).map((a) => a.action)).toEqual(["hochgeladen"]);
  });

  it("ersetzt auch dann, wenn die alte Datei nicht gelöscht werden kann", async () => {
    const first = await uploadProtocol("uebergabe", testFile("alt.pdf", "%PDF alt"));
    vi.mocked(blobModule.del).mockRejectedValueOnce(new Error("Löschen fehlgeschlagen"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const second = await uploadProtocol("uebergabe", testFile("neu.pdf", "%PDF neu"));

      expect(await allDocuments()).toEqual([expect.objectContaining({ id: second.id })]);
      // Zurück bleibt nur ein verwaister Ciphertext, die DB verweist nicht darauf
      expect(blobStore.has(first.blobUrl)).toBe(true);
      expect(consoleError).toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("lehnt unbekannte Protokollarten und Personen ab", async () => {
    await expect(
      uploadHandoverProtocol(
        seed.employee.id,
        "sonstiges" as schema.HandoverProtocolKind,
        protocolForm()
      )
    ).rejects.toThrow("Unbekannte Protokollart.");
    await expect(
      uploadHandoverProtocol(randomUUID(), "uebergabe", protocolForm())
    ).rejects.toThrow("Mitarbeiter/in nicht gefunden.");
    expect(blobModule.put).not.toHaveBeenCalled();
    expect(await allDocuments()).toHaveLength(0);
  });

  it("verlangt genau eine Datei", async () => {
    await expect(
      uploadHandoverProtocol(seed.employee.id, "uebergabe", formData({}))
    ).rejects.toThrow("Bitte eine Datei auswählen.");
    await expect(
      uploadHandoverProtocol(seed.employee.id, "uebergabe", protocolForm(testFile("leer.pdf", "")))
    ).rejects.toThrow("Bitte eine Datei auswählen.");
    await expect(
      uploadHandoverProtocol(
        seed.employee.id,
        "uebergabe",
        protocolForm([testFile("a.pdf"), testFile("b.pdf")])
      )
    ).rejects.toThrow("Pro Protokoll ist genau eine Datei zulässig.");
    expect(blobModule.put).not.toHaveBeenCalled();
    expect(await allDocuments()).toHaveLength(0);
  });

  it("lehnt falsche Dateitypen und Dateien über 10 MB ab", async () => {
    await expect(
      uploadHandoverProtocol(
        seed.employee.id,
        "uebergabe",
        protocolForm(testFile("notiz.txt", "hallo", "text/plain"))
      )
    ).rejects.toThrow('Protokoll "notiz.txt": Nur PDF, JPG oder PNG sind zulässig.');
    await expect(
      uploadHandoverProtocol(
        seed.employee.id,
        "uebergabe",
        protocolForm(testFile("gross.pdf", Buffer.alloc(10 * 1024 * 1024 + 1)))
      )
    ).rejects.toThrow('Protokoll "gross.pdf": Maximal 10 MB sind zulässig.');
    expect(blobModule.put).not.toHaveBeenCalled();
    expect(await allDocuments()).toHaveLength(0);
  });

  it("lehnt Mitarbeitende ab", async () => {
    await expectAdminOnly(() =>
      uploadHandoverProtocol(seed.employee.id, "uebergabe", protocolForm())
    );
    expect(blobModule.put).not.toHaveBeenCalled();
    expect(await allDocuments()).toHaveLength(0);
  });
});

describe("deleteHandoverProtocol", () => {
  it("löscht Zeile und verschlüsselte Datei und auditiert", async () => {
    const doc = await uploadProtocol();

    await deleteHandoverProtocol(doc.id);

    expect(await allDocuments()).toHaveLength(0);
    expect(blobStore.has(doc.blobUrl)).toBe(false);
    expect((await auditFor("it_dokument", doc.id))[0]).toMatchObject({
      action: "geloescht",
      actorUserId: seed.admin.id,
      details: { userId: seed.employee.id, kind: "uebergabe", filename: "uebergabe.pdf" },
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/it-management");
  });

  it("gelingt auch, wenn die Datei im Blob-Store nicht gelöscht werden kann", async () => {
    const doc = await uploadProtocol();
    vi.mocked(blobModule.del).mockRejectedValueOnce(new Error("Löschen fehlgeschlagen"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await deleteHandoverProtocol(doc.id);
    } finally {
      consoleError.mockRestore();
    }

    expect(await allDocuments()).toHaveLength(0);
    expect(blobStore.has(doc.blobUrl)).toBe(true);
    expect((await auditFor("it_dokument", doc.id))[0].action).toBe("geloescht");
  });

  it("meldet unbekannte Protokolle", async () => {
    const id = randomUUID();
    await expect(deleteHandoverProtocol(id)).rejects.toThrow("Protokoll nicht gefunden.");
    expect(await auditFor("it_dokument", id)).toHaveLength(0);
  });

  it("lehnt Mitarbeitende ab", async () => {
    const doc = await uploadProtocol();
    await testDb().delete(schema.auditLog);
    await expectAdminOnly(() => deleteHandoverProtocol(doc.id));
    expect(await allDocuments()).toHaveLength(1);
    expect(blobStore.has(doc.blobUrl)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CSV-Import
// ---------------------------------------------------------------------------

/**
 * Ausgangslage für den Abgleich: vier Geräte. Die Datei lässt 01 unverändert,
 * ändert 02, benennt 03 um und ordnet es neu zu, lässt 04 weg (→ löschen)
 * und legt 05 neu an.
 */
async function importScenario() {
  const colleague = await createUser({
    email: `clara-${randomUUID().slice(0, 8)}@stefanai.de`,
    firstName: "Clara",
    lastName: "Kollegin",
  });
  const unchanged = await insertEquipment({
    deviceId: "SA-IT-2026-01",
    serialNumber: "S-01",
  });
  const changed = await insertEquipment({
    deviceId: "SA-IT-2026-02",
    typeId: types.Maus.id,
  });
  const renamed = await insertEquipment({
    deviceId: "SA-IT-2026-03",
    typeId: types.Kopfhörer.id,
  });
  const removed = await insertEquipment({
    deviceId: "SA-IT-2026-04",
    typeId: types.Rucksack.id,
  });

  const email = seed.employee.email;
  const rows = [
    {
      deviceId: "SA-IT-2026-01",
      email,
      typeName: "Laptop",
      serialNumber: "S-01",
      handoverDate: "03.08.2026",
      status: "im Einsatz",
    },
    {
      deviceId: "SA-IT-2026-02",
      email,
      typeName: "maus",
      serialNumber: "M-02",
      handoverDate: "2026-08-03",
      returnDate: "15.09.2026",
      notes: "Mausrad defekt",
    },
    {
      deviceId: "SA-IT-2026-03",
      newDeviceId: "SA-IT-2026-30",
      email: colleague.email.toUpperCase(),
      typeName: "Kopfhörer",
      handoverDate: "03.08.2026",
    },
    {
      deviceId: "SA-IT-2026-05",
      email: colleague.email,
      typeName: "Laptop",
      serialNumber: "NEU-05",
      handoverDate: "01.10.2026",
    },
  ];
  return { colleague, unchanged, changed, renamed, removed, rows };
}

const SCENARIO_SUMMARY = {
  create: ["SA-IT-2026-05"],
  update: ["SA-IT-2026-02", "SA-IT-2026-03 → SA-IT-2026-30"],
  unchanged: ["SA-IT-2026-01"],
  remove: ["SA-IT-2026-04"],
};

describe("analyzeEquipmentImport", () => {
  it("zeigt die Vorschau, ohne etwas zu schreiben", async () => {
    const { rows } = await importScenario();
    const before = await allEquipment();

    const outcome = await analyzeEquipmentImport(importForm(importCsv(rows)));

    expect(outcome).toEqual({ ok: true, summary: SCENARIO_SUMMARY });
    expect(await allEquipment()).toEqual(expect.arrayContaining(before));
    expect(await allEquipment()).toHaveLength(4);
    expect(await auditFor("it_ausstattung")).toHaveLength(0);
    expect(nextCacheModule.revalidatePath).not.toHaveBeenCalled();
  });

  it("verlangt eine Datei", async () => {
    expect(await analyzeEquipmentImport(formData({}))).toEqual({
      ok: false,
      errors: ["Bitte eine CSV-Datei auswählen."],
    });
    expect(await analyzeEquipmentImport(importForm(""))).toEqual({
      ok: false,
      errors: ["Bitte eine CSV-Datei auswählen."],
    });
  });

  it("lehnt andere Dateiendungen ab, akzeptiert aber .CSV", async () => {
    expect(await analyzeEquipmentImport(importForm("x", "ausstattung.xlsx"))).toEqual({
      ok: false,
      errors: [
        "„ausstattung.xlsx“ ist keine CSV-Datei. Bitte in Excel über „Speichern unter“ als CSV ablegen.",
      ],
    });
    const { rows } = await importScenario();
    const outcome = await analyzeEquipmentImport(importForm(importCsv(rows), "LISTE.CSV"));
    expect(outcome.ok).toBe(true);
  });

  it("lehnt Dateien über 1 MB ab", async () => {
    expect(
      await analyzeEquipmentImport(importForm("a".repeat(1024 * 1024 + 1)))
    ).toEqual({ ok: false, errors: ["Die Datei ist größer als 1 MB."] });
  });

  it("meldet Fehler in der Datei mit Zeilennummer", async () => {
    const outcome = await analyzeEquipmentImport(
      importForm(
        importCsv([
          {
            deviceId: "SA-IT-2026-01",
            email: "unbekannt@stefanai.de",
            typeName: "Laptop",
            handoverDate: "03.08.2026",
          },
          {
            deviceId: "SA-IT-2026-02",
            email: seed.employee.email,
            typeName: "Beamer",
            handoverDate: "03.08.2026",
          },
        ])
      )
    );
    expect(outcome).toEqual({
      ok: false,
      errors: [
        "Zeile 2: Zu der E-Mail-Adresse „unbekannt@stefanai.de“ gibt es keine/n Mitarbeiter/in.",
        "Zeile 3: Die Ausstattungsart „Beamer“ ist unbekannt. Bitte zuerst im Reiter „Ausstattungsarten“ anlegen.",
      ],
    });
  });

  it("liest Excel-Dateien in Windows-1252 mit Umlauten", async () => {
    const text = importCsv([
      {
        deviceId: "SA-IT-2026-09",
        email: seed.employee.email,
        typeName: "Kopfhörer",
        handoverDate: "03.08.2026",
      },
    ]);
    const outcome = await analyzeEquipmentImport(importForm(Buffer.from(text, "latin1")));
    expect(outcome).toEqual({
      ok: true,
      summary: { create: ["SA-IT-2026-09"], update: [], unchanged: [], remove: [] },
    });
  });

  it("lehnt Mitarbeitende ab", async () => {
    await expectAdminOnly(() => analyzeEquipmentImport(importForm(importCsv([]))));
  });
});

describe("applyEquipmentImport", () => {
  it("legt an, ändert, benennt um, löscht fehlende Geräte und auditiert", async () => {
    const { colleague, unchanged, changed, renamed, removed, rows } =
      await importScenario();

    const outcome = await applyEquipmentImport(importForm(importCsv(rows)));

    expect(outcome).toEqual({ ok: true, summary: SCENARIO_SUMMARY });
    const items = await allEquipment();
    expect(items.map((i) => i.deviceId).sort()).toEqual([
      "SA-IT-2026-01",
      "SA-IT-2026-02",
      "SA-IT-2026-05",
      "SA-IT-2026-30",
    ]);
    expect(items.find((i) => i.id === removed.id)).toBeUndefined();
    // Unveränderte Zeilen werden nicht angefasst
    expect(await loadEquipment(unchanged.id)).toEqual(unchanged);
    expect(await loadEquipment(changed.id)).toMatchObject({
      typeId: types.Maus.id,
      serialNumber: "M-02",
      returnDate: "2026-09-15",
      notes: "Mausrad defekt",
    });
    // Umbenennen behält den Datensatz (gleiche ID) und ordnet neu zu
    expect(await loadEquipment(renamed.id)).toMatchObject({
      deviceId: "SA-IT-2026-30",
      userId: colleague.id,
      typeId: types.Kopfhörer.id,
    });
    expect(items.find((i) => i.deviceId === "SA-IT-2026-05")).toMatchObject({
      userId: colleague.id,
      typeId: types.Laptop.id,
      serialNumber: "NEU-05",
      handoverDate: "2026-10-01",
      returnDate: null,
      createdById: seed.admin.id,
    });

    const audits = await importAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      objectId: null,
      actorUserId: seed.admin.id,
      source: "web",
      details: {
        neu: ["SA-IT-2026-05"],
        aktualisiert: ["SA-IT-2026-02", "SA-IT-2026-03 → SA-IT-2026-30"],
        geloescht: ["SA-IT-2026-04"],
        unveraendert: 1,
      },
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/it-management");
  });

  it("vergibt die Geräte-ID eines entfernten Geräts im selben Durchgang neu", async () => {
    const kept = await insertEquipment({ deviceId: "SA-IT-2026-01" });
    await insertEquipment({ deviceId: "SA-IT-2026-02" });

    const outcome = await applyEquipmentImport(
      importForm(
        importCsv([
          {
            deviceId: "SA-IT-2026-01",
            newDeviceId: "SA-IT-2026-02",
            email: seed.employee.email,
            typeName: "Laptop",
            handoverDate: "03.08.2026",
          },
        ])
      )
    );

    expect(outcome).toEqual({
      ok: true,
      summary: {
        create: [],
        update: ["SA-IT-2026-01 → SA-IT-2026-02"],
        unchanged: [],
        remove: ["SA-IT-2026-02"],
      },
    });
    expect(await allEquipment()).toEqual([
      expect.objectContaining({ id: kept.id, deviceId: "SA-IT-2026-02" }),
    ]);
  });

  it("schreibt bei einem Fehler in der Datei nichts", async () => {
    const { rows } = await importScenario();
    const before = await allEquipment();

    const outcome = await applyEquipmentImport(
      importForm(
        importCsv([
          ...rows,
          {
            deviceId: "SA-IT-2026-06",
            email: seed.employee.email,
            typeName: "Laptop",
            handoverDate: "31.02.2026",
          },
        ])
      )
    );

    expect(outcome).toEqual({
      ok: false,
      errors: ["Zeile 6: Übernahme am „31.02.2026“ ist kein gültiger Kalendertag."],
    });
    expect(await allEquipment()).toHaveLength(4);
    expect(await allEquipment()).toEqual(expect.arrayContaining(before));
    expect(await importAudits()).toHaveLength(0);
    expect(nextCacheModule.revalidatePath).not.toHaveBeenCalled();
  });

  it("rollt alles zurück, wenn die Datenbank eine Anweisung ablehnt", async () => {
    const { rows } = await importScenario();
    const before = await allEquipment();
    // Postgres lehnt NUL-Zeichen in Texten ab — erst beim Anlegen, also nach
    // dem Löschen und Ändern im selben Batch
    const broken = rows.map((row) =>
      row.deviceId === "SA-IT-2026-05" ? { ...row, notes: "kaputt\u0000" } : row
    );

    await expect(applyEquipmentImport(importForm(importCsv(broken)))).rejects.toThrow(
      "invalid byte sequence"
    );

    expect(await allEquipment()).toHaveLength(4);
    expect(await allEquipment()).toEqual(expect.arrayContaining(before));
    expect(await importAudits()).toHaveLength(0);
  });

  it("meldet Dateifehler, ohne zu schreiben", async () => {
    await insertEquipment();
    expect(await applyEquipmentImport(importForm("x", "liste.txt"))).toEqual({
      ok: false,
      errors: [
        "„liste.txt“ ist keine CSV-Datei. Bitte in Excel über „Speichern unter“ als CSV ablegen.",
      ],
    });
    // Eine Datei ohne Datenzeilen leert die Liste bewusst nicht
    const outcome = await applyEquipmentImport(importForm(importCsv([])));
    expect(outcome.ok).toBe(false);
    expect(await allEquipment()).toHaveLength(1);
    expect(await importAudits()).toHaveLength(0);
  });

  it("auditiert auch einen Import ohne Änderungen", async () => {
    const item = await insertEquipment();
    const outcome = await applyEquipmentImport(
      importForm(
        importCsv([
          {
            deviceId: item.deviceId,
            email: seed.employee.email,
            typeName: "Laptop",
            handoverDate: "03.08.2026",
          },
        ])
      )
    );
    expect(outcome).toEqual({
      ok: true,
      summary: { create: [], update: [], unchanged: ["SA-IT-2026-01"], remove: [] },
    });
    expect(await loadEquipment(item.id)).toEqual(item);
    expect((await importAudits())[0].details).toEqual({
      neu: [],
      aktualisiert: [],
      geloescht: [],
      unveraendert: 1,
    });
  });

  it("lehnt Mitarbeitende ab", async () => {
    const { rows } = await importScenario();
    await expectAdminOnly(() => applyEquipmentImport(importForm(importCsv(rows))));
    expect(await allEquipment()).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// Ausstattungsarten
// ---------------------------------------------------------------------------

describe("createEquipmentType", () => {
  it("legt die Art an und auditiert", async () => {
    await createEquipmentType(formData({ name: "  Monitor ", sortOrder: "70" }));

    const type = await loadType("Monitor");
    expect(type).toMatchObject({ name: "Monitor", sortOrder: 70, active: true });
    expect((await auditFor("it_ausstattungsart", type.id))[0]).toMatchObject({
      action: "erstellt",
      actorUserId: seed.admin.id,
      source: "web",
      details: { name: "Monitor" },
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/it-management");
  });

  it("lehnt einen vorhandenen Namen ab", async () => {
    await expect(createEquipmentType(formData({ name: " Laptop " }))).rejects.toThrow(
      "Die Ausstattungsart „Laptop“ existiert bereits."
    );
    expect(await testDb().select().from(schema.itEquipmentTypes)).toHaveLength(6);
  });

  it("unterscheidet derzeit Groß- und Kleinschreibung (der CSV-Import nicht)", async () => {
    await createEquipmentType(formData({ name: "laptop" }));
    expect(await loadType("laptop")).toBeDefined();
  });

  it("prüft Bezeichnung und Sortierung", async () => {
    await expect(createEquipmentType(formData({ name: " " }))).rejects.toThrow(
      "Bezeichnung ist erforderlich."
    );
    await expect(createEquipmentType(formData({ name: "X".repeat(81) }))).rejects.toThrow(
      "Die Bezeichnung ist zu lang (max. 80 Zeichen)."
    );
    await expect(
      createEquipmentType(formData({ name: "Monitor", sortOrder: "-1" }))
    ).rejects.toThrow("Ungültige Sortierung.");
    expect(await testDb().select().from(schema.itEquipmentTypes)).toHaveLength(6);
  });

  it("lehnt Mitarbeitende ab", async () => {
    await expectAdminOnly(() => createEquipmentType(formData({ name: "Monitor" })));
    expect(await loadType("Monitor")).toBeUndefined();
  });
});

describe("updateEquipmentType", () => {
  it("benennt die Art um und auditiert", async () => {
    const id = types.Maus.id;
    await updateEquipmentType(formData({ id, name: "Maus kabellos", sortOrder: "25" }));

    expect(await loadType("Maus kabellos")).toMatchObject({ id, sortOrder: 25 });
    expect((await auditFor("it_ausstattungsart", id))[0]).toMatchObject({
      action: "aktualisiert",
      details: { name: "Maus kabellos" },
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/it-management");
  });

  it("erlaubt den eigenen Namen", async () => {
    const id = types.Maus.id;
    await updateEquipmentType(formData({ id, name: "Maus", sortOrder: "5" }));
    expect((await loadType("Maus")).sortOrder).toBe(5);
  });

  it("lehnt den Namen einer anderen Art ab", async () => {
    const id = types.Maus.id;
    await expect(
      updateEquipmentType(formData({ id, name: "Laptop", sortOrder: "5" }))
    ).rejects.toThrow("Die Ausstattungsart „Laptop“ existiert bereits.");
    expect(await loadType("Maus")).toMatchObject({ id, sortOrder: 20 });
  });

  it("verlangt ID und Bezeichnung", async () => {
    await expect(updateEquipmentType(formData({ name: "Monitor" }))).rejects.toThrow(
      "ID ist erforderlich."
    );
    await expect(
      updateEquipmentType(formData({ id: types.Maus.id, name: "" }))
    ).rejects.toThrow("Bezeichnung ist erforderlich.");
  });

  it("lehnt eine unbekannte ID ab und auditiert nichts", async () => {
    const id = randomUUID();
    await expect(updateEquipmentType(formData({ id, name: "Monitor" }))).rejects.toThrow(
      "Ausstattungsart nicht gefunden."
    );
    expect(await loadType("Monitor")).toBeUndefined();
    expect(await auditFor("it_ausstattungsart", id)).toHaveLength(0);
  });

  it("lehnt Mitarbeitende ab", async () => {
    await expectAdminOnly(() =>
      updateEquipmentType(formData({ id: types.Maus.id, name: "Ratte" }))
    );
    expect(await loadType("Maus")).toBeDefined();
  });
});

describe("toggleEquipmentType", () => {
  it("blendet die Art aus und wieder ein", async () => {
    const id = types.Koffer.id;

    await toggleEquipmentType(id);
    expect((await loadType("Koffer")).active).toBe(false);
    expect((await auditFor("it_ausstattungsart", id))[0]).toMatchObject({
      action: "deaktiviert",
      details: { name: "Koffer" },
    });

    await toggleEquipmentType(id);
    expect((await loadType("Koffer")).active).toBe(true);
    expect(
      (await auditFor("it_ausstattungsart", id)).map((a) => a.action).sort()
    ).toEqual(["aktiviert", "deaktiviert"]);
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/it-management");
  });

  it("meldet unbekannte Arten", async () => {
    await expect(toggleEquipmentType(randomUUID())).rejects.toThrow(
      "Ausstattungsart nicht gefunden."
    );
  });

  it("lehnt Mitarbeitende ab", async () => {
    await expectAdminOnly(() => toggleEquipmentType(types.Koffer.id));
    expect((await loadType("Koffer")).active).toBe(true);
  });
});

describe("deleteEquipmentType", () => {
  it("löscht eine unbenutzte Art und auditiert", async () => {
    const id = types.Koffer.id;

    await deleteEquipmentType(id);

    expect(await loadType("Koffer")).toBeUndefined();
    expect((await auditFor("it_ausstattungsart", id))[0]).toMatchObject({
      action: "geloescht",
      actorUserId: seed.admin.id,
      details: { name: "Koffer" },
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/it-management");
  });

  it("lehnt das Löschen einer verwendeten Art ab — auch bei zurückgegebenen Geräten", async () => {
    await insertEquipment({ typeId: types.Rucksack.id, returnDate: "2026-09-01" });

    await expect(deleteEquipmentType(types.Rucksack.id)).rejects.toThrow(
      "„Rucksack“ wird noch verwendet und kann nicht gelöscht werden — bitte stattdessen ausblenden."
    );
    expect(await loadType("Rucksack")).toBeDefined();
    expect(await auditFor("it_ausstattungsart", types.Rucksack.id)).toHaveLength(0);
  });

  it("meldet unbekannte Arten", async () => {
    await expect(deleteEquipmentType(randomUUID())).rejects.toThrow(
      "Ausstattungsart nicht gefunden."
    );
  });

  it("lehnt Mitarbeitende ab", async () => {
    await expectAdminOnly(() => deleteEquipmentType(types.Koffer.id));
    expect(await loadType("Koffer")).toBeDefined();
  });
});
