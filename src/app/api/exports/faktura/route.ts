import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { buildFakturaCsv, getEntriesForExport } from "@/lib/faktura/export";
import {
  normalizeForFilename,
  periodFilenameLabel,
} from "@/lib/faktura/stundenzettel";
import { isValidISODate } from "@/lib/faktura/zeitfenster";

export const preferredRegion = "fra1";

/**
 * Rohdaten-Export (CSV) der Zeitbuchungen pro Kunde und Zeitraum — für
 * interne Zwecke, inkl. ausgeblendeter und gelöschter Positionen (FA-6.2).
 * Nur für den Admin.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin")
    return NextResponse.json({ fehler: "Nur für den Admin." }, { status: 403 });

  const url = new URL(req.url);
  const customerId = url.searchParams.get("kunde");
  const from = url.searchParams.get("von");
  const to = url.searchParams.get("bis");
  if (
    !customerId ||
    !from ||
    !to ||
    !isValidISODate(from) ||
    !isValidISODate(to) ||
    to < from
  )
    return NextResponse.json(
      {
        fehler:
          "Parameter 'kunde' (UUID), 'von' und 'bis' (YYYY-MM-DD) erforderlich.",
      },
      { status: 400 }
    );

  const rows = await getEntriesForExport(customerId, from, to);
  const csv = buildFakturaCsv(rows);
  const filename = `Faktura_${normalizeForFilename(rows[0]?.customerName ?? "Export")}_${periodFilenameLabel(from, to)}.csv`;
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
