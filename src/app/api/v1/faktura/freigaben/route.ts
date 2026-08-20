import { NextResponse } from "next/server";
import { authenticateApiRequest } from "@/lib/api-auth";
import { getWeekOverview, listRecentWeeks } from "@/lib/faktura/freigabe";
import { formatMinutesAsHours } from "@/lib/faktura/zeitfenster";

export const preferredRegion = "fra1";

/**
 * GET /api/v1/faktura/freigaben — Freigabeübersicht (FA-5.8).
 * Ohne Parameter: die letzten Kalenderwochen mit Status.
 * Mit ?jahr=YYYY&kw=N: vollständige Übersicht der Woche
 * (Kunde → Projekt → Buchungen inkl. Überbuchungs-Markierung).
 */
export async function GET(req: Request) {
  const auth = await authenticateApiRequest(req, {
    allowScopes: ["readonly", "full"],
  });
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const jahr = url.searchParams.get("jahr");
  const kw = url.searchParams.get("kw");

  if (!jahr && !kw) {
    const weeks = await listRecentWeeks(8);
    return NextResponse.json({
      wochen: weeks.map((w) => ({
        jahr: w.isoYear,
        kw: w.isoWeek,
        montag: w.mondayISO,
        freitag: w.fridayISO,
        abgeschlossen: w.closed,
        status: w.status,
        anzahlBuchungen: w.entryCount,
        summeStunden: formatMinutesAsHours(w.totalMinutes),
        ueberbuchungen: w.overbookedCount,
      })),
    });
  }

  const isoYear = Number(jahr);
  const isoWeek = Number(kw);
  if (
    !Number.isInteger(isoYear) ||
    !Number.isInteger(isoWeek) ||
    isoWeek < 1 ||
    isoWeek > 53
  )
    return NextResponse.json(
      { fehler: "Parameter 'jahr' und 'kw' müssen gültige Zahlen sein." },
      { status: 400 }
    );

  const overview = await getWeekOverview(isoYear, isoWeek);
  return NextResponse.json({
    jahr: overview.isoYear,
    kw: overview.isoWeek,
    montag: overview.mondayISO,
    freitag: overview.fridayISO,
    abgeschlossen: overview.closed,
    status: overview.empty
      ? "leer"
      : (overview.approval?.status ?? "offen"),
    summeStunden: formatMinutesAsHours(overview.totalMinutes),
    ueberbuchungen: overview.overbookedCount,
    kunden: overview.customers.map((c) => ({
      kunde: c.customerName,
      summeStunden: formatMinutesAsHours(c.totalMinutes),
      projekte: c.projects.map((p) => ({
        projekt: `${c.customerName} – ${p.projectName}`,
        summeStunden: formatMinutesAsHours(p.totalMinutes),
        monatslimitStunden:
          p.monthlyLimitMinutes != null
            ? formatMinutesAsHours(p.monthlyLimitMinutes)
            : null,
        buchungen: p.entries.map((e) => ({
          id: e.id,
          datum: e.entryDate,
          mitarbeiter: e.userName,
          taetigkeit: e.description,
          stunden: formatMinutesAsHours(e.durationMinutes),
          status: e.status,
          sichtbarImStundenzettel: e.visibleOnTimesheet,
          ueberbuchung: e.overbooked,
        })),
      })),
    })),
  });
}
