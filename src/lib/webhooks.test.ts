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

  it("blockt weitere reservierte IPv4-Bereiche", () => {
    for (const url of [
      "https://0.0.0.0/hook",
      "https://172.31.255.1/hook",
      "https://100.64.0.1/hook", // CGNAT
      "https://100.127.255.254/hook",
      "https://sub.localhost/hook",
    ]) {
      expect(() => assertSafeWebhookUrl(url), url).toThrow();
    }
  });

  it("lässt öffentliche Adressen knapp neben den privaten Bereichen zu", () => {
    for (const url of [
      "https://172.15.0.1/hook",
      "https://172.32.0.1/hook",
      "https://100.63.0.1/hook",
      "https://100.128.0.1/hook",
      "https://192.169.0.1/hook",
      "https://8.8.8.8/hook",
    ]) {
      expect(() => assertSafeWebhookUrl(url), url).not.toThrow();
    }
  });

  it("blockt interne IPv6-Adressen in eckigen Klammern", () => {
    for (const url of [
      "https://[::1]/hook", // Loopback
      "https://[::]/hook", // unspezifiziert
      "https://[fe80::1]/hook", // Link-local
      "https://[febf::1]/hook",
      "https://[fc00::1]/hook", // Unique-local
      "https://[fd12:3456::1]/hook",
      "https://[::ffff:127.0.0.1]/hook", // IPv4-gemappt → Loopback
      "https://[::ffff:7f00:1]/hook",
      "https://[::ffff:a9fe:a9fe]/hook", // IPv4-gemappt → Cloud-Metadaten
      "https://[::127.0.0.1]/hook", // IPv4-kompatibel
      "https://[64:ff9b::10.0.0.1]/hook", // NAT64 → RFC1918
    ]) {
      expect(() => assertSafeWebhookUrl(url), url).toThrow(
        "keine internen oder privaten Adressen"
      );
    }
  });

  it("lässt öffentliche IPv6-Adressen zu", () => {
    for (const url of [
      "https://[2001:4860:4860::8888]/hook",
      "https://[::ffff:8.8.8.8]/hook",
      "https://[fec0::1]/hook", // außerhalb fe80::/10
    ]) {
      expect(() => assertSafeWebhookUrl(url), url).not.toThrow();
    }
  });
});
