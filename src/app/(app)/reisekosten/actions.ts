"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { del } from "@vercel/blob";
import {
  db,
  expenseReports,
  receipts,
  requestHistory,
} from "@/db";
import { writeAudit } from "@/lib/audit";
import { fullName, requireUser } from "@/lib/auth";
import {
  createExpenseReport,
  expenseReportInputSchema,
  receiptSourceFromFormData,
  resubmitExpenseReportForUser,
  withdrawExpenseReportForUser,
} from "@/lib/requests/expense";

function parsePayload(formData: FormData) {
  const raw = formData.get("payload");
  if (typeof raw !== "string") throw new Error("Ungültige Formulardaten.");
  return expenseReportInputSchema.parse(JSON.parse(raw));
}

export async function submitExpenseReport(formData: FormData) {
  const user = await requireUser();
  const report = await createExpenseReport(
    user,
    parsePayload(formData),
    "web",
    receiptSourceFromFormData(formData)
  );
  revalidatePath("/reisekosten");
  redirect(`/reisekosten/${report.id}`);
}

export async function resubmitExpenseReport(id: string, formData: FormData) {
  const user = await requireUser();
  await resubmitExpenseReportForUser(
    user,
    id,
    parsePayload(formData),
    "web",
    receiptSourceFromFormData(formData)
  );
  revalidatePath("/reisekosten");
  redirect(`/reisekosten/${id}`);
}

export async function withdrawExpenseReport(id: string) {
  const user = await requireUser();
  await withdrawExpenseReportForUser(user, id, "web");
  revalidatePath(`/reisekosten/${id}`);
  revalidatePath("/reisekosten");
}

export async function deleteExpenseReport(id: string) {
  const user = await requireUser();
  const existing = await db.query.expenseReports.findFirst({
    where: eq(expenseReports.id, id),
  });
  if (!existing || existing.userId !== user.id)
    throw new Error("Abrechnung nicht gefunden.");
  if (existing.status !== "zurueckgezogen")
    throw new Error(
      "Nur zurückgezogene Abrechnungen können endgültig gelöscht werden."
    );

  const reportReceipts = await db
    .select()
    .from(receipts)
    .where(eq(receipts.reportId, id));
  if (reportReceipts.length > 0)
    await del(reportReceipts.map((r) => r.blobUrl));

  await writeAudit({
    objectType: "reisekosten",
    objectId: id,
    action: "geloescht",
    actorUserId: user.id,
    actorLabel: fullName(user),
    source: "web",
    details: {
      destination: existing.destination,
      departureDate: existing.departureDate,
      returnDate: existing.returnDate,
      totalCents: existing.totalCents,
    },
  });

  await db
    .delete(requestHistory)
    .where(
      and(
        eq(requestHistory.requestType, "reisekosten"),
        eq(requestHistory.requestId, id)
      )
    );
  await db.delete(expenseReports).where(eq(expenseReports.id, id));

  revalidatePath("/reisekosten");
  redirect("/reisekosten");
}
