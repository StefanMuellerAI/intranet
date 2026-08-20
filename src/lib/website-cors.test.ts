import { afterEach, describe, expect, it } from "vitest";
import { corsHeaders } from "./website-cors";

afterEach(() => {
  delete process.env.WEBSITE_CORS_ORIGINS;
});

describe("corsHeaders", () => {
  it("ist ohne gesetzte Allowlist aus", () => {
    expect(corsHeaders("https://stefanai.de")).toEqual({});
  });

  it("spiegelt einen Origin von der Allowlist", () => {
    process.env.WEBSITE_CORS_ORIGINS = "https://stefanai.de";
    expect(corsHeaders("https://stefanai.de")).toMatchObject({
      "access-control-allow-origin": "https://stefanai.de",
      "access-control-allow-headers": "authorization, if-none-match",
      "access-control-expose-headers": "etag",
    });
  });

  it("toleriert Leerzeichen in der Liste", () => {
    process.env.WEBSITE_CORS_ORIGINS =
      " https://stefanai.de , https://www.stefanai.de ";
    expect(corsHeaders("https://www.stefanai.de")).toMatchObject({
      "access-control-allow-origin": "https://www.stefanai.de",
    });
  });

  it("antwortet fremden Origins ohne CORS-Header", () => {
    process.env.WEBSITE_CORS_ORIGINS = "https://stefanai.de";
    expect(corsHeaders("https://boese.example")).toEqual({});
    expect(corsHeaders("https://stefanai.de.boese.example")).toEqual({});
    // Subdomains gelten nicht automatisch mit — der Origin muss exakt passen.
    expect(corsHeaders("https://www.stefanai.de")).toEqual({});
  });

  it("gibt ohne Origin-Header nichts zurück", () => {
    process.env.WEBSITE_CORS_ORIGINS = "https://stefanai.de";
    expect(corsHeaders(null)).toEqual({});
    expect(corsHeaders("")).toEqual({});
  });

  it("wird nie zum Wildcard", () => {
    process.env.WEBSITE_CORS_ORIGINS = "https://stefanai.de";
    expect(corsHeaders("*")).toEqual({});
  });
});
