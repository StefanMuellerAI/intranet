import { NextResponse } from "next/server";
import { writeAudit } from "@/lib/audit";
import { fullName, getCurrentUser } from "@/lib/auth";
import { toISODate } from "@/lib/dates";
import { buildEquipmentCsv } from "@/lib/it-equipment-csv";
import { getEquipmentExportRows } from "@/lib/it-equipment-store";

export const preferredRegion = "fra1";

/**
 * Export der gesamten Ausstattungsliste als CSV — Grundlage für die
 * Bearbeitung in Excel und gleichzeitig Vorlage für den Import. Nur für den
 * Admin; da die Liste personenbezogen ist, wird jeder Abruf auditiert.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin")
    return NextResponse.json({ fehler: "Nur für den Admin." }, { status: 403 });

  const rows = await getEquipmentExportRows();
  const csv = buildEquipmentCsv(rows);
  const filename = `IT-Ausstattung_${toISODate(new Date())}.csv`;

  await writeAudit({
    objectType: "it_ausstattung",
    action: "exportiert",
    actorUserId: user.id,
    actorLabel: fullName(user),
    source: "web",
    details: { geraete: rows.length },
  });

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, no-store",
    },
  });
}
