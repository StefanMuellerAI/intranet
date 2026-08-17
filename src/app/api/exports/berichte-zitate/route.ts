import { NextResponse } from "next/server";
import { writeAudit } from "@/lib/audit";
import { fullName, getCurrentUser } from "@/lib/auth";
import { toISODate } from "@/lib/dates";
import { buildQuotesCsv } from "@/lib/seminar-reports-csv";
import { listApprovedQuotesForExport } from "@/lib/seminar-reports-store";

export const preferredRegion = "fra1";

/**
 * Export der für die Website freigegebenen Teilnehmenden-Zitate als CSV.
 * Die Datei enthält den Bericht-Kontext samt Mitarbeitendenname und ist
 * deshalb nur für den Admin abrufbar; jeder Abruf wird auditiert.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin")
    return NextResponse.json({ fehler: "Nur für den Admin." }, { status: 403 });

  const rows = await listApprovedQuotesForExport();
  const csv = buildQuotesCsv(rows);
  const filename = `Zitate_freigegeben_${toISODate(new Date())}.csv`;

  await writeAudit({
    objectType: "seminarbericht",
    action: "zitate_exportiert",
    actorUserId: user.id,
    actorLabel: fullName(user),
    source: "web",
    details: { zitate: rows.length },
  });

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, no-store",
    },
  });
}
