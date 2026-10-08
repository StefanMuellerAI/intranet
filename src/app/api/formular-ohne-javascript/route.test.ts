import { describe, expect, it } from "vitest";
import { preHydrationFallback } from "@/components/form-submit";
import { POST } from "./route";

describe("POST /api/formular-ohne-javascript", () => {
  it("verarbeitet nichts und bittet um erneutes Senden", async () => {
    const res = POST();
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toContain("Es wurde nichts gespeichert.");
  });

  it("ist das POST-Ziel aller Formulare ohne Reset", () => {
    expect(preHydrationFallback).toEqual({
      method: "post",
      action: "/api/formular-ohne-javascript",
    });
  });
});
