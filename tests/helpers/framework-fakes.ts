import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { vi } from "vitest";

/**
 * Test-Doubles für die Framework-Grenzen der Server-Actions und Routen:
 * Clerk (Anmeldung, Einladungen, Sperren), Next (revalidatePath, redirect),
 * Vercel Blob (In-Memory-Speicher mit lokalem HTTP-Server) und Mailversand.
 * Datenbank, Rechteprüfung (src/lib/auth.ts) und Fachlogik bleiben echt.
 */

// ── Clerk ──────────────────────────────────────────────────────────────────

/** Aktuell "angemeldeter" Clerk-User; null = keine Session. */
export const session: {
  clerkId: string | null;
  /** Antwort von currentUser() — nur für die Erstverknüpfung relevant */
  clerkUser: unknown;
} = { clerkId: null, clerkUser: null };

export const clerkBackend = {
  invitations: {
    createInvitation: vi.fn(async (params: { emailAddress: string }) => ({
      id: `inv_${randomBytes(4).toString("hex")}`,
      emailAddress: params.emailAddress,
      url: `https://clerk.test/einladung?mail=${encodeURIComponent(params.emailAddress)}`,
    })),
  },
  users: {
    banUser: vi.fn(async (id: string) => ({ id, banned: true })),
    unbanUser: vi.fn(async (id: string) => ({ id, banned: false })),
  },
};

export const clerkServerModule = {
  auth: vi.fn(async () => ({ userId: session.clerkId })),
  currentUser: vi.fn(async () => session.clerkUser),
  clerkClient: vi.fn(async () => clerkBackend),
  clerkMiddleware: vi.fn(),
};

// ── Next ───────────────────────────────────────────────────────────────────

/** Ersatz für Next' redirect(): bricht wie das Original per Exception ab. */
export class RedirectSignal extends Error {
  constructor(public readonly url: string) {
    super(`NEXT_REDIRECT ${url}`);
    this.name = "RedirectSignal";
  }
}

export const nextCacheModule = {
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
};

export const nextNavigationModule = {
  redirect: vi.fn((url: string) => {
    throw new RedirectSignal(url);
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
};

// ── Vercel Blob ────────────────────────────────────────────────────────────

export interface StoredBlob {
  pathname: string;
  body: Buffer;
  contentType?: string;
}

/** Inhalt des Fake-Blob-Stores, Schlüssel = öffentliche URL */
export const blobStore = new Map<string, StoredBlob>();
/** URLs, die der Fake-Server mit einem Fehler (502-Test) beantwortet */
export const failingBlobUrls = new Set<string>();

let blobServer: Server | undefined;
let blobBaseUrl = "";

async function ensureBlobServer(): Promise<string> {
  if (blobServer) return blobBaseUrl;
  blobServer = createServer((req, res) => {
    const url = `${blobBaseUrl}${req.url}`;
    const blob = blobStore.get(url);
    if (!blob || failingBlobUrls.has(url)) {
      res.writeHead(blob ? 500 : 404).end();
      return;
    }
    res.setHeader("content-type", blob.contentType ?? "application/octet-stream");
    res.end(blob.body);
  });
  await new Promise<void>((resolve) => blobServer!.listen(0, "127.0.0.1", resolve));
  blobServer.unref();
  const address = blobServer.address();
  if (!address || typeof address === "string")
    throw new Error("Blob-Testserver ohne Port.");
  blobBaseUrl = `http://127.0.0.1:${address.port}`;
  return blobBaseUrl;
}

async function toBuffer(body: unknown): Promise<Buffer> {
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === "string") return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body))
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (body instanceof Blob) return Buffer.from(await body.arrayBuffer());
  throw new Error("Fake-Blob: unbekannter Body-Typ");
}

export const blobModule = {
  put: vi.fn(
    async (
      pathname: string,
      body: unknown,
      opts?: { contentType?: string; addRandomSuffix?: boolean }
    ) => {
      const base = await ensureBlobServer();
      const finalPath =
        opts?.addRandomSuffix === false
          ? pathname
          : pathname.replace(/(\.[^./]+)?$/, `-${randomBytes(4).toString("hex")}$1`);
      const url = `${base}/${finalPath}`;
      blobStore.set(url, {
        pathname: finalPath,
        body: await toBuffer(body),
        contentType: opts?.contentType,
      });
      return { url, downloadUrl: url, pathname: finalPath, contentType: opts?.contentType };
    }
  ),
  del: vi.fn(async (urls: string | string[]) => {
    for (const url of Array.isArray(urls) ? urls : [urls]) blobStore.delete(url);
  }),
};

/** Datei direkt im Fake-Store ablegen (z. B. für Download-Tests). */
export async function storeBlob(
  pathname: string,
  body: Buffer | string,
  contentType?: string
): Promise<string> {
  const { url } = await blobModule.put(pathname, body, {
    contentType,
    addRandomSuffix: false,
  });
  return url;
}

// ── Mail ───────────────────────────────────────────────────────────────────

export interface SentMail {
  to: { email: string; name?: string }[];
  subject: string;
  heading: string;
  paragraphs: string[];
  linkPath?: string;
  linkUrl?: string;
  linkLabel?: string;
}

/** Alle in diesem Testfall "versendeten" Mails */
export const mailbox: SentMail[] = [];

export const mailModule = {
  sendMail: vi.fn(async (mail: SentMail) => {
    mailbox.push(mail);
  }),
};

/** Mails an eine Adresse (Groß-/Kleinschreibung egal). */
export function mailsTo(email: string): SentMail[] {
  return mailbox.filter((m) =>
    m.to.some((t) => t.email.toLowerCase() === email.toLowerCase())
  );
}

/** Zustand zwischen zwei Testfällen zurücksetzen. */
export function resetFakes(): void {
  session.clerkId = null;
  session.clerkUser = null;
  mailbox.length = 0;
  failingBlobUrls.clear();
  vi.clearAllMocks();
}
