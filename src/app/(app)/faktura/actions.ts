"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import {
  createTimeEntry,
  softDeleteTimeEntry,
  updateTimeEntry,
  type SaveEntryResult,
} from "@/lib/faktura/buchungen";

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
  const result = await createTimeEntry(user, parseEntryForm(formData), "web");
  if (result.ok) {
    revalidatePath("/faktura");
    revalidatePath("/dashboard");
  }
  return result;
}

export async function updateEntryAction(
  id: string,
  formData: FormData
): Promise<SaveEntryResult> {
  const user = await requireUser();
  const result = await updateTimeEntry(
    user,
    id,
    parseEntryForm(formData),
    "web"
  );
  if (result.ok) revalidatePath("/faktura");
  return result;
}

export async function deleteEntryAction(id: string): Promise<void> {
  const user = await requireUser();
  await softDeleteTimeEntry(user, id, "web");
  revalidatePath("/faktura");
}
