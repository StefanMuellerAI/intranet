import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signPayload } from "./webhooks";

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
