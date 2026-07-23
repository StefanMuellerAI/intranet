"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { del, put } from "@vercel/blob";
import { z } from "zod";
import {
  db,
  expenseItems,
  expenseReports,
  receipts,
  requestHistory,
} from "@/db";
import { writeAudit } from "@/lib/audit";
import { fullName, requireUser } from "@/lib/auth";
import { formatDateDE } from "@/lib/dates";
import {
  calcCarCents,
  calcEmployerSupplementCents,
  calcMealAllowance,
  calcReportTotals,
  formatEuro,
  type AbsenceType,
} from "@/lib/expenses/calc";
import { saveHistorySnapshot } from "@/lib/history";
import { notifyRequestSubmitted } from "@/lib/notifications";
import { getSettings, ratesFromSettings } from "@/lib/settings";
import { dispatchWebhookEvent } from "@/lib/webhooks";
import { buildWebhookPayload } from "@/lib/workflow";

const mealRowSchema = z.object({
  date: z.string(),
  absenceType: z.enum([
    "ganzer_tag",
    "an_abreisetag",
    "ueber_8_std",
    "unter_8_std",
  ]),
  breakfastProvided: z.boolean(),
  lunchProvided: z.boolean(),
  dinnerProvided: z.boolean(),
});

const belegItemSchema = z.object({
  date: z.string().min(1),
  description: z.string().min(1),
  amountCents: z.number().int().min(0),
  /** Index der Datei im FormData (receipt_<n>) oder vorhandene Beleg-ID */
  fileIndex: z.number().int().optional(),
  existingReceiptId: z.string().optional(),
});

const reportSchema = z
  .object({
    destination: z.string().min(1, "Bitte Reiseziel angeben."),
    customerPurpose: z.string().min(1, "Bitte Kunde / Anlass angeben."),
    departureDate: z.string().min(1),
    departureTime: z.string().min(1),
    returnDate: z.string().min(1),
    returnTime: z.string().min(1),
    isAbroad: z.boolean(),
    mealDays: z.array(mealRowSchema),
    transport: z.array(belegItemSchema),
    carKilometers: z.number().min(0),
    carPassengers: z.number().int().min(0),
    lodging: z.array(belegItemSchema),
    incidentals: z.array(belegItemSchema),
  })
  .refine(
    (v) =>
      `${v.returnDate}T${v.returnTime}` > `${v.departureDate}T${v.departureTime}`,
    { message: "Die Rückkehr muss nach der Abreise liegen." }
  );

type ReportInput = z.infer<typeof reportSchema>;

const ALLOWED_RECEIPT_TYPES = ["application/pdf", "image/jpeg", "image/png"];

function parsePayload(formData: FormData): ReportInput {
  const raw = formData.get("payload");
  if (typeof raw !== "string") throw new Error("Ungültige Formulardaten.");
  return reportSchema.parse(JSON.parse(raw));
}

async function persistReport(
  userId: string,
  data: ReportInput,
  formData: FormData,
  existingReportId?: string
): Promise<string> {
  const settings = await getSettings();
  const rates = ratesFromSettings(settings);

  // Berechnung ausschließlich serverseitig mit den aktuellen Sätzen
  const meal = calcMealAllowance(
    data.mealDays.map((d) => ({ ...d, absenceType: d.absenceType as AbsenceType })),
    rates
  );
  const carCents = calcCarCents(data.carKilometers, data.carPassengers, rates);
  const supplementCents = calcEmployerSupplementCents(meal.rows, rates);
  const totals = calcReportTotals({
    mealAllowanceCents: meal.totalCents,
    transportItemCents: data.transport.map((t) => t.amountCents),
    carCents,
    lodgingItemCents: data.lodging.map((l) => l.amountCents),
    incidentalItemCents: data.incidentals.map((i) => i.amountCents),
    employerSupplementCents: supplementCents,
  });

  const reportValues = {
    userId,
    destination: data.destination,
    customerPurpose: data.customerPurpose,
    departureDate: data.departureDate,
    departureTime: data.departureTime,
    returnDate: data.returnDate,
    returnTime: data.returnTime,
    isAbroad: data.isAbroad,
    ratesSnapshot: rates as unknown as Record<string, number>,
    mealAllowanceCents: totals.mealAllowanceCents,
    transportCents: totals.transportCents,
    carCents: totals.carCents,
    lodgingCents: totals.lodgingCents,
    incidentalsCents: totals.incidentalsCents,
    employerSupplementCents: totals.employerSupplementCents,
    totalCents: totals.totalCents,
  };

  let reportId: string;
  if (existingReportId) {
    reportId = existingReportId;
    await db
      .update(expenseReports)
      .set({ ...reportValues, updatedAt: new Date() })
      .where(eq(expenseReports.id, reportId));
    await db.delete(expenseItems).where(eq(expenseItems.reportId, reportId));
  } else {
    const [report] = await db
      .insert(expenseReports)
      .values(reportValues)
      .returning();
    reportId = report.id;
  }

  // Positionen anlegen
  let position = 0;
  const itemIdByBelegKey = new Map<string, string>();

  for (const row of meal.rows) {
    await db.insert(expenseItems).values({
      reportId,
      kind: "verpflegung",
      position: position++,
      itemDate: row.date,
      absenceType: row.absenceType,
      breakfastProvided: row.breakfastProvided,
      lunchProvided: row.lunchProvided,
      dinnerProvided: row.dinnerProvided,
      grossCents: row.grossCents,
      reductionCents: row.reductionCents,
      netCents: row.netCents,
    });
  }

  const belegBlocks: {
    kind: "fahrt" | "uebernachtung" | "nebenkosten";
    items: ReportInput["transport"];
  }[] = [
    { kind: "fahrt", items: data.transport },
    { kind: "uebernachtung", items: data.lodging },
    { kind: "nebenkosten", items: data.incidentals },
  ];
  for (const block of belegBlocks) {
    for (const [idx, item] of block.items.entries()) {
      const [inserted] = await db
        .insert(expenseItems)
        .values({
          reportId,
          kind: block.kind,
          position: position++,
          itemDate: item.date,
          description: item.description,
          amountCents: item.amountCents,
          netCents: item.amountCents,
        })
        .returning();
      itemIdByBelegKey.set(`${block.kind}_${idx}`, inserted.id);
    }
  }

  if (data.carKilometers > 0) {
    await db.insert(expenseItems).values({
      reportId,
      kind: "pkw",
      position: position++,
      description: "Privat-Pkw",
      kilometers: data.carKilometers,
      passengers: data.carPassengers,
      netCents: carCents,
    });
  }

  // Beleg-Uploads (PDF/JPG/PNG) nach Vercel Blob
  for (const block of belegBlocks) {
    for (const [idx, item] of block.items.entries()) {
      const key = `${block.kind}_${idx}`;
      if (item.existingReceiptId) {
        // Bestehenden Beleg an die neue Position hängen (Korrekturfall)
        await db
          .update(receipts)
          .set({ itemId: itemIdByBelegKey.get(key) })
          .where(eq(receipts.id, item.existingReceiptId));
        continue;
      }
      if (item.fileIndex === undefined) continue;
      const file = formData.get(`receipt_${item.fileIndex}`);
      if (!(file instanceof File) || file.size === 0) continue;
      if (!ALLOWED_RECEIPT_TYPES.includes(file.type))
        throw new Error(
          `Beleg "${file.name}": Nur PDF, JPG oder PNG sind zulässig.`
        );
      const blob = await put(
        `belege/${reportId}/${crypto.randomUUID()}-${file.name}`,
        file,
        { access: "public", addRandomSuffix: false }
      );
      await db.insert(receipts).values({
        reportId,
        itemId: itemIdByBelegKey.get(key),
        userId,
        filename: file.name,
        contentType: file.type,
        sizeBytes: file.size,
        blobUrl: blob.url,
      });
    }
  }

  return reportId;
}

export async function submitExpenseReport(formData: FormData) {
  const user = await requireUser();
  const data = parsePayload(formData);
  const reportId = await persistReport(user.id, data, formData);

  const report = await db.query.expenseReports.findFirst({
    where: eq(expenseReports.id, reportId),
  });
  await writeAudit({
    objectType: "reisekosten",
    objectId: reportId,
    action: "eingereicht",
    actorUserId: user.id,
    actorLabel: fullName(user),
    source: "web",
  });
  await notifyRequestSubmitted({
    type: "reisekosten",
    requestId: reportId,
    applicant: user,
    resubmitted: false,
    summary: `${data.destination} (${data.customerPurpose}), ${formatDateDE(data.departureDate)} bis ${formatDateDE(data.returnDate)}, Gesamterstattung ${formatEuro(report!.totalCents)}.`,
  });
  await dispatchWebhookEvent(
    "reisekosten",
    "eingereicht",
    await buildWebhookPayload("reisekosten", report!, user)
  );

  revalidatePath("/reisekosten");
  redirect(`/reisekosten/${reportId}`);
}

export async function resubmitExpenseReport(id: string, formData: FormData) {
  const user = await requireUser();
  const existing = await db.query.expenseReports.findFirst({
    where: eq(expenseReports.id, id),
  });
  if (!existing || existing.userId !== user.id)
    throw new Error("Abrechnung nicht gefunden.");
  if (existing.status !== "beanstandet" && existing.status !== "zurueckgezogen")
    throw new Error(
      "Nur beanstandete oder zurückgezogene Abrechnungen können korrigiert werden."
    );

  const oldItems = await db
    .select()
    .from(expenseItems)
    .where(eq(expenseItems.reportId, id));
  await saveHistorySnapshot("reisekosten", id, existing.version, {
    ...existing,
    items: oldItems,
  });

  const data = parsePayload(formData);
  await persistReport(user.id, data, formData, id);
  const [report] = await db
    .update(expenseReports)
    .set({
      status: "eingereicht",
      version: existing.version + 1,
      updatedAt: new Date(),
    })
    .where(eq(expenseReports.id, id))
    .returning();

  await writeAudit({
    objectType: "reisekosten",
    objectId: id,
    action: "korrigiert_erneut_eingereicht",
    actorUserId: user.id,
    actorLabel: fullName(user),
    source: "web",
  });
  await notifyRequestSubmitted({
    type: "reisekosten",
    requestId: id,
    applicant: user,
    resubmitted: true,
    summary: `${data.destination} (${data.customerPurpose}), Gesamterstattung ${formatEuro(report.totalCents)} (Version ${report.version}).`,
  });
  await dispatchWebhookEvent(
    "reisekosten",
    "eingereicht",
    await buildWebhookPayload("reisekosten", report, user)
  );

  revalidatePath("/reisekosten");
  redirect(`/reisekosten/${id}`);
}

/** Eingereichte oder beanstandete Abrechnung zurückziehen. */
export async function withdrawExpenseReport(id: string) {
  const user = await requireUser();
  const existing = await db.query.expenseReports.findFirst({
    where: eq(expenseReports.id, id),
  });
  if (!existing || existing.userId !== user.id)
    throw new Error("Abrechnung nicht gefunden.");
  if (existing.status !== "eingereicht" && existing.status !== "beanstandet")
    throw new Error(
      "Nur eingereichte oder beanstandete Abrechnungen können zurückgezogen werden."
    );

  await db
    .update(expenseReports)
    .set({ status: "zurueckgezogen", updatedAt: new Date() })
    .where(eq(expenseReports.id, id));

  await writeAudit({
    objectType: "reisekosten",
    objectId: id,
    action: "zurueckgezogen",
    actorUserId: user.id,
    actorLabel: fullName(user),
    source: "web",
  });

  revalidatePath(`/reisekosten/${id}`);
  revalidatePath("/reisekosten");
}

/** Zurückgezogene Abrechnung endgültig löschen (inkl. Beleg-Dateien). */
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

  // Beleg-Dateien in Vercel Blob entfernen (DB-Zeilen fallen per Cascade)
  const reportReceipts = await db
    .select()
    .from(receipts)
    .where(eq(receipts.reportId, id));
  if (reportReceipts.length > 0)
    await del(reportReceipts.map((r) => r.blobUrl));

  // Audit vor dem Löschen schreiben (Audit-Log hat keinen Fremdschlüssel)
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
