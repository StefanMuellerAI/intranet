import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GET as authServerMetadata,
  OPTIONS as authServerOptions,
} from "@/app/.well-known/oauth-authorization-server/route";
import {
  GET as protectedResourceMetadata,
  OPTIONS as protectedResourceOptions,
} from "@/app/.well-known/oauth-protected-resource/mcp/route";
import { DELETE, GET, POST } from "@/app/mcp/route";
import * as schema from "../../../src/db/schema";
import { actAs, createUser } from "../../helpers/actions";
import { resetDb, seedTestData, testDb, type SeedResult } from "../../helpers/db";
import { clerkServerModule } from "../../helpers/framework-fakes";

/**
 * /mcp läuft echt über mcp-handler, das MCP-SDK und verifyClerkToken aus
 * @clerk/mcp-tools. Gefälscht ist nur Clerks auth(): Für einen "gültigen
 * Token" liefert es einmalig das Ergebnis einer erfolgreichen
 * OAuth-Token-Prüfung. Die Signaturprüfung des Tokens selbst passiert in
 * Clerk und ist ohne echte Clerk-Instanz nicht testbar.
 */

const ORIGIN = "https://intra.stefanai.test";
// Publishable Key, dessen Frontend-API-Host clerk.stefanai.test ist
const FAPI_HOST = "clerk.stefanai.test";
const PUBLISHABLE_KEY = `pk_test_${Buffer.from(`${FAPI_HOST}$`).toString("base64")}`;

let seed: SeedResult;

function mcpRequest(
  method: "GET" | "POST" | "DELETE",
  body?: unknown,
  token?: string
): Request {
  return new Request(`${ORIGIN}/mcp`, {
    method,
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function rpc(method: string, params: Record<string, unknown> = {}, id = 1) {
  return { jsonrpc: "2.0", id, method, params };
}

/** auth() liefert für den nächsten Aufruf eine gültige OAuth-Token-Prüfung */
function acceptNextToken(clerkUserId: string) {
  vi.mocked(clerkServerModule.auth).mockImplementationOnce(
    async () =>
      ({
        isAuthenticated: true,
        tokenType: "oauth_token",
        clientId: "client_mcp_test",
        scopes: ["openid", "profile", "email"],
        userId: clerkUserId,
      }) as never
  );
}

/** JSON-RPC-Antwort aus JSON- oder SSE-Body lesen */
async function rpcResponse(res: Response) {
  const raw = await res.text();
  const data = raw.includes("data:")
    ? raw
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .at(-1)
    : raw;
  return JSON.parse(data ?? "null");
}

beforeAll(async () => {
  await resetDb();
  seed = await seedTestData();
  await actAs(seed.employee); // verknüpft eine Clerk-ID
});

afterEach(() => {
  vi.mocked(clerkServerModule.auth).mockReset();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("/mcp — Authentifizierung", () => {
  it("antwortet ohne Token mit 401 und verweist auf die Resource-Metadaten", async () => {
    const res = await POST(mcpRequest("POST", rpc("tools/list")));

    expect(res.status).toBe(401);
    const header = res.headers.get("www-authenticate") ?? "";
    expect(header).toContain('Bearer error="invalid_token"');
    expect(header).toContain(
      `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`
    );
    expect(await res.json()).toMatchObject({ error: "invalid_token" });
  });

  it("antwortet auch bei GET und DELETE ohne Token mit 401", async () => {
    expect((await GET(mcpRequest("GET"))).status).toBe(401);
    expect((await DELETE(mcpRequest("DELETE"))).status).toBe(401);
  });

  it("prüft den Token bei Clerk als OAuth-Token", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(mcpRequest("POST", rpc("tools/list"), "ungueltiger-token"));
    expect(clerkServerModule.auth).toHaveBeenCalledWith({ acceptsToken: "oauth_token" });
    // Ohne bestätigte Clerk-Session gilt der Token als ungültig
    expect(res.status).toBe(401);
  });

  it("lehnt einen von Clerk nicht bestätigten Token mit 401 ab", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(clerkServerModule.auth).mockImplementationOnce(
      async () => ({ isAuthenticated: false, tokenType: "oauth_token" }) as never
    );

    const res = await POST(mcpRequest("POST", rpc("tools/list"), "abgelaufen"));

    expect(res.status).toBe(401);
  });

  it("lehnt Session-Tokens statt OAuth-Tokens mit 401 ab", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(clerkServerModule.auth).mockImplementationOnce(
      async () =>
        ({
          isAuthenticated: true,
          tokenType: "session_token",
          userId: seed.employee.clerkId,
        }) as never
    );

    const res = await POST(mcpRequest("POST", rpc("tools/list"), "session-token"));

    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("invalid_token");
  });
});

describe("/mcp — mit gültigem Token", () => {
  it("listet die Intranet-Tools", async () => {
    acceptNextToken(seed.employee.clerkId!);

    const res = await POST(mcpRequest("POST", rpc("tools/list"), "gueltig"));

    expect(res.status).toBe(200);
    const body = await rpcResponse(res);
    const names = body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toHaveLength(11);
    expect(names).toEqual(
      expect.arrayContaining(["get_my_profile", "create_vacation_request", "close_my_sick_leave"])
    );
    const getRequest = body.result.tools.find(
      (t: { name: string }) => t.name === "get_my_request"
    );
    expect(getRequest.inputSchema.required).toEqual(
      expect.arrayContaining(["type", "id"])
    );
  });

  it("ruft ein Tool im Namen des Token-Users auf", async () => {
    acceptNextToken(seed.employee.clerkId!);

    const res = await POST(
      mcpRequest("POST", rpc("tools/call", { name: "get_my_profile", arguments: {} }), "gueltig")
    );

    expect(res.status).toBe(200);
    const body = await rpcResponse(res);
    expect(body.result.isError).toBeFalsy();
    const profile = JSON.parse(body.result.content[0].text);
    expect(profile).toMatchObject({ id: seed.employee.id, email: seed.employee.email });
  });

  it("prüft Tool-Argumente über das SDK und meldet Fehler als Tool-Ergebnis", async () => {
    acceptNextToken(seed.employee.clerkId!);

    const res = await POST(
      mcpRequest(
        "POST",
        rpc("tools/call", {
          name: "get_my_request",
          arguments: { type: "vacation", id: "kein-uuid" },
        }),
        "gueltig"
      )
    );

    expect(res.status).toBe(200);
    const body = await rpcResponse(res);
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain("Input validation error");
  });

  it("meldet Clerk-User ohne aktives Intranet-Konto als Tool-Fehler", async () => {
    const inactive = await createUser({ status: "deaktiviert", clerkId: "user_deaktiviert" });
    acceptNextToken(inactive.clerkId!);

    const res = await POST(
      mcpRequest(
        "POST",
        rpc("tools/call", { name: "list_my_requests", arguments: {} }),
        "gueltig"
      )
    );

    const body = await rpcResponse(res);
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain("Kein aktives Intranet-Konto");
    expect(await testDb().select().from(schema.vacationRequests)).toHaveLength(0);
  });

  it("unterstützt kein GET/DELETE (zustandsloser Streamable-HTTP-Modus)", async () => {
    acceptNextToken(seed.employee.clerkId!);
    expect((await GET(mcpRequest("GET", undefined, "gueltig"))).status).toBe(405);
    acceptNextToken(seed.employee.clerkId!);
    expect((await DELETE(mcpRequest("DELETE", undefined, "gueltig"))).status).toBe(405);
  });
});

describe("/.well-known/oauth-protected-resource/mcp", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", PUBLISHABLE_KEY);
  });

  it("liefert die Resource-Metadaten mit Clerk als Autorisierungsserver", async () => {
    const res = await protectedResourceMetadata(
      new Request(`${ORIGIN}/.well-known/oauth-protected-resource/mcp`)
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("cache-control")).toBe("max-age=3600");
    const body = await res.json();
    expect(body).toMatchObject({
      resource: ORIGIN,
      authorization_servers: [`https://${FAPI_HOST}`],
      scopes_supported: ["openid", "profile", "email"],
      jwks_uri: `https://${FAPI_HOST}/.well-known/jwks.json`,
    });
  });

  it("scheitert ohne konfigurierten Clerk-Publishable-Key", async () => {
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", undefined);
    expect(() =>
      protectedResourceMetadata(
        new Request(`${ORIGIN}/.well-known/oauth-protected-resource/mcp`)
      )
    ).toThrow("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
  });

  it("beantwortet CORS-Preflights", async () => {
    const res = await protectedResourceOptions();
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS");
  });
});

describe("/.well-known/oauth-authorization-server", () => {
  const CLERK_METADATA = {
    issuer: `https://${FAPI_HOST}`,
    authorization_endpoint: `https://${FAPI_HOST}/oauth/authorize`,
    token_endpoint: `https://${FAPI_HOST}/oauth/token`,
    registration_endpoint: `https://${FAPI_HOST}/oauth/register`,
    code_challenge_methods_supported: ["S256"],
  };

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", PUBLISHABLE_KEY);
  });

  it("reicht die Metadaten des Clerk-Autorisierungsservers durch", async () => {
    // Nur den Clerk-Abruf abfangen; lokale Aufrufe (DB-Proxy) laufen echt.
    const realFetch = globalThis.fetch;
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.startsWith(`https://${FAPI_HOST}/`)) return Response.json(CLERK_METADATA);
        return realFetch(input, init);
      });

    const res = await authServerMetadata();

    expect(fetchSpy).toHaveBeenCalledWith(
      `https://${FAPI_HOST}/.well-known/oauth-authorization-server`
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("cache-control")).toBe("max-age=3600");
    expect(await res.json()).toEqual(CLERK_METADATA);
  });

  it("beantwortet CORS-Preflights", async () => {
    const res = await authServerOptions();
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-headers")).toBe("*");
  });
});
