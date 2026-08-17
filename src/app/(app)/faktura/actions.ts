"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import {
  createTimeEntry,
  softDeleteTimeEntry,
  updateTimeEntry,
  type SaveEntryResult,
} from "@/lib/faktura/buchungen";
import { runAction, type ActionResult } from "@/lib/user-error";

function parseEntryForm(formData: FormData) {
  return {
    projectId: String(formData.get("projectId") ?? ""),
    entryDate: String(formData.get("entryDate") ?? ""),
    durationHours: String(formData.get("durationHours") ?? ""),
    description: String(formData.get("description") ?? ""),
    confirmWarnings: formData.get("confirmWarnings") === "true",
  };
}

export async function createEntryAction(
  formData: FormData
): Promise<SaveEntryResult> {
  const user = await requireUser();
  const result = await runAction(() =>
    createTimeEntry(user, parseEntryForm(formData), "web")
  );
  if (!result.ok) return result;
  if (result.data.ok) {
    revalidatePath("/faktura");
    revalidatePath("/dashboard");
  }
  return result.data;
}

export async function updateEntryAction(
  id: string,
  formData: FormData
): Promise<SaveEntryResult> {
  const user = await requireUser();
  const result = await runAction(() =>
    updateTimeEntry(user, id, parseEntryForm(formData), "web")
  );
  if (!result.ok) return result;
  if (result.data.ok) revalidatePath("/faktura");
  return result.data;
}

export async function deleteEntryAction(
  id: string
): Promise<ActionResult<null>> {
  const user = await requireUser();
  return runAction(async () => {
    await softDeleteTimeEntry(user, id, "web");
    revalidatePath("/faktura");
    return null;
  });
}
