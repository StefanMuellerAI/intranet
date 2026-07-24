"use server";

import { revalidatePath } from "next/cache";
import { clerkClient } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { del, put } from "@vercel/blob";
import { z } from "zod";
import {
  db,
  employeeDocuments,
  users,
  DOCUMENT_CATEGORIES,
  type DocumentCategory,
  type User,
} from "@/db";
import { writeAudit } from "@/lib/audit";
import { fullName, isAllowedEmail, requireAdmin, ALLOWED_EMAIL_DOMAIN } from "@/lib/auth";
import { DOCUMENT_KEY_VERSION, encryptDocument } from "@/lib/document-crypto";
import { notifyInvitation } from "@/lib/notifications";

const inviteSchema = z.object({
  firstName: z.string().min(1, "Bitte Vornamen angeben."),
  lastName: z.string().min(1, "Bitte Nachnamen angeben."),
  email: z.string().email("Ungültige E-Mail-Adresse."),
  annualVacationDays: z.coerce
    .number()
    .min(0.5, "Der Jahresurlaubsanspruch ist Pflichtfeld."),
  birthDate: z
    .string()
    .transform((v) => v.trim())
    .pipe(
      z.union([
        z.literal("").transform(() => null),
        z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Ungültiges Geburtsdatum.")
          .refine(
            (v) => v <= new Date().toISOString().slice(0, 10),
            "Das Geburtsdatum muss in der Vergangenheit liegen."
          ),
      ])
    ),
});

// ---------------------------------------------------------------------------
// Mitarbeiterdokumente — verschlüsselte Ablage in Vercel Blob
// ---------------------------------------------------------------------------

const ALLOWED_DOCUMENT_TYPES = ["application/pdf", "image/jpeg", "image/png"];
const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024;

function parseDocumentCategory(value: unknown): DocumentCategory {
  const category = String(value ?? "sonstiges");
  if (!(DOCUMENT_CATEGORIES as readonly string[]).includes(category))
    throw new Error("Ungültige Dokument-Kategorie.");
  return category as DocumentCategory;
}

/** Dateien aus dem FormData holen und validieren (Typ + Größe). */
function extractDocumentFiles(formData: FormData, field = "documents"): File[] {
  const files = formData
    .getAll(field)
    .filter((f): f is File => f instanceof File && f.size > 0);
  for (const file of files) {
    if (!ALLOWED_DOCUMENT_TYPES.includes(file.type))
      throw new Error(
        `Dokument "${file.name}": Nur PDF, JPG oder PNG sind zulässig.`
      );
    if (file.size > MAX_DOCUMENT_SIZE_BYTES)
      throw new Error(
        `Dokument "${file.name}": Maximal 10 MB pro Datei sind zulässig.`
      );
  }
  return files;
}

/**
 * Dokument serverseitig mit AES-256-GCM verschlüsseln und als unlesbaren
 * Binär-Blob ablegen. Klartext verlässt den Server-Prozess nie.
 */
async function storeEncryptedDocument(opts: {
  userId: string;
  file: File;
  category: DocumentCategory;
  title: string | null;
  admin: User;
}): Promise<void> {
  const plain = Buffer.from(await opts.file.arrayBuffer());
  const encrypted = encryptDocument(plain);

  // Pfad und Inhalt lassen keinen Rückschluss auf das Dokument zu
  const blob = await put(
    `dokumente/${opts.userId}/${crypto.randomUUID()}.bin`,
    encrypted,
    {
      access: "public",
      addRandomSuffix: false,
      contentType: "application/octet-stream",
    }
  );

  const [doc] = await db
    .insert(employeeDocuments)
    .values({
      userId: opts.userId,
      category: opts.category,
      title: opts.title,
      filename: opts.file.name,
      contentType: opts.file.type,
      sizeBytes: opts.file.size,
      blobUrl: blob.url,
      keyVersion: DOCUMENT_KEY_VERSION,
      uploadedById: opts.admin.id,
    })
    .returning();

  await writeAudit({
    objectType: "dokument",
    objectId: doc.id,
    action: "hochgeladen",
    actorUserId: opts.admin.id,
    actorLabel: fullName(opts.admin),
    source: "web",
    details: {
      userId: opts.userId,
      filename: opts.file.name,
      kategorie: opts.category,
    },
  });
}

/** Dokumente für eine/n bestehende/n Mitarbeiter/in hochladen (nur Admin). */
export async function uploadEmployeeDocuments(
  userId: string,
  formData: FormData
) {
  const admin = await requireAdmin();
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw new Error("User nicht gefunden.");

  const files = extractDocumentFiles(formData);
  if (files.length === 0) throw new Error("Bitte mindestens eine Datei auswählen.");
  const category = parseDocumentCategory(formData.get("category"));
  const titleRaw = String(formData.get("title") ?? "").trim();
  const title = titleRaw.length > 0 ? titleRaw : null;

  for (const file of files) {
    await storeEncryptedDocument({ userId, file, category, title, admin });
  }

  revalidatePath("/mitarbeitende");
  revalidatePath("/dokumente");
}

/** Dokument endgültig löschen (nur Admin) — Blob-Datei und Metadaten. */
export async function deleteEmployeeDocument(documentId: string) {
  const admin = await requireAdmin();
  const doc = await db.query.employeeDocuments.findFirst({
    where: eq(employeeDocuments.id, documentId),
  });
  if (!doc) throw new Error("Dokument nicht gefunden.");

  await del(doc.blobUrl);

  // Audit vor dem Löschen schreiben (Audit-Log hat keinen Fremdschlüssel)
  await writeAudit({
    objectType: "dokument",
    objectId: doc.id,
    action: "geloescht",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
    details: {
      userId: doc.userId,
      filename: doc.filename,
      kategorie: doc.category,
    },
  });

  await db.delete(employeeDocuments).where(eq(employeeDocuments.id, documentId));

  revalidatePath("/mitarbeitende");
  revalidatePath("/dokumente");
}

/** Clerk-Einladung erstellen und Link zurückgeben. */
async function createClerkInvitation(email: string): Promise<string | null> {
  try {
    const client = await clerkClient();
    const invitation = await client.invitations.createInvitation({
      emailAddress: email,
      redirectUrl: `${process.env.APP_BASE_URL ?? "http://localhost:3000"}/anmelden`,
      ignoreExisting: true,
      // Clerk versendet selbst keine Mail — der Versand läuft über Brevo
      notify: false,
    });
    return invitation.url ?? null;
  } catch (err) {
    console.error("Clerk-Einladung fehlgeschlagen:", err);
    return null;
  }
}

export async function inviteUser(formData: FormData) {
  const admin = await requireAdmin();
  const data = inviteSchema.parse({
    firstName: String(formData.get("firstName") ?? ""),
    lastName: String(formData.get("lastName") ?? ""),
    email: String(formData.get("email") ?? "").trim().toLowerCase(),
    annualVacationDays: formData.get("annualVacationDays"),
    birthDate: String(formData.get("birthDate") ?? ""),
  });

  // Serverseitige Domain-Validierung (zusätzlich zur Clerk-Allowlist)
  if (!isAllowedEmail(data.email))
    throw new Error(
      `Zulässig sind ausschließlich Adressen der Domain @${ALLOWED_EMAIL_DOMAIN}.`
    );

  const existing = await db.query.users.findFirst({
    where: eq(users.email, data.email),
  });
  if (existing)
    throw new Error("Für diese E-Mail-Adresse existiert bereits ein Konto.");

  // Optionale Dokumente (Arbeitsvertrag etc.) vor der Einladung validieren,
  // damit eine ungültige Datei nicht zu einem halb angelegten User führt.
  const documentFiles = extractDocumentFiles(formData);
  const documentCategory = parseDocumentCategory(formData.get("documentCategory"));

  const invitationUrl = await createClerkInvitation(data.email);

  const [user] = await db
    .insert(users)
    .values({
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName,
      annualVacationDays: data.annualVacationDays,
      birthDate: data.birthDate,
      status: "eingeladen",
    })
    .returning();

  // Mitgelieferte Dokumente verschlüsselt ablegen
  for (const file of documentFiles) {
    await storeEncryptedDocument({
      userId: user.id,
      file,
      category: documentCategory,
      title: null,
      admin,
    });
  }

  await writeAudit({
    objectType: "user",
    objectId: user.id,
    action: "eingeladen",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
    details: {
      email: data.email,
      jahresurlaub: data.annualVacationDays,
      geburtsdatum: data.birthDate,
    },
  });
  await notifyInvitation({
    email: data.email,
    name: `${data.firstName} ${data.lastName}`,
    invitationUrl:
      invitationUrl ??
      `${process.env.APP_BASE_URL ?? "http://localhost:3000"}/anmelden`,
    resent: false,
  });

  revalidatePath("/mitarbeitende");
}

/** Einladung jederzeit erneut versenden. */
export async function resendInvitation(userId: string) {
  const admin = await requireAdmin();
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw new Error("User nicht gefunden.");
  if (user.status !== "eingeladen")
    throw new Error("Nur eingeladene User können erneut eingeladen werden.");

  const invitationUrl = await createClerkInvitation(user.email);

  await writeAudit({
    objectType: "user",
    objectId: userId,
    action: "einladung_erneut_versendet",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
  });
  await notifyInvitation({
    email: user.email,
    name: fullName(user),
    invitationUrl:
      invitationUrl ??
      `${process.env.APP_BASE_URL ?? "http://localhost:3000"}/anmelden`,
    resent: true,
  });

  revalidatePath("/mitarbeitende");
}

/** Jahresurlaubsanspruch und Übertrag pro User anpassen. */
export async function updateUserVacation(userId: string, formData: FormData) {
  const admin = await requireAdmin();
  const annual = Number(formData.get("annualVacationDays"));
  const carryover = Number(formData.get("vacationCarryoverDays"));
  if (!Number.isFinite(annual) || annual < 0)
    throw new Error("Ungültiger Jahresurlaubsanspruch.");

  await db
    .update(users)
    .set({
      annualVacationDays: annual,
      vacationCarryoverDays: Number.isFinite(carryover) ? carryover : 0,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  await writeAudit({
    objectType: "user",
    objectId: userId,
    action: "urlaubsanspruch_geaendert",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
    details: { jahresurlaub: annual, uebertrag: carryover },
  });
  revalidatePath("/mitarbeitende");
}

/** Geburtsdatum setzen oder leeren (nur Admin) — Anzeige im Kalender. */
export async function updateUserBirthday(userId: string, formData: FormData) {
  const admin = await requireAdmin();
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw new Error("User nicht gefunden.");

  const raw = String(formData.get("birthDate") ?? "").trim();
  let birthDate: string | null = null;
  if (raw.length > 0) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw))
      throw new Error("Ungültiges Geburtsdatum.");
    if (raw > new Date().toISOString().slice(0, 10))
      throw new Error("Das Geburtsdatum muss in der Vergangenheit liegen.");
    birthDate = raw;
  }

  await db
    .update(users)
    .set({ birthDate, updatedAt: new Date() })
    .where(eq(users.id, userId));

  await writeAudit({
    objectType: "user",
    objectId: userId,
    action: "geburtsdatum_geaendert",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
    details: { geburtsdatum: birthDate },
  });
  revalidatePath("/mitarbeitende");
  revalidatePath("/kalender");
}

/** Fachliche/n und disziplinarische/n Vorgesetzte/n pflegen (nur Admin). */
export async function updateUserSupervisors(
  userId: string,
  formData: FormData
) {
  const admin = await requireAdmin();
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw new Error("User nicht gefunden.");

  async function parseSupervisorId(field: string): Promise<string | null> {
    const raw = String(formData.get(field) ?? "").trim();
    if (raw.length === 0) return null;
    if (raw === userId)
      throw new Error(
        "Mitarbeitende können nicht ihre eigenen Vorgesetzten sein."
      );
    const supervisor = await db.query.users.findFirst({
      where: eq(users.id, raw),
    });
    if (!supervisor) throw new Error("Ausgewählte/r Vorgesetzte/r nicht gefunden.");
    return supervisor.id;
  }

  const technicalSupervisorId = await parseSupervisorId(
    "technicalSupervisorId"
  );
  const disciplinarySupervisorId = await parseSupervisorId(
    "disciplinarySupervisorId"
  );

  await db
    .update(users)
    .set({ technicalSupervisorId, disciplinarySupervisorId, updatedAt: new Date() })
    .where(eq(users.id, userId));

  await writeAudit({
    objectType: "user",
    objectId: userId,
    action: "vorgesetzte_geaendert",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
    details: {
      fachlicherVorgesetzter: technicalSupervisorId,
      disziplinarischerVorgesetzter: disciplinarySupervisorId,
    },
  });
  revalidatePath("/mitarbeitende");
}

/** Offboarding: Login sperren, Antragsdaten bleiben erhalten (Abschnitt 9). */
export async function setUserStatus(
  userId: string,
  status: "aktiv" | "deaktiviert"
) {
  const admin = await requireAdmin();
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw new Error("User nicht gefunden.");
  if (user.id === admin.id)
    throw new Error("Das eigene Admin-Konto kann nicht deaktiviert werden.");

  await db
    .update(users)
    .set({ status, updatedAt: new Date() })
    .where(eq(users.id, userId));

  // Login in Clerk sperren/entsperren
  if (user.clerkId) {
    try {
      const client = await clerkClient();
      if (status === "deaktiviert") await client.users.banUser(user.clerkId);
      else await client.users.unbanUser(user.clerkId);
    } catch (err) {
      console.error("Clerk-Statusänderung fehlgeschlagen:", err);
    }
  }

  await writeAudit({
    objectType: "user",
    objectId: userId,
    action: status === "deaktiviert" ? "deaktiviert" : "reaktiviert",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
  });
  revalidatePath("/mitarbeitende");
}
