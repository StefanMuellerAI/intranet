"use server";

import { revalidatePath } from "next/cache";
import { requireApprover } from "@/lib/auth";
import {
  approveRequest,
  rejectRequest,
  type WorkflowType,
} from "@/lib/workflow";

export async function approveAction(type: WorkflowType, id: string) {
  const approver = await requireApprover();
  await approveRequest(type, id, { user: approver, source: "web" });
  revalidatePath("/freigaben");
  revalidatePath(`/${type}`);
}

export async function rejectAction(
  type: WorkflowType,
  id: string,
  formData: FormData
) {
  const approver = await requireApprover();
  const comment = String(formData.get("comment") ?? "");
  await rejectRequest(type, id, comment, { user: approver, source: "web" });
  revalidatePath("/freigaben");
  revalidatePath(`/${type}`);
}
