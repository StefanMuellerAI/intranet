import "server-only";
import { and, asc, count, desc, eq, gte, lte } from "drizzle-orm";
import {
  db,
  fakturaCustomers,
  seminarReportQuotes,
  seminarReports,
  users,
  type SeminarReport,
  type SeminarReportQuote,
  type User,
} from "@/db";
import { writeAudit } from "@/lib/audit";
import { fullName } from "@/lib/auth";
import type { QuoteExportRow } from "@/lib/seminar-reports-csv";
import {
  planQuoteChanges,
  quoteTextSchema,
  seminarReportInputSchema,
  type SeminarReportInput,
  type SeminarReportKind,
} from "@/lib/seminar-reports";
import { UserError } from "@/lib/user-error";

/**
 * Datenbankzugriffe der Seminar- und Beratungsberichte.
 *
 * Der Neon-HTTP-Treiber kennt keine interaktiven Transaktionen
 * (db.transaction wirft), batch() führt dagegen alle Anweisungen gemeinsam in
 * einer Transaktion aus — Bericht und Zitate werden deshalb immer als ein
 * Batch geschrieben und greifen ganz oder gar nicht.
 */
type BatchStatement = Parameters<typeof db.batch>[0][number];

async function runBatch(statements: BatchStatement[]): Promise<void> {
  if (statements.length === 0) return;
  await db.batch(statements as [BatchStatement, ...BatchStatement[]]);
}

// ---------------------------------------------------------------------------
// Ansichtsmodelle
// ---------------------------------------------------------------------------

export interface SeminarReportListRow {
  id: string;
  userId: string;
  userName: string;
  kind: SeminarReportKind;
  customerName: string;
  title: string;
  eventDate: string;
  durationDays: number;
  feedbackRating: number;
  quoteCount: number;
}

export interface SeminarReportWithQuotes {
  report: SeminarReport;
  quotes: SeminarReportQuote[];
}

export interface AdminQuoteRow {
  id: string;
  quote: string;
  websiteApproved: boolean;
  reportId: string;
  kind: SeminarReportKind;
  title: string;
  customerName: string;
  eventDate: string;
  userId: string;
  userName: string;
}

export const REPORT_SORT_ORDERS = [
  "datum_neu",
  "datum_alt",
  "mitarbeiter",
] as const;
export type ReportSortOrder = (typeof REPORT_SORT_ORDERS)[number];

export interface SeminarReportFilter {
  userId?: string;
  from?: string;
  to?: string;
  kind?: SeminarReportKind;
  sort?: ReportSortOrder;
}

// ---------------------------------------------------------------------------
// Lesen
// ---------------------------------------------------------------------------

async function quoteCountByReport(): Promise<Map<string, number>> {
  const rows = await db
    .select({ reportId: seminarReportQuotes.reportId, total: count() })
    .from(seminarReportQuotes)
    .groupBy(seminarReportQuotes.reportId);
  return new Map(rows.map((row) => [row.reportId, Number(row.total)]));
}

function sortRows(
  rows: SeminarReportListRow[],
  sort: ReportSortOrder
): SeminarReportListRow[] {
  // ISO-Datumsstrings lassen sich lexikografisch vergleichen.
  const byDateDesc = (a: SeminarReportListRow, b: SeminarReportListRow) =>
    b.eventDate.localeCompare(a.eventDate);

  const sorted = [...rows];
  if (sort === "datum_alt")
    sorted.sort((a, b) => a.eventDate.localeCompare(b.eventDate));
  else if (sort === "mitarbeiter")
    sorted.sort(
      (a, b) => a.userName.localeCompare(b.userName, "de") || byDateDesc(a, b)
    );
  else sorted.sort(byDateDesc);
  return sorted;
}

/** Berichte einer Person — für die eigene Übersicht. */
export async function listMySeminarReports(
  userId: string
): Promise<SeminarReportListRow[]> {
  return listSeminarReports({ userId });
}

/**
 * Gefilterte Berichte samt Mitarbeitendenname. Die Namen kommen aus einer
 * zweiten Abfrage und werden in JS zugeordnet — dieses Projekt nutzt bewusst
 * keine Drizzle-Relations.
 */
export async function listSeminarReports(
  filter: SeminarReportFilter = {}
): Promise<SeminarReportListRow[]> {
  const conditions = [
    filter.userId ? eq(seminarReports.userId, filter.userId) : undefined,
    filter.from ? gte(seminarReports.eventDate, filter.from) : undefined,
    filter.to ? lte(seminarReports.eventDate, filter.to) : undefined,
    filter.kind ? eq(seminarReports.kind, filter.kind) : undefined,
  ].filter((condition) => condition !== undefined);

  const [reports, allUsers, counts] = await Promise.all([
    conditions.length > 0
      ? db
          .select()
          .from(seminarReports)
          .where(and(...conditions))
      : db.select().from(seminarReports),
    db.select().from(users).orderBy(asc(users.lastName)),
    quoteCountByReport(),
  ]);

  const userById = new Map(allUsers.map((user) => [user.id, user]));
  const rows = reports.map((report) => {
    const user = userById.get(report.userId);
    return {
      id: report.id,
      userId: report.userId,
      userName: user ? fullName(user) : "Unbekannt",
      kind: report.kind,
      customerName: report.customerName,
      title: report.title,
      eventDate: report.eventDate,
      durationDays: report.durationDays,
      feedbackRating: report.feedbackRating,
      quoteCount: counts.get(report.id) ?? 0,
    };
  });

  return sortRows(rows, filter.sort ?? "datum_neu");
}

export async function getSeminarReportWithQuotes(
  id: string
): Promise<SeminarReportWithQuotes | null> {
  const report = await db.query.seminarReports.findFirst({
    where: eq(seminarReports.id, id),
  });
  if (!report) return null;

  const quotes = await db
    .select()
    .from(seminarReportQuotes)
    .where(eq(seminarReportQuotes.reportId, id))
    .orderBy(asc(seminarReportQuotes.position));

  return { report, quotes };
}

/**
 * Vorschläge für das Kundenfeld: bereits erfasste Kunden aus Berichten plus
 * die aktiven Faktura-Kunden. Freitext bleibt möglich — die Liste dient nur
 * einheitlichen Schreibweisen.
 */
export async function listCustomerSuggestions(): Promise<string[]> {
  const [fromReports, fromFaktura] = await Promise.all([
    db
      .selectDistinct({ name: seminarReports.customerName })
      .from(seminarReports),
    db
      .select({ name: fakturaCustomers.name })
      .from(fakturaCustomers)
      .where(eq(fakturaCustomers.active, true)),
  ]);

  const names = new Set<string>();
  for (const row of [...fromReports, ...fromFaktura]) {
    const name = row.name.trim();
    if (name) names.add(name);
  }
  return [...names].sort((a, b) => a.localeCompare(b, "de"));
}

/** Alle Zitate mit Bericht-Kontext — Grundlage der Admin-Zitatansicht. */
export async function listQuotesForAdmin(): Promise<AdminQuoteRow[]> {
  const [quotes, reports, allUsers] = await Promise.all([
    db
      .select()
      .from(seminarReportQuotes)
      .orderBy(asc(seminarReportQuotes.position)),
    db.select().from(seminarReports),
    db.select().from(users),
  ]);

  const reportById = new Map(reports.map((report) => [report.id, report]));
  const userById = new Map(allUsers.map((user) => [user.id, user]));

  return quotes
    .flatMap((quote) => {
      const report = reportById.get(quote.reportId);
      if (!report) return [];
      const user = userById.get(report.userId);
      return [
        {
          id: quote.id,
          quote: quote.quote,
          websiteApproved: quote.websiteApproved,
          reportId: report.id,
          kind: report.kind,
          customerName: report.customerName,
          title: report.title,
          eventDate: report.eventDate,
          userId: report.userId,
          userName: user ? fullName(user) : "Unbekannt",
        },
      ];
    })
    .sort(
      (a, b) =>
        b.eventDate.localeCompare(a.eventDate) ||
        a.title.localeCompare(b.title, "de")
    );
}

export async function listApprovedQuotesForExport(): Promise<QuoteExportRow[]> {
  const quotes = await listQuotesForAdmin();
  return quotes
    .filter((quote) => quote.websiteApproved)
    .map((quote) => ({
      quote: quote.quote,
      kind: quote.kind,
      title: quote.title,
      customerName: quote.customerName,
      eventDate: quote.eventDate,
      userName: quote.userName,
    }));
}

/** Zitat, wie es die Website-Schnittstelle ausliefert. */
export interface WebsiteQuoteRow {
  id: string;
  quote: string;
}

export const WEBSITE_QUOTES_MAX_LIMIT = 200;

/**
 * Für die Website freigegebene Zitate — die Datengrundlage von
 * `GET /api/v1/website/zitate`.
 *
 * Bewusst eine eigene Abfrage statt `listQuotesForAdmin()` mit
 * anschließendem Weglassen von Feldern: Hier wird die Tabelle `users` gar
 * nicht erst geladen, damit der Name der/des Vortragenden auch bei einem
 * späteren unachtsamen Refactor nicht nach außen gelangen kann. Auch Kunde,
 * Titel und Datum bleiben ungelesen — sortiert wird über sie, ausgeliefert
 * werden sie nicht (neueste Veranstaltung zuerst).
 */
export async function listApprovedQuotesForWebsite(opts?: {
  limit?: number;
}): Promise<WebsiteQuoteRow[]> {
  const limit = Math.min(
    Math.max(opts?.limit ?? WEBSITE_QUOTES_MAX_LIMIT, 1),
    WEBSITE_QUOTES_MAX_LIMIT
  );
  return db
    .select({
      id: seminarReportQuotes.id,
      quote: seminarReportQuotes.quote,
    })
    .from(seminarReportQuotes)
    .innerJoin(
      seminarReports,
      eq(seminarReportQuotes.reportId, seminarReports.id)
    )
    .where(eq(seminarReportQuotes.websiteApproved, true))
    .orderBy(
      desc(seminarReports.eventDate),
      asc(seminarReports.title),
      asc(seminarReportQuotes.position)
    )
    .limit(limit);
}

// ---------------------------------------------------------------------------
// Schreiben
// ---------------------------------------------------------------------------

function auditDetails(report: {
  title: string;
  customerName: string;
  eventDate: string;
}) {
  return {
    titel: report.title,
    kunde: report.customerName,
    datum: report.eventDate,
  };
}

/** Bericht der/des Angemeldeten laden; fremde Berichte gelten als nicht vorhanden. */
async function requireOwnReport(user: User, id: string): Promise<SeminarReport> {
  const report = await db.query.seminarReports.findFirst({
    where: eq(seminarReports.id, id),
  });
  if (!report || report.userId !== user.id)
    throw new UserError("Bericht nicht gefunden.");
  return report;
}

/**
 * Bericht zum Bearbeiten laden. Eigene Berichte darf jede/r ändern, fremde nur
 * der Admin: Er verantwortet die Zitate nach außen und muss sie nachträglich
 * in eine verwertbare Form bringen können. Für alle anderen bleibt ein fremder
 * Bericht "nicht gefunden".
 */
async function requireEditableReport(
  user: User,
  id: string
): Promise<SeminarReport> {
  const report = await db.query.seminarReports.findFirst({
    where: eq(seminarReports.id, id),
  });
  if (!report || (report.userId !== user.id && user.role !== "admin"))
    throw new UserError("Bericht nicht gefunden.");
  return report;
}

/** Legt den Bericht samt Zitaten an und liefert die Id des neuen Berichts. */
export async function createSeminarReport(
  user: User,
  raw: SeminarReportInput
): Promise<string> {
  const data = seminarReportInputSchema.parse(raw);

  // Id vorab erzeugen: innerhalb eines Batch steht das Ergebnis von
  // .returning() noch nicht zur Verfügung, die Zitate brauchen sie aber.
  const id = crypto.randomUUID();

  await runBatch([
    db.insert(seminarReports).values({
      id,
      userId: user.id,
      kind: data.kind,
      customerName: data.customerName,
      title: data.title,
      eventDate: data.eventDate,
      durationDays: data.durationDays,
      whatWentWell: data.whatWentWell,
      whatWentBadly: data.whatWentBadly,
      improvements: data.improvements,
      feedbackRating: data.feedbackRating,
    }),
    ...data.quotes.map((quote, position) =>
      db
        .insert(seminarReportQuotes)
        .values({ reportId: id, quote: quote.quote, position })
    ),
  ]);

  await writeAudit({
    objectType: "seminarbericht",
    objectId: id,
    action: "erstellt",
    actorUserId: user.id,
    actorLabel: fullName(user),
    source: "web",
    details: { ...auditDetails(data), zitate: data.quotes.length },
  });

  return id;
}

export async function updateSeminarReport(
  user: User,
  id: string,
  raw: SeminarReportInput
): Promise<void> {
  const existing = await requireEditableReport(user, id);
  const isAdminEdit = user.role === "admin";
  const data = seminarReportInputSchema.parse(raw);

  // Nur Zitate dieses Berichts kommen in den Abgleich — so kann eine
  // untergeschobene fremde Id kein fremdes Zitat überschreiben.
  const existingQuotes = await db
    .select()
    .from(seminarReportQuotes)
    .where(eq(seminarReportQuotes.reportId, id));

  // Korrigiert der Admin den Wortlaut, bleibt eine Freigabe bestehen — er ist
  // die freigebende Stelle. Bei allen anderen muss er den neuen Wortlaut
  // erneut freigeben.
  const plan = planQuoteChanges(existingQuotes, data.quotes, {
    keepApproval: isAdminEdit,
  });

  // Reihenfolge wie beim IT-Import: erst löschen, dann der Kopf, dann die
  // Zitate — alles gemeinsam in einer Transaktion.
  await runBatch([
    ...plan.remove.map((quoteId) =>
      db.delete(seminarReportQuotes).where(eq(seminarReportQuotes.id, quoteId))
    ),
    db
      .update(seminarReports)
      .set({
        kind: data.kind,
        customerName: data.customerName,
        title: data.title,
        eventDate: data.eventDate,
        durationDays: data.durationDays,
        whatWentWell: data.whatWentWell,
        whatWentBadly: data.whatWentBadly,
        improvements: data.improvements,
        feedbackRating: data.feedbackRating,
        updatedAt: new Date(),
      })
      .where(eq(seminarReports.id, id)),
    ...plan.update.map((entry) =>
      db
        .update(seminarReportQuotes)
        .set({
          quote: entry.quote,
          position: entry.position,
          ...(entry.resetApproval ? { websiteApproved: false } : {}),
        })
        .where(eq(seminarReportQuotes.id, entry.id))
    ),
    ...plan.insert.map((entry) =>
      db
        .insert(seminarReportQuotes)
        .values({ reportId: id, quote: entry.quote, position: entry.position })
    ),
  ]);

  await writeAudit({
    objectType: "seminarbericht",
    objectId: id,
    action: "aktualisiert",
    actorUserId: user.id,
    actorLabel: fullName(user),
    source: "web",
    details: {
      ...auditDetails(data),
      zitate: data.quotes.length,
      zitate_entfernt: plan.remove.length,
      zitate_freigabe_zurueckgesetzt: plan.update.filter((e) => e.resetApproval)
        .length,
      ...(existing.userId === user.id ? {} : { als_admin: true }),
    },
  });
}

/**
 * Korrigiert den Wortlaut eines einzelnen Zitats und liefert die Id des
 * zugehörigen Berichts (für die Cache-Invalidierung) — der schnelle Weg für den
 * Admin, ein Zitat aus der Zitatverwaltung heraus verwertbar zu machen
 * (z. B. eine vorangestellte Punktzahl zu entfernen), ohne den ganzen Bericht
 * zu öffnen. Die Website-Freigabe bleibt dabei bewusst bestehen: Sonst würde
 * ausgerechnet die Korrektur des Freigebenden das Zitat von der Website
 * nehmen.
 */
export async function updateQuoteText(
  admin: User,
  quoteId: string,
  raw: string
): Promise<string> {
  const quote = await db.query.seminarReportQuotes.findFirst({
    where: eq(seminarReportQuotes.id, quoteId),
  });
  if (!quote) throw new UserError("Zitat nicht gefunden.");

  const text = quoteTextSchema.parse(raw);
  if (text === quote.quote) return quote.reportId;

  await db
    .update(seminarReportQuotes)
    .set({ quote: text })
    .where(eq(seminarReportQuotes.id, quoteId));

  await writeAudit({
    objectType: "seminarbericht",
    objectId: quote.reportId,
    action: "zitat_bearbeitet",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
    details: { zitatId: quoteId, vorher: quote.quote, nachher: text },
  });

  return quote.reportId;
}

export async function deleteSeminarReport(
  user: User,
  id: string
): Promise<void> {
  const existing = await requireOwnReport(user, id);
  const quotes = await db
    .select()
    .from(seminarReportQuotes)
    .where(eq(seminarReportQuotes.reportId, id));

  // Audit vor dem Löschen, damit der Vorgang nachvollziehbar bleibt.
  await writeAudit({
    objectType: "seminarbericht",
    objectId: id,
    action: "geloescht",
    actorUserId: user.id,
    actorLabel: fullName(user),
    source: "web",
    details: {
      ...auditDetails(existing),
      zitate: quotes.length,
      zitate_website_freigegeben: quotes.filter((q) => q.websiteApproved).length,
    },
  });

  // Die Zitate laufen über onDelete: "cascade" mit.
  await db.delete(seminarReports).where(eq(seminarReports.id, id));
}

export async function setQuoteWebsiteApproved(
  admin: User,
  quoteId: string,
  approved: boolean
): Promise<void> {
  const quote = await db.query.seminarReportQuotes.findFirst({
    where: eq(seminarReportQuotes.id, quoteId),
  });
  if (!quote) throw new UserError("Zitat nicht gefunden.");

  await db
    .update(seminarReportQuotes)
    .set({ websiteApproved: approved })
    .where(eq(seminarReportQuotes.id, quoteId));

  await writeAudit({
    objectType: "seminarbericht",
    objectId: quote.reportId,
    action: approved
      ? "zitat_website_freigegeben"
      : "zitat_website_freigabe_zurueckgezogen",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
    details: { zitatId: quoteId },
  });
}
