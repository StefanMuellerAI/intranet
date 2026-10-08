import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decryptDocument,
  DOCUMENT_KEY_VERSION,
  encryptDocument,
} from "./document-crypto";

// Der Schlüssel wird bei jedem Aufruf frisch aus der Umgebung gelesen
// (kein Modul-Cache), daher genügt vi.stubEnv je Testfall.
const KEY = randomBytes(32).toString("base64");
const ANDERER_KEY = randomBytes(32).toString("base64");

// Payload-Aufbau: [1 Byte Version][12 Byte IV][16 Byte Tag][Ciphertext]
const IV_END = 1 + 12;
const TAG_END = IV_END + 16;

const PLAIN = Buffer.from("Arbeitsvertrag Max Mitarbeiter — vertraulich");

beforeEach(() => {
  vi.stubEnv("DOCUMENT_ENCRYPTION_KEY", KEY);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("encryptDocument", () => {
  it("erzeugt Version, IV, Tag und Ciphertext ohne Klartext", () => {
    const payload = encryptDocument(PLAIN);
    expect(payload[0]).toBe(DOCUMENT_KEY_VERSION);
    expect(payload.length).toBe(TAG_END + PLAIN.length);
    expect(payload.includes(PLAIN)).toBe(false);
  });

  it("liefert für denselben Klartext jedes Mal einen anderen Ciphertext (zufälliger IV)", () => {
    const a = encryptDocument(PLAIN);
    const b = encryptDocument(PLAIN);
    expect(a.equals(b)).toBe(false);
    expect(a.subarray(1, IV_END).equals(b.subarray(1, IV_END))).toBe(false);
    expect(decryptDocument(a).equals(PLAIN)).toBe(true);
    expect(decryptDocument(b).equals(PLAIN)).toBe(true);
  });

  it("verweigert die Verschlüsselung ohne Schlüssel", () => {
    vi.stubEnv("DOCUMENT_ENCRYPTION_KEY", undefined);
    expect(() => encryptDocument(PLAIN)).toThrow(
      "DOCUMENT_ENCRYPTION_KEY ist nicht gesetzt."
    );
  });

  it("verweigert einen Schlüssel mit falscher Länge", () => {
    vi.stubEnv("DOCUMENT_ENCRYPTION_KEY", randomBytes(16).toString("base64"));
    expect(() => encryptDocument(PLAIN)).toThrow(
      "base64-kodierter 32-Byte-Schlüssel"
    );
  });
});

describe("decryptDocument", () => {
  it("stellt den Klartext wieder her (Hin- und Rückweg)", () => {
    expect(decryptDocument(encryptDocument(PLAIN)).equals(PLAIN)).toBe(true);
  });

  it("verarbeitet leere und große Dokumente", () => {
    const leer = encryptDocument(Buffer.alloc(0));
    expect(leer.length).toBe(TAG_END);
    expect(decryptDocument(leer).length).toBe(0);

    const gross = randomBytes(2 * 1024 * 1024);
    expect(decryptDocument(encryptDocument(gross)).equals(gross)).toBe(true);
  });

  it("scheitert mit einem anderen Schlüssel", () => {
    const payload = encryptDocument(PLAIN);
    vi.stubEnv("DOCUMENT_ENCRYPTION_KEY", ANDERER_KEY);
    expect(() => decryptDocument(payload)).toThrow();
  });

  it("lehnt eine unbekannte Schlüsselversion ab", () => {
    const payload = encryptDocument(PLAIN);
    payload[0] = 2;
    expect(() => decryptDocument(payload)).toThrow("Unbekannte Schlüsselversion: 2");
  });

  it("verweigert die Entschlüsselung ohne Schlüssel", () => {
    const payload = encryptDocument(PLAIN);
    vi.stubEnv("DOCUMENT_ENCRYPTION_KEY", undefined);
    expect(() => decryptDocument(payload)).toThrow(
      "DOCUMENT_ENCRYPTION_KEY ist nicht gesetzt."
    );
  });

  it("verweigert einen Schlüssel mit falscher Länge", () => {
    const payload = encryptDocument(PLAIN);
    vi.stubEnv("DOCUMENT_ENCRYPTION_KEY", randomBytes(31).toString("base64"));
    expect(() => decryptDocument(payload)).toThrow(
      "base64-kodierter 32-Byte-Schlüssel"
    );
  });

  it("erkennt einen manipulierten Auth-Tag", () => {
    const payload = encryptDocument(PLAIN);
    payload[IV_END] ^= 0x01;
    expect(() => decryptDocument(payload)).toThrow();
  });

  it("erkennt einen manipulierten Ciphertext", () => {
    const payload = encryptDocument(PLAIN);
    payload[payload.length - 1] ^= 0x01;
    expect(() => decryptDocument(payload)).toThrow();
  });

  it("erkennt einen manipulierten IV", () => {
    const payload = encryptDocument(PLAIN);
    payload[1] ^= 0x01;
    expect(() => decryptDocument(payload)).toThrow();
  });

  it("erkennt einen abgeschnittenen Ciphertext", () => {
    const payload = encryptDocument(PLAIN);
    expect(() => decryptDocument(payload.subarray(0, payload.length - 1))).toThrow();
  });

  it("lehnt zu kurze Payloads ab", () => {
    expect(() => decryptDocument(Buffer.alloc(0))).toThrow(
      "Ungültiges Dokument-Payload."
    );
    expect(() => decryptDocument(Buffer.alloc(TAG_END - 1, 1))).toThrow(
      "Ungültiges Dokument-Payload."
    );
  });
});
