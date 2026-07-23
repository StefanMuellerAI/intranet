import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signReceiptUrl, verifyReceiptSignature } from "./signed-url";

const RECEIPT_ID = "11111111-2222-3333-4444-555555555555";

function paramsOf(url: string): { expires: string; sig: string } {
  const u = new URL(url);
  return {
    expires: u.searchParams.get("expires") ?? "",
    sig: u.searchParams.get("sig") ?? "",
  };
}

describe("signed-url", () => {
  beforeEach(() => {
    vi.stubEnv("DOWNLOAD_URL_SECRET", "test-secret");
    vi.stubEnv("APP_BASE_URL", "https://intranet.example");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("erzeugt eine URL auf /api/receipts/[id] mit expires und sig", () => {
    const url = signReceiptUrl(RECEIPT_ID);
    expect(url).toContain(`https://intranet.example/api/receipts/${RECEIPT_ID}?`);
    const { expires, sig } = paramsOf(url);
    expect(Number(expires)).toBeGreaterThan(Date.now() / 1000);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("verifiziert eine frisch signierte URL", () => {
    const { expires, sig } = paramsOf(signReceiptUrl(RECEIPT_ID));
    expect(verifyReceiptSignature(RECEIPT_ID, expires, sig)).toBe(true);
  });

  it("lehnt abgelaufene Signaturen ab", () => {
    const { expires, sig } = paramsOf(signReceiptUrl(RECEIPT_ID, 60));
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 120_000));
    expect(verifyReceiptSignature(RECEIPT_ID, expires, sig)).toBe(false);
  });

  it("lehnt manipulierte Signaturen ab", () => {
    const { expires, sig } = paramsOf(signReceiptUrl(RECEIPT_ID));
    const tampered = (sig[0] === "0" ? "1" : "0") + sig.slice(1);
    expect(verifyReceiptSignature(RECEIPT_ID, expires, tampered)).toBe(false);
  });

  it("lehnt Signaturen für eine andere Beleg-ID ab", () => {
    const { expires, sig } = paramsOf(signReceiptUrl(RECEIPT_ID));
    expect(
      verifyReceiptSignature(
        "99999999-8888-7777-6666-555555555555",
        expires,
        sig
      )
    ).toBe(false);
  });

  it("lehnt kaputte expires-Werte und leere Signaturen ab", () => {
    expect(verifyReceiptSignature(RECEIPT_ID, "keine-zahl", "abc")).toBe(false);
    const { expires } = paramsOf(signReceiptUrl(RECEIPT_ID));
    expect(verifyReceiptSignature(RECEIPT_ID, expires, "")).toBe(false);
  });

  it("wirft ohne DOWNLOAD_URL_SECRET", () => {
    vi.stubEnv("DOWNLOAD_URL_SECRET", "");
    expect(() => signReceiptUrl(RECEIPT_ID)).toThrow(
      "DOWNLOAD_URL_SECRET ist nicht gesetzt."
    );
  });
});
