/**
 * Integrationstests Modul Faktura (Neon-Test-Branch).
 *
 * Der Jetzt-Zeitpunkt ist über FAKTURA_TEST_NOW in .env.test fixiert:
 * Freitag, 24.07.2026, 12:00 Europe/Berlin → laufende Woche ist KW 30/2026
 * (Mo 20.07. – Fr 24.07.). KW 29 (13.–17.07.) und älter sind abgeschlossen.
 */
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { GET as getFreigaben } from "@/app/api/v1/faktura/freigaben/route";
import { POST as postFreigeben } from "@/app/api/v1/faktura/freigaben/freigeben/route";
import {
  adminCreateTimeEntry,
  adminSetEntryVisibility,
  adminSoftDeleteTimeEntry,
  adminUpdateTimeEntry,
  createTimeEntry,
  softDeleteTimeEntry,
  updateTimeEntry,
} from "@/lib/faktura/buchungen";
import { buildFakturaCsv, getEntriesForExport } from "@/lib/faktura/export";
import {
  approveWeek,
  getWeekApproval,
  getWeekOverview,
  revokeWeekApproval,
} from "@/lib/faktura/freigabe";
import { checkMonthlyLimit } from "@/lib/faktura/limit";
import {
  createCustomer,
  createProject,
  setProjectActive,
} from "@/lib/faktura/stammdaten";
import { generateTimesheet } from "@/lib/faktura/stundenzettel";
import {
  auditLog,
  fakturaTimeEntries,
  fakturaTimesheets,
  fakturaWeekApprovals,
  type FakturaCustomer,
  type FakturaProject,
} from "../../src/db/schema";
import {
  createTestApiKey,
  resetDb,
  seedTestData,
  testDb,
  type SeedResult,
} from "../helpers/db";

let seed: SeedResult;
let apiKey: string;
let customer: FakturaCustomer;
let project: FakturaProject;
let limitedProject: FakturaProject;

/** KW 30/2026 — die laufende (offene) Woche; „heute" ist deren Freitag */
const TODAY = "2026-07-24";
/** KW 29/2026 — abgeschlossen, freigebbar */
const W29_MONDAY = "2026-07-13";
const W29_FRIDAY = "2026-07-17";
/** KW 28/2026 — abgeschlossen, für den API-Freigabetest */
const W28_MONDAY = "2026-07-06";

function entryInput(overrides: Partial<Parameters<typeof createTimeEntry>[1]> = {}) {
  return {
    projectId: project.id,
    entryDate: TODAY,
    durationHours: "1,5",
    description: "Konzeptarbeit",
    confirmWarnings: false,
    ...overrides,
  };
}

async function auditRows(objectId: string, action?: string) {
  return testDb()
    .select()
    .from(auditLog)
    .where(
      action
        ? and(eq(auditLog.objectId, objectId), eq(auditLog.action, action))
        : eq(auditLog.objectId, objectId)
    );
}

beforeAll(async () => {
  await resetDb();
  seed = await seedTestData();
  ({ key: apiKey } = await createTestApiKey(seed.admin.id));

  customer = await createCustomer(seed.admin, {
    name: "ACME GmbH",
    address: "Beispielstraße 1, 10115 Berlin",
    contactPerson: "Erika Beispiel",
  });
  project = await createProject(seed.admin, {
    customerId: customer.id,
    name: "Website-Relaunch",
  });
  limitedProject = await createProject(seed.admin, {
    customerId: customer.id,
    name: "Support-Kontingent",
    monthlyLimitHours: 3,
  });
});

// ---------------------------------------------------------------------------
// Zeitbuchungen: Fenster, Limit, Schreibschutz
// ---------------------------------------------------------------------------

describe("Zeitbuchungen Mitarbeitende", () => {
  it("legt eine Buchung an und schreibt genau einen Audit-Eintrag", async () => {
    const result = await createTimeEntry(seed.employee, entryInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = await auditRows(result.entryId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      objectType: "faktura_buchung",
      action: "angelegt",
      source: "web",
    });
    expect((rows[0].details as { projekt: string }).projekt).toBe(
      "ACME GmbH – Website-Relaunch"
    );
  });

  it("lehnt Buchungen außerhalb des Fensters serverseitig ab", async () => {
    // Vorwoche (KW 29) und Zukunft sind für Mitarbeitende gesperrt
    await expect(
      createTimeEntry(seed.employee, entryInput({ entryDate: W29_FRIDAY }))
    ).rejects.toThrow(/laufenden Kalenderwoche/);
    await expect(
      createTimeEntry(seed.employee, entryInput({ entryDate: "2026-07-27" }))
    ).rejects.toThrow(/Zukunft/);
    await expect(
      createTimeEntry(seed.employee, entryInput({ entryDate: "2026-07-25" }))
    ).rejects.toThrow(/Werktag der Folgewoche/);
  });

  it("Monatslimit: Warnung beim Erreichen, Speichern erst nach Bestätigung", async () => {
    // Limit 3 h — erste Buchung 2 h ohne Warnung
    const first = await createTimeEntry(
      seed.employee,
      entryInput({ projectId: limitedProject.id, durationHours: 2 })
    );
    expect(first.ok).toBe(true);

    // Zweite Buchung erreicht das Limit exakt → Warnung „erreicht", zweistufig
    const second = await createTimeEntry(
      seed.employee,
      entryInput({ projectId: limitedProject.id, durationHours: 1 })
    );
    expect(second.ok).toBe(false);
    if (!second.ok)
      expect(second.warnings.join(" ")).toContain("erreicht");

    const confirmed = await createTimeEntry(
      seed.employee,
      entryInput({
        projectId: limitedProject.id,
        durationHours: 1,
        confirmWarnings: true,
      })
    );
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;

    // Exakt am Limit → nicht als Überbuchung markiert (Edge Case 7)
    const [atLimit] = await testDb()
      .select()
      .from(fakturaTimeEntries)
      .where(eq(fakturaTimeEntries.id, confirmed.entryId));
    expect(atLimit.overbooked).toBe(false);

    // Dritte Buchung oberhalb des Limits → „überschritten" + overbooked
    const over = await createTimeEntry(
      seed.employee,
      entryInput({
        projectId: limitedProject.id,
        durationHours: "0,25",
        confirmWarnings: true,
      })
    );
    expect(over.ok).toBe(true);
    if (!over.ok) return;
    const [overEntry] = await testDb()
      .select()
      .from(fakturaTimeEntries)
      .where(eq(fakturaTimeEntries.id, over.entryId));
    expect(overEntry.overbooked).toBe(true);

    const check = await checkMonthlyLimit(limitedProject, TODAY, 15);
    expect(check.warning).toContain("überschritten");
  });

  it("verkraftet parallele Buchungen auf das limitierte Projekt", async () => {
    const [a, b] = await Promise.all([
      createTimeEntry(
        seed.employee,
        entryInput({
          projectId: limitedProject.id,
          durationHours: "0,25",
          description: "Parallel A",
          confirmWarnings: true,
        })
      ),
      createTimeEntry(
        seed.admin,
        entryInput({
          projectId: limitedProject.id,
          durationHours: "0,25",
          description: "Parallel B",
          confirmWarnings: true,
        })
      ),
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    // Beide Buchungen sind persistiert — keine geht verloren
    const entries = await testDb()
      .select()
      .from(fakturaTimeEntries)
      .where(eq(fakturaTimeEntries.projectId, limitedProject.id));
    expect(
      entries.filter((e) => e.description.startsWith("Parallel"))
    ).toHaveLength(2);
  });

  it("blockiert Schreibzugriffe, sobald die Woche freigegeben ist (Race, Edge Case 9)", async () => {
    // Freigabe der laufenden KW direkt einfügen (simuliert den Wettlauf)
    await testDb().insert(fakturaWeekApprovals).values({
      isoYear: 2026,
      isoWeek: 30,
      status: "freigegeben",
      approvedAt: new Date(),
      approvedById: seed.admin.id,
    });

    await expect(
      createTimeEntry(seed.employee, entryInput())
    ).rejects.toThrow(/inzwischen freigegeben/);

    // Aufräumen: Freigabe wieder entfernen, KW 30 bleibt für Folgetests offen
    await testDb()
      .delete(fakturaWeekApprovals)
      .where(eq(fakturaWeekApprovals.isoWeek, 30));
  });

  it("Mitarbeitende können eigene offene Buchungen ändern und löschen", async () => {
    const created = await createTimeEntry(
      seed.employee,
      entryInput({ description: "Erster Text" })
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const updated = await updateTimeEntry(
      seed.employee,
      created.entryId,
      entryInput({ description: "Korrigierter Text", durationHours: "2,25" })
    );
    expect(updated.ok).toBe(true);

    // Fremde Buchungen sind unsichtbar (RBAC): Admin-User als „fremd" simuliert
    await expect(
      updateTimeEntry(seed.admin, created.entryId, entryInput())
    ).rejects.toThrow(/nicht gefunden/);

    await softDeleteTimeEntry(seed.employee, created.entryId);
    const [row] = await testDb()
      .select()
      .from(fakturaTimeEntries)
      .where(eq(fakturaTimeEntries.id, created.entryId));
    expect(row.deleted).toBe(true);

    // Audit: angelegt + geaendert + geloescht = 3 Einträge
    expect(await auditRows(created.entryId)).toHaveLength(3);
  });

  it("lehnt Buchungen auf inaktive Projekte ab", async () => {
    const inactive = await createProject(seed.admin, {
      customerId: customer.id,
      name: "Altprojekt",
    });
    await setProjectActive(seed.admin, inactive.id, false);
    await expect(
      createTimeEntry(seed.employee, entryInput({ projectId: inactive.id }))
    ).rejects.toThrow(/inaktive/);
  });
});

// ---------------------------------------------------------------------------
// Wochenfreigabe: Statusübergänge, Schreibschutz, Widerruf
// ---------------------------------------------------------------------------

describe("Wochenfreigabe (KW 29/2026)", () => {
  let w29EntryId: string;

  beforeAll(async () => {
    // Buchungen in der abgeschlossenen KW 29 kann nur der Admin anlegen
    w29EntryId = await adminCreateTimeEntry(seed.admin, {
      userId: seed.employee.id,
      projectId: project.id,
      entryDate: W29_MONDAY,
      durationHours: 4,
      description: "Sprint-Arbeit KW 29",
      confirmWarnings: true,
    });
  });

  it("die laufende Woche ist nicht freigebbar", async () => {
    await expect(approveWeek(seed.admin, 2026, 30)).rejects.toThrow(
      /abgeschlossene Wochen/
    );
  });

  it("leere Wochen benötigen keine Freigabe (FA-5.7)", async () => {
    const overview = await getWeekOverview(2026, 27);
    expect(overview.empty).toBe(true);
    await expect(approveWeek(seed.admin, 2026, 27)).rejects.toThrow(
      /keine Buchungen/
    );
  });

  it("Freigabe setzt Freigabezeile und alle Buchungen auf freigegeben", async () => {
    await approveWeek(seed.admin, 2026, 29);

    const approval = await getWeekApproval(2026, 29);
    expect(approval?.status).toBe("freigegeben");
    expect(approval?.approvedById).toBe(seed.admin.id);

    const [entry] = await testDb()
      .select()
      .from(fakturaTimeEntries)
      .where(eq(fakturaTimeEntries.id, w29EntryId));
    expect(entry.status).toBe("freigegeben");

    // Doppelte Freigabe wird abgelehnt
    await expect(approveWeek(seed.admin, 2026, 29)).rejects.toThrow(
      /bereits freigegeben/
    );
  });

  it("freigegebene Buchungen sind für Mitarbeitende schreibgeschützt", async () => {
    await expect(
      updateTimeEntry(
        seed.employee,
        w29EntryId,
        entryInput({ entryDate: W29_MONDAY })
      )
    ).rejects.toThrow(/freigegeben|geschlossen/);
    await expect(
      softDeleteTimeEntry(seed.employee, w29EntryId)
    ).rejects.toThrow(/freigegeben|geschlossen/);
  });

  it("Admin-Korrektur an freigegebener Buchung nur mit Pflichtbegründung (FA-5.5)", async () => {
    await expect(
      adminUpdateTimeEntry(seed.admin, w29EntryId, {
        projectId: project.id,
        entryDate: W29_MONDAY,
        durationHours: 5,
        description: "Sprint-Arbeit KW 29 (korrigiert)",
        confirmWarnings: true,
      })
    ).rejects.toThrow(/Begründung/);

    await adminUpdateTimeEntry(seed.admin, w29EntryId, {
      projectId: project.id,
      entryDate: W29_MONDAY,
      durationHours: 5,
      description: "Sprint-Arbeit KW 29 (korrigiert)",
      confirmWarnings: true,
      reason: "Kundenabstimmung: Aufwand nachgemeldet",
    });

    const rows = await auditRows(w29EntryId, "admin_korrigiert");
    expect(rows).toHaveLength(1);
    const details = rows[0].details as {
      begruendung: string;
      alt: { durationMinutes: number };
      neu: { durationMinutes: number };
    };
    expect(details.begruendung).toContain("Kundenabstimmung");
    expect(details.alt.durationMinutes).toBe(240);
    expect(details.neu.durationMinutes).toBe(300);
  });

  it("Widerruf nur mit Begründung; Buchungen gehen zurück auf offen (FA-5.6)", async () => {
    await expect(
      revokeWeekApproval(seed.admin, 2026, 29, "  ")
    ).rejects.toThrow(/Begründung/);

    await revokeWeekApproval(
      seed.admin,
      2026,
      29,
      "Nachtrag einer vergessenen Buchung"
    );
    const approval = await getWeekApproval(2026, 29);
    expect(approval?.status).toBe("widerrufen");
    expect(approval?.revokeReason).toContain("Nachtrag");

    const [entry] = await testDb()
      .select()
      .from(fakturaTimeEntries)
      .where(eq(fakturaTimeEntries.id, w29EntryId));
    expect(entry.status).toBe("offen");

    // Erneute Freigabe nach Widerruf ist möglich
    await approveWeek(seed.admin, 2026, 29);
    expect((await getWeekApproval(2026, 29))?.status).toBe("freigegeben");
  });
});

// ---------------------------------------------------------------------------
// Stundenzettel: Versionierung, Sichtbarkeit, veraltet-Markierung
// ---------------------------------------------------------------------------

describe("Stundenzettel (KW 29/2026, freigegeben)", () => {
  let secondEntryId: string;

  beforeAll(async () => {
    // Zweite Buchung in der freigegebenen KW 29 (mit Pflichtbegründung)
    secondEntryId = await adminCreateTimeEntry(seed.admin, {
      userId: seed.employee.id,
      projectId: project.id,
      entryDate: "2026-07-14",
      durationHours: 2,
      description: "Interne Abstimmung",
      confirmWarnings: true,
      reason: "Nachtrag nach Widerruf/Neufreigabe",
    });
  });

  it("erzeugt ein finales PDF mit Dokumentnummer, Version 1 und Prüfsumme", async () => {
    const { timesheet, isDraft } = await generateTimesheet(seed.admin, {
      customerId: customer.id,
      fromISO: W29_MONDAY,
      toISO: W29_FRIDAY,
    });
    expect(isDraft).toBe(false);
    expect(timesheet.version).toBe(1);
    expect(timesheet.docNumber).toMatch(/^SZ-2026-\d{4}$/);
    expect(timesheet.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(timesheet.filename).toBe(
      "Stundenzettel_ACME-GmbH_2026-07-13_2026-07-17_v1.pdf"
    );
    expect(timesheet.blobUrl.startsWith("data:application/pdf;base64,")).toBe(
      true
    );

    // Genau ein Audit-Eintrag für die Erzeugung
    expect(await auditRows(timesheet.id, "erzeugt")).toHaveLength(1);
  });

  it("Ausblenden markiert den Stundenzettel als veraltet; Neuexport wird Version 2", async () => {
    await adminSetEntryVisibility(seed.admin, secondEntryId, false);

    const [v1] = await testDb()
      .select()
      .from(fakturaTimesheets)
      .where(eq(fakturaTimesheets.version, 1));
    expect(v1.stale).toBe(true);

    const { timesheet: v2 } = await generateTimesheet(seed.admin, {
      customerId: customer.id,
      fromISO: W29_MONDAY,
      toISO: W29_FRIDAY,
    });
    expect(v2.version).toBe(2);
    expect(v2.docNumber).toBe(v1.docNumber);
    expect(v2.stale).toBe(false);
    // Inhalt hat sich geändert (eine Buchung weniger) → andere Prüfsumme
    expect(v2.sha256).not.toBe(v1.sha256);

    // Alte Version bleibt unverändert archiviert
    const [v1After] = await testDb()
      .select()
      .from(fakturaTimesheets)
      .where(eq(fakturaTimesheets.id, v1.id));
    expect(v1After.sha256).toBe(v1.sha256);
    expect(v1After.blobUrl).toBe(v1.blobUrl);
  });

  it("ausgeblendete Buchungen fehlen im PDF-Datensatz, erscheinen aber im CSV", async () => {
    // PDF-Datensatz: Audit der Version 2 zählt eine Buchung weniger
    const audits = await testDb()
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.objectType, "faktura_stundenzettel"),
          eq(auditLog.action, "erzeugt")
        )
      );
    const countOfVersion = (version: number) =>
      (
        audits.find(
          (r) => (r.details as { version: number }).version === version
        )?.details as { anzahlBuchungen: number }
      ).anzahlBuchungen;
    expect(countOfVersion(1)).toBe(2);
    expect(countOfVersion(2)).toBe(1);

    // CSV: ausgeblendete Buchung enthalten und gekennzeichnet (FA-6.2)
    const rows = await getEntriesForExport(customer.id, W29_MONDAY, W29_FRIDAY);
    const csv = buildFakturaCsv(rows);
    expect(csv).toContain("Interne Abstimmung");
    expect(csv).toContain("nein (ausgeblendet)");
    expect(csv.startsWith("\uFEFF")).toBe(true);
  });

  it("Zeitraum mit nicht freigegebenen Buchungen ergibt nur einen Entwurf (FA-6.4)", async () => {
    // KW 30 ist offen — der Monat Juli enthält damit offene Buchungen
    const { timesheet, isDraft } = await generateTimesheet(seed.admin, {
      customerId: customer.id,
      fromISO: "2026-07-01",
      toISO: "2026-07-31",
    });
    expect(isDraft).toBe(true);
    expect(timesheet.isDraft).toBe(true);
    expect(timesheet.filename).toBe(
      "Stundenzettel_ACME-GmbH_2026-07_v1.pdf"
    );
  });

  it("Admin-Löschung markiert Stundenzettel als veraltet (Edge Case 14)", async () => {
    // Frisch erzeugte Version 2 ist aktuell …
    const [v2] = await testDb()
      .select()
      .from(fakturaTimesheets)
      .where(eq(fakturaTimesheets.version, 2));
    expect(v2.stale).toBe(false);

    // … bis der Admin eine Buchung des Zeitraums löscht (mit Begründung)
    await adminSoftDeleteTimeEntry(
      seed.admin,
      secondEntryId,
      "Doppelt erfasst"
    );
    const [v2After] = await testDb()
      .select()
      .from(fakturaTimesheets)
      .where(eq(fakturaTimesheets.id, v2.id));
    expect(v2After.stale).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Admin-API /api/v1/faktura (FA-5.8)
// ---------------------------------------------------------------------------

describe("Admin-API /api/v1/faktura/freigaben", () => {
  function authed(url: string, init?: RequestInit): Request {
    return new Request(url, {
      ...init,
      headers: { authorization: `Bearer ${apiKey}`, ...(init?.headers ?? {}) },
    });
  }

  it("verlangt einen API-Key", async () => {
    const res = await getFreigaben(
      new Request("http://localhost/api/v1/faktura/freigaben")
    );
    expect(res.status).toBe(401);
  });

  it("listet die letzten Wochen mit Status", async () => {
    const res = await getFreigaben(
      authed("http://localhost/api/v1/faktura/freigaben")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const w29 = body.wochen.find(
      (w: { jahr: number; kw: number }) => w.jahr === 2026 && w.kw === 29
    );
    expect(w29).toMatchObject({ status: "freigegeben", abgeschlossen: true });
    const w30 = body.wochen.find((w: { kw: number }) => w.kw === 30);
    expect(w30).toMatchObject({ status: "offen", abgeschlossen: false });
  });

  it("liefert die Detailübersicht einer Woche", async () => {
    const res = await getFreigaben(
      authed("http://localhost/api/v1/faktura/freigaben?jahr=2026&kw=29")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ jahr: 2026, kw: 29, status: "freigegeben" });
    expect(body.kunden[0].kunde).toBe("ACME GmbH");
    expect(body.kunden[0].projekte[0].projekt).toBe(
      "ACME GmbH – Website-Relaunch"
    );
  });

  it("validiert die Parameter", async () => {
    const res = await getFreigaben(
      authed("http://localhost/api/v1/faktura/freigaben?jahr=abc&kw=99")
    );
    expect(res.status).toBe(400);
  });

  it("gibt eine abgeschlossene Woche frei und auditiert mit source=api", async () => {
    // Buchung in KW 28 anlegen, damit die Woche freigebbar ist
    await adminCreateTimeEntry(seed.admin, {
      userId: seed.employee.id,
      projectId: project.id,
      entryDate: W28_MONDAY,
      durationHours: 3,
      description: "Arbeit KW 28",
      confirmWarnings: true,
    });

    const res = await postFreigeben(
      authed("http://localhost/api/v1/faktura/freigaben/freigeben", {
        method: "POST",
        body: JSON.stringify({ jahr: 2026, kw: 28 }),
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      jahr: 2026,
      kw: 28,
      status: "freigegeben",
    });
    expect((await getWeekApproval(2026, 28))?.status).toBe("freigegeben");

    const audits = await testDb()
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.objectType, "faktura_freigabe"),
          eq(auditLog.action, "woche_freigegeben"),
          eq(auditLog.source, "api")
        )
      );
    expect(audits).toHaveLength(1);
  });

  it("lehnt die Freigabe der laufenden Woche mit 409 ab", async () => {
    const res = await postFreigeben(
      authed("http://localhost/api/v1/faktura/freigaben/freigeben", {
        method: "POST",
        body: JSON.stringify({ jahr: 2026, kw: 30 }),
      })
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.fehler).toContain("abgeschlossene Wochen");
  });

  it("lehnt ungültige Bodies mit 400 ab", async () => {
    const res = await postFreigeben(
      authed("http://localhost/api/v1/faktura/freigaben/freigeben", {
        method: "POST",
        body: "kein json",
      })
    );
    expect(res.status).toBe(400);
  });
});
