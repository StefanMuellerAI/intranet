import "server-only";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import {
  db,
  fakturaCustomers,
  fakturaProjects,
  fakturaTimeEntries,
  users,
  type FakturaTimeEntry,
} from "@/db";
import { fullName } from "@/lib/auth";
import { formatDateDE } from "@/lib/dates";
import {
  formatIsoWeek,
  formatMinutesAsHours,
  isoWeekOf,
} from "@/lib/faktura/zeitfenster";

export interface ExportRow {
  entry: FakturaTimeEntry;
  userName: string;
  customerName: string;
  projectName: string;
}

/**
 * Rohdaten eines Kunden für einen Zeitraum — für interne Zwecke inklusive
 * ausgeblendeter und (soft-)gelöschter Buchungen (FA-6.2).
 */
export async function getEntriesForExport(
  customerId: string,
  fromISO: string,
  toISO: string
): Promise<ExportRow[]> {
  const customer = await db.query.fakturaCustomers.findFirst({
    where: eq(fakturaCustomers.id, customerId),
  });
  if (!customer) throw new Error("Kunde nicht gefunden.");

  const projects = await db
    .select()
    .from(fakturaProjects)
    .where(eq(fakturaProjects.customerId, customerId));
  if (projects.length === 0) return [];

  const [entries, allUsers] = await Promise.all([
    db
      .select()
      .from(fakturaTimeEntries)
      .where(
        and(
          inArray(
            fakturaTimeEntries.projectId,
            projects.map((p) => p.id)
          ),
          gte(fakturaTimeEntries.entryDate, fromISO),
          lte(fakturaTimeEntries.entryDate, toISO)
        )
      )
      .orderBy(asc(fakturaTimeEntries.entryDate), asc(fakturaTimeEntries.createdAt)),
    db.select().from(users),
  ]);

  return entries.map((entry) => ({
    entry,
    userName: (() => {
      const u = allUsers.find((x) => x.id === entry.userId);
      return u ? fullName(u) : "Unbekannt";
    })(),
    customerName: customer.name,
    projectName:
      projects.find((p) => p.id === entry.projectId)?.name ?? "Unbekannt",
  }));
}

/**
 * CSV-Rohdaten-Export (Semikolon, BOM, deutsche Beschriftung): alle Buchungen
 * inkl. ausgeblendeter und gelöschter Positionen, klar gekennzeichnet.
 */
export function buildFakturaCsv(rows: ExportRow[]): string {
  const lines = [
    [
      "Datum",
      "Kalenderwoche",
      "Mitarbeiter/in",
      "Kunde",
      "Projekt",
      "Tätigkeit",
      "Dauer (h)",
      "Status",
      "Im Stundenzettel sichtbar",
      "Überbuchung",
      "Gelöscht",
      "Erstellt am",
      "Zuletzt geändert am",
      "Buchungs-ID",
    ].join(";"),
    ...rows.map(({ entry, userName, customerName, projectName }) =>
      [
        formatDateDE(entry.entryDate),
        formatIsoWeek(isoWeekOf(entry.entryDate)),
        userName,
        customerName,
        projectName,
        entry.description,
        formatMinutesAsHours(entry.durationMinutes),
        entry.status,
        entry.visibleOnTimesheet ? "ja" : "nein (ausgeblendet)",
        entry.overbooked ? "ja" : "nein",
        entry.deleted ? "ja (soft-delete)" : "nein",
        entry.createdAt.toISOString(),
        entry.updatedAt.toISOString(),
        entry.id,
      ]
        .map((v) => `"${String(v).replaceAll('"', '""')}"`)
        .join(";")
    ),
  ];
  return "\uFEFF" + lines.join("\r\n");
}
