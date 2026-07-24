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

export async function createCustomerAction(formData: FormData) {
  const admin = await requireAdmin();
  await createCustomer(admin, customerInput(formData), "web");
  revalidatePath("/faktura/kunden");
}

export async function updateCustomerAction(formData: FormData) {
  const admin = await requireAdmin();
  await updateCustomer(
    admin,
    String(formData.get("id") ?? ""),
    customerInput(formData),
    "web"
  );
  revalidatePath("/faktura/kunden");
}

export async function toggleCustomerActiveAction(id: string, active: boolean) {
  const admin = await requireAdmin();
  await setCustomerActive(admin, id, active, "web");
  revalidatePath("/faktura/kunden");
}

export async function createProjectAction(formData: FormData) {
  const admin = await requireAdmin();
  await createProject(
    admin,
    {
      customerId: String(formData.get("customerId") ?? ""),
      ...projectInput(formData),
    },
    "web"
  );
  revalidatePath("/faktura/kunden");
}

export async function updateProjectAction(formData: FormData) {
  const admin = await requireAdmin();
  await updateProject(
    admin,
    String(formData.get("id") ?? ""),
    projectInput(formData),
    "web"
  );
  revalidatePath("/faktura/kunden");
}

export async function toggleProjectActiveAction(id: string, active: boolean) {
  const admin = await requireAdmin();
  await setProjectActive(admin, id, active, "web");
  revalidatePath("/faktura/kunden");
}
