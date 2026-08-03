"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { del, put } from "@vercel/blob";
import {
  db,
  itEquipment,
  itEquipmentDocuments,
  itEquipmentTypes,
  users,
  type ItEquipment,
  type User,
} from "@/db";
import { writeAudit } from "@/lib/audit";
import { fullName, requireAdmin } from "@/lib/auth";
import { parseSortOrder, requireNonEmpty } from "@/lib/content";
import { DOCUMENT_KEY_VERSION, encryptDocument } from "@/lib/document-crypto";
import {
  parseEquipmentDates,
  parseEquipmentInput,
  parseEquipmentTypeName,
} from "@/lib/it-equipment";

const ALLOWED_DOCUMENT_TYPES = ["application/pdf", "image/jpeg", "image/png"];
const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024;

function revalidateEquipment() {
  revalidatePath("/it-management");
}

/** Übergabeprotokolle aus dem FormData holen und validieren (Typ + Größe). */
function extractProtocolFiles(formData: FormData): File[] {
  const files = formData
    .getAll("documents")
    .filter((f): f is File => f instanceof File && f.size > 0);
  for (const file of files) {
    if (!ALLOWED_DOCUMENT_TYPES.includes(file.type))
      throw new Error(
        `Protokoll "${file.name}": Nur PDF, JPG oder PNG sind zulässig.`
      );
    if (file.size > MAX_DOCUMENT_SIZE_BYTES)
      throw new Error(
        `Protokoll "${file.name}": Maximal 10 MB pro Datei sind zulässig.`
      );
  }
  return files;
}

/**
 * Protokoll serverseitig mit AES-256-GCM verschlüsseln und als unlesbaren
 * Binär-Blob ablegen. Klartext verlässt den Server-Prozess nie.
 */
async function storeEncryptedProtocol(opts: {
  equipmentId: string;
  file: File;
  admin: User;
}): Promise<void> {
  const plain = Buffer.from(await opts.file.arrayBuffer());
  const encrypted = encryptDocument(plain);

  // Pfad und Inhalt lassen keinen Rückschluss auf das Dokument zu
  const blob = await put(
    `it-ausstattung/${opts.equipmentId}/${crypto.randomUUID()}.bin`,
    encrypted,
    {
      access: "public",
      addRandomSuffix: false,
      contentType: "application/octet-stream",
    }
  );

  const [doc] = await db
    .insert(itEquipmentDocuments)
    .values({
      equipmentId: opts.equipmentId,
      filename: opts.file.name,
      contentType: opts.file.type,
      sizeBytes: opts.file.size,
      blobUrl: blob.url,
      keyVersion: DOCUMENT_KEY_VERSION,
      uploadedById: opts.admin.id,
    })
    .returning();

  await writeAudit({
    objectType: "it_dokument",
    objectId: doc.id,
    action: "hochgeladen",
    actorUserId: opts.admin.id,
    actorLabel: fullName(opts.admin),
    source: "web",
    details: { equipmentId: opts.equipmentId, filename: opts.file.name },
  });
}

async function findEquipment(id: string): Promise<ItEquipment> {
  const row = await db.query.itEquipment.findFirst({
    where: eq(itEquipment.id, id),
  });
  if (!row) throw new Error("Ausstattung nicht gefunden.");
  return row;
}

/** Prüft, dass Mitarbeiter/in und Ausstattungsart tatsächlich existieren. */
async function assertReferences(userId: string, typeId: string) {
  const [user, type] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.id, userId) }),
    db.query.itEquipmentTypes.findFirst({ where: eq(itEquipmentTypes.id, typeId) }),
  ]);
  if (!user) throw new Error("Mitarbeiter/in nicht gefunden.");
  if (!type) throw new Error("Ausstattungsart nicht gefunden.");
}

// ---------------------------------------------------------------------------
// Ausstattung
// ---------------------------------------------------------------------------

export async function createEquipment(formData: FormData) {
  const admin = await requireAdmin();
  const input = parseEquipmentInput({
    userId: String(formData.get("userId") ?? ""),
    typeId: String(formData.get("typeId") ?? ""),
    serialNumber: String(formData.get("serialNumber") ?? ""),
    notes: String(formData.get("notes") ?? ""),
    handoverDate: String(formData.get("handoverDate") ?? ""),
    returnDate: String(formData.get("returnDate") ?? ""),
  });
  await assertReferences(input.userId, input.typeId);

  // Dateien vor dem Insert prüfen, damit eine ungültige Datei nicht zu
  // einem Eintrag ohne Protokoll führt.
  const files = extractProtocolFiles(formData);

  const [row] = await db
    .insert(itEquipment)
    .values({ ...input, createdById: admin.id })
    .returning();

  for (const file of files) {
    await storeEncryptedProtocol({ equipmentId: row.id, file, admin });
  }

  await writeAudit({
    objectType: "it_ausstattung",
    objectId: row.id,
    action: "erstellt",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
    details: {
      userId: input.userId,
      typeId: input.typeId,
      handoverDate: input.handoverDate,
    },
  });
  revalidateEquipment();
}

export async function updateEquipment(formData: FormData) {
  const admin = await requireAdmin();
  const id = requireNonEmpty(String(formData.get("id") ?? ""), "ID");
  const existing = await findEquipment(id);
  const input = parseEquipmentInput({
    userId: String(formData.get("userId") ?? ""),
    typeId: String(formData.get("typeId") ?? ""),
    serialNumber: String(formData.get("serialNumber") ?? ""),
    notes: String(formData.get("notes") ?? ""),
    handoverDate: String(formData.get("handoverDate") ?? ""),
    returnDate: String(formData.get("returnDate") ?? ""),
  });
  await assertReferences(input.userId, input.typeId);

  await db
    .update(itEquipment)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(itEquipment.id, id));

  await writeAudit({
    objectType: "it_ausstattung",
    objectId: id,
    action: "aktualisiert",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
    details: {
      alt: {
        userId: existing.userId,
        typeId: existing.typeId,
        handoverDate: existing.handoverDate,
        returnDate: existing.returnDate,
      },
      neu: {
        userId: input.userId,
        typeId: input.typeId,
        handoverDate: input.handoverDate,
        returnDate: input.returnDate,
      },
    },
  });
  revalidateEquipment();
}

/** Rückgabe erfassen — das Datum darf nicht vor der Übernahme liegen. */
export async function markEquipmentReturned(id: string, formData: FormData) {
  const admin = await requireAdmin();
  const existing = await findEquipment(id);
  const raw = String(formData.get("returnDate") ?? "");
  if (!raw.trim()) throw new Error("Bitte ein Rückgabedatum angeben.");
  const { returnDate } = parseEquipmentDates(existing.handoverDate, raw);

  await db
    .update(itEquipment)
    .set({ returnDate, updatedAt: new Date() })
    .where(eq(itEquipment.id, id));

  await writeAudit({
    objectType: "it_ausstattung",
    objectId: id,
    action: "zurueckgegeben",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
    details: { returnDate },
  });
  revalidateEquipment();
}

/** Rückgabe rückgängig machen — die Ausstattung gilt wieder als im Einsatz. */
export async function undoEquipmentReturn(id: string) {
  const admin = await requireAdmin();
  const existing = await findEquipment(id);

  await db
    .update(itEquipment)
    .set({ returnDate: null, updatedAt: new Date() })
    .where(eq(itEquipment.id, id));

  await writeAudit({
    objectType: "it_ausstattung",
    objectId: id,
    action: "rueckgabe_zurueckgenommen",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
    details: { alt: { returnDate: existing.returnDate } },
  });
  revalidateEquipment();
}

/** Ausstattung endgültig löschen — inklusive aller Protokolle im Blob-Store. */
export async function deleteEquipment(id: string) {
  const admin = await requireAdmin();
  const existing = await findEquipment(id);

  const docs = await db
    .select()
    .from(itEquipmentDocuments)
    .where(eq(itEquipmentDocuments.equipmentId, id));
  for (const doc of docs) {
    await del(doc.blobUrl);
  }

  // Audit vor dem Löschen schreiben (Audit-Log hat keinen Fremdschlüssel)
  await writeAudit({
    objectType: "it_ausstattung",
    objectId: id,
    action: "geloescht",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
    details: {
      userId: existing.userId,
      typeId: existing.typeId,
      protokolle: docs.length,
    },
  });

  // Die Protokoll-Zeilen entfernt Postgres per ON DELETE CASCADE
  await db.delete(itEquipment).where(eq(itEquipment.id, id));

  revalidateEquipment();
}

// ---------------------------------------------------------------------------
// Übergabeprotokolle
// ---------------------------------------------------------------------------

export async function uploadEquipmentDocuments(
  equipmentId: string,
  formData: FormData
) {
  const admin = await requireAdmin();
  await findEquipment(equipmentId);

  const files = extractProtocolFiles(formData);
  if (files.length === 0)
    throw new Error("Bitte mindestens eine Datei auswählen.");

  for (const file of files) {
    await storeEncryptedProtocol({ equipmentId, file, admin });
  }

  revalidateEquipment();
}

export async function deleteEquipmentDocument(documentId: string) {
  const admin = await requireAdmin();
  const doc = await db.query.itEquipmentDocuments.findFirst({
    where: eq(itEquipmentDocuments.id, documentId),
  });
  if (!doc) throw new Error("Protokoll nicht gefunden.");

  await del(doc.blobUrl);

  await writeAudit({
    objectType: "it_dokument",
    objectId: doc.id,
    action: "geloescht",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
    details: { equipmentId: doc.equipmentId, filename: doc.filename },
  });

  await db
    .delete(itEquipmentDocuments)
    .where(eq(itEquipmentDocuments.id, documentId));

  revalidateEquipment();
}

// ---------------------------------------------------------------------------
// Ausstattungsarten
// ---------------------------------------------------------------------------

/** Name je Art eindeutig — sonst laufen Auswertungen auf Dubletten. */
async function assertUniqueTypeName(name: string, exceptId?: string) {
  const existing = await db.query.itEquipmentTypes.findFirst({
    where: eq(itEquipmentTypes.name, name),
  });
  if (existing && existing.id !== exceptId)
    throw new Error(`Die Ausstattungsart „${name}“ existiert bereits.`);
}

export async function createEquipmentType(formData: FormData) {
  const admin = await requireAdmin();
  const name = parseEquipmentTypeName(String(formData.get("name") ?? ""));
  const sortOrder = parseSortOrder(String(formData.get("sortOrder") ?? "0"));
  await assertUniqueTypeName(name);

  const [row] = await db
    .insert(itEquipmentTypes)
    .values({ name, sortOrder })
    .returning();

  await writeAudit({
    objectType: "it_ausstattungsart",
    objectId: row.id,
    action: "erstellt",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
    details: { name },
  });
  revalidateEquipment();
}

export async function updateEquipmentType(formData: FormData) {
  const admin = await requireAdmin();
  const id = requireNonEmpty(String(formData.get("id") ?? ""), "ID");
  const name = parseEquipmentTypeName(String(formData.get("name") ?? ""));
  const sortOrder = parseSortOrder(String(formData.get("sortOrder") ?? "0"));
  await assertUniqueTypeName(name, id);

  await db
    .update(itEquipmentTypes)
    .set({ name, sortOrder, updatedAt: new Date() })
    .where(eq(itEquipmentTypes.id, id));

  await writeAudit({
    objectType: "it_ausstattungsart",
    objectId: id,
    action: "aktualisiert",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
    details: { name },
  });
  revalidateEquipment();
}

export async function toggleEquipmentType(id: string) {
  const admin = await requireAdmin();
  const row = await db.query.itEquipmentTypes.findFirst({
    where: eq(itEquipmentTypes.id, id),
  });
  if (!row) throw new Error("Ausstattungsart nicht gefunden.");

  await db
    .update(itEquipmentTypes)
    .set({ active: !row.active, updatedAt: new Date() })
    .where(eq(itEquipmentTypes.id, id));

  await writeAudit({
    objectType: "it_ausstattungsart",
    objectId: id,
    action: row.active ? "deaktiviert" : "aktiviert",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
    details: { name: row.name },
  });
  revalidateEquipment();
}

/**
 * Löschen nur, solange die Art nirgends verwendet wird — sonst bliebe die
 * Historie zurückgegebener Geräte ohne Bezeichnung zurück.
 */
export async function deleteEquipmentType(id: string) {
  const admin = await requireAdmin();
  const row = await db.query.itEquipmentTypes.findFirst({
    where: eq(itEquipmentTypes.id, id),
  });
  if (!row) throw new Error("Ausstattungsart nicht gefunden.");

  const inUse = await db.query.itEquipment.findFirst({
    where: eq(itEquipment.typeId, id),
  });
  if (inUse)
    throw new Error(
      `„${row.name}“ wird noch verwendet und kann nicht gelöscht werden — bitte stattdessen ausblenden.`
    );

  await db.delete(itEquipmentTypes).where(eq(itEquipmentTypes.id, id));

  await writeAudit({
    objectType: "it_ausstattungsart",
    objectId: id,
    action: "geloescht",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
    details: { name: row.name },
  });
  revalidateEquipment();
}
