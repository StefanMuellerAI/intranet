/**
 * Integrationstests der Faktura-Server-Actions: Zeiterfassung der
 * Mitarbeitenden, Wochenfreigabe und Admin-Korrekturen, Stundenzettel sowie
 * Kunden- und Projektstammdaten.
 *
 * „Jetzt" ist über FAKTURA_TEST_NOW fixiert: Freitag, 24.07.2026, 12:00 Uhr
 * Europe/Berlin → laufende Woche ist KW 30/2026 (Mo 20.07. – Fr 24.07.).
 * KW 29 (13.–17.07.) und älter sind abgeschlossen und damit freigebbar.
 *
 * Die Admin-Actions prüfen die Rolle vor runAction() — ein Aufruf durch
 * Mitarbeitende endet deshalb mit einer geworfenen Exception statt mit einem
 * Ergebnisobjekt.
 */
import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createEntryAction,
  deleteEntryAction,
  updateEntryAction,
} from "@/app/(app)/faktura/actions";
import { generateTimesheetAction } from "@/app/(app)/faktura/export/actions";
import {
  adminCreateEntryAction,
  adminDeleteEntryAction,
  adminUpdateEntryAction,
  approveWeekAction,
  getEntryHistoryAction,
  revokeWeekAction,
  setEntryVisibilityAction,
} from "@/app/(app)/faktura/freigabe/actions";
import {
  createCustomerAction,
  createProjectAction,
  toggleCustomerActiveAction,
  toggleProjectActiveAction,
  updateCustomerAction,
  updateProjectAction,
} from "@/app/(app)/faktura/kunden/actions";
import * as schema from "../../../src/db/schema";
import { actAs, auditFor, createUser, formData } from "../../helpers/actions";
import {
  resetDb,
  seedTestData,
  testDb,
  type SeedResult,
} from "../../helpers/db";
import {
  blobStore,
  mailbox,
  mailsTo,
  nextCacheModule,
} from "../../helpers/framework-fakes";

let seed: SeedResult;
let customer: schema.FakturaCustomer;
let project: schema.FakturaProject;

/** Freitag der laufenden KW 30/2026 */
const TODAY = "2026-07-24";
const KW30_MONDAY = "2026-07-20";
/** KW 29/2026 — abgeschlossen */
const KW29_MONDAY = "2026-07-13";
const KW29_FRIDAY = "2026-07-17";
const KW29_SATURDAY = "2026-07-18";
/** Montag der KW 31 — liegt in der Zukunft */
const FUTURE = "2026-07-27";
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

type SaveResult = Awaited<ReturnType<typeof createEntryAction>>;

function entryIdOf(result: SaveResult): string {
  if (!result.ok)
    throw new Error(`Speichern fehlgeschlagen: ${JSON.stringify(result)}`);
  return result.entryId;
}

/** Formular der Zeiterfassung (Standard: 1,5 h heute auf das Basisprojekt) */
function entryForm(values: Record<string, string> = {}) {
  return formData({
    projectId: project.id,
    entryDate: TODAY,
    durationHours: "1,5",
    description: "Konzeptarbeit",
    ...values,
  });
}

/** Formular der Admin-Korrektur (Standard: Buchung für Max in KW 29) */
function adminEntryForm(values: Record<string, string> = {}) {
  return formData({
    userId: seed.employee.id,
    projectId: project.id,
    entryDate: KW29_MONDAY,
    durationHours: "2",
    description: "Workshop-Vorbereitung",
    ...values,
  });
}

async function insertCustomer(
  name: string,
  values: Partial<typeof schema.fakturaCustomers.$inferInsert> = {}
) {
  const [row] = await testDb()
    .insert(schema.fakturaCustomers)
    .values({ name, ...values })
    .returning();
  return row;
}

async function insertProject(
  customerId: string,
  name: string,
  values: Partial<typeof schema.fakturaProjects.$inferInsert> = {}
) {
  const [row] = await testDb()
    .insert(schema.fakturaProjects)
    .values({ customerId, name, ...values })
    .returning();
  return row;
}

/** Bestandsbuchung direkt in der DB (Standard: 1 h von Max heute) */
async function insertEntry(
  values: Partial<typeof schema.fakturaTimeEntries.$inferInsert> = {}
) {
  const userId = values.userId ?? seed.employee.id;
  const [row] = await testDb()
    .insert(schema.fakturaTimeEntries)
    .values({
      userId,
      projectId: project.id,
      entryDate: TODAY,
      durationMinutes: 60,
      description: "Bestandsbuchung",
      createdById: userId,
      updatedById: userId,
      ...values,
    })
    .returning();
  return row;
}

async function loadEntry(id: string) {
  const row = await testDb().query.fakturaTimeEntries.findFirst({
    where: eq(schema.fakturaTimeEntries.id, id),
  });
  if (!row) throw new Error("Buchung fehlt");
  return row;
}

async function entriesOf(userId: string) {
  return testDb()
    .select()
    .from(schema.fakturaTimeEntries)
    .where(eq(schema.fakturaTimeEntries.userId, userId));
}

/** Freigabezeile setzen und alle Buchungen der Woche auf freigegeben stellen */
async function approveWeekInDb(
  isoYear: number,
  isoWeek: number,
  monday: string
) {
  const db = testDb();
  await db.insert(schema.fakturaWeekApprovals).values({
    isoYear,
    isoWeek,
    status: "freigegeben",
    approvedAt: new Date(),
    approvedById: seed.admin.id,
  });
  const entries = await db.select().from(schema.fakturaTimeEntries);
  const end = new Date(`${monday}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  const sunday = end.toISOString().slice(0, 10);
  for (const entry of entries)
    if (entry.entryDate >= monday && entry.entryDate <= sunday)
      await db
        .update(schema.fakturaTimeEntries)
        .set({ status: "freigegeben" })
        .where(eq(schema.fakturaTimeEntries.id, entry.id));
}

async function approvalOf(isoYear: number, isoWeek: number) {
  return testDb().query.fakturaWeekApprovals.findFirst({
    where: and(
      eq(schema.fakturaWeekApprovals.isoYear, isoYear),
      eq(schema.fakturaWeekApprovals.isoWeek, isoWeek)
    ),
  });
}

let timesheetSeq = 0;

/** Archivierten Stundenzettel direkt anlegen (für die veraltet-Markierung) */
async function insertTimesheet(customerId: string, from: string, to: string) {
  timesheetSeq += 1;
  const [row] = await testDb()
    .insert(schema.fakturaTimesheets)
    .values({
      customerId,
      periodFrom: from,
      periodTo: to,
      docNumber: `SZ-2020-${String(timesheetSeq).padStart(4, "0")}`,
      version: 1,
      filename: "Stundenzettel_Test.pdf",
      blobUrl: "data:application/pdf;base64,JVBERi0=",
      sha256: "0".repeat(64),
      createdById: seed.admin.id,
    })
    .returning();
  return row;
}

async function isStale(timesheetId: string) {
  const row = await testDb().query.fakturaTimesheets.findFirst({
    where: eq(schema.fakturaTimesheets.id, timesheetId),
  });
  return row?.stale;
}

function expectFakturaRevalidated() {
  for (const path of [
    "/faktura/freigabe",
    "/faktura",
    "/faktura/kunden",
    "/faktura/export",
  ])
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith(path);
}

beforeAll(async () => {
  await resetDb();
  seed = await seedTestData();
});

beforeEach(async () => {
  const db = testDb();
  await db.delete(schema.fakturaTimesheets);
  await db.delete(schema.fakturaTimeEntries);
  await db.delete(schema.fakturaWeekApprovals);
  await db.delete(schema.fakturaProjects);
  await db.delete(schema.fakturaCustomers);
  await db.delete(schema.auditLog);
  customer = await insertCustomer("ACME GmbH");
  project = await insertProject(customer.id, "Website-Relaunch");
});

// ---------------------------------------------------------------------------
// Zeiterfassung der Mitarbeitenden
// ---------------------------------------------------------------------------

describe("createEntryAction", () => {
  it("legt die Buchung an, auditiert und aktualisiert Faktura und Dashboard", async () => {
    await actAs(seed.employee);
    const result = await createEntryAction(entryForm());

    const id = entryIdOf(result);
    expect(await loadEntry(id)).toMatchObject({
      userId: seed.employee.id,
      projectId: project.id,
      entryDate: TODAY,
      durationMinutes: 90,
      description: "Konzeptarbeit",
      status: "offen",
      overbooked: false,
      deleted: false,
      visibleOnTimesheet: true,
      createdById: seed.employee.id,
    });
    const [audit] = await auditFor("faktura_buchung", id);
    expect(audit).toMatchObject({
      action: "angelegt",
      actorUserId: seed.employee.id,
      actorLabel: "Max Mitarbeiter",
      source: "web",
    });
    expect((audit.details as { projekt: string }).projekt).toBe(
      "ACME GmbH – Website-Relaunch"
    );
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/faktura");
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("markiert vorhandene Stundenzettel des Kunden mit diesem Datum als veraltet", async () => {
    const july = await insertTimesheet(customer.id, "2026-07-01", "2026-07-31");
    const june = await insertTimesheet(customer.id, "2026-06-01", "2026-06-30");
    await actAs(seed.employee);
    entryIdOf(await createEntryAction(entryForm()));
    expect(await isStale(july.id)).toBe(true);
    expect(await isStale(june.id)).toBe(false);
  });

  it("lässt auch den Admin eigene Zeiten buchen", async () => {
    await actAs(seed.admin);
    const id = entryIdOf(await createEntryAction(entryForm()));
    expect((await loadEntry(id)).userId).toBe(seed.admin.id);
  });

  it("verlangt bei mehr als 10 Stunden am Tag eine Bestätigung", async () => {
    await insertEntry({ durationMinutes: 9 * 60 });
    await actAs(seed.employee);

    const result = await createEntryAction(entryForm());
    expect(result).toEqual({
      ok: false,
      warnings: [
        "Hinweis: Mit dieser Buchung sind an diesem Tag 10,50 Stunden über alle Projekte gebucht (mehr als 10 Stunden).",
      ],
    });
    expect(await entriesOf(seed.employee.id)).toHaveLength(1);
    expect(nextCacheModule.revalidatePath).not.toHaveBeenCalled();

    const confirmed = await createEntryAction(
      entryForm({ confirmWarnings: "true" })
    );
    entryIdOf(confirmed);
    expect(await entriesOf(seed.employee.id)).toHaveLength(2);
  });

  it("warnt bei genau 10 Stunden noch nicht", async () => {
    await insertEntry({ durationMinutes: 510 });
    await actAs(seed.employee);
    entryIdOf(await createEntryAction(entryForm()));
  });

  it("zählt fremde und gelöschte Buchungen nicht zur Tagessumme", async () => {
    await insertEntry({ userId: seed.admin.id, durationMinutes: 9 * 60 });
    await insertEntry({ durationMinutes: 9 * 60, deleted: true });
    await actAs(seed.employee);
    entryIdOf(await createEntryAction(entryForm()));
  });

  it("lehnt mehr als 24 Stunden am Tag auch mit Bestätigung ab", async () => {
    await insertEntry({ durationMinutes: 23 * 60 });
    await actAs(seed.employee);

    const result = await createEntryAction(
      entryForm({ confirmWarnings: "true" })
    );
    expect(result).toEqual({
      ok: false,
      error:
        "Das harte Tagesmaximum von 24 Stunden würde überschritten (Summe wäre 24,50 h).",
    });
    expect(await entriesOf(seed.employee.id)).toHaveLength(1);
  });

  it("lehnt eine einzelne Buchung über 24 Stunden ab", async () => {
    await actAs(seed.employee);
    expect(
      await createEntryAction(entryForm({ durationHours: "24,25" }))
    ).toEqual({
      ok: false,
      error: "Die Dauer darf 24 Stunden nicht überschreiten.",
    });
  });

  it("prüft das 0,25-Stunden-Raster und eine positive Dauer", async () => {
    await actAs(seed.employee);
    expect(
      await createEntryAction(entryForm({ durationHours: "1,1" }))
    ).toEqual({
      ok: false,
      error: "Die Dauer muss im 0,25-Stunden-Raster (15 Minuten) liegen.",
    });
    expect(
      await createEntryAction(entryForm({ durationHours: "1,01" }))
    ).toEqual({
      ok: false,
      error:
        "Ungültige Dauer. Bitte im 0,25-Stunden-Raster angeben (z. B. 1,25).",
    });
    expect(
      await createEntryAction(entryForm({ durationHours: "abc" }))
    ).toEqual({
      ok: false,
      error:
        "Ungültige Dauer. Bitte im 0,25-Stunden-Raster angeben (z. B. 1,25).",
    });
    expect(await createEntryAction(entryForm({ durationHours: "0" }))).toEqual({
      ok: false,
      error: "Die Dauer muss größer als 0 sein.",
    });
    expect(await entriesOf(seed.employee.id)).toHaveLength(0);
  });

  it("meldet fehlende Pflichtfelder aus der Schema-Prüfung", async () => {
    await actAs(seed.employee);
    expect(await createEntryAction(entryForm({ projectId: "" }))).toEqual({
      ok: false,
      error: "Bitte ein Projekt auswählen.",
    });
    expect(await createEntryAction(entryForm({ description: "   " }))).toEqual({
      ok: false,
      error: "Bitte eine Tätigkeitsbeschreibung angeben (Pflichtfeld).",
    });
  });

  it("lehnt Daten außerhalb der Projektlaufzeit ab", async () => {
    const future = await insertProject(customer.id, "Phase 2", {
      validFrom: "2026-08-01",
    });
    const ended = await insertProject(customer.id, "Phase 0", {
      validTo: "2026-07-23",
    });
    await actAs(seed.employee);

    expect(
      await createEntryAction(entryForm({ projectId: future.id }))
    ).toEqual({
      ok: false,
      error:
        "Das Buchungsdatum liegt außerhalb der Projektlaufzeit (01.08.2026 bis offen). Bitte ein Datum innerhalb der Laufzeit wählen oder den Admin kontaktieren.",
    });
    const result = await createEntryAction(entryForm({ projectId: ended.id }));
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("(offen bis 23.07.2026)"),
    });
  });

  it("akzeptiert den letzten Tag der Projektlaufzeit", async () => {
    const ending = await insertProject(customer.id, "Endet heute", {
      validFrom: KW30_MONDAY,
      validTo: TODAY,
    });
    await actAs(seed.employee);
    entryIdOf(await createEntryAction(entryForm({ projectId: ending.id })));
  });

  it("lehnt Buchungen auf inaktive Projekte und inaktive Kunden ab", async () => {
    const inactiveProject = await insertProject(customer.id, "Altprojekt", {
      active: false,
    });
    const inactiveCustomer = await insertCustomer("Altkunde AG", {
      active: false,
    });
    const projectOfInactive = await insertProject(
      inactiveCustomer.id,
      "Wartung"
    );
    await actAs(seed.employee);

    const expected = {
      ok: false,
      error:
        "Auf inaktive Kunden oder Projekte können keine neuen Buchungen erfasst werden.",
    };
    expect(
      await createEntryAction(entryForm({ projectId: inactiveProject.id }))
    ).toEqual(expected);
    expect(
      await createEntryAction(entryForm({ projectId: projectOfInactive.id }))
    ).toEqual(expected);
  });

  it("meldet ein unbekanntes Projekt", async () => {
    await actAs(seed.employee);
    expect(
      await createEntryAction(entryForm({ projectId: UNKNOWN_ID }))
    ).toEqual({
      ok: false,
      error: "Projekt nicht gefunden.",
    });
  });

  it("lehnt Daten außerhalb des Buchungsfensters ab", async () => {
    await actAs(seed.employee);
    const errorFor = async (entryDate: string) => {
      const result = await createEntryAction(entryForm({ entryDate }));
      return "error" in result ? result.error : JSON.stringify(result);
    };

    expect(await errorFor(KW29_FRIDAY)).toContain(
      "außerhalb der laufenden Kalenderwoche"
    );
    expect(await errorFor(FUTURE)).toBe(
      "Buchungen in der Zukunft sind nicht möglich."
    );
    expect(await errorFor("2026-07-25")).toContain(
      "Samstage und Sonntage sind keine gültigen Buchungstage"
    );
    expect(await errorFor("2026-02-30")).toBe("Ungültiges Buchungsdatum.");
    expect(await entriesOf(seed.employee.id)).toHaveLength(0);
  });

  it("warnt beim Überschreiten des Monatslimits und speichert erst nach Bestätigung", async () => {
    const limited = await insertProject(customer.id, "Support-Kontingent", {
      monthlyLimitMinutes: 120,
    });
    // Das Limit gilt über alle Mitarbeitenden des Projekts
    await insertEntry({
      userId: seed.admin.id,
      projectId: limited.id,
      entryDate: KW30_MONDAY,
      durationMinutes: 90,
    });
    await actAs(seed.employee);

    const warned = await createEntryAction(
      entryForm({ projectId: limited.id, durationHours: "1" })
    );
    expect(warned).toEqual({
      ok: false,
      warnings: [
        "Monatslimit des Projekts überschritten: Mit dieser Buchung sind 2,50 von 2,00 Stunden im Monat gebucht.",
      ],
    });
    expect(await entriesOf(seed.employee.id)).toHaveLength(0);

    const id = entryIdOf(
      await createEntryAction(
        entryForm({
          projectId: limited.id,
          durationHours: "1",
          confirmWarnings: "true",
        })
      )
    );
    expect((await loadEntry(id)).overbooked).toBe(true);
  });

  it("sammelt Tages- und Limitwarnung in einer Rückfrage", async () => {
    const limited = await insertProject(customer.id, "Kontingent", {
      monthlyLimitMinutes: 60,
    });
    await insertEntry({ durationMinutes: 9 * 60 });
    await actAs(seed.employee);

    const result = await createEntryAction(
      entryForm({ projectId: limited.id })
    );
    expect(result).toMatchObject({ ok: false });
    expect("warnings" in result && result.warnings).toHaveLength(2);
  });

  it("lehnt Buchungen in einer inzwischen freigegebenen Woche ab", async () => {
    await testDb().insert(schema.fakturaWeekApprovals).values({
      isoYear: 2026,
      isoWeek: 30,
      status: "freigegeben",
      approvedAt: new Date(),
      approvedById: seed.admin.id,
    });
    await actAs(seed.employee);
    expect(await createEntryAction(entryForm())).toEqual({
      ok: false,
      error:
        "Diese Kalenderwoche wurde inzwischen freigegeben — die Buchung ist nicht mehr möglich.",
    });
    expect(await entriesOf(seed.employee.id)).toHaveLength(0);
  });

  it("verlangt eine Anmeldung", async () => {
    await actAs(null);
    await expect(createEntryAction(entryForm())).rejects.toThrow(
      "Nicht angemeldet"
    );
  });

  it("sperrt deaktivierte Konten", async () => {
    const inactive = await createUser({ status: "deaktiviert" });
    await actAs(inactive);
    await expect(createEntryAction(entryForm())).rejects.toThrow(
      "Nicht angemeldet"
    );
  });
});

describe("updateEntryAction", () => {
  it("ändert die eigene offene Buchung und auditiert alt/neu", async () => {
    const entry = await insertEntry();
    await actAs(seed.employee);

    const result = await updateEntryAction(
      entry.id,
      entryForm({ durationHours: "2,25", description: "Korrigierter Text" })
    );
    expect(result).toEqual({ ok: true, entryId: entry.id });

    expect(await loadEntry(entry.id)).toMatchObject({
      durationMinutes: 135,
      description: "Korrigierter Text",
      updatedById: seed.employee.id,
      status: "offen",
    });
    const [audit] = await auditFor("faktura_buchung", entry.id);
    expect(audit).toMatchObject({
      action: "geaendert",
      actorUserId: seed.employee.id,
    });
    const details = audit.details as {
      alt: { durationMinutes: number };
      neu: { durationMinutes: number; description: string };
    };
    expect(details.alt.durationMinutes).toBe(60);
    expect(details.neu).toMatchObject({
      durationMinutes: 135,
      description: "Korrigierter Text",
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/faktura");
  });

  it("zählt die bearbeitete Buchung nicht doppelt zur Tagessumme", async () => {
    // 8 h → 10 h: Tagessumme genau 10 h, also noch keine Warnung
    const entry = await insertEntry({ durationMinutes: 8 * 60 });
    await actAs(seed.employee);
    const result = await updateEntryAction(
      entry.id,
      entryForm({ durationHours: "10" })
    );
    expect(result).toEqual({ ok: true, entryId: entry.id });
  });

  it("warnt auch beim Bearbeiten und speichert erst nach Bestätigung", async () => {
    await insertEntry({ durationMinutes: 8 * 60 });
    const entry = await insertEntry({ durationMinutes: 60 });
    await actAs(seed.employee);

    const warned = await updateEntryAction(
      entry.id,
      entryForm({ durationHours: "3" })
    );
    expect(warned).toMatchObject({
      ok: false,
      warnings: [expect.stringContaining("11,00 Stunden")],
    });
    expect((await loadEntry(entry.id)).durationMinutes).toBe(60);
    expect(nextCacheModule.revalidatePath).not.toHaveBeenCalled();

    const confirmed = await updateEntryAction(
      entry.id,
      entryForm({ durationHours: "3", confirmWarnings: "true" })
    );
    expect(confirmed).toEqual({ ok: true, entryId: entry.id });
    expect((await loadEntry(entry.id)).durationMinutes).toBe(180);
  });

  it("markiert beim Limit-Überschreiten die bearbeitete Buchung als überbucht", async () => {
    const limited = await insertProject(customer.id, "Kontingent", {
      monthlyLimitMinutes: 120,
    });
    const entry = await insertEntry({
      projectId: limited.id,
      durationMinutes: 60,
    });
    await actAs(seed.employee);

    const result = await updateEntryAction(
      entry.id,
      entryForm({
        projectId: limited.id,
        durationHours: "2,5",
        confirmWarnings: "true",
      })
    );
    expect(result).toEqual({ ok: true, entryId: entry.id });
    expect((await loadEntry(entry.id)).overbooked).toBe(true);
  });

  it("lässt fremde Buchungen nicht ändern — auch nicht durch den Admin", async () => {
    const entry = await insertEntry();
    for (const user of [await createUser(), seed.admin]) {
      await actAs(user);
      expect(await updateEntryAction(entry.id, entryForm())).toEqual({
        ok: false,
        error: "Buchung nicht gefunden.",
      });
    }
    expect((await loadEntry(entry.id)).durationMinutes).toBe(60);
  });

  it("lässt gelöschte und unbekannte Buchungen nicht ändern", async () => {
    const deleted = await insertEntry({ deleted: true });
    await actAs(seed.employee);
    for (const id of [deleted.id, UNKNOWN_ID])
      expect(await updateEntryAction(id, entryForm())).toEqual({
        ok: false,
        error: "Buchung nicht gefunden.",
      });
  });

  it("schützt Buchungen einer freigegebenen Woche", async () => {
    const entry = await insertEntry({ status: "freigegeben" });
    await actAs(seed.employee);
    expect(await updateEntryAction(entry.id, entryForm())).toEqual({
      ok: false,
      error:
        "Diese Woche wurde bereits freigegeben — die Buchung ist schreibgeschützt.",
    });
  });

  it("lehnt Änderungen ab, wenn die Woche während der Bearbeitung freigegeben wurde", async () => {
    const entry = await insertEntry();
    await testDb().insert(schema.fakturaWeekApprovals).values({
      isoYear: 2026,
      isoWeek: 30,
      status: "freigegeben",
      approvedAt: new Date(),
      approvedById: seed.admin.id,
    });
    await actAs(seed.employee);
    expect(
      await updateEntryAction(entry.id, entryForm({ description: "Zu spät" }))
    ).toEqual({
      ok: false,
      error:
        "Die Buchung wurde inzwischen freigegeben oder gelöscht und kann nicht mehr geändert werden.",
    });
    expect((await loadEntry(entry.id)).description).toBe("Bestandsbuchung");
  });

  it("lässt Buchungen aus geschlossenen Wochen nicht mehr ändern", async () => {
    const entry = await insertEntry({ entryDate: KW29_FRIDAY });
    await actAs(seed.employee);
    expect(await updateEntryAction(entry.id, entryForm())).toEqual({
      ok: false,
      error:
        "Das Buchungsfenster für diese Woche ist geschlossen — die Buchung kann nicht mehr geändert werden.",
    });
  });

  it("prüft das neue Projekt wie beim Anlegen", async () => {
    const entry = await insertEntry();
    const inactive = await insertProject(customer.id, "Altprojekt", {
      active: false,
    });
    await actAs(seed.employee);
    expect(
      await updateEntryAction(entry.id, entryForm({ projectId: inactive.id }))
    ).toMatchObject({ ok: false, error: expect.stringContaining("inaktive") });
    expect((await loadEntry(entry.id)).projectId).toBe(project.id);
  });

  it("sperrt auch Textkorrekturen, sobald das Projekt inaktiv ist — Löschen bleibt möglich", async () => {
    // Offene Frage: „Inaktiv setzen blockiert nur neue Buchungen" (stammdaten.ts)
    const entry = await insertEntry();
    await testDb()
      .update(schema.fakturaProjects)
      .set({ active: false })
      .where(eq(schema.fakturaProjects.id, project.id));
    await actAs(seed.employee);

    expect(
      await updateEntryAction(
        entry.id,
        entryForm({ description: "Tippfehler" })
      )
    ).toMatchObject({ ok: false, error: expect.stringContaining("inaktive") });
    expect(await deleteEntryAction(entry.id)).toEqual({ ok: true, data: null });
  });

  it("markiert bei Projektwechsel die Stundenzettel des alten und neuen Kunden als veraltet", async () => {
    const other = await insertCustomer("Beta AG");
    const otherProject = await insertProject(other.id, "Schulung");
    const oldSheet = await insertTimesheet(customer.id, KW30_MONDAY, TODAY);
    const newSheet = await insertTimesheet(other.id, KW30_MONDAY, TODAY);
    const unrelated = await insertTimesheet(
      customer.id,
      "2026-06-01",
      "2026-06-30"
    );
    const entry = await insertEntry();
    await actAs(seed.employee);

    const result = await updateEntryAction(
      entry.id,
      entryForm({ projectId: otherProject.id })
    );
    expect(result).toEqual({ ok: true, entryId: entry.id });
    expect(await isStale(oldSheet.id)).toBe(true);
    expect(await isStale(newSheet.id)).toBe(true);
    expect(await isStale(unrelated.id)).toBe(false);
    const details = (await auditFor("faktura_buchung", entry.id))[0]
      .details as {
      projekt: string;
    };
    expect(details.projekt).toBe("Beta AG – Schulung");
  });

  it("markiert bei Datumswechsel den Stundenzettel des alten Datums als veraltet", async () => {
    const mondaySheet = await insertTimesheet(
      customer.id,
      KW30_MONDAY,
      KW30_MONDAY
    );
    const fridaySheet = await insertTimesheet(customer.id, TODAY, TODAY);
    const entry = await insertEntry({ entryDate: KW30_MONDAY });
    await actAs(seed.employee);

    await updateEntryAction(entry.id, entryForm({ entryDate: TODAY }));
    expect(await isStale(mondaySheet.id)).toBe(true);
    expect(await isStale(fridaySheet.id)).toBe(true);
  });

  it("lässt Stundenzettel anderer Kunden unberührt, wenn Projekt und Datum gleich bleiben", async () => {
    const other = await insertCustomer("Beta AG");
    const otherSheet = await insertTimesheet(other.id, KW30_MONDAY, TODAY);
    const entry = await insertEntry();
    await actAs(seed.employee);
    await updateEntryAction(entry.id, entryForm({ description: "Nur Text" }));
    expect(await isStale(otherSheet.id)).toBe(false);
  });

  it("verlangt eine Anmeldung", async () => {
    const entry = await insertEntry();
    await actAs(null);
    await expect(updateEntryAction(entry.id, entryForm())).rejects.toThrow(
      "Nicht angemeldet"
    );
  });
});

describe("deleteEntryAction", () => {
  it("löscht die eigene offene Buchung weich und auditiert", async () => {
    const sheet = await insertTimesheet(customer.id, KW30_MONDAY, TODAY);
    const entry = await insertEntry();
    await actAs(seed.employee);

    expect(await deleteEntryAction(entry.id)).toEqual({ ok: true, data: null });

    expect(await loadEntry(entry.id)).toMatchObject({
      deleted: true,
      updatedById: seed.employee.id,
    });
    const [audit] = await auditFor("faktura_buchung", entry.id);
    expect(audit).toMatchObject({
      action: "geloescht",
      actorUserId: seed.employee.id,
    });
    expect((audit.details as { alt: { deleted: boolean } }).alt.deleted).toBe(
      false
    );
    expect(await isStale(sheet.id)).toBe(true);
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/faktura");
  });

  it("lässt fremde Buchungen nicht löschen", async () => {
    const entry = await insertEntry();
    await actAs(await createUser());
    expect(await deleteEntryAction(entry.id)).toEqual({
      ok: false,
      error: "Buchung nicht gefunden.",
    });
    expect((await loadEntry(entry.id)).deleted).toBe(false);
    expect(await auditFor("faktura_buchung", entry.id)).toHaveLength(0);
  });

  it("lässt freigegebene Buchungen nicht löschen", async () => {
    const entry = await insertEntry({ status: "freigegeben" });
    await actAs(seed.employee);
    expect(await deleteEntryAction(entry.id)).toEqual({
      ok: false,
      error:
        "Diese Woche wurde bereits freigegeben — die Buchung ist schreibgeschützt.",
    });
    expect((await loadEntry(entry.id)).deleted).toBe(false);
  });

  it("lehnt das Löschen ab, wenn die Woche inzwischen freigegeben wurde", async () => {
    const entry = await insertEntry();
    await testDb().insert(schema.fakturaWeekApprovals).values({
      isoYear: 2026,
      isoWeek: 30,
      status: "freigegeben",
      approvedAt: new Date(),
      approvedById: seed.admin.id,
    });
    await actAs(seed.employee);
    expect(await deleteEntryAction(entry.id)).toEqual({
      ok: false,
      error:
        "Die Buchung wurde inzwischen freigegeben und kann nicht mehr gelöscht werden.",
    });
    expect((await loadEntry(entry.id)).deleted).toBe(false);
  });

  it("lässt bereits gelöschte Buchungen nicht erneut löschen", async () => {
    const entry = await insertEntry({ deleted: true });
    await actAs(seed.employee);
    expect(await deleteEntryAction(entry.id)).toEqual({
      ok: false,
      error: "Buchung nicht gefunden.",
    });
  });

  it("verlangt eine Anmeldung", async () => {
    const entry = await insertEntry();
    await actAs(null);
    await expect(deleteEntryAction(entry.id)).rejects.toThrow(
      "Nicht angemeldet"
    );
  });
});

// ---------------------------------------------------------------------------
// Stundenzettel
// ---------------------------------------------------------------------------

describe("generateTimesheetAction", () => {
  function periodForm(values: Record<string, string> = {}) {
    return formData({
      customerId: customer.id,
      fromISO: KW29_MONDAY,
      toISO: KW29_FRIDAY,
      ...values,
    });
  }

  it("erzeugt für eine freigegebene Woche einen finalen Stundenzettel", async () => {
    await insertEntry({ entryDate: KW29_MONDAY, status: "freigegeben" });
    await insertEntry({ entryDate: "2026-07-14", status: "freigegeben" });
    await actAs(seed.admin);

    const result = await generateTimesheetAction(periodForm());
    expect(result).toEqual({
      ok: true,
      data: {
        timesheetId: expect.any(String),
        docNumber: "SZ-2026-0001",
        version: 1,
        isDraft: false,
      },
    });
    if (!result.ok) return;

    const sheet = await testDb().query.fakturaTimesheets.findFirst({
      where: eq(schema.fakturaTimesheets.id, result.data.timesheetId),
    });
    expect(sheet).toMatchObject({
      customerId: customer.id,
      periodFrom: KW29_MONDAY,
      periodTo: KW29_FRIDAY,
      isDraft: false,
      stale: false,
      filename: "Stundenzettel_ACME-GmbH_2026-07-13_2026-07-17_v1.pdf",
      createdById: seed.admin.id,
    });
    // Ohne BLOB_READ_WRITE_TOKEN wird das PDF als data-URL archiviert
    expect(sheet?.blobUrl.startsWith("data:application/pdf;base64,")).toBe(
      true
    );

    const [audit] = await auditFor(
      "faktura_stundenzettel",
      result.data.timesheetId
    );
    expect(audit).toMatchObject({
      action: "erzeugt",
      actorUserId: seed.admin.id,
    });
    expect(audit.details).toMatchObject({
      dokumentnummer: "SZ-2026-0001",
      version: 1,
      entwurf: false,
      anzahlBuchungen: 2,
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith(
      "/faktura/export"
    );
  });

  it("erzeugt nur einen Entwurf, solange offene Buchungen im Zeitraum liegen", async () => {
    await insertEntry({ entryDate: KW29_MONDAY, status: "freigegeben" });
    await insertEntry({ entryDate: "2026-07-14" });
    await actAs(seed.admin);
    const result = await generateTimesheetAction(periodForm());
    expect(result).toMatchObject({ ok: true, data: { isDraft: true } });
  });

  it("lehnt Zeiträume ohne sichtbare Buchungen ab", async () => {
    await insertEntry({ entryDate: KW29_MONDAY, visibleOnTimesheet: false });
    await insertEntry({ entryDate: "2026-07-14", deleted: true });
    // Buchung eines anderen Kunden zählt nicht
    const other = await insertCustomer("Beta AG");
    await insertEntry({
      entryDate: KW29_MONDAY,
      projectId: (await insertProject(other.id, "Schulung")).id,
    });
    await actAs(seed.admin);

    expect(await generateTimesheetAction(periodForm())).toEqual({
      ok: false,
      error:
        "Für diesen Kunden und Zeitraum gibt es keine sichtbaren Buchungen.",
    });
    expect(await testDb().select().from(schema.fakturaTimesheets)).toHaveLength(
      0
    );
  });

  it("lehnt Kunden ohne Projekte mit derselben Meldung ab", async () => {
    const empty = await insertCustomer("Leer GmbH");
    await actAs(seed.admin);
    expect(
      await generateTimesheetAction(periodForm({ customerId: empty.id }))
    ).toEqual({
      ok: false,
      error:
        "Für diesen Kunden und Zeitraum gibt es keine sichtbaren Buchungen.",
    });
  });

  it("lehnt ungültige Zeiträume ab", async () => {
    await insertEntry({ entryDate: KW29_MONDAY });
    await actAs(seed.admin);
    for (const values of [
      { fromISO: KW29_FRIDAY, toISO: KW29_MONDAY },
      { fromISO: "2026-02-30", toISO: "2026-03-05" },
      { fromISO: "", toISO: KW29_FRIDAY },
    ])
      expect(await generateTimesheetAction(periodForm(values))).toEqual({
        ok: false,
        error: "Ungültiger Zeitraum.",
      });
  });

  it("meldet einen unbekannten Kunden", async () => {
    await actAs(seed.admin);
    expect(
      await generateTimesheetAction(periodForm({ customerId: UNKNOWN_ID }))
    ).toEqual({
      ok: false,
      error: "Kunde nicht gefunden.",
    });
  });

  it("vergibt laufende Nummern je Jahr und zählt die Version je Zeitraum hoch", async () => {
    await insertEntry({ entryDate: KW29_MONDAY, status: "freigegeben" });
    await insertEntry({ entryDate: "2026-07-06", status: "freigegeben" });
    // Nummern anderer Jahre zählen nicht mit, die höchste Nummer des Jahres schon
    await testDb()
      .insert(schema.fakturaTimesheets)
      .values([
        {
          customerId: customer.id,
          periodFrom: "2025-12-01",
          periodTo: "2025-12-31",
          docNumber: "SZ-2025-0042",
          filename: "alt.pdf",
          blobUrl: "data:application/pdf;base64,JVBERi0=",
          sha256: "0".repeat(64),
          createdById: seed.admin.id,
        },
        {
          customerId: customer.id,
          periodFrom: "2026-01-01",
          periodTo: "2026-01-31",
          docNumber: "SZ-2026-0007",
          filename: "januar.pdf",
          blobUrl: "data:application/pdf;base64,JVBERi0=",
          sha256: "0".repeat(64),
          createdById: seed.admin.id,
        },
      ]);
    await actAs(seed.admin);

    const first = await generateTimesheetAction(periodForm());
    const second = await generateTimesheetAction(periodForm());
    const otherPeriod = await generateTimesheetAction(
      periodForm({ fromISO: "2026-07-06", toISO: "2026-07-10" })
    );

    expect(first).toMatchObject({
      ok: true,
      data: { docNumber: "SZ-2026-0008", version: 1 },
    });
    expect(second).toMatchObject({
      ok: true,
      data: { docNumber: "SZ-2026-0008", version: 2 },
    });
    expect(otherPeriod).toMatchObject({
      ok: true,
      data: { docNumber: "SZ-2026-0009", version: 1 },
    });
    if (!second.ok) return;
    const v2 = await testDb().query.fakturaTimesheets.findFirst({
      where: eq(schema.fakturaTimesheets.id, second.data.timesheetId),
    });
    expect(v2?.filename).toBe(
      "Stundenzettel_ACME-GmbH_2026-07-13_2026-07-17_v2.pdf"
    );
  });

  it("legt das PDF mit Zufallssuffix im Blob-Speicher ab, wenn ein Token gesetzt ist", async () => {
    await insertEntry({ entryDate: KW29_MONDAY, status: "freigegeben" });
    await actAs(seed.admin);
    const previous = process.env.BLOB_READ_WRITE_TOKEN;
    process.env.BLOB_READ_WRITE_TOKEN = "test-token";
    try {
      const result = await generateTimesheetAction(periodForm());
      if (!result.ok) throw new Error(result.error);
      const sheet = await testDb().query.fakturaTimesheets.findFirst({
        where: eq(schema.fakturaTimesheets.id, result.data.timesheetId),
      });
      // Zufallssuffix ist sicherheitskritisch (keine erratbaren URLs)
      expect(sheet?.blobUrl).toMatch(
        /\/stundenzettel\/SZ-2026-0001_v1-[0-9a-f]{8}\.pdf$/
      );
      const stored = blobStore.get(sheet!.blobUrl);
      expect(stored?.contentType).toBe("application/pdf");
      expect(stored?.body.subarray(0, 5).toString()).toBe("%PDF-");
    } finally {
      if (previous === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
      else process.env.BLOB_READ_WRITE_TOKEN = previous;
    }
  });

  it("ist nur für den Admin zulässig", async () => {
    await insertEntry({ entryDate: KW29_MONDAY, status: "freigegeben" });
    await actAs(seed.employee);
    await expect(generateTimesheetAction(periodForm())).rejects.toThrow(
      "Nur für den Admin zulässig."
    );
    expect(await testDb().select().from(schema.fakturaTimesheets)).toHaveLength(
      0
    );
  });
});

// ---------------------------------------------------------------------------
// Wochenfreigabe
// ---------------------------------------------------------------------------

describe("approveWeekAction", () => {
  it("gibt eine abgeschlossene Woche frei, sperrt die Buchungen und auditiert", async () => {
    const a = await insertEntry({
      entryDate: KW29_MONDAY,
      durationMinutes: 60,
    });
    const b = await insertEntry({
      entryDate: KW29_FRIDAY,
      durationMinutes: 30,
    });
    const otherWeek = await insertEntry({ entryDate: TODAY });
    await actAs(seed.admin);

    expect(await approveWeekAction(2026, 29)).toEqual({ ok: true, data: null });

    expect(await approvalOf(2026, 29)).toMatchObject({
      status: "freigegeben",
      approvedById: seed.admin.id,
    });
    expect((await loadEntry(a.id)).status).toBe("freigegeben");
    expect((await loadEntry(b.id)).status).toBe("freigegeben");
    expect((await loadEntry(otherWeek.id)).status).toBe("offen");

    const [audit] = await auditFor("faktura_freigabe");
    expect(audit).toMatchObject({
      action: "woche_freigegeben",
      actorUserId: seed.admin.id,
      source: "web",
      details: {
        isoYear: 2026,
        isoWeek: 29,
        anzahlBuchungen: 2,
        summeMinuten: 90,
        erneuteFreigabe: false,
      },
    });
    expectFakturaRevalidated();
  });

  it("gibt eine widerrufene Woche erneut frei und vermerkt das im Audit", async () => {
    await insertEntry({ entryDate: KW29_MONDAY });
    await testDb().insert(schema.fakturaWeekApprovals).values({
      isoYear: 2026,
      isoWeek: 29,
      status: "widerrufen",
      revokeReason: "Nachtrag",
    });
    await actAs(seed.admin);

    expect(await approveWeekAction(2026, 29)).toEqual({ ok: true, data: null });
    expect((await approvalOf(2026, 29))?.status).toBe("freigegeben");
    expect((await auditFor("faktura_freigabe"))[0].details).toMatchObject({
      erneuteFreigabe: true,
    });
  });

  it("lehnt die laufende Woche ab", async () => {
    await insertEntry();
    await actAs(seed.admin);
    expect(await approveWeekAction(2026, 30)).toEqual({
      ok: false,
      error:
        "Nur abgeschlossene Wochen können freigegeben werden (ab Samstag 00:00 Uhr).",
    });
    expect(await approvalOf(2026, 30)).toBeUndefined();
  });

  it("lehnt leere Wochen ab — gelöschte Buchungen zählen nicht", async () => {
    await insertEntry({ entryDate: KW29_MONDAY, deleted: true });
    await actAs(seed.admin);
    expect(await approveWeekAction(2026, 29)).toEqual({
      ok: false,
      error:
        "Diese Woche enthält keine Buchungen — eine Freigabe ist nicht erforderlich (FA-5.7).",
    });
    expect(await approvalOf(2026, 29)).toBeUndefined();
  });

  it("lehnt eine doppelte Freigabe ab", async () => {
    await insertEntry({ entryDate: KW29_MONDAY });
    await approveWeekInDb(2026, 29, KW29_MONDAY);
    await actAs(seed.admin);
    expect(await approveWeekAction(2026, 29)).toEqual({
      ok: false,
      error: "Diese Woche ist bereits freigegeben.",
    });
  });

  it("ist nur für den Admin zulässig", async () => {
    await insertEntry({ entryDate: KW29_MONDAY });
    await actAs(seed.employee);
    await expect(approveWeekAction(2026, 29)).rejects.toThrow(
      "Nur für den Admin zulässig."
    );
    expect(await approvalOf(2026, 29)).toBeUndefined();
  });
});

describe("revokeWeekAction", () => {
  function revokeForm(reason: string, isoWeek = 29) {
    return formData({ isoYear: "2026", isoWeek: String(isoWeek), reason });
  }

  it("widerruft die Freigabe, öffnet die Buchungen und markiert Stundenzettel als veraltet", async () => {
    const other = await insertCustomer("Beta AG");
    const entry = await insertEntry({ entryDate: KW29_MONDAY });
    await approveWeekInDb(2026, 29, KW29_MONDAY);
    const julySheet = await insertTimesheet(
      customer.id,
      "2026-07-01",
      "2026-07-31"
    );
    const juneSheet = await insertTimesheet(
      customer.id,
      "2026-06-01",
      "2026-06-30"
    );
    const otherSheet = await insertTimesheet(
      other.id,
      "2026-07-01",
      "2026-07-31"
    );
    await actAs(seed.admin);

    expect(
      await revokeWeekAction(revokeForm("  Nachtrag einer Buchung  "))
    ).toEqual({
      ok: true,
      data: null,
    });

    expect(await approvalOf(2026, 29)).toMatchObject({
      status: "widerrufen",
      revokeReason: "Nachtrag einer Buchung",
    });
    expect((await loadEntry(entry.id)).status).toBe("offen");
    expect(await isStale(julySheet.id)).toBe(true);
    expect(await isStale(juneSheet.id)).toBe(false);
    expect(await isStale(otherSheet.id)).toBe(false);
    expect((await auditFor("faktura_freigabe"))[0]).toMatchObject({
      action: "freigabe_widerrufen",
      actorUserId: seed.admin.id,
      details: {
        isoYear: 2026,
        isoWeek: 29,
        begruendung: "Nachtrag einer Buchung",
      },
    });
    expectFakturaRevalidated();
  });

  it("verlangt eine Begründung", async () => {
    await insertEntry({ entryDate: KW29_MONDAY });
    await approveWeekInDb(2026, 29, KW29_MONDAY);
    await actAs(seed.admin);

    for (const reason of ["", "   "])
      expect(await revokeWeekAction(revokeForm(reason))).toEqual({
        ok: false,
        error: "Bitte eine Begründung für den Widerruf angeben.",
      });
    expect(
      await revokeWeekAction(formData({ isoYear: "2026", isoWeek: "29" }))
    ).toEqual({
      ok: false,
      error: "Bitte eine Begründung für den Widerruf angeben.",
    });
    expect((await approvalOf(2026, 29))?.status).toBe("freigegeben");
  });

  it("lehnt nicht freigegebene und bereits widerrufene Wochen ab", async () => {
    await testDb().insert(schema.fakturaWeekApprovals).values({
      isoYear: 2026,
      isoWeek: 28,
      status: "widerrufen",
      revokeReason: "Erster Widerruf",
    });
    await actAs(seed.admin);

    for (const week of [29, 28])
      expect(await revokeWeekAction(revokeForm("Begründung", week))).toEqual({
        ok: false,
        error: "Diese Woche ist nicht freigegeben.",
      });
    expect((await approvalOf(2026, 28))?.revokeReason).toBe("Erster Widerruf");
  });

  it("ist nur für den Admin zulässig", async () => {
    await insertEntry({ entryDate: KW29_MONDAY });
    await approveWeekInDb(2026, 29, KW29_MONDAY);
    await actAs(seed.employee);
    await expect(revokeWeekAction(revokeForm("Begründung"))).rejects.toThrow(
      "Nur für den Admin zulässig."
    );
    expect((await approvalOf(2026, 29))?.status).toBe("freigegeben");
  });
});

// ---------------------------------------------------------------------------
// Admin-Korrekturen
// ---------------------------------------------------------------------------

describe("adminCreateEntryAction", () => {
  it("legt eine Buchung für Mitarbeitende in einer abgeschlossenen Woche an und benachrichtigt", async () => {
    const sheet = await insertTimesheet(customer.id, KW29_MONDAY, KW29_FRIDAY);
    await actAs(seed.admin);

    expect(await adminCreateEntryAction(adminEntryForm())).toEqual({
      ok: true,
      data: null,
    });

    const [entry] = await entriesOf(seed.employee.id);
    expect(entry).toMatchObject({
      projectId: project.id,
      entryDate: KW29_MONDAY,
      durationMinutes: 120,
      description: "Workshop-Vorbereitung",
      status: "offen",
      createdById: seed.admin.id,
      updatedById: seed.admin.id,
    });
    const [audit] = await auditFor("faktura_buchung", entry.id);
    expect(audit).toMatchObject({
      action: "admin_angelegt",
      actorUserId: seed.admin.id,
      details: {
        projekt: "ACME GmbH – Website-Relaunch",
        mitarbeiter: "Max Mitarbeiter",
        begruendung: null,
      },
    });
    expect(await isStale(sheet.id)).toBe(true);

    const mails = mailsTo(seed.employee.email);
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({
      subject:
        "Zeitbuchung neu angelegt: ACME GmbH – Website-Relaunch (13.07.2026)",
      linkPath: "/faktura",
    });
    expect(mails[0].paragraphs).toContain(
      "Dauer: 2,00 h · Tätigkeit: Workshop-Vorbereitung"
    );
    expectFakturaRevalidated();
  });

  it("bestätigt Warnungen automatisch, markiert aber Überbuchungen", async () => {
    const limited = await insertProject(customer.id, "Kontingent", {
      monthlyLimitMinutes: 60,
    });
    await insertEntry({ entryDate: KW29_MONDAY, durationMinutes: 9 * 60 });
    await actAs(seed.admin);

    expect(
      await adminCreateEntryAction(adminEntryForm({ projectId: limited.id }))
    ).toEqual({ ok: true, data: null });
    const created = (await entriesOf(seed.employee.id)).find(
      (e) => e.projectId === limited.id
    );
    expect(created?.overbooked).toBe(true);
  });

  it("hält auch für den Admin das Tagesmaximum von 24 Stunden ein", async () => {
    await insertEntry({ entryDate: KW29_MONDAY, durationMinutes: 23 * 60 });
    await actAs(seed.admin);
    expect(await adminCreateEntryAction(adminEntryForm())).toMatchObject({
      ok: false,
      error: expect.stringContaining("harte Tagesmaximum von 24 Stunden"),
    });
  });

  it("lehnt Wochenenden und Daten in der Zukunft ab", async () => {
    await actAs(seed.admin);
    expect(
      await adminCreateEntryAction(adminEntryForm({ entryDate: KW29_SATURDAY }))
    ).toEqual({
      ok: false,
      error:
        "Samstage und Sonntage sind keine gültigen Buchungstage (auch nicht für Admin-Korrekturen).",
    });
    expect(
      await adminCreateEntryAction(adminEntryForm({ entryDate: FUTURE }))
    ).toEqual({
      ok: false,
      error: "Buchungen in der Zukunft sind nicht möglich.",
    });
    expect(
      await adminCreateEntryAction(adminEntryForm({ entryDate: "2026-13-01" }))
    ).toEqual({ ok: false, error: "Ungültiges Buchungsdatum." });
    expect(await entriesOf(seed.employee.id)).toHaveLength(0);
  });

  it("verlangt in einer freigegebenen Woche eine Begründung und übernimmt den Status", async () => {
    await insertEntry({ entryDate: KW29_FRIDAY });
    await approveWeekInDb(2026, 29, KW29_MONDAY);
    await actAs(seed.admin);

    expect(await adminCreateEntryAction(adminEntryForm())).toEqual({
      ok: false,
      error:
        "Die Woche ist bereits freigegeben — bitte eine Begründung für die nachträgliche Korrektur angeben.",
    });
    expect(await entriesOf(seed.employee.id)).toHaveLength(1);

    expect(
      await adminCreateEntryAction(
        adminEntryForm({ reason: "Vergessene Buchung" })
      )
    ).toEqual({ ok: true, data: null });
    const created = (await entriesOf(seed.employee.id)).find(
      (e) => e.entryDate === KW29_MONDAY
    );
    expect(created?.status).toBe("freigegeben");
    expect(
      (await auditFor("faktura_buchung", created!.id))[0].details
    ).toMatchObject({
      begruendung: "Vergessene Buchung",
    });
    expect(mailsTo(seed.employee.email)[0].paragraphs).toContain(
      "Begründung: Vergessene Buchung"
    );
  });

  it("meldet unbekannte oder fehlende Mitarbeitende", async () => {
    await actAs(seed.admin);
    expect(
      await adminCreateEntryAction(adminEntryForm({ userId: UNKNOWN_ID }))
    ).toEqual({
      ok: false,
      error: "Mitarbeiter/in nicht gefunden.",
    });
    expect(
      await adminCreateEntryAction(adminEntryForm({ userId: "" }))
    ).toEqual({
      ok: false,
      error: "Bitte eine/n Mitarbeiter/in auswählen.",
    });
    expect(mailbox).toHaveLength(0);
  });

  it("prüft Projektlaufzeit und aktive Stammdaten auch für den Admin", async () => {
    const ended = await insertProject(customer.id, "Phase 0", {
      validTo: "2026-07-10",
    });
    const inactive = await insertProject(customer.id, "Altprojekt", {
      active: false,
    });
    await actAs(seed.admin);
    expect(
      await adminCreateEntryAction(adminEntryForm({ projectId: ended.id }))
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("Projektlaufzeit"),
    });
    expect(
      await adminCreateEntryAction(adminEntryForm({ projectId: inactive.id }))
    ).toMatchObject({ ok: false, error: expect.stringContaining("inaktive") });
  });

  it("ist nur für den Admin zulässig", async () => {
    await actAs(seed.employee);
    await expect(adminCreateEntryAction(adminEntryForm())).rejects.toThrow(
      "Nur für den Admin zulässig."
    );
    expect(await entriesOf(seed.employee.id)).toHaveLength(0);
  });
});

describe("adminUpdateEntryAction", () => {
  it("verlangt eine Begründung, wenn eine offene Buchung in eine freigegebene Woche verschoben wird", async () => {
    const entry = await insertEntry({ entryDate: "2026-07-06" }); // KW 28, offen
    await insertEntry({ entryDate: KW29_FRIDAY });
    await approveWeekInDb(2026, 29, KW29_MONDAY);
    await actAs(seed.admin);
    expect(
      await adminUpdateEntryAction(entry.id, adminEntryForm({ entryDate: KW29_MONDAY }))
    ).toMatchObject({ ok: false, error: expect.stringContaining("Begründung") });
    expect(
      await adminUpdateEntryAction(
        entry.id,
        adminEntryForm({ entryDate: KW29_MONDAY, reason: "Falsche Woche" })
      )
    ).toEqual({ ok: true, data: null });
    expect((await loadEntry(entry.id)).status).toBe("freigegeben");
    expect((await auditFor("faktura_buchung", entry.id))[0].action).toBe(
      "admin_korrigiert"
    );
  });

  it("passt eine offene Buchung an (admin_geaendert) und benachrichtigt die/den Mitarbeitende/n", async () => {
    const entry = await insertEntry({
      entryDate: KW29_MONDAY,
      durationMinutes: 60,
    });
    await actAs(seed.admin);

    expect(
      await adminUpdateEntryAction(
        entry.id,
        adminEntryForm({ durationHours: "1,75", description: "Präzisiert" })
      )
    ).toEqual({ ok: true, data: null });

    expect(await loadEntry(entry.id)).toMatchObject({
      durationMinutes: 105,
      description: "Präzisiert",
      status: "offen",
      userId: seed.employee.id,
      updatedById: seed.admin.id,
    });
    const [audit] = await auditFor("faktura_buchung", entry.id);
    expect(audit).toMatchObject({
      action: "admin_geaendert",
      actorUserId: seed.admin.id,
      details: { begruendung: null },
    });
    const [mail] = mailsTo(seed.employee.email);
    expect(mail.subject).toBe(
      "Zeitbuchung angepasst: ACME GmbH – Website-Relaunch (13.07.2026)"
    );
    expect(mail.paragraphs).toEqual(
      expect.arrayContaining([
        "Vorher: 13.07.2026 · 1,00 h · Bestandsbuchung",
        "Nachher: 13.07.2026 · 1,75 h · Präzisiert",
      ])
    );
    expectFakturaRevalidated();
  });

  it("korrigiert freigegebene Buchungen nur mit Begründung (admin_korrigiert)", async () => {
    const entry = await insertEntry({ entryDate: KW29_MONDAY });
    await approveWeekInDb(2026, 29, KW29_MONDAY);
    await actAs(seed.admin);

    expect(await adminUpdateEntryAction(entry.id, adminEntryForm())).toEqual({
      ok: false,
      error:
        "Diese Buchung ist bereits freigegeben — bitte eine Begründung für die Korrektur angeben.",
    });
    expect((await loadEntry(entry.id)).durationMinutes).toBe(60);

    expect(
      await adminUpdateEntryAction(
        entry.id,
        adminEntryForm({ reason: "Kunde meldet Mehraufwand" })
      )
    ).toEqual({ ok: true, data: null });
    expect(await loadEntry(entry.id)).toMatchObject({
      durationMinutes: 120,
      status: "freigegeben",
    });
    expect((await auditFor("faktura_buchung", entry.id))[0]).toMatchObject({
      action: "admin_korrigiert",
      details: { begruendung: "Kunde meldet Mehraufwand" },
    });
  });

  it("markiert bei Projektwechsel auch den Stundenzettel des alten Kunden als veraltet", async () => {
    const other = await insertCustomer("Beta AG");
    const otherProject = await insertProject(other.id, "Schulung");
    const oldSheet = await insertTimesheet(
      customer.id,
      KW29_MONDAY,
      KW29_FRIDAY
    );
    const newSheet = await insertTimesheet(other.id, KW29_MONDAY, KW29_FRIDAY);
    const entry = await insertEntry({ entryDate: KW29_MONDAY });
    await actAs(seed.admin);

    await adminUpdateEntryAction(
      entry.id,
      adminEntryForm({ projectId: otherProject.id })
    );
    expect(await isStale(oldSheet.id)).toBe(true);
    expect(await isStale(newSheet.id)).toBe(true);
  });

  it("lehnt ungültige Daten ab", async () => {
    const entry = await insertEntry({ entryDate: KW29_MONDAY });
    await actAs(seed.admin);
    expect(
      await adminUpdateEntryAction(
        entry.id,
        adminEntryForm({ entryDate: KW29_SATURDAY })
      )
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("Samstage und Sonntage"),
    });
    expect(
      await adminUpdateEntryAction(
        entry.id,
        adminEntryForm({ description: "" })
      )
    ).toEqual({
      ok: false,
      error: "Bitte eine Tätigkeitsbeschreibung angeben (Pflichtfeld).",
    });
    expect(mailbox).toHaveLength(0);
  });

  it("meldet unbekannte und gelöschte Buchungen", async () => {
    const deleted = await insertEntry({
      entryDate: KW29_MONDAY,
      deleted: true,
    });
    await actAs(seed.admin);
    for (const id of [UNKNOWN_ID, deleted.id])
      expect(await adminUpdateEntryAction(id, adminEntryForm())).toEqual({
        ok: false,
        error: "Buchung nicht gefunden.",
      });
  });

  it("blockiert Korrekturen an Buchungen eines inzwischen inaktiven Projekts — Löschen bleibt möglich", async () => {
    // Offene Frage: setProjectActive() verspricht „blockiert nur neue
    // Buchungen", die Prüfung greift aber auch bei Korrekturen bestehender.
    const entry = await insertEntry({ entryDate: KW29_MONDAY });
    await testDb()
      .update(schema.fakturaProjects)
      .set({ active: false })
      .where(eq(schema.fakturaProjects.id, project.id));
    await actAs(seed.admin);

    expect(
      await adminUpdateEntryAction(
        entry.id,
        adminEntryForm({ description: "Nur Tippfehler korrigiert" })
      )
    ).toEqual({
      ok: false,
      error:
        "Auf inaktive Kunden oder Projekte können keine neuen Buchungen erfasst werden.",
    });
    expect(await adminDeleteEntryAction(entry.id, "")).toEqual({
      ok: true,
      data: null,
    });
  });

  it("ist nur für den Admin zulässig", async () => {
    const entry = await insertEntry();
    await actAs(seed.employee);
    await expect(
      adminUpdateEntryAction(entry.id, adminEntryForm())
    ).rejects.toThrow("Nur für den Admin zulässig.");
  });
});

describe("adminDeleteEntryAction", () => {
  it("löscht offene Buchungen auch ohne Begründung und benachrichtigt", async () => {
    const sheet = await insertTimesheet(customer.id, KW30_MONDAY, TODAY);
    const entry = await insertEntry();
    await actAs(seed.admin);

    expect(await adminDeleteEntryAction(entry.id, "")).toEqual({
      ok: true,
      data: null,
    });

    expect(await loadEntry(entry.id)).toMatchObject({
      deleted: true,
      updatedById: seed.admin.id,
    });
    expect((await auditFor("faktura_buchung", entry.id))[0]).toMatchObject({
      action: "admin_geloescht",
      details: { begruendung: null, projekt: "ACME GmbH – Website-Relaunch" },
    });
    expect(await isStale(sheet.id)).toBe(true);
    const [mail] = mailsTo(seed.employee.email);
    expect(mail.subject).toBe(
      "Zeitbuchung gelöscht: ACME GmbH – Website-Relaunch (24.07.2026)"
    );
    expect(mail.paragraphs).toContain(
      "Gelöschte Buchung: 1,00 h · Bestandsbuchung"
    );
    expectFakturaRevalidated();
  });

  it("verlangt bei freigegebenen Buchungen eine Begründung", async () => {
    const entry = await insertEntry({ entryDate: KW29_MONDAY });
    await approveWeekInDb(2026, 29, KW29_MONDAY);
    await actAs(seed.admin);

    for (const reason of ["", "   "])
      expect(await adminDeleteEntryAction(entry.id, reason)).toEqual({
        ok: false,
        error:
          "Diese Buchung ist bereits freigegeben — bitte eine Begründung für die Löschung angeben.",
      });
    expect((await loadEntry(entry.id)).deleted).toBe(false);

    expect(
      await adminDeleteEntryAction(entry.id, "  Doppelt erfasst ")
    ).toEqual({
      ok: true,
      data: null,
    });
    expect((await loadEntry(entry.id)).deleted).toBe(true);
    expect(
      (await auditFor("faktura_buchung", entry.id))[0].details
    ).toMatchObject({
      begruendung: "Doppelt erfasst",
    });
    expect(mailsTo(seed.employee.email)[0].paragraphs).toContain(
      "Begründung: Doppelt erfasst"
    );
  });

  it("meldet unbekannte und bereits gelöschte Buchungen", async () => {
    const deleted = await insertEntry({ deleted: true });
    await actAs(seed.admin);
    for (const id of [UNKNOWN_ID, deleted.id])
      expect(await adminDeleteEntryAction(id, "Grund")).toEqual({
        ok: false,
        error: "Buchung nicht gefunden.",
      });
  });

  it("ist nur für den Admin zulässig", async () => {
    const entry = await insertEntry();
    await actAs(seed.employee);
    await expect(adminDeleteEntryAction(entry.id, "Grund")).rejects.toThrow(
      "Nur für den Admin zulässig."
    );
    expect((await loadEntry(entry.id)).deleted).toBe(false);
  });
});

describe("setEntryVisibilityAction", () => {
  it("blendet eine Buchung aus und wieder ein", async () => {
    const sheet = await insertTimesheet(customer.id, KW30_MONDAY, TODAY);
    const entry = await insertEntry();
    await actAs(seed.admin);

    expect(await setEntryVisibilityAction(entry.id, false)).toEqual({
      ok: true,
      data: null,
    });
    expect((await loadEntry(entry.id)).visibleOnTimesheet).toBe(false);
    expect(await isStale(sheet.id)).toBe(true);
    expect((await auditFor("faktura_buchung", entry.id))[0]).toMatchObject({
      action: "ausgeblendet",
      details: {
        alt: { visibleOnTimesheet: true },
        neu: { visibleOnTimesheet: false },
      },
    });
    expect(mailsTo(seed.employee.email)[0].subject).toBe(
      "Zeitbuchung für den Stundenzettel ausgeblendet: ACME GmbH – Website-Relaunch (24.07.2026)"
    );
    expectFakturaRevalidated();

    expect(await setEntryVisibilityAction(entry.id, true)).toEqual({
      ok: true,
      data: null,
    });
    expect((await loadEntry(entry.id)).visibleOnTimesheet).toBe(true);
    expect((await auditFor("faktura_buchung", entry.id))[0].action).toBe(
      "eingeblendet"
    );
    expect(mailsTo(seed.employee.email)[1].subject).toContain(
      "wieder eingeblendet"
    );
  });

  it("lässt einen unveränderten Zustand ohne Audit und ohne Mail", async () => {
    const sheet = await insertTimesheet(customer.id, KW30_MONDAY, TODAY);
    const entry = await insertEntry();
    await actAs(seed.admin);

    expect(await setEntryVisibilityAction(entry.id, true)).toEqual({
      ok: true,
      data: null,
    });
    expect(await auditFor("faktura_buchung", entry.id)).toHaveLength(0);
    expect(mailbox).toHaveLength(0);
    expect(await isStale(sheet.id)).toBe(false);
  });

  it("meldet unbekannte Buchungen", async () => {
    await actAs(seed.admin);
    expect(await setEntryVisibilityAction(UNKNOWN_ID, false)).toEqual({
      ok: false,
      error: "Buchung nicht gefunden.",
    });
  });

  it("ist nur für den Admin zulässig", async () => {
    const entry = await insertEntry();
    await actAs(seed.employee);
    await expect(setEntryVisibilityAction(entry.id, false)).rejects.toThrow(
      "Nur für den Admin zulässig."
    );
    expect((await loadEntry(entry.id)).visibleOnTimesheet).toBe(true);
  });
});

describe("getEntryHistoryAction", () => {
  it("liefert die Historie einer Buchung, neueste zuerst", async () => {
    await actAs(seed.employee);
    const id = entryIdOf(await createEntryAction(entryForm()));
    const otherId = entryIdOf(
      await createEntryAction(entryForm({ description: "Andere Buchung" }))
    );
    await actAs(seed.admin);
    await adminUpdateEntryAction(
      id,
      formData({
        projectId: project.id,
        entryDate: TODAY,
        durationHours: "2",
        description: "Nachgeschärft",
      })
    );
    await setEntryVisibilityAction(id, false);

    const history = await getEntryHistoryAction(id);

    expect(history.map((h) => h.action)).toEqual([
      "ausgeblendet",
      "admin_geaendert",
      "angelegt",
    ]);
    expect(history.map((h) => h.actorLabel)).toEqual([
      "Erika Admin",
      "Erika Admin",
      "Max Mitarbeiter",
    ]);
    const times = history.map((h) => h.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
    expect(JSON.parse(history[1].details)).toMatchObject({
      alt: { durationMinutes: 90 },
      neu: { durationMinutes: 120, description: "Nachgeschärft" },
    });
    expect(history.some((h) => h.details.includes("Andere Buchung"))).toBe(
      false
    );
    expect(await getEntryHistoryAction(otherId)).toHaveLength(1);
  });

  it("liefert eine leere Historie für unbekannte Buchungen", async () => {
    await actAs(seed.admin);
    expect(await getEntryHistoryAction(UNKNOWN_ID)).toEqual([]);
  });

  it("ist nur für den Admin zulässig", async () => {
    const entry = await insertEntry();
    await actAs(seed.employee);
    await expect(getEntryHistoryAction(entry.id)).rejects.toThrow(
      "Nur für den Admin zulässig."
    );
  });
});

// ---------------------------------------------------------------------------
// Kunden und Projekte
// ---------------------------------------------------------------------------

async function loadCustomer(id: string) {
  return testDb().query.fakturaCustomers.findFirst({
    where: eq(schema.fakturaCustomers.id, id),
  });
}

async function loadProject(id: string) {
  return testDb().query.fakturaProjects.findFirst({
    where: eq(schema.fakturaProjects.id, id),
  });
}

async function customerByName(name: string) {
  return testDb().query.fakturaCustomers.findFirst({
    where: eq(schema.fakturaCustomers.name, name),
  });
}

async function projectByName(name: string) {
  return testDb().query.fakturaProjects.findFirst({
    where: eq(schema.fakturaProjects.name, name),
  });
}

describe("createCustomerAction", () => {
  it("legt einen Kunden an und auditiert", async () => {
    await actAs(seed.admin);
    expect(
      await createCustomerAction(
        formData({
          name: "  Beta AG ",
          address: "Hauptstraße 5, 50667 Köln",
          contactPerson: "",
        })
      )
    ).toEqual({ ok: true, data: null });

    const created = await customerByName("Beta AG");
    expect(created).toMatchObject({
      address: "Hauptstraße 5, 50667 Köln",
      contactPerson: null,
      active: true,
    });
    expect((await auditFor("faktura_kunde", created!.id))[0]).toMatchObject({
      action: "angelegt",
      actorUserId: seed.admin.id,
      details: {
        neu: { name: "Beta AG", address: "Hauptstraße 5, 50667 Köln" },
      },
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith(
      "/faktura/kunden"
    );
  });

  it("lehnt doppelte Kundennamen ab", async () => {
    await actAs(seed.admin);
    expect(
      await createCustomerAction(formData({ name: " ACME GmbH " }))
    ).toEqual({
      ok: false,
      error: 'Ein Kunde mit dem Namen „ACME GmbH" existiert bereits.',
    });
    expect(await testDb().select().from(schema.fakturaCustomers)).toHaveLength(
      1
    );
  });

  it("verlangt einen Namen", async () => {
    await actAs(seed.admin);
    expect(await createCustomerAction(formData({ name: "   " }))).toEqual({
      ok: false,
      error: "Bitte einen Kundennamen angeben.",
    });
  });

  it("ist nur für den Admin zulässig", async () => {
    await actAs(seed.employee);
    await expect(
      createCustomerAction(formData({ name: "Beta AG" }))
    ).rejects.toThrow("Nur für den Admin zulässig.");
    expect(await customerByName("Beta AG")).toBeUndefined();
  });
});

describe("updateCustomerAction", () => {
  it("ändert Name, Anschrift und Ansprechperson und auditiert alt/neu", async () => {
    await testDb()
      .update(schema.fakturaCustomers)
      .set({ address: "Alte Straße 1", contactPerson: "Frau Alt" })
      .where(eq(schema.fakturaCustomers.id, customer.id));
    await actAs(seed.admin);

    expect(
      await updateCustomerAction(
        formData({
          id: customer.id,
          name: "ACME Deutschland GmbH",
          address: "",
          contactPerson: "Herr Neu",
        })
      )
    ).toEqual({ ok: true, data: null });

    expect(await loadCustomer(customer.id)).toMatchObject({
      name: "ACME Deutschland GmbH",
      address: null,
      contactPerson: "Herr Neu",
    });
    expect((await auditFor("faktura_kunde", customer.id))[0]).toMatchObject({
      action: "geaendert",
      details: {
        alt: {
          name: "ACME GmbH",
          address: "Alte Straße 1",
          contactPerson: "Frau Alt",
        },
        neu: { name: "ACME Deutschland GmbH", contactPerson: "Herr Neu" },
      },
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith(
      "/faktura/kunden"
    );
  });

  it("erlaubt den eigenen Namen, aber keinen fremden", async () => {
    await insertCustomer("Beta AG");
    await actAs(seed.admin);

    expect(
      await updateCustomerAction(
        formData({ id: customer.id, name: "ACME GmbH" })
      )
    ).toEqual({ ok: true, data: null });
    expect(
      await updateCustomerAction(formData({ id: customer.id, name: "Beta AG" }))
    ).toEqual({
      ok: false,
      error: 'Ein Kunde mit dem Namen „Beta AG" existiert bereits.',
    });
    expect((await loadCustomer(customer.id))?.name).toBe("ACME GmbH");
  });

  it("meldet unbekannte Kunden", async () => {
    await actAs(seed.admin);
    expect(
      await updateCustomerAction(formData({ id: UNKNOWN_ID, name: "Neu" }))
    ).toEqual({ ok: false, error: "Kunde nicht gefunden." });
  });

  it("verlangt einen Namen", async () => {
    await actAs(seed.admin);
    expect(
      await updateCustomerAction(formData({ id: customer.id, name: "" }))
    ).toEqual({ ok: false, error: "Bitte einen Kundennamen angeben." });
  });

  it("ist nur für den Admin zulässig", async () => {
    await actAs(seed.employee);
    await expect(
      updateCustomerAction(formData({ id: customer.id, name: "Gekapert" }))
    ).rejects.toThrow("Nur für den Admin zulässig.");
    expect((await loadCustomer(customer.id))?.name).toBe("ACME GmbH");
  });
});

describe("toggleCustomerActiveAction", () => {
  it("inaktiviert einen Kunden — neue Buchungen sind gesperrt, Bestand bleibt", async () => {
    const existing = await insertEntry({ entryDate: KW30_MONDAY });
    await actAs(seed.admin);

    expect(await toggleCustomerActiveAction(customer.id, false)).toEqual({
      ok: true,
      data: null,
    });
    expect((await loadCustomer(customer.id))?.active).toBe(false);
    expect((await auditFor("faktura_kunde", customer.id))[0]).toMatchObject({
      action: "inaktiviert",
      details: {
        name: "ACME GmbH",
        alt: { active: true },
        neu: { active: false },
      },
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith(
      "/faktura/kunden"
    );

    await actAs(seed.employee);
    expect(await createEntryAction(entryForm())).toMatchObject({
      ok: false,
      error: expect.stringContaining("inaktive Kunden"),
    });
    expect((await loadEntry(existing.id)).deleted).toBe(false);
  });

  it("aktiviert einen Kunden wieder — Buchungen sind wieder möglich", async () => {
    await testDb()
      .update(schema.fakturaCustomers)
      .set({ active: false })
      .where(eq(schema.fakturaCustomers.id, customer.id));
    await actAs(seed.admin);

    expect(await toggleCustomerActiveAction(customer.id, true)).toEqual({
      ok: true,
      data: null,
    });
    expect((await auditFor("faktura_kunde", customer.id))[0].action).toBe(
      "aktiviert"
    );

    await actAs(seed.employee);
    entryIdOf(await createEntryAction(entryForm()));
  });

  it("meldet unbekannte Kunden", async () => {
    await actAs(seed.admin);
    expect(await toggleCustomerActiveAction(UNKNOWN_ID, false)).toEqual({
      ok: false,
      error: "Kunde nicht gefunden.",
    });
  });

  it("ist nur für den Admin zulässig", async () => {
    await actAs(seed.employee);
    await expect(
      toggleCustomerActiveAction(customer.id, false)
    ).rejects.toThrow("Nur für den Admin zulässig.");
    expect((await loadCustomer(customer.id))?.active).toBe(true);
  });
});

describe("createProjectAction", () => {
  function projectForm(values: Record<string, string> = {}) {
    return formData({
      customerId: customer.id,
      name: "Schulungsreihe",
      ...values,
    });
  }

  it("legt ein Projekt mit Laufzeit und Monatslimit (Komma) an", async () => {
    await actAs(seed.admin);
    expect(
      await createProjectAction(
        projectForm({
          validFrom: "2026-07-01",
          validTo: "2026-12-31",
          monthlyLimitHours: "12,25",
        })
      )
    ).toEqual({ ok: true, data: null });

    const created = await projectByName("Schulungsreihe");
    expect(created).toMatchObject({
      customerId: customer.id,
      validFrom: "2026-07-01",
      validTo: "2026-12-31",
      monthlyLimitMinutes: 735,
      active: true,
    });
    expect((await auditFor("faktura_projekt", created!.id))[0]).toMatchObject({
      action: "angelegt",
      details: { kunde: "ACME GmbH", neu: { name: "Schulungsreihe" } },
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith(
      "/faktura/kunden"
    );
  });

  it("legt ein Projekt ohne Laufzeit und Limit an", async () => {
    await actAs(seed.admin);
    await createProjectAction(
      projectForm({ validFrom: "", validTo: " ", monthlyLimitHours: "" })
    );
    expect(await projectByName("Schulungsreihe")).toMatchObject({
      validFrom: null,
      validTo: null,
      monthlyLimitMinutes: null,
    });
  });

  it("verlangt ein Monatslimit im 0,25-Stunden-Raster und größer als 0", async () => {
    await actAs(seed.admin);
    expect(
      await createProjectAction(projectForm({ monthlyLimitHours: "1,1" }))
    ).toEqual({
      ok: false,
      error: "Das Monatslimit muss ein Vielfaches von 0,25 Stunden sein.",
    });
    expect(
      await createProjectAction(projectForm({ monthlyLimitHours: "0" }))
    ).toEqual({
      ok: false,
      error: "Das Monatslimit muss größer als 0 sein.",
    });
    expect(
      await createProjectAction(projectForm({ monthlyLimitHours: "-2" }))
    ).toEqual({
      ok: false,
      error: "Das Monatslimit muss größer als 0 sein.",
    });
    expect(await projectByName("Schulungsreihe")).toBeUndefined();
  });

  it("prüft die Laufzeit", async () => {
    await actAs(seed.admin);
    expect(
      await createProjectAction(
        projectForm({ validFrom: "2026-08-01", validTo: "2026-07-31" })
      )
    ).toEqual({
      ok: false,
      error: "Das Laufzeitende darf nicht vor dem Laufzeitbeginn liegen.",
    });
    expect(
      await createProjectAction(projectForm({ validFrom: "2026-13-01" }))
    ).toEqual({
      ok: false,
      error: "Ungültiges Laufzeit-Startdatum.",
    });
    expect(
      await createProjectAction(projectForm({ validTo: "31.12.2026" }))
    ).toEqual({
      ok: false,
      error: "Ungültiges Laufzeit-Enddatum.",
    });
  });

  it("lehnt doppelte Projektnamen je Kunde ab, erlaubt sie aber bei anderen Kunden", async () => {
    const other = await insertCustomer("Beta AG");
    await actAs(seed.admin);

    expect(
      await createProjectAction(projectForm({ name: "Website-Relaunch" }))
    ).toEqual({
      ok: false,
      error:
        'Für diesen Kunden existiert bereits ein Projekt „Website-Relaunch".',
    });
    expect(
      await createProjectAction(
        projectForm({ customerId: other.id, name: "Website-Relaunch" })
      )
    ).toEqual({ ok: true, data: null });
  });

  it("meldet fehlende oder unbekannte Kunden und fehlende Namen", async () => {
    await actAs(seed.admin);
    expect(await createProjectAction(projectForm({ customerId: "" }))).toEqual({
      ok: false,
      error: "Bitte einen Kunden auswählen.",
    });
    expect(
      await createProjectAction(projectForm({ customerId: UNKNOWN_ID }))
    ).toEqual({
      ok: false,
      error: "Kunde nicht gefunden.",
    });
    expect(await createProjectAction(projectForm({ name: " " }))).toEqual({
      ok: false,
      error: "Bitte einen Projektnamen angeben.",
    });
  });

  it("ist nur für den Admin zulässig", async () => {
    await actAs(seed.employee);
    await expect(createProjectAction(projectForm())).rejects.toThrow(
      "Nur für den Admin zulässig."
    );
    expect(await projectByName("Schulungsreihe")).toBeUndefined();
  });
});

describe("updateProjectAction", () => {
  it("ändert Name, Laufzeit und Limit und lässt Bestandsbuchungen unangetastet", async () => {
    const existing = await insertEntry({ entryDate: KW29_MONDAY });
    await actAs(seed.admin);

    expect(
      await updateProjectAction(
        formData({
          id: project.id,
          name: "Relaunch 2.0",
          validFrom: "2026-07-20",
          validTo: "2026-09-30",
          monthlyLimitHours: "40,5",
        })
      )
    ).toEqual({ ok: true, data: null });

    expect(await loadProject(project.id)).toMatchObject({
      customerId: customer.id,
      name: "Relaunch 2.0",
      validFrom: "2026-07-20",
      validTo: "2026-09-30",
      monthlyLimitMinutes: 2430,
    });
    // Die Buchung vor dem neuen Laufzeitbeginn bleibt bestehen (FA-1.3)
    expect(await loadEntry(existing.id)).toMatchObject({
      projectId: project.id,
      deleted: false,
    });
    expect((await auditFor("faktura_projekt", project.id))[0]).toMatchObject({
      action: "geaendert",
      details: {
        alt: {
          name: "Website-Relaunch",
          validFrom: null,
          monthlyLimitMinutes: null,
        },
        neu: {
          name: "Relaunch 2.0",
          validFrom: "2026-07-20",
          monthlyLimitMinutes: 2430,
        },
      },
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith(
      "/faktura/kunden"
    );
  });

  it("entfernt Laufzeit und Limit, wenn die Felder geleert werden", async () => {
    const limited = await insertProject(customer.id, "Kontingent", {
      validFrom: "2026-01-01",
      validTo: "2026-12-31",
      monthlyLimitMinutes: 600,
    });
    await actAs(seed.admin);
    await updateProjectAction(
      formData({ id: limited.id, name: "Kontingent", monthlyLimitHours: "" })
    );
    expect(await loadProject(limited.id)).toMatchObject({
      validFrom: null,
      validTo: null,
      monthlyLimitMinutes: null,
    });
  });

  it("validiert wie beim Anlegen", async () => {
    await insertProject(customer.id, "Schulung");
    await actAs(seed.admin);

    expect(
      await updateProjectAction(
        formData({
          id: project.id,
          name: "Website-Relaunch",
          monthlyLimitHours: "2,6",
        })
      )
    ).toEqual({
      ok: false,
      error: "Das Monatslimit muss ein Vielfaches von 0,25 Stunden sein.",
    });
    expect(
      await updateProjectAction(
        formData({
          id: project.id,
          name: "Website-Relaunch",
          validFrom: "2026-09-01",
          validTo: "2026-08-01",
        })
      )
    ).toEqual({
      ok: false,
      error: "Das Laufzeitende darf nicht vor dem Laufzeitbeginn liegen.",
    });
    expect(
      await updateProjectAction(formData({ id: project.id, name: "Schulung" }))
    ).toEqual({
      ok: false,
      error: 'Für diesen Kunden existiert bereits ein Projekt „Schulung".',
    });
    expect(
      await updateProjectAction(formData({ id: project.id, name: "" }))
    ).toEqual({
      ok: false,
      error: "Bitte einen Projektnamen angeben.",
    });
    expect((await loadProject(project.id))?.name).toBe("Website-Relaunch");
  });

  it("meldet unbekannte Projekte", async () => {
    await actAs(seed.admin);
    expect(
      await updateProjectAction(formData({ id: UNKNOWN_ID, name: "X" }))
    ).toEqual({
      ok: false,
      error: "Projekt nicht gefunden.",
    });
  });

  it("ist nur für den Admin zulässig", async () => {
    await actAs(seed.employee);
    await expect(
      updateProjectAction(formData({ id: project.id, name: "Gekapert" }))
    ).rejects.toThrow("Nur für den Admin zulässig.");
    expect((await loadProject(project.id))?.name).toBe("Website-Relaunch");
  });
});

describe("toggleProjectActiveAction", () => {
  it("inaktiviert ein Projekt und aktiviert es wieder", async () => {
    await actAs(seed.admin);
    expect(await toggleProjectActiveAction(project.id, false)).toEqual({
      ok: true,
      data: null,
    });
    expect((await loadProject(project.id))?.active).toBe(false);
    expect((await auditFor("faktura_projekt", project.id))[0]).toMatchObject({
      action: "inaktiviert",
      details: {
        name: "Website-Relaunch",
        alt: { active: true },
        neu: { active: false },
      },
    });

    await actAs(seed.employee);
    expect(await createEntryAction(entryForm())).toMatchObject({
      ok: false,
      error: expect.stringContaining("inaktive"),
    });

    await actAs(seed.admin);
    expect(await toggleProjectActiveAction(project.id, true)).toEqual({
      ok: true,
      data: null,
    });
    expect((await loadProject(project.id))?.active).toBe(true);
    expect((await auditFor("faktura_projekt", project.id))[0].action).toBe(
      "aktiviert"
    );
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith(
      "/faktura/kunden"
    );

    await actAs(seed.employee);
    entryIdOf(await createEntryAction(entryForm()));
  });

  it("meldet unbekannte Projekte", async () => {
    await actAs(seed.admin);
    expect(await toggleProjectActiveAction(UNKNOWN_ID, true)).toEqual({
      ok: false,
      error: "Projekt nicht gefunden.",
    });
  });

  it("ist nur für den Admin zulässig", async () => {
    await actAs(seed.employee);
    await expect(toggleProjectActiveAction(project.id, false)).rejects.toThrow(
      "Nur für den Admin zulässig."
    );
    expect((await loadProject(project.id))?.active).toBe(true);
  });
});
