"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireUser } from "@/lib/auth";
import { seminarReportInputSchema } from "@/lib/seminar-reports";
import {
  createSeminarReport,
  deleteSeminarReport,
  setQuoteWebsiteApproved,
  updateQuoteText,
  updateSeminarReport,
} from "@/lib/seminar-reports-store";
import { UserError, runAction, type ActionResult } from "@/lib/user-error";

/**
 * Das Formular überträgt einen JSON-Payload, weil die Zitate eine Liste
 * variabler Länge sind — wie beim Reisekostenformular. Zod prüft die Struktur,
 * die Besitzverhältnisse prüft die Datenzugriffsschicht.
 */
function parsePayload(formData: FormData) {
  const raw = formData.get("payload");
  if (typeof raw !== "string") throw new UserError("Ungültige Formulardaten.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new UserError("Ungültige Formulardaten.");
  }
  return seminarReportInputSchema.parse(parsed);
}

function revalidateReportViews(id?: string) {
  revalidatePath("/berichte");
  revalidatePath("/berichte/alle");
  revalidatePath("/berichte/zitate");
  if (id) revalidatePath(`/berichte/${id}`);
}

export async function submitSeminarReport(
  formData: FormData
): Promise<ActionResult<null>> {
  const result = await runAction(async () => {
    const user = await requireUser();
    return createSeminarReport(user, parsePayload(formData));
  });
  if (!result.ok) return result;

  // revalidatePath vor redirect — redirect wirft und beendet die Action.
  revalidateReportViews(result.data);
  redirect(`/berichte/${result.data}`);
}

export async function updateSeminarReportAction(
  id: string,
  formData: FormData
): Promise<ActionResult<null>> {
  const result = await runAction(async () => {
    const user = await requireUser();
    await updateSeminarReport(user, id, parsePayload(formData));
    return null;
  });
  if (result.ok) revalidateReportViews(id);
  return result;
}

export async function deleteSeminarReportAction(id: string): Promise<void> {
  const user = await requireUser();
  await deleteSeminarReport(user, id);
  revalidateReportViews(id);
  redirect("/berichte");
}

/** Wortlaut eines einzelnen Zitats korrigieren — nur für den Admin. */
export async function updateQuoteTextAction(
  quoteId: string,
  formData: FormData
): Promise<ActionResult<null>> {
  const result = await runAction(async () => {
    const admin = await requireAdmin();
    return updateQuoteText(admin, quoteId, String(formData.get("quote") ?? ""));
  });
  if (!result.ok) return result;

  revalidateReportViews(result.data);
  return { ok: true, data: null };
}

export async function toggleQuoteWebsiteApproval(
  quoteId: string,
  approved: boolean
): Promise<ActionResult<null>> {
  const result = await runAction(async () => {
    const admin = await requireAdmin();
    await setQuoteWebsiteApproved(admin, quoteId, approved);
    return null;
  });
  if (result.ok) revalidateReportViews();
  return result;
}
