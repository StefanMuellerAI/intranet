import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, fakturaTimesheets } from "@/db";
import { getCurrentUser } from "@/lib/auth";

export const preferredRegion = "fra1";

/**
 * Auslieferung archivierter Stundenzettel-PDFs über einen Admin-geschützten
 * Proxy (keine direkten Blob-URLs nach außen). Alle Versionen bleiben abrufbar.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin")
    return NextResponse.json({ fehler: "Nur für den Admin." }, { status: 403 });

  const { id } = await params;
  const timesheet = await db.query.fakturaTimesheets.findFirst({
    where: eq(fakturaTimesheets.id, id),
  });
  if (!timesheet)
    return NextResponse.json(
      { fehler: "Stundenzettel nicht gefunden." },
      { status: 404 }
    );

  const blobResponse = await fetch(timesheet.blobUrl);
  if (!blobResponse.ok)
    return NextResponse.json(
      { fehler: "PDF konnte nicht geladen werden." },
      { status: 502 }
    );

  return new NextResponse(blobResponse.body, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${timesheet.filename}"`,
      "x-dokumentnummer": timesheet.docNumber,
      "x-version": String(timesheet.version),
      "x-sha256": timesheet.sha256,
    },
  });
}
