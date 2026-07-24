"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import {
  createCustomer,
  createProject,
  setCustomerActive,
  setProjectActive,
  updateCustomer,
  updateProject,
} from "@/lib/faktura/stammdaten";
import { runAction, type ActionResult } from "@/lib/faktura/user-error";

function optional(formData: FormData, key: string): string | undefined {
  const value = String(formData.get(key) ?? "").trim();
  return value || undefined;
}

function customerInput(formData: FormData) {
  return {
    name: String(formData.get("name") ?? ""),
    address: optional(formData, "address"),
    contactPerson: optional(formData, "contactPerson"),
  };
}

function projectInput(formData: FormData) {
  const limitRaw = String(formData.get("monthlyLimitHours") ?? "").trim();
  return {
    name: String(formData.get("name") ?? ""),
    validFrom: optional(formData, "validFrom"),
    validTo: optional(formData, "validTo"),
    monthlyLimitHours: limitRaw
      ? Number(limitRaw.replace(",", "."))
      : undefined,
  };
}

export async function createCustomerAction(
  formData: FormData
): Promise<ActionResult<null>> {
  const admin = await requireAdmin();
  return runAction(async () => {
    await createCustomer(admin, customerInput(formData), "web");
    revalidatePath("/faktura/kunden");
    return null;
  });
}

export async function updateCustomerAction(
  formData: FormData
): Promise<ActionResult<null>> {
  const admin = await requireAdmin();
  return runAction(async () => {
    await updateCustomer(
      admin,
      String(formData.get("id") ?? ""),
      customerInput(formData),
      "web"
    );
    revalidatePath("/faktura/kunden");
    return null;
  });
}

export async function toggleCustomerActiveAction(
  id: string,
  active: boolean
): Promise<ActionResult<null>> {
  const admin = await requireAdmin();
  return runAction(async () => {
    await setCustomerActive(admin, id, active, "web");
    revalidatePath("/faktura/kunden");
    return null;
  });
}

export async function createProjectAction(
  formData: FormData
): Promise<ActionResult<null>> {
  const admin = await requireAdmin();
  return runAction(async () => {
    await createProject(
      admin,
      {
        customerId: String(formData.get("customerId") ?? ""),
        ...projectInput(formData),
      },
      "web"
    );
    revalidatePath("/faktura/kunden");
    return null;
  });
}

export async function updateProjectAction(
  formData: FormData
): Promise<ActionResult<null>> {
  const admin = await requireAdmin();
  return runAction(async () => {
    await updateProject(
      admin,
      String(formData.get("id") ?? ""),
      projectInput(formData),
      "web"
    );
    revalidatePath("/faktura/kunden");
    return null;
  });
}

export async function toggleProjectActiveAction(
  id: string,
  active: boolean
): Promise<ActionResult<null>> {
  const admin = await requireAdmin();
  return runAction(async () => {
    await setProjectActive(admin, id, active, "web");
    revalidatePath("/faktura/kunden");
    return null;
  });
}
