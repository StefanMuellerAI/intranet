import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM-Verschlüsselung für Mitarbeiterdokumente (Arbeitsverträge etc.).
 * Dokumente liegen im Blob-Store ausschließlich als Ciphertext; der Schlüssel
 * existiert nur in der App-Umgebung (DOCUMENT_ENCRYPTION_KEY).
 *
 * Payload-Format: [1 Byte keyVersion][12 Byte IV][16 Byte AuthTag][Ciphertext]
 * Die eingebettete keyVersion erlaubt spätere Schlüsselrotation ohne
 * Schema-Änderung.
 */

export const DOCUMENT_KEY_VERSION = 1;

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function keyForVersion(version: number): Buffer {
  if (version !== DOCUMENT_KEY_VERSION)
    throw new Error(`Unbekannte Schlüsselversion: ${version}`);
  const raw = process.env.DOCUMENT_ENCRYPTION_KEY;
  if (!raw) throw new Error("DOCUMENT_ENCRYPTION_KEY ist nicht gesetzt.");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32)
    throw new Error(
      "DOCUMENT_ENCRYPTION_KEY muss ein base64-kodierter 32-Byte-Schlüssel sein (openssl rand -base64 32)."
    );
  return key;
}

export function encryptDocument(plain: Buffer): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(
    "aes-256-gcm",
    keyForVersion(DOCUMENT_KEY_VERSION),
    iv
  );
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([DOCUMENT_KEY_VERSION]), iv, tag, ciphertext]);
}

export function decryptDocument(payload: Buffer): Buffer {
  if (payload.length < 1 + IV_LENGTH + TAG_LENGTH)
    throw new Error("Ungültiges Dokument-Payload.");
  const version = payload[0];
  const iv = payload.subarray(1, 1 + IV_LENGTH);
  const tag = payload.subarray(1 + IV_LENGTH, 1 + IV_LENGTH + TAG_LENGTH);
  const ciphertext = payload.subarray(1 + IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", keyForVersion(version), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
