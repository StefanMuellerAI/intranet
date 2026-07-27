import { asc } from "drizzle-orm";
import { db, fakturaCustomers } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { formatDateDE } from "@/lib/dates";
import { listTimesheets } from "@/lib/faktura/stundenzettel";
import { berlinTodayISO, monthOf } from "@/lib/faktura/zeitfenster";
import {
  ExportForm,
  TimesheetList,
} from "@/components/faktura/export-admin";
import { FakturaNav } from "@/components/faktura/faktura-nav";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Faktura — Export & Stundenzettel" };

export default async function FakturaExportPage() {
  await requireAdmin();

  const [customers, timesheets] = await Promise.all([
    db.select().from(fakturaCustomers).orderBy(asc(fakturaCustomers.name)),
    listTimesheets(),
  ]);

  return (
    <div data-page-width="wide">
      <PageHeader
        title="Export & Stundenzettel"
        description="Rohdaten-Export (CSV) für interne Zwecke und unterschriftsfähige Stundenzettel (PDF) pro Kunde und Zeitraum — revisionssicher archiviert mit Dokumentnummer, Version und Prüfsumme."
      />
      <FakturaNav />
      <ExportForm
        customers={customers.map((c) => ({
          id: c.id,
          name: c.name,
          active: c.active,
        }))}
        defaultMonth={monthOf(berlinTodayISO())}
      />
      <TimesheetList
        timesheets={timesheets.map((t) => ({
          id: t.id,
          docNumber: t.docNumber,
          version: t.version,
          customerName: t.customerName,
          periodLabel: `${formatDateDE(t.periodFrom)} – ${formatDateDE(t.periodTo)}`,
          isDraft: t.isDraft,
          stale: t.stale,
          sha256Short: t.sha256.slice(0, 16) + "…",
          createdLabel: t.createdAt.toLocaleString("de-DE", {
            timeZone: "Europe/Berlin",
          }),
          filename: t.filename,
        }))}
      />
    </div>
  );
}
