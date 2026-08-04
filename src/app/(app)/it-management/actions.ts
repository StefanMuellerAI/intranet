"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { del, put } from "@vercel/blob";
import {
  HANDOVER_PROTOCOL_KINDS,
  db,
  itEquipment,
  itEquipmentDocuments,
  itEquipmentTypes,
  users,
  type HandoverProtocolKind,
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
import {
  decodeCsvUpload,
  planEquipmentImport,
  type EquipmentImportPlan,
  type EquipmentImportResult,
} from "@/lib/it-equipment-csv";
import { getImportContext } from "@/lib/it-equipment-store";

/** Anweisungstyp für db.batch — alle Schreibvorgänge in einer Transaktion. */
type BatchStatement = Parameters<typeof db.batch>[0][number];

const ALLOWED_DOCUMENT_TYPES = ["application/pdf", "image/jpeg", "image/png"];
const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024;

function revalidateEquipment() {
  revalidatePath("/it-management");
}

/**
 * Genau ein Protokoll aus dem FormData holen und validieren (Typ + Größe).
 * Je Person und Art ist bewusst nur ein Dokument vorgesehen.
 */
function extractProtocolFile(formData: FormData): File {
  const files = formData
    .getAll("document")
    .filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) throw new Error("Bitte eine Datei auswählen.");
  if (files.length > 1)
    throw new Error("Pro Protokoll ist genau eine Datei zulässig.");

  const [file] = files;
  if (!ALLOWED_DOCUMENT_TYPES.includes(file.type))
    throw new Error(
      `Protokoll "${file.name}": Nur PDF, JPG oder PNG sind zulässig.`
    );
  if (file.size > MAX_DOCUMENT_SIZE_BYTES)
    throw new Error(`Protokoll "${file.name}": Maximal 10 MB sind zulässig.`);
  return file;
}

/**
 * Protokoll serverseitig mit AES-256-GCM verschlüsseln und als unlesbaren
 * Binär-Blob ablegen. Klartext verlässt den Server-Prozess nie.
 */
async function storeEncryptedProtocol(opts: {
  userId: string;
  kind: HandoverProtocolKind;
  file: File;
  admin: User;
}): Promise<void> {
  const plain = Buffer.from(await opts.file.arrayBuffer());
  const encrypted = encryptDocument(plain);

  // Pfad und Inhalt lassen keinen Rückschluss auf das Dokument zu
  const blob = await put(
    `it-protokolle/${opts.userId}/${opts.kind}-${crypto.randomUUID()}.bin`,
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
      userId: opts.userId,
      kind: opts.kind,
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
    details: {
      userId: opts.userId,
      kind: opts.kind,
      filename: opts.file.name,
    },
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

/**
 * Geräte-ID je Gerät eindeutig — sie ist der Schlüssel, über den der
 * CSV-Import bestehende Geräte wiedererkennt.
 */
async function assertUniqueDeviceId(deviceId: string, exceptId?: string) {
  const existing = await db.query.itEquipment.findFirst({
    where: eq(itEquipment.deviceId, deviceId),
  });
  if (existing && existing.id !== exceptId)
    throw new Error(`Die Geräte-ID „${deviceId}“ ist bereits vergeben.`);
}

// ---------------------------------------------------------------------------
// Ausstattung
// ---------------------------------------------------------------------------

export async function createEquipment(formData: FormData) {
  const admin = await requireAdmin();
  const input = parseEquipmentInput({
    userId: String(formData.get("userId") ?? ""),
    typeId: String(formData.get("typeId") ?? ""),
    deviceId: String(formData.get("deviceId") ?? ""),
    serialNumber: String(formData.get("serialNumber") ?? ""),
    notes: String(formData.get("notes") ?? ""),
    handoverDate: String(formData.get("handoverDate") ?? ""),
    returnDate: String(formData.get("returnDate") ?? ""),
  });
  await assertReferences(input.userId, input.typeId);
  await assertUniqueDeviceId(input.deviceId);

  const [row] = await db
    .insert(itEquipment)
    .values({ ...input, createdById: admin.id })
    .returning();

  await writeAudit({
    objectType: "it_ausstattung",
    objectId: row.id,
    action: "erstellt",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
    details: {
      deviceId: input.deviceId,
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
    deviceId: String(formData.get("deviceId") ?? ""),
    serialNumber: String(formData.get("serialNumber") ?? ""),
    notes: String(formData.get("notes") ?? ""),
    handoverDate: String(formData.get("handoverDate") ?? ""),
    returnDate: String(formData.get("returnDate") ?? ""),
  });
  await assertReferences(input.userId, input.typeId);
  await assertUniqueDeviceId(input.deviceId, id);

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
        deviceId: existing.deviceId,
        userId: existing.userId,
        typeId: existing.typeId,
        handoverDate: existing.handoverDate,
        returnDate: existing.returnDate,
      },
      neu: {
        deviceId: input.deviceId,
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

/**
 * Ausstattung endgültig löschen. Die Übergabeprotokolle hängen an der Person
 * und nicht am Gerät — sie bleiben davon unberührt.
 */
export async function deleteEquipment(id: string) {
  const admin = await requireAdmin();
  const existing = await findEquipment(id);

  // Audit vor dem Löschen schreiben (Audit-Log hat keinen Fremdschlüssel)
  await writeAudit({
    objectType: "it_ausstattung",
    objectId: id,
    action: "geloescht",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
    details: {
      deviceId: existing.deviceId,
      userId: existing.userId,
      typeId: existing.typeId,
    },
  });

  await db.delete(itEquipment).where(eq(itEquipment.id, id));

  revalidateEquipment();
}

// ---------------------------------------------------------------------------
// Übergabe- und Rücknahmeprotokolle (je Person genau eines pro Art)
// ---------------------------------------------------------------------------

/**
 * Protokoll für eine Person hinterlegen. Da die Ausstattung gesammelt
 * übergeben wird, gibt es je Art genau ein Dokument — ein neuer Upload
 * ersetzt das bisherige und löscht dessen verschlüsselte Datei mit.
 */
export async function uploadHandoverProtocol(
  userId: string,
  kind: HandoverProtocolKind,
  formData: FormData
) {
  const admin = await requireAdmin();
  if (!HANDOVER_PROTOCOL_KINDS.includes(kind))
    throw new Error("Unbekannte Protokollart.");

  const employee = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });
  if (!employee) throw new Error("Mitarbeiter/in nicht gefunden.");

  const file = extractProtocolFile(formData);

  // Das bisherige Dokument zuerst entfernen: sonst verletzt der Insert die
  // Eindeutigkeit und im Blob-Store bliebe eine verwaiste Datei zurück.
  const existing = await db.query.itEquipmentDocuments.findFirst({
    where: and(
      eq(itEquipmentDocuments.userId, userId),
      eq(itEquipmentDocuments.kind, kind)
    ),
  });
  if (existing) {
    await del(existing.blobUrl);
    await db
      .delete(itEquipmentDocuments)
      .where(eq(itEquipmentDocuments.id, existing.id));

    await writeAudit({
      objectType: "it_dokument",
      objectId: existing.id,
      action: "ersetzt",
      actorUserId: admin.id,
      actorLabel: fullName(admin),
      source: "web",
      details: { userId, kind, filename: existing.filename },
    });
  }

  await storeEncryptedProtocol({ userId, kind, file, admin });
  revalidateEquipment();
}

export async function deleteHandoverProtocol(documentId: string) {
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
    details: { userId: doc.userId, kind: doc.kind, filename: doc.filename },
  });

  await db
    .delete(itEquipmentDocuments)
    .where(eq(itEquipmentDocuments.id, documentId));

  revalidateEquipment();
}

// ---------------------------------------------------------------------------
// CSV-Import (zweistufig: prüfen, dann anwenden)
// ---------------------------------------------------------------------------

const MAX_IMPORT_SIZE_BYTES = 1024 * 1024;

export interface ImportSummary {
  create: string[];
  update: string[];
  unchanged: string[];
  remove: string[];
}

/**
 * Der Import meldet Fehler als Rückgabewert statt sie zu werfen: Es sind
 * mehrere Meldungen mit Zeilennummern, und Next.js maskiert geworfene Texte
 * im Production-Build.
 */
export type ImportOutcome =
  | { ok: true; summary: ImportSummary }
  | { ok: false; errors: string[] };

async function readImportFile(formData: FormData): Promise<string> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0)
    throw new Error("Bitte eine CSV-Datei auswählen.");
  if (!file.name.toLowerCase().endsWith(".csv"))
    throw new Error(
      `„${file.name}“ ist keine CSV-Datei. Bitte in Excel über „Speichern unter“ als CSV ablegen.`
    );
  if (file.size > MAX_IMPORT_SIZE_BYTES)
    throw new Error("Die Datei ist größer als 1 MB.");
  return decodeCsvUpload(await file.arrayBuffer());
}

async function planFromUpload(
  formData: FormData
): Promise<EquipmentImportResult> {
  let text: string;
  try {
    text = await readImportFile(formData);
  } catch (err) {
    return {
      ok: false,
      errors: [
        err instanceof Error
          ? err.message
          : "Die Datei konnte nicht gelesen werden.",
      ],
    };
  }
  return planEquipmentImport(text, await getImportContext());
}

function summarize(plan: EquipmentImportPlan): ImportSummary {
  return {
    create: plan.create.map((values) => values.deviceId),
    update: plan.update.map((entry) =>
      entry.values.deviceId === entry.previousDeviceId
        ? entry.values.deviceId
        : `${entry.previousDeviceId} → ${entry.values.deviceId}`
    ),
    unchanged: plan.unchanged,
    remove: plan.remove.map((entry) => entry.deviceId),
  };
}

/** Schritt 1: Datei prüfen und zeigen, was der Import bewirken würde. */
export async function analyzeEquipmentImport(
  formData: FormData
): Promise<ImportOutcome> {
  await requireAdmin();
  const result = await planFromUpload(formData);
  if (!result.ok) return { ok: false, errors: result.errors };
  return { ok: true, summary: summarize(result.plan) };
}

/**
 * Schritt 2: dieselbe Datei erneut prüfen und den Abgleich anwenden. Bewusst
 * ohne Server-State zwischen den Schritten — so kann die Vorschau nicht auf
 * veralteten Daten beruhen.
 */
export async function applyEquipmentImport(
  formData: FormData
): Promise<ImportOutcome> {
  const admin = await requireAdmin();
  const result = await planFromUpload(formData);
  if (!result.ok) return { ok: false, errors: result.errors };

  const { plan } = result;
  // Reihenfolge: erst löschen, dann aktualisieren, dann anlegen — sonst
  // kollidieren freiwerdende Geräte-IDs mit neuen Zeilen.
  const statements: BatchStatement[] = [
    ...plan.remove.map((entry) =>
      db.delete(itEquipment).where(eq(itEquipment.id, entry.id))
    ),
    ...plan.update.map((entry) =>
      db
        .update(itEquipment)
        .set({ ...entry.values, updatedAt: new Date() })
        .where(eq(itEquipment.id, entry.id))
    ),
    ...plan.create.map((values) =>
      db.insert(itEquipment).values({ ...values, createdById: admin.id })
    ),
  ];

  // Der Neon-HTTP-Treiber kennt keine interaktiven Transaktionen
  // (db.transaction wirft), batch() führt alle Anweisungen dagegen
  // gemeinsam in einer Transaktion aus — der Import greift ganz oder nicht.
  if (statements.length > 0)
    await db.batch(statements as [BatchStatement, ...BatchStatement[]]);

  const summary = summarize(plan);
  await writeAudit({
    objectType: "it_ausstattung",
    action: "importiert",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
    details: {
      neu: summary.create,
      aktualisiert: summary.update,
      geloescht: summary.remove,
      unveraendert: summary.unchanged.length,
    },
  });

  revalidateEquipment();
  return { ok: true, summary };
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
