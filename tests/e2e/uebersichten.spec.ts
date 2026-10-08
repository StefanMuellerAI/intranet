import { createCipheriv, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { auditLog, employeeDocuments, users } from "../../src/db/schema";
import { E2E_ADMIN_EMAIL, E2E_USER_EMAIL, testDb } from "../helpers/db";
import {
  ADMIN_NAME,
  ADMIN_STATE,
  USER_NAME,
  USER_STATE,
  openDialog,
  pageAs,
} from "./helpers";

/**
 * Organigramm, Meine Dokumente und Mein Konto.
 */

const BASE_URL = process.env.APP_BASE_URL ?? "http://localhost:3100";
const HIGHLIGHT = /(^|\s)ring-primary(\s|$)/;

async function userByEmail(email: string) {
  const [user] = await testDb().select().from(users).where(eq(users.email, email));
  if (!user) throw new Error(`Test-User ${email} fehlt in der Datenbank.`);
  return user;
}

/** Knoten im Organigramm-Diagramm (absolut positionierte Karte) */
function chartNode(page: Page, name: string): Locator {
  return page
    .locator("div.absolute.shadow-sm")
    .filter({ has: page.getByText(name, { exact: true }) });
}

/** Eintrag in der Liste „Ohne Zuordnung“ */
function unassignedEntry(page: Page, name: string): Locator {
  return page.locator("li").filter({ hasText: new RegExp(`^${name}$`) });
}

/**
 * Verschlüsselt wie encryptDocument (src/lib/document-crypto.ts):
 * [1 Byte keyVersion][12 Byte IV][16 Byte AuthTag][Ciphertext]
 */
function encryptLikeApp(plain: Buffer, keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64, "base64");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), ciphertext]);
}

test.describe("Organigramm", () => {
  test("zeigt die Hierarchie und hebt den eigenen Knoten hervor", async ({
    browser,
  }) => {
    const db = testDb();
    const admin = await userByEmail(E2E_ADMIN_EMAIL);
    const employee = await userByEmail(E2E_USER_EMAIL);

    try {
      // Admin = Geschäftsführung (Wurzel), Mitarbeiter berichtet fachlich
      // und disziplinarisch an den Admin
      await db
        .update(users)
        .set({
          isManagingDirector: true,
          technicalSupervisorId: null,
          disciplinarySupervisorId: null,
        })
        .where(eq(users.id, admin.id));
      await db
        .update(users)
        .set({
          isManagingDirector: false,
          technicalSupervisorId: admin.id,
          disciplinarySupervisorId: admin.id,
        })
        .where(eq(users.id, employee.id));

      const page = await pageAs(browser, USER_STATE);
      await page.goto("/organigramm");
      await expect(
        page.getByRole("heading", { level: 1, name: "Organigramm" })
      ).toBeVisible();
      await expect(page.getByText("Disziplinarisch", { exact: true })).toBeVisible();
      await expect(page.getByText("Fachlich", { exact: true })).toBeVisible();

      const adminNode = chartNode(page, ADMIN_NAME);
      const employeeNode = chartNode(page, USER_NAME);
      await expect(adminNode).toBeVisible();
      await expect(employeeNode).toBeVisible();
      await expect(adminNode).toContainText("Geschäftsführung");
      await expect(employeeNode).not.toContainText("Geschäftsführung");

      // Vorgesetzte/r steht eine Ebene über dem Mitarbeiter
      const adminBox = await adminNode.boundingBox();
      const employeeBox = await employeeNode.boundingBox();
      expect(adminBox).not.toBeNull();
      expect(employeeBox).not.toBeNull();
      expect(adminBox!.y).toBeLessThan(employeeBox!.y);
      // Fachlich + disziplinarisch dieselbe Person → Doppelstrich
      // (durchgezogener und gestrichelter Pfad im Kanten-SVG)
      const edges = page.locator("svg.pointer-events-none.absolute path");
      await expect(
        edges.and(page.locator('[stroke-dasharray="6 4"]')).first()
      ).toBeAttached();
      expect(await edges.count()).toBeGreaterThanOrEqual(2);

      // Eigener Knoten hervorgehoben (Ring), fremder nicht
      await expect(employeeNode).toHaveClass(HIGHLIGHT);
      await expect(adminNode).not.toHaveClass(HIGHLIGHT);
      // Beide stehen im Diagramm, nicht in „Ohne Zuordnung“
      await expect(unassignedEntry(page, USER_NAME)).toHaveCount(0);
      await expect(unassignedEntry(page, ADMIN_NAME)).toHaveCount(0);

      // Aus Admin-Sicht ist der Admin-Knoten hervorgehoben
      const adminPage = await pageAs(browser, ADMIN_STATE);
      await adminPage.goto("/organigramm");
      await expect(chartNode(adminPage, ADMIN_NAME)).toHaveClass(HIGHLIGHT);
      await expect(chartNode(adminPage, USER_NAME)).not.toHaveClass(HIGHLIGHT);
    } finally {
      await db
        .update(users)
        .set({
          isManagingDirector: admin.isManagingDirector,
          technicalSupervisorId: admin.technicalSupervisorId,
          disciplinarySupervisorId: admin.disciplinarySupervisorId,
        })
        .where(eq(users.id, admin.id));
      await db
        .update(users)
        .set({
          isManagingDirector: employee.isManagingDirector,
          technicalSupervisorId: employee.technicalSupervisorId,
          disciplinarySupervisorId: employee.disciplinarySupervisorId,
        })
        .where(eq(users.id, employee.id));
    }
  });

  test("Mitarbeitende ohne Vorgesetzte stehen unter „Ohne Zuordnung“", async ({
    browser,
  }) => {
    const db = testDb();
    const employee = await userByEmail(E2E_USER_EMAIL);
    try {
      await db
        .update(users)
        .set({
          isManagingDirector: false,
          technicalSupervisorId: null,
          disciplinarySupervisorId: null,
        })
        .where(eq(users.id, employee.id));

      const page = await pageAs(browser, USER_STATE);
      await page.goto("/organigramm");
      await expect(
        page.getByRole("heading", { level: 2, name: "Ohne Zuordnung" })
      ).toBeVisible();
      const own = unassignedEntry(page, USER_NAME);
      await expect(own).toBeVisible();
      await expect(own).toHaveClass(HIGHLIGHT);
      await expect(chartNode(page, USER_NAME)).toHaveCount(0);
    } finally {
      await db
        .update(users)
        .set({
          isManagingDirector: employee.isManagingDirector,
          technicalSupervisorId: employee.technicalSupervisorId,
          disciplinarySupervisorId: employee.disciplinarySupervisorId,
        })
        .where(eq(users.id, employee.id));
    }
  });
});

test.describe("Meine Dokumente", () => {
  test("listet eigene Dokumente; Download liefert den entschlüsselten Inhalt", async ({
    browser,
  }) => {
    const key = process.env.DOCUMENT_ENCRYPTION_KEY;
    test.skip(!key, "DOCUMENT_ENCRYPTION_KEY ist nicht gesetzt.");

    const db = testDb();
    const admin = await userByEmail(E2E_ADMIN_EMAIL);
    const employee = await userByEmail(E2E_USER_EMAIL);
    const stamp = Date.now();
    const title = `E2E-Arbeitsvertrag ${stamp}`;
    const filename = `arbeitsvertrag-${stamp}.txt`;
    const foreignTitle = `E2E-Fremddokument ${stamp}`;
    const plain = Buffer.from(`Arbeitsvertrag Max Mitarbeiter (${stamp})\n`, "utf8");
    const payload = encryptLikeApp(plain, key!);

    // Der Dev-Server lädt den Ciphertext per fetch(blobUrl) — ein lokaler
    // HTTP-Server ersetzt hier den Vercel-Blob-Store.
    const server = createServer((req, res) => {
      if (req.url === `/blob/${stamp}`) {
        res.writeHead(200, { "content-type": "application/octet-stream" });
        res.end(payload);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;

    const [own] = await db
      .insert(employeeDocuments)
      .values({
        userId: employee.id,
        category: "arbeitsvertrag",
        title,
        filename,
        contentType: "text/plain",
        sizeBytes: plain.length,
        blobUrl: `http://127.0.0.1:${port}/blob/${stamp}`,
        uploadedById: admin.id,
      })
      .returning();
    const [foreign] = await db
      .insert(employeeDocuments)
      .values({
        userId: admin.id,
        category: "sonstiges",
        title: foreignTitle,
        filename: `fremd-${stamp}.txt`,
        contentType: "text/plain",
        sizeBytes: 10,
        blobUrl: `http://127.0.0.1:${port}/blob/fremd`,
        uploadedById: admin.id,
      })
      .returning();

    try {
      const page = await pageAs(browser, USER_STATE);
      await page.goto("/dokumente");
      await expect(
        page.getByRole("heading", { level: 1, name: "Meine Dokumente" })
      ).toBeVisible();

      const row = page.getByRole("row").filter({ hasText: title });
      await expect(row).toBeVisible();
      await expect(row).toContainText(filename);
      await expect(row.locator('[data-slot="badge"]')).toHaveText(
        "Arbeitsvertrag"
      );
      await expect(row).toContainText(`${plain.length} B`);
      // Fremde Dokumente erscheinen nicht
      await expect(page.getByText(foreignTitle)).toHaveCount(0);

      const link = row.getByRole("link", { name: title, exact: true });
      await expect(link).toHaveAttribute("href", `/api/dokumente/${own.id}`);
      await expect(link).toHaveAttribute("target", "_blank");

      // Download mit der Session der Seite
      const response = await page.request.get(
        (await link.getAttribute("href"))!
      );
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toContain("text/plain");
      expect(response.headers()["content-disposition"]).toBe(
        `attachment; filename="${filename}"`
      );
      expect((await response.body()).toString("utf8")).toBe(
        plain.toString("utf8")
      );

      // Jeder Abruf wird protokolliert
      const audits = await db
        .select()
        .from(auditLog)
        .where(
          and(eq(auditLog.objectId, own.id), eq(auditLog.action, "abgerufen"))
        );
      expect(audits.length).toBeGreaterThanOrEqual(1);
      expect(audits[0].actorUserId).toBe(employee.id);

      // Fremdes Dokument: wie nicht vorhanden (404)
      const foreignResponse = await page.request.get(
        `/api/dokumente/${foreign.id}`
      );
      expect(foreignResponse.status()).toBe(404);
    } finally {
      await db.delete(employeeDocuments).where(eq(employeeDocuments.id, own.id));
      await db
        .delete(employeeDocuments)
        .where(eq(employeeDocuments.id, foreign.id));
      // Keep-Alive-Verbindungen des Dev-Servers nicht abwarten
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("Leerzustand ohne eigene Dokumente", async ({ browser }) => {
    const employee = await userByEmail(E2E_USER_EMAIL);
    const existing = await testDb()
      .select({ id: employeeDocuments.id })
      .from(employeeDocuments)
      .where(eq(employeeDocuments.userId, employee.id));
    test.skip(
      existing.length > 0,
      "Andere Specs haben Dokumente für den Mitarbeiter hinterlegt."
    );

    const page = await pageAs(browser, USER_STATE);
    await page.goto("/dokumente");
    await expect(
      page.getByText("Es sind noch keine Dokumente für dich hinterlegt.", {
        exact: true,
      })
    ).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
  });
});

test.describe("Mein Konto", () => {
  test("„URL kopieren“ legt die MCP-URL in die Zwischenablage", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      storageState: USER_STATE,
      baseURL: BASE_URL,
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const page = await context.newPage();
    try {
      await page.goto("/konto");
      await expect(
        page.getByRole("heading", { level: 1, name: "Mein Konto" })
      ).toBeVisible();

      const shownUrl = (await page.locator("code").first().innerText()).trim();
      expect(shownUrl).toMatch(/^https?:\/\/[^/]+\/mcp$/);
      if (process.env.APP_BASE_URL)
        expect(shownUrl).toBe(
          `${process.env.APP_BASE_URL.replace(/\/$/, "")}/mcp`
        );

      await openDialog(
        page.getByRole("button", { name: "URL kopieren", exact: true }),
        page
          .getByText("MCP-URL in die Zwischenablage kopiert.", { exact: true })
          .first()
      );
      const clipboard = await page.evaluate(() =>
        navigator.clipboard.readText()
      );
      expect(clipboard).toBe(shownUrl);
    } finally {
      await context.close();
    }
  });
});
