"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, helpfulLinks, newsItems, salesNews, teamEvents, users } from "@/db";
import { writeAudit } from "@/lib/audit";
import { fullName, requireAdmin } from "@/lib/auth";
import {
  parseDeliveryRange,
  parseEuroVolume,
  parseEventRange,
  parseExternalUrl,
  parseSortOrder,
  requireNonEmpty,
} from "@/lib/content";

function revalidateContent() {
  revalidatePath("/inhalte");
  revalidatePath("/dashboard");
}

/** Teamevents erscheinen zusätzlich im Abwesenheitskalender. */
function revalidateTeamEvents() {
  revalidateContent();
  revalidatePath("/kalender");
}

// ---------------------------------------------------------------------------
// Hilfreiche Links
// ---------------------------------------------------------------------------

export async function createHelpfulLink(formData: FormData) {
  const admin = await requireAdmin();
  const title = requireNonEmpty(String(formData.get("title") ?? ""), "Titel");
  const url = parseExternalUrl(String(formData.get("url") ?? ""));
  const description =
    String(formData.get("description") ?? "").trim() || null;
  const sortOrder = parseSortOrder(String(formData.get("sortOrder") ?? "0"));

  const [row] = await db
    .insert(helpfulLinks)
    .values({ title, url, description, sortOrder })
    .returning();

  await writeAudit({
    objectType: "hilfreicher_link",
    objectId: row.id,
    action: "erstellt",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
    details: { title, url },
  });
  revalidateContent();
}

export async function updateHelpfulLink(formData: FormData) {
  const admin = await requireAdmin();
  const id = requireNonEmpty(String(formData.get("id") ?? ""), "ID");
  const title = requireNonEmpty(String(formData.get("title") ?? ""), "Titel");
  const url = parseExternalUrl(String(formData.get("url") ?? ""));
  const description =
    String(formData.get("description") ?? "").trim() || null;
  const sortOrder = parseSortOrder(String(formData.get("sortOrder") ?? "0"));

  await db
    .update(helpfulLinks)
    .set({ title, url, description, sortOrder, updatedAt: new Date() })
    .where(eq(helpfulLinks.id, id));

  await writeAudit({
    objectType: "hilfreicher_link",
    objectId: id,
    action: "aktualisiert",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
    details: { title, url },
  });
  revalidateContent();
}

export async function toggleHelpfulLink(id: string) {
  const admin = await requireAdmin();
  const [row] = await db
    .select()
    .from(helpfulLinks)
    .where(eq(helpfulLinks.id, id))
    .limit(1);
  if (!row) throw new Error("Link nicht gefunden.");

  await db
    .update(helpfulLinks)
    .set({ active: !row.active, updatedAt: new Date() })
    .where(eq(helpfulLinks.id, id));

  await writeAudit({
    objectType: "hilfreicher_link",
    objectId: id,
    action: row.active ? "deaktiviert" : "aktiviert",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
  });
  revalidateContent();
}

export async function deleteHelpfulLink(id: string) {
  const admin = await requireAdmin();
  await db.delete(helpfulLinks).where(eq(helpfulLinks.id, id));

  await writeAudit({
    objectType: "hilfreicher_link",
    objectId: id,
    action: "geloescht",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
  });
  revalidateContent();
}

// ---------------------------------------------------------------------------
// Neuigkeiten
// ---------------------------------------------------------------------------

export async function createNewsItem(formData: FormData) {
  const admin = await requireAdmin();
  const title = requireNonEmpty(String(formData.get("title") ?? ""), "Titel");
  const body = requireNonEmpty(String(formData.get("body") ?? ""), "Nachricht");

  const [row] = await db
    .insert(newsItems)
    .values({ title, body, createdById: admin.id })
    .returning();

  await writeAudit({
    objectType: "neuigkeit",
    objectId: row.id,
    action: "erstellt",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
    details: { title },
  });
  revalidateContent();
}

export async function updateNewsItem(formData: FormData) {
  const admin = await requireAdmin();
  const id = requireNonEmpty(String(formData.get("id") ?? ""), "ID");
  const title = requireNonEmpty(String(formData.get("title") ?? ""), "Titel");
  const body = requireNonEmpty(String(formData.get("body") ?? ""), "Nachricht");

  await db
    .update(newsItems)
    .set({ title, body, updatedAt: new Date() })
    .where(eq(newsItems.id, id));

  await writeAudit({
    objectType: "neuigkeit",
    objectId: id,
    action: "aktualisiert",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
    details: { title },
  });
  revalidateContent();
}

export async function toggleNewsItem(id: string) {
  const admin = await requireAdmin();
  const [row] = await db
    .select()
    .from(newsItems)
    .where(eq(newsItems.id, id))
    .limit(1);
  if (!row) throw new Error("Neuigkeit nicht gefunden.");

  await db
    .update(newsItems)
    .set({ active: !row.active, updatedAt: new Date() })
    .where(eq(newsItems.id, id));

  await writeAudit({
    objectType: "neuigkeit",
    objectId: id,
    action: row.active ? "deaktiviert" : "aktiviert",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
  });
  revalidateContent();
}

export async function deleteNewsItem(id: string) {
  const admin = await requireAdmin();
  await db.delete(newsItems).where(eq(newsItems.id, id));

  await writeAudit({
    objectType: "neuigkeit",
    objectId: id,
    action: "geloescht",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
  });
  revalidateContent();
}

// ---------------------------------------------------------------------------
// Teamevents
// ---------------------------------------------------------------------------

export async function createTeamEvent(formData: FormData) {
  const admin = await requireAdmin();
  const title = requireNonEmpty(String(formData.get("title") ?? ""), "Titel");
  const { startDate, endDate } = parseEventRange(
    String(formData.get("startDate") ?? ""),
    String(formData.get("endDate") ?? "")
  );

  const [row] = await db
    .insert(teamEvents)
    .values({ title, startDate, endDate, createdById: admin.id })
    .returning();

  await writeAudit({
    objectType: "teamevent",
    objectId: row.id,
    action: "erstellt",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
    details: { title, startDate, endDate },
  });
  revalidateTeamEvents();
}

export async function updateTeamEvent(formData: FormData) {
  const admin = await requireAdmin();
  const id = requireNonEmpty(String(formData.get("id") ?? ""), "ID");
  const title = requireNonEmpty(String(formData.get("title") ?? ""), "Titel");
  const { startDate, endDate } = parseEventRange(
    String(formData.get("startDate") ?? ""),
    String(formData.get("endDate") ?? "")
  );

  await db
    .update(teamEvents)
    .set({ title, startDate, endDate, updatedAt: new Date() })
    .where(eq(teamEvents.id, id));

  await writeAudit({
    objectType: "teamevent",
    objectId: id,
    action: "aktualisiert",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
    details: { title, startDate, endDate },
  });
  revalidateTeamEvents();
}

export async function toggleTeamEvent(id: string) {
  const admin = await requireAdmin();
  const [row] = await db
    .select()
    .from(teamEvents)
    .where(eq(teamEvents.id, id))
    .limit(1);
  if (!row) throw new Error("Teamevent nicht gefunden.");

  await db
    .update(teamEvents)
    .set({ active: !row.active, updatedAt: new Date() })
    .where(eq(teamEvents.id, id));

  await writeAudit({
    objectType: "teamevent",
    objectId: id,
    action: row.active ? "deaktiviert" : "aktiviert",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
  });
  revalidateTeamEvents();
}

export async function deleteTeamEvent(id: string) {
  const admin = await requireAdmin();
  await db.delete(teamEvents).where(eq(teamEvents.id, id));

  await writeAudit({
    objectType: "teamevent",
    objectId: id,
    action: "geloescht",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
  });
  revalidateTeamEvents();
}

// ---------------------------------------------------------------------------
// Sales-Nachrichten
// ---------------------------------------------------------------------------

/** Prüft, dass die/der ursächliche Mitarbeiter/in existiert, und liefert sie/ihn. */
async function requireSeller(id: string) {
  const seller = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!seller) throw new Error("Mitarbeiter/in nicht gefunden.");
  return seller;
}

/** Liest und validiert die Formularfelder einer Sales-Nachricht. */
function parseSalesNewsInput(formData: FormData) {
  const customerName = requireNonEmpty(
    String(formData.get("customerName") ?? ""),
    "Kundenname"
  );
  const volumeCents = parseEuroVolume(String(formData.get("volume") ?? ""));
  const soldById = requireNonEmpty(
    String(formData.get("soldById") ?? ""),
    "Ursächliche/r Mitarbeiter/in"
  );
  const { deliveryStart, deliveryEnd } = parseDeliveryRange(
    String(formData.get("deliveryStart") ?? ""),
    String(formData.get("deliveryEnd") ?? "")
  );
  return { customerName, volumeCents, soldById, deliveryStart, deliveryEnd };
}

export async function createSalesNews(formData: FormData) {
  const admin = await requireAdmin();
  const input = parseSalesNewsInput(formData);
  const seller = await requireSeller(input.soldById);

  const [row] = await db
    .insert(salesNews)
    .values({ ...input, createdById: admin.id })
    .returning();

  await writeAudit({
    objectType: "sales_nachricht",
    objectId: row.id,
    action: "erstellt",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
    details: {
      customerName: input.customerName,
      volumeCents: input.volumeCents,
      soldBy: fullName(seller),
    },
  });
  revalidateContent();
}

export async function updateSalesNews(formData: FormData) {
  const admin = await requireAdmin();
  const id = requireNonEmpty(String(formData.get("id") ?? ""), "ID");
  const input = parseSalesNewsInput(formData);
  const seller = await requireSeller(input.soldById);

  await db
    .update(salesNews)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(salesNews.id, id));

  await writeAudit({
    objectType: "sales_nachricht",
    objectId: id,
    action: "aktualisiert",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
    details: {
      customerName: input.customerName,
      volumeCents: input.volumeCents,
      soldBy: fullName(seller),
    },
  });
  revalidateContent();
}

export async function toggleSalesNews(id: string) {
  const admin = await requireAdmin();
  const [row] = await db
    .select()
    .from(salesNews)
    .where(eq(salesNews.id, id))
    .limit(1);
  if (!row) throw new Error("Sales-Nachricht nicht gefunden.");

  await db
    .update(salesNews)
    .set({ active: !row.active, updatedAt: new Date() })
    .where(eq(salesNews.id, id));

  await writeAudit({
    objectType: "sales_nachricht",
    objectId: id,
    action: row.active ? "deaktiviert" : "aktiviert",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
  });
  revalidateContent();
}

export async function deleteSalesNews(id: string) {
  const admin = await requireAdmin();
  await db.delete(salesNews).where(eq(salesNews.id, id));

  await writeAudit({
    objectType: "sales_nachricht",
    objectId: id,
    action: "geloescht",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
  });
  revalidateContent();
}
