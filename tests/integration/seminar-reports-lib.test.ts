/**
 * Ergänzende Integrationstests der Seminarbericht-Datenzugriffe:
 * Kundenvorschläge, eigene Übersicht, Admin-Zitatliste und Fehlerpfade.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  listCustomerSuggestions,
  listMySeminarReports,
  listQuotesForAdmin,
  setQuoteWebsiteApproved,
} from "@/lib/seminar-reports-store";
import * as schema from "../../src/db/schema";
import { auditFor } from "../helpers/actions";
import { resetDb, seedTestData, testDb, type SeedResult } from "../helpers/db";

let seed: SeedResult;

async function insertReport(
  values: Partial<typeof schema.seminarReports.$inferInsert> = {},
  quotes: { quote: string; websiteApproved?: boolean }[] = []
) {
  const [report] = await testDb()
    .insert(schema.seminarReports)
    .values({
      userId: seed.employee.id,
      kind: "seminar",
      customerName: "Haufe Akademie",
      title: "KI-Grundlagen",
      eventDate: "2026-05-12",
      durationDays: 1,
      whatWentWell: "Übungen",
      whatWentBadly: "Raum",
      improvements: "Mehr Pausen",
      feedbackRating: 5,
      quoteQuestion: "Was nehmen Sie mit?",
      ...values,
    })
    .returning();
  if (quotes.length > 0)
    await testDb()
      .insert(schema.seminarReportQuotes)
      .values(
        quotes.map((q, position) => ({
          reportId: report.id,
          position,
          quote: q.quote,
          websiteApproved: q.websiteApproved ?? false,
        }))
      );
  return report;
}

beforeAll(async () => {
  await resetDb();
  seed = await seedTestData();
});

beforeEach(async () => {
  const db = testDb();
  await db.delete(schema.seminarReportQuotes);
  await db.delete(schema.seminarReports);
  await db.delete(schema.fakturaTimesheets);
  await db.delete(schema.fakturaTimeEntries);
  await db.delete(schema.fakturaProjects);
  await db.delete(schema.fakturaCustomers);
  await db.delete(schema.auditLog);
});

describe("listCustomerSuggestions", () => {
  it("vereint Kunden aus Berichten und aktive Faktura-Kunden, getrimmt und sortiert", async () => {
    await insertReport({ customerName: "Haufe Akademie" });
    await insertReport({
      customerName: " Haufe Akademie ",
      title: "Zweiter Termin",
    });
    await insertReport({ customerName: "Zukunftswerk" });
    await insertReport({ customerName: "   " });
    await testDb()
      .insert(schema.fakturaCustomers)
      .values([
        { name: "ACME GmbH" },
        { name: "Ärztekammer Nordrhein" },
        { name: "Haufe Akademie" },
        { name: "Altkunde AG", active: false },
      ]);

    expect(await listCustomerSuggestions()).toEqual([
      "ACME GmbH",
      "Ärztekammer Nordrhein",
      "Haufe Akademie",
      "Zukunftswerk",
    ]);
  });

  it("liefert ohne Daten eine leere Liste", async () => {
    expect(await listCustomerSuggestions()).toEqual([]);
  });
});

describe("listMySeminarReports", () => {
  it("liefert nur die eigenen Berichte, neueste zuerst, mit Zitatanzahl", async () => {
    const older = await insertReport(
      { title: "Alt", eventDate: "2026-01-10" },
      [{ quote: "Eins" }, { quote: "Zwei" }]
    );
    const newer = await insertReport({
      title: "Neu",
      eventDate: "2026-06-10",
      kind: "beratung",
      durationDays: 0.5,
    });
    await insertReport({ userId: seed.admin.id, title: "Fremd" });

    const rows = await listMySeminarReports(seed.employee.id);
    expect(rows).toEqual([
      expect.objectContaining({
        id: newer.id,
        title: "Neu",
        kind: "beratung",
        durationDays: 0.5,
        quoteCount: 0,
        userName: "Max Mitarbeiter",
      }),
      expect.objectContaining({ id: older.id, title: "Alt", quoteCount: 2 }),
    ]);
    expect(await listMySeminarReports(seed.admin.id)).toHaveLength(1);
  });
});

describe("listQuotesForAdmin", () => {
  it("liefert alle Zitate mit Bericht-Kontext, neueste Veranstaltung zuerst", async () => {
    const may = await insertReport(
      { title: "B-Seminar", eventDate: "2026-05-12" },
      [{ quote: "Mai eins", websiteApproved: true }, { quote: "Mai zwei" }]
    );
    const sameDay = await insertReport(
      { title: "A-Seminar", eventDate: "2026-05-12" },
      [{ quote: "Gleicher Tag" }]
    );
    const june = await insertReport(
      {
        userId: seed.admin.id,
        kind: "beratung",
        title: "Juni",
        customerName: "Beta AG",
        eventDate: "2026-06-01",
        quoteQuestion: null,
      },
      [{ quote: "Juni" }]
    );
    await insertReport({ title: "Ohne Zitate" });

    const rows = await listQuotesForAdmin();
    expect(rows.map((r) => r.quote)).toEqual([
      "Juni",
      "Gleicher Tag",
      "Mai eins",
      "Mai zwei",
    ]);
    expect(rows[0]).toMatchObject({
      reportId: june.id,
      kind: "beratung",
      title: "Juni",
      customerName: "Beta AG",
      eventDate: "2026-06-01",
      quoteQuestion: null,
      websiteApproved: false,
      userId: seed.admin.id,
      userName: "Erika Admin",
    });
    expect(rows[1].reportId).toBe(sameDay.id);
    expect(rows[2]).toMatchObject({
      reportId: may.id,
      websiteApproved: true,
      quoteQuestion: "Was nehmen Sie mit?",
      userName: "Max Mitarbeiter",
    });
  });
});

describe("setQuoteWebsiteApproved", () => {
  it("meldet unbekannte Zitate ohne Audit", async () => {
    await expect(
      setQuoteWebsiteApproved(
        seed.admin,
        "00000000-0000-4000-8000-000000000000",
        true
      )
    ).rejects.toThrow("Zitat nicht gefunden.");
    expect(await auditFor("seminarbericht")).toHaveLength(0);
  });
});
