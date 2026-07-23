import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashApiKey } from "./api-keys";

describe("hashApiKey", () => {
  it("liefert einen SHA-256-Hex-Hash (64 Zeichen)", () => {
    const hash = hashApiKey("sk_test_abc");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ist deterministisch", () => {
    expect(hashApiKey("gleicher-key")).toBe(hashApiKey("gleicher-key"));
  });

  it("liefert unterschiedliche Hashes für unterschiedliche Keys", () => {
    expect(hashApiKey("key-a")).not.toBe(hashApiKey("key-b"));
  });

  it("entspricht dem Standard-SHA-256 (kompatibel zu extern erzeugten Hashes)", () => {
    const expected = createHash("sha256").update("mein-key").digest("hex");
    expect(hashApiKey("mein-key")).toBe(expected);
  });
});
