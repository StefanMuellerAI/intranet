/**
 * Integrationstests für den CSV-Export der für die Website freigegebenen
 * Teilnehmenden-Zitate (GET /api/exports/berichte-zitate).
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as exportQuotes } from "@/app/api/exports/berichte-zitate/route";
import * as schema from "../../../src/db/schema";
import { actAs, auditFor } from "../../helpers/actions";
import {
  resetDb,
  seedTestData,
  testDb,
  type SeedResult,
} from "../../helpers/db";

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

/** CSV-Text inkl. BOM (Response.text() würde die BOM entfernen) */
async function csvText(res: Response): Promise<string> {
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(
    await res.arrayBuffer()
  );
}

beforeAll(async () => {
  await resetDb();
  seed = await seedTestData();
});

beforeEach(async () => {
  const db = testDb();
  await db.delete(schema.seminarReportQuotes);
  await db.delete(schema.seminarReports);
  await db.delete(schema.auditLog);
});

describe("GET /api/exports/berichte-zitate", () => {
  it("verweigert den Export für Mitarbeitende und ohne Session (403) ohne Audit", async () => {
    await insertReport({}, [{ quote: "Freigegeben", websiteApproved: true }]);

    await actAs(seed.employee);
    const res = await exportQuotes();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ fehler: "Nur für den Admin." });

    await actAs(null);
    expect((await exportQuotes()).status).toBe(403);
    expect(await auditFor("seminarbericht")).toHaveLength(0);
  });

  it("liefert dem Admin nur freigegebene Zitate als CSV mit Kontext", async () => {
    await insertReport({}, [
      { quote: 'Sehr "praxisnah"; gerne wieder', websiteApproved: true },
      { quote: "Nicht freigegeben" },
    ]);
    await insertReport(
      {
        userId: seed.admin.id,
        kind: "beratung",
        title: "Strategieberatung",
        customerName: "Beta AG",
        eventDate: "2026-06-01",
        quoteQuestion: null,
      },
      [{ quote: "Klarer Fahrplan", websiteApproved: true }]
    );
    await actAs(seed.admin);

    const res = await exportQuotes();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-disposition")).toMatch(
      /^attachment; filename="Zitate_freigegeben_\d{4}-\d{2}-\d{2}\.csv"/
    );

    const csv = await csvText(res);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split("\r\n");
    expect(lines).toEqual([
      "Zitat;Art;Veranstaltung;Kunde;Datum;Mitarbeiter/in;Frage",
      // neueste Veranstaltung zuerst; Altbericht ohne Frage → leeres Feld
      '"Klarer Fahrplan";"Beratung";"Strategieberatung";"Beta AG";"01.06.2026";"Erika Admin";""',
      '"Sehr ""praxisnah""; gerne wieder";"Seminar";"KI-Grundlagen";"Haufe Akademie";"12.05.2026";"Max Mitarbeiter";"Was nehmen Sie mit?"',
    ]);
    expect(csv).not.toContain("Nicht freigegeben");
  });

  it("liefert ohne freigegebene Zitate nur die Kopfzeile", async () => {
    await insertReport({}, [{ quote: "Nicht freigegeben" }]);
    await actAs(seed.admin);
    const csv = await csvText(await exportQuotes());
    expect(csv).toBe(
      "﻿Zitat;Art;Veranstaltung;Kunde;Datum;Mitarbeiter/in;Frage"
    );
  });

  it("auditiert jeden Abruf mit der Anzahl der Zitate", async () => {
    await insertReport({}, [
      { quote: "Eins", websiteApproved: true },
      { quote: "Zwei", websiteApproved: true },
      { quote: "Drei" },
    ]);
    await actAs(seed.admin);

    await exportQuotes();
    await exportQuotes();

    const audits = await auditFor("seminarbericht");
    expect(audits).toHaveLength(2);
    expect(audits[0]).toMatchObject({
      action: "zitate_exportiert",
      objectId: null,
      actorUserId: seed.admin.id,
      actorLabel: "Erika Admin",
      source: "web",
      details: { zitate: 2 },
    });
  });
});
