/**
 * Ergänzende Integrationstests der Faktura-Bibliothek: Stammdatenpflege,
 * Fehlerpfade des Freigabe-Widerrufs sowie Wochenliste und Freigabeübersicht.
 *
 * „Jetzt" ist über FAKTURA_TEST_NOW fixiert: Freitag, 24.07.2026, 12:00 Uhr
 * Europe/Berlin → laufende Woche KW 30/2026, KW 29 und älter abgeschlossen.
 */
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  getWeekOverview,
  listRecentWeeks,
  revokeWeekApproval,
} from "@/lib/faktura/freigabe";
import {
  setCustomerActive,
  updateCustomer,
  updateProject,
  type ProjectInput,
} from "@/lib/faktura/stammdaten";
import * as schema from "../../src/db/schema";
import { auditFor, createUser } from "../helpers/actions";
import { resetDb, seedTestData, testDb, type SeedResult } from "../helpers/db";

let seed: SeedResult;
let customer: schema.FakturaCustomer;
let project: schema.FakturaProject;

const TODAY = "2026-07-24";
const KW29_MONDAY = "2026-07-13";
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

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

async function insertApproval(
  isoWeek: number,
  status: "offen" | "freigegeben" | "widerrufen"
) {
  await testDb()
    .insert(schema.fakturaWeekApprovals)
    .values({
      isoYear: 2026,
      isoWeek,
      status,
      approvedAt: status === "freigegeben" ? new Date() : null,
      approvedById: status === "freigegeben" ? seed.admin.id : null,
    });
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
// Stammdaten
// ---------------------------------------------------------------------------

describe("updateCustomer", () => {
  it("ändert die Stammdaten, speichert leere Felder als null und auditiert die Quelle", async () => {
    const updated = await updateCustomer(
      seed.admin,
      customer.id,
      { name: " ACME AG ", address: "", contactPerson: " Frau Beispiel " },
      "api"
    );
    expect(updated).toMatchObject({
      id: customer.id,
      name: "ACME AG",
      address: null,
      contactPerson: "Frau Beispiel",
    });
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(
      customer.updatedAt.getTime()
    );
    expect((await auditFor("faktura_kunde", customer.id))[0]).toMatchObject({
      action: "geaendert",
      source: "api",
      details: {
        alt: { name: "ACME GmbH", address: null, contactPerson: null },
        neu: { name: "ACME AG", contactPerson: "Frau Beispiel" },
      },
    });
  });

  it("erlaubt den eigenen Namen, lehnt den Namen eines anderen Kunden ab", async () => {
    await insertCustomer("Beta AG");
    await expect(
      updateCustomer(seed.admin, customer.id, {
        name: "ACME GmbH",
        address: "Weg 1",
      })
    ).resolves.toMatchObject({ address: "Weg 1" });
    await expect(
      updateCustomer(seed.admin, customer.id, { name: "Beta AG" })
    ).rejects.toThrow('Ein Kunde mit dem Namen „Beta AG" existiert bereits.');
  });

  it("meldet unbekannte Kunden vor der Validierung", async () => {
    await expect(
      updateCustomer(seed.admin, UNKNOWN_ID, { name: "" })
    ).rejects.toThrow("Kunde nicht gefunden.");
  });

  it("lehnt einen leeren Namen ab", async () => {
    await expect(
      updateCustomer(seed.admin, customer.id, { name: "  " })
    ).rejects.toThrow("Bitte einen Kundennamen angeben.");
    expect(await auditFor("faktura_kunde", customer.id)).toHaveLength(0);
  });
});

describe("setCustomerActive", () => {
  it("inaktiviert und aktiviert einen Kunden mit Audit", async () => {
    await setCustomerActive(seed.admin, customer.id, false);
    await setCustomerActive(seed.admin, customer.id, true);

    const row = await testDb().query.fakturaCustomers.findFirst({
      where: eq(schema.fakturaCustomers.id, customer.id),
    });
    expect(row?.active).toBe(true);
    expect(
      (await auditFor("faktura_kunde", customer.id)).map((a) => a.action)
    ).toEqual(["aktiviert", "inaktiviert"]);
  });

  it("auditiert auch einen unveränderten Zustand", async () => {
    await setCustomerActive(seed.admin, customer.id, true);
    expect((await auditFor("faktura_kunde", customer.id))[0]).toMatchObject({
      action: "aktiviert",
      details: { alt: { active: true }, neu: { active: true } },
    });
  });

  it("meldet unbekannte Kunden", async () => {
    await expect(
      setCustomerActive(seed.admin, UNKNOWN_ID, false)
    ).rejects.toThrow("Kunde nicht gefunden.");
  });
});

describe("updateProject", () => {
  function input(
    values: Partial<ProjectInput> = {}
  ): Omit<ProjectInput, "customerId"> {
    return { name: "Website-Relaunch", ...values };
  }

  it("ändert Name, Laufzeit und Limit und liefert das Projekt zurück", async () => {
    const updated = await updateProject(
      seed.admin,
      project.id,
      input({
        name: "Relaunch 2.0",
        validFrom: "2026-07-01",
        validTo: "2026-09-30",
        monthlyLimitHours: 20.75,
      })
    );
    expect(updated).toMatchObject({
      id: project.id,
      customerId: customer.id,
      name: "Relaunch 2.0",
      validFrom: "2026-07-01",
      validTo: "2026-09-30",
      monthlyLimitMinutes: 1245,
    });
    expect((await auditFor("faktura_projekt", project.id))[0]).toMatchObject({
      action: "geaendert",
      details: {
        neu: {
          name: "Relaunch 2.0",
          validFrom: "2026-07-01",
          validTo: "2026-09-30",
          monthlyLimitMinutes: 1245,
        },
      },
    });
  });

  it("lässt sich nicht zu einem anderen Kunden verschieben", async () => {
    const other = await insertCustomer("Beta AG");
    const updated = await updateProject(seed.admin, project.id, {
      ...input(),
      customerId: other.id,
    } as Omit<ProjectInput, "customerId">);
    expect(updated.customerId).toBe(customer.id);
  });

  it("entfernt Laufzeit und Limit", async () => {
    const limited = await insertProject(customer.id, "Kontingent", {
      validFrom: "2026-01-01",
      validTo: "2026-12-31",
      monthlyLimitMinutes: 600,
    });
    const updated = await updateProject(
      seed.admin,
      limited.id,
      input({ name: "Kontingent" })
    );
    expect(updated).toMatchObject({
      validFrom: null,
      validTo: null,
      monthlyLimitMinutes: null,
    });
  });

  it("prüft den Namen nur innerhalb desselben Kunden auf Eindeutigkeit", async () => {
    await insertProject(customer.id, "Schulung");
    const other = await insertCustomer("Beta AG");
    await insertProject(other.id, "Support");

    await expect(
      updateProject(seed.admin, project.id, input({ name: "Schulung" }))
    ).rejects.toThrow(
      'Für diesen Kunden existiert bereits ein Projekt „Schulung".'
    );
    await expect(
      updateProject(seed.admin, project.id, input({ name: "Support" }))
    ).resolves.toMatchObject({ name: "Support" });
  });

  it("validiert Laufzeit und Limit", async () => {
    await expect(
      updateProject(seed.admin, project.id, input({ monthlyLimitHours: 0.1 }))
    ).rejects.toThrow("Vielfaches von 0,25 Stunden");
    await expect(
      updateProject(
        seed.admin,
        project.id,
        input({ validFrom: "2026-09-01", validTo: "2026-08-31" })
      )
    ).rejects.toThrow(
      "Das Laufzeitende darf nicht vor dem Laufzeitbeginn liegen."
    );
    expect(await auditFor("faktura_projekt", project.id)).toHaveLength(0);
  });

  it("meldet unbekannte Projekte", async () => {
    await expect(
      updateProject(seed.admin, UNKNOWN_ID, input())
    ).rejects.toThrow("Projekt nicht gefunden.");
  });
});

// ---------------------------------------------------------------------------
// Freigabe
// ---------------------------------------------------------------------------

describe("revokeWeekApproval", () => {
  it("verlangt eine Begründung, bevor die Freigabe geprüft wird", async () => {
    await expect(
      revokeWeekApproval(seed.admin, 2026, 29, " \n ")
    ).rejects.toThrow("Bitte eine Begründung für den Widerruf angeben.");
  });

  it("lehnt Wochen ohne, mit offener oder widerrufener Freigabe ab", async () => {
    await insertApproval(28, "offen");
    await insertApproval(27, "widerrufen");
    for (const week of [29, 28, 27])
      await expect(
        revokeWeekApproval(seed.admin, 2026, week, "Begründung")
      ).rejects.toThrow("Diese Woche ist nicht freigegeben.");
    expect(await auditFor("faktura_freigabe")).toHaveLength(0);
  });

  it("widerruft auch eine Freigabe, deren Buchungen inzwischen gelöscht sind", async () => {
    await insertEntry({
      entryDate: KW29_MONDAY,
      deleted: true,
      status: "freigegeben",
    });
    await insertApproval(29, "freigegeben");
    await revokeWeekApproval(seed.admin, 2026, 29, "Aufräumen", "api");

    const approval = await testDb().query.fakturaWeekApprovals.findFirst({
      where: eq(schema.fakturaWeekApprovals.isoWeek, 29),
    });
    expect(approval).toMatchObject({
      status: "widerrufen",
      revokeReason: "Aufräumen",
    });
    expect((await auditFor("faktura_freigabe"))[0]).toMatchObject({
      action: "freigabe_widerrufen",
      source: "api",
    });
  });
});

describe("listRecentWeeks", () => {
  it("listet die letzten acht Wochen ab der laufenden KW", async () => {
    const weeks = await listRecentWeeks();
    expect(weeks.map((w) => w.isoWeek)).toEqual([
      30, 29, 28, 27, 26, 25, 24, 23,
    ]);
    expect(weeks[0]).toMatchObject({
      isoYear: 2026,
      mondayISO: "2026-07-20",
      fridayISO: "2026-07-24",
      closed: false,
    });
    expect(weeks.slice(1).every((w) => w.closed)).toBe(true);
    expect(await listRecentWeeks(3)).toHaveLength(3);
  });

  it("leitet den Status aus Buchungen und Freigabe ab", async () => {
    const other = await createUser();
    // KW 30: offen, zwei Mitarbeitende, eine Überbuchung, eine gelöschte Buchung
    await insertEntry({ durationMinutes: 90, overbooked: true });
    await insertEntry({ userId: other.id, durationMinutes: 45 });
    await insertEntry({ durationMinutes: 600, deleted: true });
    // KW 29: freigegeben
    await insertEntry({ entryDate: KW29_MONDAY, status: "freigegeben" });
    await insertApproval(29, "freigegeben");
    // KW 28: widerrufen
    await insertEntry({ entryDate: "2026-07-07" });
    await insertApproval(28, "widerrufen");
    // KW 27: Freigabezeile „offen“ zählt wie keine Freigabe
    await insertEntry({ entryDate: "2026-06-30" });
    await insertApproval(27, "offen");
    // KW 26: freigegeben, aber alle Buchungen gelöscht → leer
    await insertEntry({ entryDate: "2026-06-22", deleted: true });
    await insertApproval(26, "freigegeben");

    const weeks = await listRecentWeeks(6);
    expect(
      weeks.map((w) => ({
        kw: w.isoWeek,
        status: w.status,
        anzahl: w.entryCount,
      }))
    ).toEqual([
      { kw: 30, status: "offen", anzahl: 2 },
      { kw: 29, status: "freigegeben", anzahl: 1 },
      { kw: 28, status: "widerrufen", anzahl: 1 },
      { kw: 27, status: "offen", anzahl: 1 },
      { kw: 26, status: "leer", anzahl: 0 },
      { kw: 25, status: "leer", anzahl: 0 },
    ]);
    expect(weeks[0]).toMatchObject({ totalMinutes: 135, overbookedCount: 1 });
  });
});

describe("getWeekOverview", () => {
  it("gruppiert mehrere Kunden und Projekte alphabetisch mit Summen", async () => {
    const zeta = await insertCustomer("Zeta AG");
    const aerzte = await insertCustomer("Ärztekammer");
    const zetaB = await insertProject(zeta.id, "B-Projekt", {
      monthlyLimitMinutes: 600,
    });
    const zetaA = await insertProject(zeta.id, "A-Projekt");
    const aerzteProject = await insertProject(aerzte.id, "Fortbildung");
    const other = await createUser({ firstName: "Ola", lastName: "Andere" });

    await insertEntry({
      projectId: zetaB.id,
      entryDate: "2026-07-21",
      durationMinutes: 120,
    });
    await insertEntry({
      projectId: zetaB.id,
      userId: other.id,
      entryDate: "2026-07-20",
      durationMinutes: 30,
      overbooked: true,
    });
    await insertEntry({ projectId: zetaA.id, durationMinutes: 15 });
    await insertEntry({ projectId: aerzteProject.id, durationMinutes: 45 });
    await insertEntry({ projectId: project.id, durationMinutes: 60 });
    // gelöscht bzw. andere Woche → nicht enthalten
    await insertEntry({
      projectId: zetaA.id,
      durationMinutes: 999 * 15,
      deleted: true,
    });
    await insertEntry({ projectId: zetaA.id, entryDate: KW29_MONDAY });

    const overview = await getWeekOverview(2026, 30);

    expect(overview).toMatchObject({
      isoYear: 2026,
      isoWeek: 30,
      mondayISO: "2026-07-20",
      fridayISO: "2026-07-24",
      closed: false,
      approval: null,
      empty: false,
      totalMinutes: 270,
      overbookedCount: 1,
    });
    expect(
      overview.customers.map((c) => [c.customerName, c.totalMinutes])
    ).toEqual([
      ["ACME GmbH", 60],
      ["Ärztekammer", 45],
      ["Zeta AG", 165],
    ]);
    const zetaGroup = overview.customers[2];
    expect(
      zetaGroup.projects.map((p) => [p.projectName, p.totalMinutes])
    ).toEqual([
      ["A-Projekt", 15],
      ["B-Projekt", 150],
    ]);
    expect(zetaGroup.projects[1].monthlyLimitMinutes).toBe(600);
    // Buchungen nach Datum sortiert, mit Namen der Mitarbeitenden
    expect(
      zetaGroup.projects[1].entries.map((e) => [e.entryDate, e.userName])
    ).toEqual([
      ["2026-07-20", "Ola Andere"],
      ["2026-07-21", "Max Mitarbeiter"],
    ]);
  });

  it("liefert für eine leere, abgeschlossene Woche die Freigabezeile mit", async () => {
    await insertApproval(29, "widerrufen");
    const overview = await getWeekOverview(2026, 29);
    expect(overview).toMatchObject({
      closed: true,
      empty: true,
      totalMinutes: 0,
      customers: [],
      approval: expect.objectContaining({ status: "widerrufen" }),
    });
  });
});
