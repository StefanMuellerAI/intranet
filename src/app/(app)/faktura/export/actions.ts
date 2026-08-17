"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { generateTimesheet } from "@/lib/faktura/stundenzettel";
import { runAction, type ActionResult } from "@/lib/user-error";

export interface GenerateResult {
  timesheetId: string;
  docNumber: string;
  version: number;
  isDraft: boolean;
}

/** Stundenzettel (PDF) erzeugen und unveränderlich archivieren (FA-6.3 ff.). */
export async function generateTimesheetAction(
  formData: FormData
): Promise<ActionResult<GenerateResult>> {
  const admin = await requireAdmin();
  return runAction(async () => {
    const { timesheet, isDraft } = await generateTimesheet(
      admin,
      {
        customerId: String(formData.get("customerId") ?? ""),
        fromISO: String(formData.get("fromISO") ?? ""),
        toISO: String(formData.get("toISO") ?? ""),
      },
      "web"
    );
    revalidatePath("/faktura/export");
    return {
      timesheetId: timesheet.id,
      docNumber: timesheet.docNumber,
      version: timesheet.version,
      isDraft,
    };
  });
}
