import "server-only";
import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  fakturaCustomers,
  fakturaProjects,
  fakturaTimeEntries,
  users,
  type FakturaProject,
  type FakturaTimeEntry,
  type User,
} from "@/db";
import { writeAudit } from "@/lib/audit";
import { fullName } from "@/lib/auth";
import { formatDateDE } from "@/lib/dates";
import { notifyFakturaEntryChanged } from "@/lib/notifications";
import { checkMonthlyLimit } from "@/lib/faktura/limit";
import { UserError } from "@/lib/user-error";
import {
  customerProjectLabel,
  type FakturaSource,
} from "@/lib/faktura/stammdaten";
import { markTimesheetsStale } from "@/lib/faktura/stundenzettel";
import {
  MAX_DAY_MINUTES,
  WARN_DAY_MINUTES,
  berlinTodayISO,
  currentNow,
  formatMinutesAsHours,
  isValidISODate,
  isoWeekOf,
  isoWeekday,
  parseHoursToMinutes,
  validateBookingDate,
  validateDurationMinutes,
} from "@/lib/faktura/zeitfenster";

// ---------------------------------------------------------------------------
// Eingabe-Schema
// ---------------------------------------------------------------------------

export const timeEntryInputSchema = z.object({
  projectId: z.string().uuid("Bitte ein Projekt auswählen."),
  entryDate: z.string().min(1, "Bitte ein Buchungsdatum angeben."),
  /** Dauer in Stunden, z. B. "1,25" — Vielfache von 0,25 */
  durationHours: z.union([z.string(), z.number()]),
  description: z
    .string()
    .trim()
    .min(1, "Bitte eine Tätigkeitsbeschreibung angeben (Pflichtfeld)."),
  /** Zweite Stufe: Speichern trotz Warnung (Limit / >10 h) bestätigt */
  confirmWarnings: z.boolean().default(false),
});

export type TimeEntryInput = z.infer<typeof timeEntryInputSchema>;

/**
 * Ergebnis einer Speicheroperation: gespeichert, Warnungen, die die/der
 * Mitarbeitende vor dem Speichern bestätigen muss (FA-4.2), oder ein
 * fachlicher Fehler (von der Action aus UserError übersetzt — geworfene
 * Fehlermeldungen würde Next.js in Production maskieren).
 */
export type SaveEntryResult =
  | { ok: true; entryId: string }
  | { ok: false; warnings: string[] }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Gemeinsame Validierung
// ---------------------------------------------------------------------------

async function loadActiveProjectOrThrow(projectId: string): Promise<{
  project: FakturaProject;
  customerName: string;
}> {
  const project = await db.query.fakturaProjects.findFirst({
    where: eq(fakturaProjects.id, projectId),
  });
  if (!project) throw new UserError("Projekt nicht gefunden.");
  const customer = await db.query.fakturaCustomers.findFirst({
    where: eq(fakturaCustomers.id, project.customerId),
  });
  if (!customer) throw new UserError("Kunde nicht gefunden.");
  if (!project.active || !customer.active)
    throw new UserError(
      "Auf inaktive Kunden oder Projekte können keine neuen Buchungen erfasst werden."
    );
  return { project, customerName: customer.name };
}

/** Projektlaufzeit prüfen (Edge Case 5) — gilt auch für Admin-Korrekturen. */
function assertWithinProjectTerm(project: FakturaProject, entryDate: string) {
  if (
    (project.validFrom && entryDate < project.validFrom) ||
    (project.validTo && entryDate > project.validTo)
  ) {
    const from = project.validFrom ? formatDateDE(project.validFrom) : "offen";
    const to = project.validTo ? formatDateDE(project.validTo) : "offen";
    throw new UserError(
      `Das Buchungsdatum liegt außerhalb der Projektlaufzeit (${from} bis ${to}). Bitte ein Datum innerhalb der Laufzeit wählen oder den Admin kontaktieren.`
    );
  }
}

/** Buchungsdatum für Admin-Korrekturen: Werktag Mo–Fr, nie Zukunft — Fensterregel entfällt. */
function validateAdminEntryDate(entryDate: string) {
  if (!isValidISODate(entryDate)) throw new UserError("Ungültiges Buchungsdatum.");
  if (isoWeekday(entryDate) >= 6)
    throw new UserError(
      "Samstage und Sonntage sind keine gültigen Buchungstage (auch nicht für Admin-Korrekturen)."
    );
  if (entryDate > berlinTodayISO())
    throw new UserError("Buchungen in der Zukunft sind nicht möglich.");
}

/** Tagessumme der/des Mitarbeitenden über alle Projekte (ohne gelöschte). */
async function getDayTotalMinutes(
  userId: string,
  entryDate: string,
  excludeEntryId?: string
): Promise<number> {
  const conditions = [
    eq(fakturaTimeEntries.userId, userId),
    eq(fakturaTimeEntries.entryDate, entryDate),
    eq(fakturaTimeEntries.deleted, false),
  ];
  if (excludeEntryId)
    conditions.push(ne(fakturaTimeEntries.id, excludeEntryId));
  const [row] = await db
    .select({
      total: sql<number>`coalesce(sum(${fakturaTimeEntries.durationMinutes}), 0)`,
    })
    .from(fakturaTimeEntries)
    .where(and(...conditions));
  return Number(row?.total ?? 0);
}

interface ValidatedEntry {
  project: FakturaProject;
  customerName: string;
  durationMinutes: number;
  overbooked: boolean;
  warnings: string[];
}

async function validateEntry(opts: {
  ownerId: string;
  input: TimeEntryInput;
  isAdminAction: boolean;
  excludeEntryId?: string;
}): Promise<ValidatedEntry> {
  const { input } = opts;

  const durationMinutes = parseHoursToMinutes(input.durationHours);
  if (durationMinutes === null)
    throw new UserError(
      "Ungültige Dauer. Bitte im 0,25-Stunden-Raster angeben (z. B. 1,25)."
    );
  const durationError = validateDurationMinutes(durationMinutes);
  if (durationError) throw new UserError(durationError);

  if (opts.isAdminAction) {
    validateAdminEntryDate(input.entryDate);
  } else {
    const dateResult = validateBookingDate(input.entryDate, currentNow());
    if (!dateResult.ok) throw new UserError(dateResult.error);
  }

  const { project, customerName } = await loadActiveProjectOrThrow(
    input.projectId
  );
  assertWithinProjectTerm(project, input.entryDate);

  // Hartes Tagesmaximum 24 h über alle Projekte (FA-2.5)
  const dayTotal =
    (await getDayTotalMinutes(opts.ownerId, input.entryDate, opts.excludeEntryId)) +
    durationMinutes;
  if (dayTotal > MAX_DAY_MINUTES)
    throw new UserError(
      `Das harte Tagesmaximum von 24 Stunden würde überschritten (Summe wäre ${formatMinutesAsHours(dayTotal)} h).`
    );

  const warnings: string[] = [];
  if (dayTotal > WARN_DAY_MINUTES)
    warnings.push(
      `Hinweis: Mit dieser Buchung sind an diesem Tag ${formatMinutesAsHours(dayTotal)} Stunden über alle Projekte gebucht (mehr als 10 Stunden).`
    );

  // Limitprüfung beim Speichern (FA-4.1, Edge Case 8)
  const limitResult = await checkMonthlyLimit(
    project,
    input.entryDate,
    durationMinutes,
    opts.excludeEntryId
  );
  if (limitResult.warning) warnings.push(limitResult.warning);

  return {
    project,
    customerName,
    durationMinutes,
    overbooked: limitResult.overbooked,
    warnings,
  };
}

function entryAuditValues(entry: FakturaTimeEntry) {
  return {
    projectId: entry.projectId,
    entryDate: entry.entryDate,
    durationMinutes: entry.durationMinutes,
    description: entry.description,
    visibleOnTimesheet: entry.visibleOnTimesheet,
    overbooked: entry.overbooked,
    deleted: entry.deleted,
    status: entry.status,
  };
}

async function loadEntryOrThrow(id: string): Promise<FakturaTimeEntry> {
  const entry = await db.query.fakturaTimeEntries.findFirst({
    where: eq(fakturaTimeEntries.id, id),
  });
  if (!entry || entry.deleted) throw new UserError("Buchung nicht gefunden.");
  return entry;
}

/** SQL-Bedingung: Für die ISO-Woche des Datums existiert keine erteilte Freigabe. */
function weekNotApprovedSql(entryDate: string) {
  const week = isoWeekOf(entryDate);
  return sql`not exists (
    select 1 from faktura_week_approvals wa
    where wa.iso_year = ${week.isoYear}
      and wa.iso_week = ${week.isoWeek}
      and wa.status = 'freigegeben'
  )`;
}

// ---------------------------------------------------------------------------
// Mitarbeitende: eigene Buchungen
// ---------------------------------------------------------------------------

export async function createTimeEntry(
  user: User,
  raw: TimeEntryInput,
  source: FakturaSource = "web"
): Promise<SaveEntryResult> {
  const input = timeEntryInputSchema.parse(raw);
  const validated = await validateEntry({
    ownerId: user.id,
    input,
    isAdminAction: false,
  });

  if (validated.warnings.length > 0 && !input.confirmWarnings)
    return { ok: false, warnings: validated.warnings };

  // Race Condition Freigabe (Edge Case 9): Einfügen nur, solange die Woche
  // nicht freigegeben ist — Prüfung im selben Statement (konditionales INSERT).
  const week = isoWeekOf(input.entryDate);
  const result = await db.execute(sql`
    insert into faktura_time_entries
      (user_id, project_id, entry_date, duration_minutes, description,
       overbooked, created_by_id, updated_by_id)
    select ${user.id}::uuid, ${input.projectId}::uuid, ${input.entryDate}::date,
           ${validated.durationMinutes}::integer, ${input.description},
           ${validated.overbooked}::boolean, ${user.id}::uuid, ${user.id}::uuid
    where not exists (
      select 1 from faktura_week_approvals wa
      where wa.iso_year = ${week.isoYear}
        and wa.iso_week = ${week.isoWeek}
        and wa.status = 'freigegeben'
    )
    returning id
  `);
  const insertedId = (result.rows[0] as { id: string } | undefined)?.id;
  if (!insertedId)
    throw new UserError(
      "Diese Kalenderwoche wurde inzwischen freigegeben — die Buchung ist nicht mehr möglich."
    );
  const entry = await loadEntryOrThrow(insertedId);

  await writeAudit({
    objectType: "faktura_buchung",
    objectId: entry.id,
    action: "angelegt",
    actorUserId: user.id,
    actorLabel: fullName(user),
    source,
    details: {
      projekt: customerProjectLabel(validated.customerName, validated.project.name),
      neu: entryAuditValues(entry),
    },
  });
  await markTimesheetsStale(validated.project.customerId, input.entryDate);

  return { ok: true, entryId: entry.id };
}

function assertEmployeeMayEdit(entry: FakturaTimeEntry, user: User) {
  if (entry.userId !== user.id) throw new UserError("Buchung nicht gefunden.");
  if (entry.status === "freigegeben")
    throw new UserError(
      "Diese Woche wurde bereits freigegeben — die Buchung ist schreibgeschützt."
    );
  // Bearbeiten/Löschen nur, solange das Buchungsdatum im Fenster liegt (FA-2.4)
  const windowResult = validateBookingDate(entry.entryDate, currentNow());
  if (!windowResult.ok)
    throw new UserError(
      "Das Buchungsfenster für diese Woche ist geschlossen — die Buchung kann nicht mehr geändert werden."
    );
}

export async function updateTimeEntry(
  user: User,
  id: string,
  raw: TimeEntryInput,
  source: FakturaSource = "web"
): Promise<SaveEntryResult> {
  const entry = await loadEntryOrThrow(id);
  assertEmployeeMayEdit(entry, user);

  const input = timeEntryInputSchema.parse(raw);
  const validated = await validateEntry({
    ownerId: user.id,
    input,
    isAdminAction: false,
    excludeEntryId: id,
  });

  if (validated.warnings.length > 0 && !input.confirmWarnings)
    return { ok: false, warnings: validated.warnings };

  // Statusprüfung im selben Statement — kollidierende Änderungen während
  // einer laufenden Wochenfreigabe werden abgelehnt (FA-5.4, Edge Case 9).
  const updated = await db
    .update(fakturaTimeEntries)
    .set({
      projectId: input.projectId,
      entryDate: input.entryDate,
      durationMinutes: validated.durationMinutes,
      description: input.description,
      overbooked: validated.overbooked,
      updatedById: user.id,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(fakturaTimeEntries.id, id),
        eq(fakturaTimeEntries.userId, user.id),
        eq(fakturaTimeEntries.status, "offen"),
        eq(fakturaTimeEntries.deleted, false),
        weekNotApprovedSql(input.entryDate)
      )
    )
    .returning();
  if (!updated[0])
    throw new UserError(
      "Die Buchung wurde inzwischen freigegeben oder gelöscht und kann nicht mehr geändert werden."
    );

  await writeAudit({
    objectType: "faktura_buchung",
    objectId: id,
    action: "geaendert",
    actorUserId: user.id,
    actorLabel: fullName(user),
    source,
    details: {
      projekt: customerProjectLabel(validated.customerName, validated.project.name),
      alt: entryAuditValues(entry),
      neu: entryAuditValues(updated[0]),
    },
  });
  await markTimesheetsStale(validated.project.customerId, input.entryDate);
  if (entry.projectId !== input.projectId || entry.entryDate !== input.entryDate) {
    const oldCustomerId = (
      await db.query.fakturaProjects.findFirst({
        where: eq(fakturaProjects.id, entry.projectId),
      })
    )?.customerId;
    if (oldCustomerId) await markTimesheetsStale(oldCustomerId, entry.entryDate);
  }

  return { ok: true, entryId: id };
}

export async function softDeleteTimeEntry(
  user: User,
  id: string,
  source: FakturaSource = "web"
): Promise<void> {
  const entry = await loadEntryOrThrow(id);
  assertEmployeeMayEdit(entry, user);

  const deleted = await db
    .update(fakturaTimeEntries)
    .set({ deleted: true, updatedById: user.id, updatedAt: new Date() })
    .where(
      and(
        eq(fakturaTimeEntries.id, id),
        eq(fakturaTimeEntries.userId, user.id),
        eq(fakturaTimeEntries.status, "offen"),
        eq(fakturaTimeEntries.deleted, false),
        weekNotApprovedSql(entry.entryDate)
      )
    )
    .returning();
  if (!deleted[0])
    throw new UserError(
      "Die Buchung wurde inzwischen freigegeben und kann nicht mehr gelöscht werden."
    );

  await writeAudit({
    objectType: "faktura_buchung",
    objectId: id,
    action: "geloescht",
    actorUserId: user.id,
    actorLabel: fullName(user),
    source,
    details: { alt: entryAuditValues(entry) },
  });
  const customerId = (
    await db.query.fakturaProjects.findFirst({
      where: eq(fakturaProjects.id, entry.projectId),
    })
  )?.customerId;
  if (customerId) await markTimesheetsStale(customerId, entry.entryDate);
}

// ---------------------------------------------------------------------------
// Admin: Anpassungen, Neuanlage, Ausblenden, Löschen
// ---------------------------------------------------------------------------

async function notifyOwner(
  ownerId: string,
  action: string,
  projectLabel: string,
  entryDate: string,
  details: string[]
) {
  const owner = await db.query.users.findFirst({ where: eq(users.id, ownerId) });
  if (!owner) return;
  await notifyFakturaEntryChanged({
    employee: owner,
    action,
    projectLabel,
    entryDateLabel: formatDateDE(entryDate),
    details,
  });
}

export const adminEntryInputSchema = timeEntryInputSchema.extend({
  userId: z.string().uuid("Bitte eine/n Mitarbeiter/in auswählen."),
  /** Pflichtbegründung bei Korrekturen an freigegebenen Buchungen (FA-5.5) */
  reason: z.string().trim().optional(),
});

export type AdminEntryInput = z.infer<typeof adminEntryInputSchema>;

/** Admin legt eine Buchung für eine/n Mitarbeiter/in neu an (FA-5.3). */
export async function adminCreateTimeEntry(
  admin: User,
  raw: AdminEntryInput,
  source: FakturaSource = "web"
): Promise<string> {
  const input = adminEntryInputSchema.parse(raw);
  const owner = await db.query.users.findFirst({
    where: eq(users.id, input.userId),
  });
  if (!owner) throw new UserError("Mitarbeiter/in nicht gefunden.");

  const validated = await validateEntry({
    ownerId: input.userId,
    input,
    isAdminAction: true,
  });

  const week = isoWeekOf(input.entryDate);
  const approval = await db.query.fakturaWeekApprovals.findFirst({
    where: (t, { and: andOp, eq: eqOp }) =>
      andOp(eqOp(t.isoYear, week.isoYear), eqOp(t.isoWeek, week.isoWeek)),
  });
  const weekApproved = approval?.status === "freigegeben";
  if (weekApproved && !input.reason)
    throw new UserError(
      "Die Woche ist bereits freigegeben — bitte eine Begründung für die nachträgliche Korrektur angeben."
    );

  const [entry] = await db
    .insert(fakturaTimeEntries)
    .values({
      userId: input.userId,
      projectId: input.projectId,
      entryDate: input.entryDate,
      durationMinutes: validated.durationMinutes,
      description: input.description,
      overbooked: validated.overbooked,
      status: weekApproved ? "freigegeben" : "offen",
      createdById: admin.id,
      updatedById: admin.id,
    })
    .returning();

  const projectLabel = customerProjectLabel(
    validated.customerName,
    validated.project.name
  );
  await writeAudit({
    objectType: "faktura_buchung",
    objectId: entry.id,
    action: "admin_angelegt",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source,
    details: {
      projekt: projectLabel,
      mitarbeiter: fullName(owner),
      begruendung: input.reason || null,
      neu: entryAuditValues(entry),
    },
  });
  await markTimesheetsStale(validated.project.customerId, input.entryDate);
  await notifyOwner(input.userId, "neu angelegt", projectLabel, input.entryDate, [
    `Dauer: ${formatMinutesAsHours(validated.durationMinutes)} h · Tätigkeit: ${input.description}`,
    ...(input.reason ? [`Begründung: ${input.reason}`] : []),
  ]);
  return entry.id;
}

/**
 * Admin passt eine Buchung an (Dauer, Tätigkeitstext, Projekt, Datum).
 * Nachträgliche Korrekturen an freigegebenen Buchungen erfordern eine
 * Pflichtbegründung (FA-5.5).
 */
export async function adminUpdateTimeEntry(
  admin: User,
  id: string,
  raw: Omit<AdminEntryInput, "userId">,
  source: FakturaSource = "web"
): Promise<void> {
  const entry = await loadEntryOrThrow(id);
  const input = adminEntryInputSchema.parse({ ...raw, userId: entry.userId });

  if (entry.status === "freigegeben" && !input.reason)
    throw new UserError(
      "Diese Buchung ist bereits freigegeben — bitte eine Begründung für die Korrektur angeben."
    );

  const validated = await validateEntry({
    ownerId: entry.userId,
    input,
    isAdminAction: true,
    excludeEntryId: id,
  });

  const [updated] = await db
    .update(fakturaTimeEntries)
    .set({
      projectId: input.projectId,
      entryDate: input.entryDate,
      durationMinutes: validated.durationMinutes,
      description: input.description,
      overbooked: validated.overbooked,
      updatedById: admin.id,
      updatedAt: new Date(),
    })
    .where(eq(fakturaTimeEntries.id, id))
    .returning();

  const projectLabel = customerProjectLabel(
    validated.customerName,
    validated.project.name
  );
  await writeAudit({
    objectType: "faktura_buchung",
    objectId: id,
    action:
      entry.status === "freigegeben" ? "admin_korrigiert" : "admin_geaendert",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source,
    details: {
      projekt: projectLabel,
      begruendung: input.reason || null,
      alt: entryAuditValues(entry),
      neu: entryAuditValues(updated),
    },
  });
  await markTimesheetsStale(validated.project.customerId, input.entryDate);
  if (entry.projectId !== input.projectId || entry.entryDate !== input.entryDate) {
    const oldCustomerId = (
      await db.query.fakturaProjects.findFirst({
        where: eq(fakturaProjects.id, entry.projectId),
      })
    )?.customerId;
    if (oldCustomerId) await markTimesheetsStale(oldCustomerId, entry.entryDate);
  }
  await notifyOwner(entry.userId, "angepasst", projectLabel, input.entryDate, [
    `Vorher: ${formatDateDE(entry.entryDate)} · ${formatMinutesAsHours(entry.durationMinutes)} h · ${entry.description}`,
    `Nachher: ${formatDateDE(input.entryDate)} · ${formatMinutesAsHours(validated.durationMinutes)} h · ${input.description}`,
    ...(input.reason ? [`Begründung: ${input.reason}`] : []),
  ]);
}

/** Admin löscht eine Buchung (Soft-Delete); bei freigegebenen mit Pflichtbegründung. */
export async function adminSoftDeleteTimeEntry(
  admin: User,
  id: string,
  reason: string | undefined,
  source: FakturaSource = "web"
): Promise<void> {
  const entry = await loadEntryOrThrow(id);
  if (entry.status === "freigegeben" && !reason?.trim())
    throw new UserError(
      "Diese Buchung ist bereits freigegeben — bitte eine Begründung für die Löschung angeben."
    );

  await db
    .update(fakturaTimeEntries)
    .set({ deleted: true, updatedById: admin.id, updatedAt: new Date() })
    .where(eq(fakturaTimeEntries.id, id));

  const project = await db.query.fakturaProjects.findFirst({
    where: eq(fakturaProjects.id, entry.projectId),
  });
  const customer = project
    ? await db.query.fakturaCustomers.findFirst({
        where: eq(fakturaCustomers.id, project.customerId),
      })
    : null;
  const projectLabel = customerProjectLabel(
    customer?.name ?? "Unbekannt",
    project?.name ?? "Unbekannt"
  );

  await writeAudit({
    objectType: "faktura_buchung",
    objectId: id,
    action: "admin_geloescht",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source,
    details: {
      projekt: projectLabel,
      begruendung: reason?.trim() || null,
      alt: entryAuditValues(entry),
    },
  });
  if (project) await markTimesheetsStale(project.customerId, entry.entryDate);
  await notifyOwner(entry.userId, "gelöscht", projectLabel, entry.entryDate, [
    `Gelöschte Buchung: ${formatMinutesAsHours(entry.durationMinutes)} h · ${entry.description}`,
    ...(reason?.trim() ? [`Begründung: ${reason.trim()}`] : []),
  ]);
}

/**
 * Ausblenden/Einblenden für den Stundenzettel (FA-4.4/FA-4.5): betrifft
 * ausschließlich die Kundendarstellung — Datenbank, Audit-Log, interne
 * Exporte und Limitanrechnung bleiben unberührt (Entscheidung E-3).
 */
export async function adminSetEntryVisibility(
  admin: User,
  id: string,
  visible: boolean,
  source: FakturaSource = "web"
): Promise<void> {
  const entry = await loadEntryOrThrow(id);
  if (entry.visibleOnTimesheet === visible) return;

  await db
    .update(fakturaTimeEntries)
    .set({
      visibleOnTimesheet: visible,
      updatedById: admin.id,
      updatedAt: new Date(),
    })
    .where(eq(fakturaTimeEntries.id, id));

  const project = await db.query.fakturaProjects.findFirst({
    where: eq(fakturaProjects.id, entry.projectId),
  });
  const customer = project
    ? await db.query.fakturaCustomers.findFirst({
        where: eq(fakturaCustomers.id, project.customerId),
      })
    : null;
  const projectLabel = customerProjectLabel(
    customer?.name ?? "Unbekannt",
    project?.name ?? "Unbekannt"
  );

  await writeAudit({
    objectType: "faktura_buchung",
    objectId: id,
    action: visible ? "eingeblendet" : "ausgeblendet",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source,
    details: {
      projekt: projectLabel,
      alt: { visibleOnTimesheet: entry.visibleOnTimesheet },
      neu: { visibleOnTimesheet: visible },
    },
  });
  if (project) await markTimesheetsStale(project.customerId, entry.entryDate);
  await notifyOwner(
    entry.userId,
    visible ? "wieder eingeblendet" : "für den Stundenzettel ausgeblendet",
    projectLabel,
    entry.entryDate,
    [
      `Betroffene Buchung: ${formatMinutesAsHours(entry.durationMinutes)} h · ${entry.description}`,
      visible
        ? "Die Buchung erscheint wieder auf dem Stundenzettel."
        : "Die Buchung bleibt vollständig erhalten, erscheint aber nicht auf dem kundenseitigen Stundenzettel.",
    ]
  );
}
