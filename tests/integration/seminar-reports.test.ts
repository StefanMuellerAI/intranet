import { asc, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SeminarReportInput } from "@/lib/seminar-reports";
import {
  createSeminarReport,
  deleteSeminarReport,
  getSeminarReportWithQuotes,
  listApprovedQuotesForExport,
  listSeminarReports,
  setQuoteWebsiteApproved,
  updateQuoteText,
  updateSeminarReport,
} from "@/lib/seminar-reports-store";
import { seminarReportQuotes, seminarReports } from "../../src/db/schema";
import { resetDb, seedTestData, testDb, type SeedResult } from "../helpers/db";

let seed: SeedResult;

function input(overrides: Partial<SeminarReportInput> = {}): SeminarReportInput {
  return {
    kind: "seminar",
    customerName: "Haufe Akademie",
    title: "KI-Grundlagen",
    eventDate: "2026-05-12",
    durationDays: 1,
    whatWentWell: "Übungen kamen gut an.",
    whatWentBadly: "Raum zu klein.",
    improvements: "Teilnehmendenzahl vorab abfragen.",
    feedbackRating: 5,
    quotes: [],
    ...overrides,
  };
}

async function quotesOf(reportId: string) {
  return testDb()
    .select()
    .from(seminarReportQuotes)
    .where(eq(seminarReportQuotes.reportId, reportId))
    .orderBy(asc(seminarReportQuotes.position));
}

beforeAll(async () => {
  await resetDb();
  seed = await seedTestData();
});

beforeEach(async () => {
  const db = testDb();
  await db.delete(seminarReportQuotes);
  await db.delete(seminarReports);
});

describe("Seminarberichte — Anlegen und Lesen", () => {
  it("legt Bericht und Zitate in der Reihenfolge des Formulars an", async () => {
    const reportId = await createSeminarReport(
      seed.employee,
      input({
        quotes: [
          { id: null, quote: "Sehr praxisnah." },
          { id: null, quote: "Guter Einstieg." },
        ],
      })
    );

    const found = await getSeminarReportWithQuotes(reportId);
    expect(found?.report.userId).toBe(seed.employee.id);
    expect(found?.report.feedbackRating).toBe(5);
    expect(found?.quotes.map((q) => q.quote)).toEqual([
      "Sehr praxisnah.",
      "Guter Einstieg.",
    ]);
    // Neue Zitate sind nie automatisch für die Website freigegeben.
    expect(found?.quotes.every((q) => q.websiteApproved === false)).toBe(true);
  });

  it("zählt die Zitate in der Übersicht", async () => {
    await createSeminarReport(
      seed.employee,
      input({ quotes: [{ id: null, quote: "Eins" }] })
    );
    const rows = await listSeminarReports({ userId: seed.employee.id });
    expect(rows).toHaveLength(1);
    expect(rows[0].quoteCount).toBe(1);
    expect(rows[0].userName).toBe("Max Mitarbeiter");
  });

  it("filtert nach Mitarbeiter/in, Zeitraum und Art", async () => {
    await createSeminarReport(
      seed.employee,
      input({ eventDate: "2026-01-10", title: "Januar" })
    );
    await createSeminarReport(
      seed.employee,
      input({ eventDate: "2026-06-10", title: "Juni", kind: "beratung" })
    );
    await createSeminarReport(
      seed.admin,
      input({ eventDate: "2026-03-10", title: "Admin-Bericht" })
    );

    expect(
      (await listSeminarReports({ userId: seed.employee.id })).map((r) => r.title)
    ).toEqual(["Juni", "Januar"]);

    expect(
      (await listSeminarReports({ from: "2026-02-01", to: "2026-04-01" })).map(
        (r) => r.title
      )
    ).toEqual(["Admin-Bericht"]);

    expect(
      (await listSeminarReports({ kind: "beratung" })).map((r) => r.title)
    ).toEqual(["Juni"]);
  });

  it("sortiert nach Datum in beide Richtungen und nach Mitarbeiter/in", async () => {
    await createSeminarReport(
      seed.employee,
      input({ eventDate: "2026-01-10", title: "Alt" })
    );
    await createSeminarReport(
      seed.admin,
      input({ eventDate: "2026-09-10", title: "Neu" })
    );

    expect(
      (await listSeminarReports({ sort: "datum_neu" })).map((r) => r.title)
    ).toEqual(["Neu", "Alt"]);
    expect(
      (await listSeminarReports({ sort: "datum_alt" })).map((r) => r.title)
    ).toEqual(["Alt", "Neu"]);
    // Erika Admin vor Max Mitarbeiter
    expect(
      (await listSeminarReports({ sort: "mitarbeiter" })).map((r) => r.userName)
    ).toEqual(["Erika Admin", "Max Mitarbeiter"]);
  });
});

describe("Seminarberichte — Bearbeiten", () => {
  it("hält die Website-Freigabe bei unverändertem Wortlaut", async () => {
    const reportId = await createSeminarReport(
      seed.employee,
      input({ quotes: [{ id: null, quote: "Sehr praxisnah." }] })
    );
    const [quote] = await quotesOf(reportId);
    await setQuoteWebsiteApproved(seed.admin, quote.id, true);

    await updateSeminarReport(
      seed.employee,
      reportId,
      input({
        title: "Neuer Titel",
        quotes: [{ id: quote.id, quote: "Sehr praxisnah." }],
      })
    );

    const after = await quotesOf(reportId);
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(quote.id);
    expect(after[0].websiteApproved).toBe(true);
    const found = await getSeminarReportWithQuotes(reportId);
    expect(found?.report.title).toBe("Neuer Titel");
  });

  it("setzt die Freigabe zurück, wenn der Wortlaut geändert wird", async () => {
    const reportId = await createSeminarReport(
      seed.employee,
      input({ quotes: [{ id: null, quote: "Sehr praxisnah." }] })
    );
    const [quote] = await quotesOf(reportId);
    await setQuoteWebsiteApproved(seed.admin, quote.id, true);

    await updateSeminarReport(
      seed.employee,
      reportId,
      input({ quotes: [{ id: quote.id, quote: "Doch etwas anderes." }] })
    );

    const after = await quotesOf(reportId);
    expect(after[0].websiteApproved).toBe(false);
    expect(after[0].quote).toBe("Doch etwas anderes.");
  });

  it("entfernt gelöschte und ergänzt neue Zitate", async () => {
    const reportId = await createSeminarReport(
      seed.employee,
      input({
        quotes: [
          { id: null, quote: "Bleibt" },
          { id: null, quote: "Verschwindet" },
        ],
      })
    );
    const before = await quotesOf(reportId);
    const keep = before.find((q) => q.quote === "Bleibt")!;

    await updateSeminarReport(
      seed.employee,
      reportId,
      input({
        quotes: [
          { id: keep.id, quote: "Bleibt" },
          { id: null, quote: "Kommt dazu" },
        ],
      })
    );

    const after = await quotesOf(reportId);
    expect(after.map((q) => q.quote)).toEqual(["Bleibt", "Kommt dazu"]);
    expect(after[0].id).toBe(keep.id);
  });

  it("schreibt kein fremdes Zitat um, wenn eine fremde Id gesendet wird", async () => {
    const ownId = await createSeminarReport(
      seed.employee,
      input({ title: "Eigener", quotes: [{ id: null, quote: "Eigenes Zitat" }] })
    );
    const foreignId = await createSeminarReport(
      seed.admin,
      input({ title: "Fremder", quotes: [{ id: null, quote: "Fremdes Zitat" }] })
    );
    const [foreignQuote] = await quotesOf(foreignId);

    await updateSeminarReport(
      seed.employee,
      ownId,
      input({
        title: "Eigener",
        quotes: [{ id: foreignQuote.id, quote: "Übernommen" }],
      })
    );

    // Das fremde Zitat bleibt unangetastet und beim fremden Bericht.
    const foreignAfter = await quotesOf(foreignId);
    expect(foreignAfter).toHaveLength(1);
    expect(foreignAfter[0].id).toBe(foreignQuote.id);
    expect(foreignAfter[0].quote).toBe("Fremdes Zitat");

    // Beim eigenen Bericht entsteht ein neues Zitat.
    const ownAfter = await quotesOf(ownId);
    expect(ownAfter).toHaveLength(1);
    expect(ownAfter[0].id).not.toBe(foreignQuote.id);
    expect(ownAfter[0].quote).toBe("Übernommen");
  });
});

describe("Seminarberichte — Nachträgliche Korrektur durch den Admin", () => {
  it("lässt den Admin einen fremden Bericht bearbeiten", async () => {
    const reportId = await createSeminarReport(
      seed.employee,
      input({
        title: "KI-Grundlagen",
        quotes: [
          { id: null, quote: "- 5, weil ich jetzt weiß, was möglich ist" },
        ],
      })
    );
    const [quote] = await quotesOf(reportId);

    await updateSeminarReport(
      seed.admin,
      reportId,
      input({
        title: "KI-Grundlagen",
        quotes: [
          { id: quote.id, quote: "Weil ich jetzt weiß, was möglich ist" },
        ],
      })
    );

    const after = await quotesOf(reportId);
    expect(after[0].id).toBe(quote.id);
    expect(after[0].quote).toBe("Weil ich jetzt weiß, was möglich ist");
    // Der Bericht bleibt der verfassenden Person zugeordnet.
    const found = await getSeminarReportWithQuotes(reportId);
    expect(found?.report.userId).toBe(seed.employee.id);
  });

  it("behält die Website-Freigabe, wenn der Admin den Wortlaut korrigiert", async () => {
    const reportId = await createSeminarReport(
      seed.employee,
      input({ quotes: [{ id: null, quote: "- 5, weil es praxisnah war" }] })
    );
    const [quote] = await quotesOf(reportId);
    await setQuoteWebsiteApproved(seed.admin, quote.id, true);

    await updateSeminarReport(
      seed.admin,
      reportId,
      input({ quotes: [{ id: quote.id, quote: "Weil es praxisnah war" }] })
    );

    const after = await quotesOf(reportId);
    expect(after[0].quote).toBe("Weil es praxisnah war");
    expect(after[0].websiteApproved).toBe(true);
  });

  it("korrigiert ein einzelnes Zitat aus der Zitatverwaltung heraus", async () => {
    const reportId = await createSeminarReport(
      seed.employee,
      input({
        quotes: [
          { id: null, quote: "- 5, weil ich jetzt weiß, was möglich ist" },
          { id: null, quote: "Bleibt unberührt" },
        ],
      })
    );
    const quotes = await quotesOf(reportId);
    await setQuoteWebsiteApproved(seed.admin, quotes[0].id, true);

    const touchedReportId = await updateQuoteText(
      seed.admin,
      quotes[0].id,
      "  Weil ich jetzt weiß, was möglich ist  "
    );
    expect(touchedReportId).toBe(reportId);

    const after = await quotesOf(reportId);
    expect(after[0].quote).toBe("Weil ich jetzt weiß, was möglich ist");
    expect(after[0].websiteApproved).toBe(true);
    expect(after[0].position).toBe(quotes[0].position);
    expect(after[1].quote).toBe("Bleibt unberührt");

    // Nur die freigegebene, korrigierte Fassung geht in den Export.
    expect((await listApprovedQuotesForExport()).map((row) => row.quote)).toEqual(
      ["Weil ich jetzt weiß, was möglich ist"]
    );
  });

  it("lehnt ein leeres oder unbekanntes Zitat ab", async () => {
    const reportId = await createSeminarReport(
      seed.employee,
      input({ quotes: [{ id: null, quote: "Bleibt" }] })
    );
    const [quote] = await quotesOf(reportId);

    await expect(updateQuoteText(seed.admin, quote.id, "   ")).rejects.toThrow();
    await expect(
      updateQuoteText(seed.admin, "cccccccc-0000-4000-8000-000000000003", "Neu")
    ).rejects.toThrow("Zitat nicht gefunden.");

    expect((await quotesOf(reportId))[0].quote).toBe("Bleibt");
  });
});

describe("Seminarberichte — Zugriffsschutz (IDOR)", () => {
  it("lässt fremde Berichte nicht bearbeiten", async () => {
    const foreignId = await createSeminarReport(
      seed.admin,
      input({ title: "Fremder Bericht" })
    );

    await expect(
      updateSeminarReport(seed.employee, foreignId, input({ title: "Gekapert" }))
    ).rejects.toThrow("Bericht nicht gefunden.");

    const found = await getSeminarReportWithQuotes(foreignId);
    expect(found?.report.title).toBe("Fremder Bericht");
  });

  it("lässt fremde Berichte nicht löschen", async () => {
    const foreignId = await createSeminarReport(seed.admin, input());

    await expect(
      deleteSeminarReport(seed.employee, foreignId)
    ).rejects.toThrow("Bericht nicht gefunden.");

    expect(await getSeminarReportWithQuotes(foreignId)).not.toBeNull();
  });

  it("lässt auch den Admin fremde Berichte nicht löschen", async () => {
    // Der Admin darf korrigieren, aber nicht den Bericht einer anderen Person
    // aus der Welt schaffen.
    const foreignId = await createSeminarReport(seed.employee, input());

    await expect(deleteSeminarReport(seed.admin, foreignId)).rejects.toThrow(
      "Bericht nicht gefunden."
    );

    expect(await getSeminarReportWithQuotes(foreignId)).not.toBeNull();
  });
});

describe("Seminarberichte — Löschen und Export", () => {
  it("löscht die Zitate mit dem Bericht", async () => {
    const reportId = await createSeminarReport(
      seed.employee,
      input({
        quotes: [
          { id: null, quote: "Eins" },
          { id: null, quote: "Zwei" },
        ],
      })
    );
    const [quote] = await quotesOf(reportId);
    await setQuoteWebsiteApproved(seed.admin, quote.id, true);

    await deleteSeminarReport(seed.employee, reportId);

    expect(await getSeminarReportWithQuotes(reportId)).toBeNull();
    expect(await quotesOf(reportId)).toHaveLength(0);
    expect(await listApprovedQuotesForExport()).toHaveLength(0);
  });

  it("exportiert nur freigegebene Zitate samt Kontext", async () => {
    const reportId = await createSeminarReport(
      seed.employee,
      input({
        title: "KI-Grundlagen",
        quotes: [
          { id: null, quote: "Freigegeben" },
          { id: null, quote: "Nicht freigegeben" },
        ],
      })
    );
    const quotes = await quotesOf(reportId);
    const approved = quotes.find((q) => q.quote === "Freigegeben")!;
    await setQuoteWebsiteApproved(seed.admin, approved.id, true);

    const rows = await listApprovedQuotesForExport();
    expect(rows).toEqual([
      {
        quote: "Freigegeben",
        kind: "seminar",
        title: "KI-Grundlagen",
        customerName: "Haufe Akademie",
        eventDate: "2026-05-12",
        userName: "Max Mitarbeiter",
      },
    ]);
  });

  it("nimmt eine zurückgezogene Freigabe wieder aus dem Export", async () => {
    const reportId = await createSeminarReport(
      seed.employee,
      input({ quotes: [{ id: null, quote: "Wackelkandidat" }] })
    );
    const [quote] = await quotesOf(reportId);

    await setQuoteWebsiteApproved(seed.admin, quote.id, true);
    expect(await listApprovedQuotesForExport()).toHaveLength(1);

    await setQuoteWebsiteApproved(seed.admin, quote.id, false);
    expect(await listApprovedQuotesForExport()).toHaveLength(0);
  });
});
