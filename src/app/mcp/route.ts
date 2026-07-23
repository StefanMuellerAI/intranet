import { verifyClerkToken } from "@clerk/mcp-tools/next";
import { auth } from "@clerk/nextjs/server";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { registerIntranetMcpTools } from "@/lib/mcp-tools";

export const preferredRegion = "fra1";
export const maxDuration = 60;

const handler = createMcpHandler(
  (server) => {
    registerIntranetMcpTools(server);
  },
  {
    serverInfo: {
      name: "stefanai-intranet",
      version: "1.0.0",
    },
  },
  {
    maxDuration: 60,
    disableSse: true,
    verboseLogs: process.env.NODE_ENV === "development",
  }
);

const authHandler = withMcpAuth(
  handler,
  async (_req, token) => {
    const clerkAuth = await auth({ acceptsToken: "oauth_token" });
    return verifyClerkToken(clerkAuth, token);
  },
  {
    required: true,
    resourceMetadataPath: "/.well-known/oauth-protected-resource/mcp",
  }
);

export { authHandler as GET, authHandler as POST, authHandler as DELETE };
