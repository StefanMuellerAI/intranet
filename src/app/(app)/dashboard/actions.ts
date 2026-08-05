"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, salesNews, salesNewsDismissals } from "@/db";
import { requireUser } from "@/lib/auth";

/**
 * Schließt eine Sales-Nachricht nur für die angemeldete Person: Sie
 * verschwindet von deren Dashboard, bleibt für alle anderen aber sichtbar.
 */
export async function dismissSalesNews(id: string) {
  const user = await requireUser();

  const [item] = await db
    .select({ id: salesNews.id })
    .from(salesNews)
    .where(eq(salesNews.id, id))
    .limit(1);
  if (!item) throw new Error("Sales-Nachricht nicht gefunden.");

  // Idempotent — ein Doppelklick oder zweiter Tab erzeugt keinen Fehler
  await db
    .insert(salesNewsDismissals)
    .values({ salesNewsId: item.id, userId: user.id })
    .onConflictDoNothing();

  revalidatePath("/dashboard");
}
