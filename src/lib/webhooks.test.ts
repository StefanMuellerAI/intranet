import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assertSafeWebhookUrl, signPayload } from "./webhooks";

describe("signPayload", () => {
  it("erzeugt eine HMAC-SHA256-Signatur als Hex-String", () => {
    expect(signPayload('{"a":1}', "geheim")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ist kompatibel zur Standard-HMAC-Berechnung (n8n-Verifikation)", () => {
    const payload = JSON.stringify({ kategorie: "urlaub", ereignis: "genehmigt" });
    const expected = createHmac("sha256", "mein-secret")
      .update(payload)
      .digest("hex");
    expect(signPayload(payload, "mein-secret")).toBe(expected);
  });

  it("ändert sich mit Payload und Secret", () => {
    expect(signPayload("a", "s")).not.toBe(signPayload("b", "s"));
    expect(signPayload("a", "s1")).not.toBe(signPayload("a", "s2"));
  });
});

describe("assertSafeWebhookUrl", () => {
  it("akzeptiert öffentliche https-URLs", () => {
    expect(() =>
      assertSafeWebhookUrl("https://hooks.n8n.example.com/webhook/abc")
    ).not.toThrow();
  });

  it("lehnt http und andere Schemata ab", () => {
    expect(() => assertSafeWebhookUrl("http://example.com/hook")).toThrow(
      "https://"
    );
    expect(() => assertSafeWebhookUrl("file:///etc/passwd")).toThrow();
  });

  it("lehnt ungültige URLs ab", () => {
    expect(() => assertSafeWebhookUrl("kein-url")).toThrow("Ungültige");
  });

  it("blockt interne und private Adressen (SSRF)", () => {
    for (const url of [
      "https://localhost/hook",
      "https://127.0.0.1/hook",
      "https://10.0.0.5/hook",
      "https://172.16.4.4/hook",
      "https://192.168.1.10/hook",
      "https://169.254.169.254/latest/meta-data", // Cloud-Metadaten
      "https://intern.local/hook",
    ]) {
      expect(() => assertSafeWebhookUrl(url), url).toThrow();
    }
  });
});
