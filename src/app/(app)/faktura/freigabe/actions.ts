"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq } from "drizzle-orm";
import { auditLog, db } from "@/db";
import { requireAdmin } from "@/lib/auth";
import {
  adminCreateTimeEntry,
  adminSetEntryVisibility,
  adminSoftDeleteTimeEntry,
  adminUpdateTimeEntry,
} from "@/lib/faktura/buchungen";
import { approveWeek, revokeWeekApproval } from "@/lib/faktura/freigabe";

function revalidate() {
  revalidatePath("/faktura/freigabe");
  revalidatePath("/faktura");
  revalidatePath("/faktura/kunden");
  revalidatePath("/faktura/export");
}

export async function approveWeekAction(isoYear: number, isoWeek: number) {
  const admin = await requireAdmin();
  await approveWeek(admin, isoYear, isoWeek, "web");
  revalidate();
}

export async function revokeWeekAction(formData: FormData) {
  const admin = await requireAdmin();
  await revokeWeekApproval(
    admin,
    Number(formData.get("isoYear")),
    Number(formData.get("isoWeek")),
    String(formData.get("reason") ?? ""),
    "web"
  );
  revalidate();
}

function parseAdminEntryForm(formData: FormData) {
  return {
    projectId: String(formData.get("projectId") ?? ""),
    entryDate: String(formData.get("entryDate") ?? ""),
    durationHours: String(formData.get("durationHours") ?? ""),
    description: String(formData.get("description") ?? ""),
    reason: String(formData.get("reason") ?? "").trim() || undefined,
    confirmWarnings: true,
  };
}

/** Admin legt eine Buchung für eine/n Mitarbeiter/in an (FA-5.3). */
export async function adminCreateEntryAction(formData: FormData) {
  const admin = await requireAdmin();
  await adminCreateTimeEntry(
    admin,
    {
      userId: String(formData.get("userId") ?? ""),
      ...parseAdminEntryForm(formData),
    },
    "web"
  );
  revalidate();
}

/** Admin passt eine Buchung an — bei freigegebenen mit Pflichtbegründung (FA-5.5). */
export async function adminUpdateEntryAction(id: string, formData: FormData) {
  const admin = await requireAdmin();
  await adminUpdateTimeEntry(admin, id, parseAdminEntryForm(formData), "web");
  revalidate();
}

export async function adminDeleteEntryAction(id: string, reason: string) {
  const admin = await requireAdmin();
  await adminSoftDeleteTimeEntry(admin, id, reason || undefined, "web");
  revalidate();
}

/** Ausblenden/Einblenden für den Stundenzettel (FA-4.4/FA-4.5). */
export async function setEntryVisibilityAction(id: string, visible: boolean) {
  const admin = await requireAdmin();
  await adminSetEntryVisibility(admin, id, visible, "web");
  revalidate();
}

export interface EntryHistoryItem {
  createdAt: string;
  action: string;
  actorLabel: string;
  details: string;
}

/** Audit-Historie einer Buchung — „Historie anzeigen" (FA-7.4). */
export async function getEntryHistoryAction(
  entryId: string
): Promise<EntryHistoryItem[]> {
  await requireAdmin();
  const rows = await db
    .select()
    .from(auditLog)
    .where(
      and(
        eq(auditLog.objectType, "faktura_buchung"),
        eq(auditLog.objectId, entryId)
      )
    )
    .orderBy(desc(auditLog.createdAt));
  return rows.map((row) => ({
    createdAt: row.createdAt.toISOString(),
    action: row.action,
    actorLabel: row.actorLabel,
    details: row.details ? JSON.stringify(row.details, null, 2) : "",
  }));
}
