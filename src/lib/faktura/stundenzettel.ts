import "server-only";
import { createHash } from "node:crypto";
import { put } from "@vercel/blob";
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import {
  db,
  fakturaCustomers,
  fakturaProjects,
  fakturaTimeEntries,
  fakturaTimesheets,
  users,
  type FakturaTimesheet,
  type User,
} from "@/db";
import { writeAudit } from "@/lib/audit";
import { fullName } from "@/lib/auth";
import { formatDateDE } from "@/lib/dates";
import { type FakturaSource } from "@/lib/faktura/stammdaten";
import { UserError } from "@/lib/faktura/user-error";
import {
  renderTimesheetPdf,
  type TimesheetPdfData,
} from "@/lib/faktura/stundenzettel-pdf";
import {
  berlinTodayISO,
  currentNow,
  isValidISODate,
} from "@/lib/faktura/zeitfenster";

// ---------------------------------------------------------------------------
// Veraltet-Markierung (FA-6.6)
// ---------------------------------------------------------------------------

/**
 * Markiert alle Stundenzettel eines Kunden als „veraltet", deren Zeitraum das
 * Buchungsdatum enthält (FA-6.6). Ein Neuexport erzeugt Version n+1; alle
 * bereits archivierten Versionen bleiben unverändert erhalten.
 */
export async function markTimesheetsStale(
  customerId: string,
  entryDateISO: string
): Promise<void> {
  await markTimesheetsStaleForRange(customerId, entryDateISO, entryDateISO);
}

/**
 * Veraltet-Markierung für einen Datumsbereich (z. B. Freigabe-Widerruf einer
 * ganzen Kalenderwoche): alle Stundenzettel, deren Zeitraum den Bereich berührt.
 */
export async function markTimesheetsStaleForRange(
  customerId: string,
  fromISO: string,
  toISO: string
): Promise<void> {
  await db
    .update(fakturaTimesheets)
    .set({ stale: true })
    .where(
      and(
        eq(fakturaTimesheets.customerId, customerId),
        eq(fakturaTimesheets.stale, false),
        lte(fakturaTimesheets.periodFrom, toISO),
        gte(fakturaTimesheets.periodTo, fromISO)
      )
    );
}

/** Kunden-ID zu einem Projekt — für die Veraltet-Markierung nach Mutationen. */
export async function customerIdOfProject(projectId: string): Promise<string> {
  const project = await db.query.fakturaProjects.findFirst({
    where: eq(fakturaProjects.id, projectId),
  });
  if (!project) throw new UserError("Projekt nicht gefunden.");
  return project.customerId;
}

// ---------------------------------------------------------------------------
// Dateinamen (FA-6.7, Edge Case 19)
// ---------------------------------------------------------------------------

/** Kundenname URL-/dateisicher normalisieren (Umlaute, Leerzeichen, Slashes). */
export function normalizeForFilename(name: string): string {
  return (
    name
      .replaceAll("ä", "ae")
      .replaceAll("ö", "oe")
      .replaceAll("ü", "ue")
      .replaceAll("Ä", "Ae")
      .replaceAll("Ö", "Oe")
      .replaceAll("Ü", "Ue")
      .replaceAll("ß", "ss")
      // Akzente entfernen (é → e), danach alles Unerlaubte zu "-"
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "") || "Kunde"
  );
}

/** Zeitraum-Label für Dateinamen: Kalendermonat kompakt, sonst von_bis. */
export function periodFilenameLabel(fromISO: string, toISO: string): string {
  const [y, m] = fromISO.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (
    fromISO.endsWith("-01") &&
    toISO === `${fromISO.slice(0, 7)}-${String(lastDay).padStart(2, "0")}`
  )
    return fromISO.slice(0, 7);
  return `${fromISO}_${toISO}`;
}

export function timesheetFilename(
  customerName: string,
  fromISO: string,
  toISO: string,
  version: number
): string {
  return `Stundenzettel_${normalizeForFilename(customerName)}_${periodFilenameLabel(fromISO, toISO)}_v${version}.pdf`;
}

// ---------------------------------------------------------------------------
// Erzeugung (FA-6.3 bis FA-6.7)
// ---------------------------------------------------------------------------

export interface GenerateTimesheetResult {
  timesheet: FakturaTimesheet;
  isDraft: boolean;
}

/**
 * Erzeugt einen Stundenzettel (PDF) für Kunde und Zeitraum:
 * - nur sichtbare Buchungen; enthält der Zeitraum nicht freigegebene
 *   Buchungen, entsteht ausschließlich ein Entwurf mit Wasserzeichen (FA-6.4)
 * - Dokumentnummer stabil je Kunde+Zeitraum, Neuexport = Version n+1 (FA-6.6)
 * - unveränderliche Archivierung in Vercel Blob inkl. SHA-256 (FA-7.3)
 */
export async function generateTimesheet(
  admin: User,
  opts: { customerId: string; fromISO: string; toISO: string },
  source: FakturaSource = "web"
): Promise<GenerateTimesheetResult> {
  const { customerId, fromISO, toISO } = opts;
  if (!isValidISODate(fromISO) || !isValidISODate(toISO) || toISO < fromISO)
    throw new UserError("Ungültiger Zeitraum.");

  const customer = await db.query.fakturaCustomers.findFirst({
    where: eq(fakturaCustomers.id, customerId),
  });
  if (!customer) throw new UserError("Kunde nicht gefunden.");

  const projects = await db
    .select()
    .from(fakturaProjects)
    .where(eq(fakturaProjects.customerId, customerId))
    .orderBy(asc(fakturaProjects.name));
  const projectIds = projects.map((p) => p.id);

  const entries =
    projectIds.length === 0
      ? []
      : await db
          .select()
          .from(fakturaTimeEntries)
          .where(
            and(
              inArray(fakturaTimeEntries.projectId, projectIds),
              eq(fakturaTimeEntries.deleted, false),
              eq(fakturaTimeEntries.visibleOnTimesheet, true),
              gte(fakturaTimeEntries.entryDate, fromISO),
              lte(fakturaTimeEntries.entryDate, toISO)
            )
          )
          .orderBy(asc(fakturaTimeEntries.entryDate));
  if (entries.length === 0)
    throw new UserError(
      "Für diesen Kunden und Zeitraum gibt es keine sichtbaren Buchungen."
    );

  // Entwurf, sobald der Zeitraum nicht freigegebene Buchungen enthält (FA-6.4)
  const isDraft = entries.some((e) => e.status !== "freigegeben");

  const allUsers = await db.select().from(users);
  const userName = (id: string) => {
    const u = allUsers.find((x) => x.id === id);
    return u ? fullName(u) : "Unbekannt";
  };

  const pdfProjects = projects
    .map((project) => {
      const rows = entries
        .filter((e) => e.projectId === project.id)
        .map((e) => ({
          dateLabel: formatDateDE(e.entryDate),
          userName: userName(e.userId),
          description: e.description,
          durationMinutes: e.durationMinutes,
        }));
      return {
        name: project.name,
        totalMinutes: rows.reduce((s, r) => s + r.durationMinutes, 0),
        rows,
      };
    })
    .filter((p) => p.rows.length > 0);

  // Dokumentnummer: stabil je Kunde+Zeitraum; sonst laufende Nummer je Jahr
  const existing = await db
    .select()
    .from(fakturaTimesheets)
    .where(
      and(
        eq(fakturaTimesheets.customerId, customerId),
        eq(fakturaTimesheets.periodFrom, fromISO),
        eq(fakturaTimesheets.periodTo, toISO)
      )
    )
    .orderBy(desc(fakturaTimesheets.version));
  let docNumber = existing[0]?.docNumber;
  const version = (existing[0]?.version ?? 0) + 1;
  if (!docNumber) docNumber = await nextDocNumber();

  const data: TimesheetPdfData = {
    customerName: customer.name,
    customerAddress: customer.address,
    contactPerson: customer.contactPerson,
    periodLabel: `${formatDateDE(fromISO)} bis ${formatDateDE(toISO)}`,
    docNumber,
    version,
    createdAtLabel: new Intl.DateTimeFormat("de-DE", {
      timeZone: "Europe/Berlin",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date()),
    isDraft,
    projects: pdfProjects,
    totalMinutes: pdfProjects.reduce((s, p) => s + p.totalMinutes, 0),
  };

  const pdf = await renderTimesheetPdf(data);
  const sha256 = createHash("sha256").update(pdf).digest("hex");
  const filename = timesheetFilename(customer.name, fromISO, toISO, version);
  const blobUrl = await storePdf(`stundenzettel/${docNumber}_v${version}.pdf`, pdf);

  const [timesheet] = await db
    .insert(fakturaTimesheets)
    .values({
      customerId,
      periodFrom: fromISO,
      periodTo: toISO,
      docNumber,
      version,
      isDraft,
      filename,
      blobUrl,
      sha256,
      createdById: admin.id,
    })
    .returning();

  await writeAudit({
    objectType: "faktura_stundenzettel",
    objectId: timesheet.id,
    action: "erzeugt",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source,
    details: {
      kunde: customer.name,
      zeitraum: `${fromISO} – ${toISO}`,
      dokumentnummer: docNumber,
      version,
      entwurf: isDraft,
      sha256,
      anzahlBuchungen: entries.length,
    },
  });

  return { timesheet, isDraft };
}

/**
 * Unveränderliche Archivierung in Vercel Blob — nie überschreiben (FA-7.3).
 * Ohne BLOB_READ_WRITE_TOKEN (lokale Entwicklung/Tests) wird das PDF als
 * data-URL persistiert, damit der Download-Proxy identisch funktioniert.
 *
 * SICHERHEIT — bewusste Ausnahme: Anders als Personaldokumente und Belege
 * werden Stundenzettel NICHT verschlüsselt abgelegt. Der Blob ist öffentlich;
 * der Schutz vor unbefugtem Zugriff hängt damit allein am nicht-erratbaren
 * Zufallssuffix (`addRandomSuffix: true`). Dieses Flag ist sicherheitskritisch
 * und darf nicht auf false gesetzt werden — sonst wären die Zettel über die
 * fortlaufenden Dokumentnummern (SZ-JJJJ-NNNN) enumerierbar. Eine spätere
 * Verschlüsselung analog zu document-crypto ist als Härtung vorgemerkt.
 */
async function storePdf(pathname: string, pdf: Buffer): Promise<string> {
  if (!process.env.BLOB_READ_WRITE_TOKEN)
    return `data:application/pdf;base64,${pdf.toString("base64")}`;
  const blob = await put(pathname, pdf, {
    access: "public",
    contentType: "application/pdf",
    addRandomSuffix: true, // sicherheitskritisch — siehe Kommentar oben
  });
  return blob.url;
}

/** Laufende Dokumentnummer je Jahr, z. B. SZ-2026-0007. */
async function nextDocNumber(): Promise<string> {
  const year = Number(berlinTodayISO(currentNow()).slice(0, 4));
  const prefix = `SZ-${year}-`;
  const rows = await db
    .select({ docNumber: fakturaTimesheets.docNumber })
    .from(fakturaTimesheets);
  const maxSeq = rows
    .map((r) => r.docNumber)
    .filter((n) => n.startsWith(prefix))
    .map((n) => Number(n.slice(prefix.length)))
    .filter((n) => Number.isFinite(n))
    .reduce((max, n) => Math.max(max, n), 0);
  return `${prefix}${String(maxSeq + 1).padStart(4, "0")}`;
}

// ---------------------------------------------------------------------------
// Abfragen für die Export-Seite
// ---------------------------------------------------------------------------

export interface TimesheetListItem extends FakturaTimesheet {
  customerName: string;
}

export async function listTimesheets(): Promise<TimesheetListItem[]> {
  const [timesheets, customers] = await Promise.all([
    db
      .select()
      .from(fakturaTimesheets)
      .orderBy(desc(fakturaTimesheets.createdAt)),
    db.select().from(fakturaCustomers),
  ]);
  return timesheets.map((t) => ({
    ...t,
    customerName:
      customers.find((c) => c.id === t.customerId)?.name ?? "Unbekannt",
  }));
}
