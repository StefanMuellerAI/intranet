/**
 * Integrationstests der Server-Actions für Seminar- und Beratungsberichte.
 *
 * Anders als in Faktura laufen hier auch requireUser()/requireAdmin() innerhalb
 * von runAction(): Eine fehlende Berechtigung kommt deshalb als Ergebnisobjekt
 * mit der generischen Fehlermeldung zurück, nicht als Exception. Ausnahme ist
 * deleteSeminarReportAction, die ohne runAction() arbeitet und wirft.
 */
import { asc, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteSeminarReportAction,
  submitSeminarReport,
  toggleQuoteWebsiteApproval,
  updateQuoteTextAction,
  updateSeminarReportAction,
} from "@/app/(app)/berichte/actions";
import type { SeminarReportInput } from "@/lib/seminar-reports";
import * as schema from "../../../src/db/schema";
import {
  actAs,
  auditFor,
  createUser,
  expectRedirect,
  formData,
  idFromUrl,
} from "../../helpers/actions";
import {
  resetDb,
  seedTestData,
  testDb,
  type SeedResult,
} from "../../helpers/db";
import { nextCacheModule } from "../../helpers/framework-fakes";

let seed: SeedResult;

const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";
const UNEXPECTED_ERROR =
  "Unerwarteter Fehler. Bitte versuchen Sie es später erneut.";

function payload(
  overrides: Partial<SeminarReportInput> = {}
): SeminarReportInput {
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
    quoteQuestion: "Was nehmen Sie aus dem Tag mit?",
    quotes: [],
    ...overrides,
  };
}

/** Formular wie aus bericht-form.tsx: alles steckt im JSON-Feld "payload" */
function reportForm(overrides: Record<string, unknown> = {}) {
  return formData({ payload: JSON.stringify({ ...payload(), ...overrides }) });
}

async function submitAs(
  user: schema.User,
  overrides: Partial<SeminarReportInput> = {}
): Promise<string> {
  await actAs(user);
  const url = await expectRedirect(
    submitSeminarReport(reportForm(overrides)),
    /^\/berichte\/[0-9a-f-]+$/
  );
  return idFromUrl(url);
}

async function loadReport(id: string) {
  return testDb().query.seminarReports.findFirst({
    where: eq(schema.seminarReports.id, id),
  });
}

async function quotesOf(reportId: string) {
  return testDb()
    .select()
    .from(schema.seminarReportQuotes)
    .where(eq(schema.seminarReportQuotes.reportId, reportId))
    .orderBy(asc(schema.seminarReportQuotes.position));
}

async function approve(quoteId: string) {
  await testDb()
    .update(schema.seminarReportQuotes)
    .set({ websiteApproved: true })
    .where(eq(schema.seminarReportQuotes.id, quoteId));
}

/**
 * runAction() protokolliert unerwartete Fehler (hier: fehlende Anmeldung oder
 * Rolle) per console.error — mitschneiden statt die Testausgabe zu fluten.
 */
async function expectLoggedFailure<T>(action: Promise<T>): Promise<T> {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const result = await action;
    expect(consoleError).toHaveBeenCalledWith(
      "Server-Action fehlgeschlagen:",
      expect.any(Error)
    );
    return result;
  } finally {
    consoleError.mockRestore();
  }
}

function expectReportViewsRevalidated(id?: string) {
  for (const path of ["/berichte", "/berichte/alle", "/berichte/zitate"])
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith(path);
  if (id)
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith(
      `/berichte/${id}`
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

describe("submitSeminarReport", () => {
  it("legt Bericht und Zitate an, auditiert und leitet zum Bericht weiter", async () => {
    const id = await submitAs(seed.employee, {
      quotes: [
        { id: null, quote: "Sehr praxisnah." },
        { id: null, quote: "Guter Einstieg." },
      ],
    });

    expect(await loadReport(id)).toMatchObject({
      userId: seed.employee.id,
      kind: "seminar",
      title: "KI-Grundlagen",
      durationDays: 1,
      feedbackRating: 5,
      quoteQuestion: "Was nehmen Sie aus dem Tag mit?",
    });
    const quotes = await quotesOf(id);
    expect(quotes.map((q) => q.quote)).toEqual([
      "Sehr praxisnah.",
      "Guter Einstieg.",
    ]);
    expect(quotes.every((q) => !q.websiteApproved)).toBe(true);
    expect((await auditFor("seminarbericht", id))[0]).toMatchObject({
      action: "erstellt",
      actorUserId: seed.employee.id,
      source: "web",
      details: { titel: "KI-Grundlagen", kunde: "Haufe Akademie", zitate: 2 },
    });
    expectReportViewsRevalidated(id);
  });

  it("speichert halbe Tage und Beratungen", async () => {
    const id = await submitAs(seed.employee, {
      kind: "beratung",
      durationDays: 2.5,
    });
    expect(await loadReport(id)).toMatchObject({
      kind: "beratung",
      durationDays: 2.5,
    });
  });

  it("ordnet den Bericht immer der angemeldeten Person zu", async () => {
    // Untergeschobene Felder im Payload werden vom Schema verworfen
    await actAs(seed.employee);
    const url = await expectRedirect(
      submitSeminarReport(
        reportForm({ userId: seed.admin.id, id: crypto.randomUUID() })
      )
    );
    expect((await loadReport(idFromUrl(url)))?.userId).toBe(seed.employee.id);
  });

  it("lehnt ein fehlendes oder ungültiges Payload ab", async () => {
    await actAs(seed.employee);
    expect(await submitSeminarReport(formData({}))).toEqual({
      ok: false,
      error: "Ungültige Formulardaten.",
    });
    expect(
      await submitSeminarReport(formData({ payload: "{kein json" }))
    ).toEqual({
      ok: false,
      error: "Ungültige Formulardaten.",
    });
    expect(
      await submitSeminarReport(formData({ payload: new Blob(["{}"]) }))
    ).toEqual({ ok: false, error: "Ungültige Formulardaten." });
    expect(await testDb().select().from(schema.seminarReports)).toHaveLength(0);
    expect(nextCacheModule.revalidatePath).not.toHaveBeenCalled();
  });

  it("meldet die erste Zod-Fehlermeldung", async () => {
    await actAs(seed.employee);
    const errorFor = async (overrides: Record<string, unknown>) =>
      submitSeminarReport(reportForm(overrides));

    expect(await errorFor({ feedbackRating: 6 })).toEqual({
      ok: false,
      error: "Das Feedback liegt zwischen 1 und 5.",
    });
    expect(await errorFor({ feedbackRating: null })).toEqual({
      ok: false,
      error: "Bitte das Teilnehmenden-Feedback angeben.",
    });
    expect(await errorFor({ durationDays: 0.3 })).toEqual({
      ok: false,
      error: "Bitte die Dauer in halben Tagen angeben, z. B. 0,5 oder 1,5.",
    });
    expect(await errorFor({ durationDays: 0 })).toEqual({
      ok: false,
      error: "Die Dauer muss größer als 0 sein.",
    });
    expect(await errorFor({ kind: "workshop" })).toEqual({
      ok: false,
      error: "Bitte Seminar oder Beratung wählen.",
    });
    expect(await errorFor({ title: "   " })).toEqual({
      ok: false,
      error: "Bitte den Titel der Veranstaltung angeben.",
    });
    expect(await errorFor({ eventDate: "12.05.2026" })).toEqual({
      ok: false,
      error: "Bitte das Datum der Veranstaltung angeben.",
    });
    expect(
      await errorFor({
        quoteQuestion: "",
        quotes: [{ id: null, quote: "Ohne Frage" }],
      })
    ).toEqual({
      ok: false,
      error:
        "Bitte die Frage angeben, die Sie den Teilnehmenden gestellt haben und auf die die Zitate antworten.",
    });
    expect(
      await errorFor({ quotes: [{ id: null, quote: "x".repeat(1001) }] })
    ).toEqual({
      ok: false,
      error: "Zitate dürfen höchstens 1000 Zeichen lang sein.",
    });
    expect(
      await errorFor({
        quotes: Array.from({ length: 21 }, (_, i) => ({
          id: null,
          quote: `Zitat ${i}`,
        })),
      })
    ).toEqual({
      ok: false,
      error: "Bitte höchstens 20 Zitate je Bericht erfassen.",
    });
    expect(await testDb().select().from(schema.seminarReports)).toHaveLength(0);
  });

  it("verlangt eine Anmeldung", async () => {
    await actAs(null);
    expect(
      await expectLoggedFailure(submitSeminarReport(reportForm()))
    ).toEqual({
      ok: false,
      error: UNEXPECTED_ERROR,
    });
    expect(await testDb().select().from(schema.seminarReports)).toHaveLength(0);
  });
});

describe("updateSeminarReportAction", () => {
  it("lässt die verfassende Person ihren Bericht bearbeiten", async () => {
    const id = await submitAs(seed.employee, {
      quotes: [{ id: null, quote: "Bleibt" }],
    });
    const [quote] = await quotesOf(id);
    nextCacheModule.revalidatePath.mockClear();

    const result = await updateSeminarReportAction(
      id,
      reportForm({
        title: "KI-Grundlagen II",
        feedbackRating: 4,
        quotes: [
          { id: quote.id, quote: "Bleibt" },
          { id: null, quote: "Neu dazu" },
        ],
      })
    );
    expect(result).toEqual({ ok: true, data: null });

    expect(await loadReport(id)).toMatchObject({
      title: "KI-Grundlagen II",
      feedbackRating: 4,
      userId: seed.employee.id,
    });
    expect((await quotesOf(id)).map((q) => q.quote)).toEqual([
      "Bleibt",
      "Neu dazu",
    ]);
    const [audit] = await auditFor("seminarbericht", id);
    expect(audit).toMatchObject({
      action: "aktualisiert",
      actorUserId: seed.employee.id,
    });
    expect(audit.details).toMatchObject({ zitate: 2, zitate_entfernt: 0 });
    expect(audit.details).not.toHaveProperty("als_admin");
    expectReportViewsRevalidated(id);
  });

  it("setzt die Website-Freigabe zurück, wenn Mitarbeitende den Wortlaut ändern", async () => {
    const id = await submitAs(seed.employee, {
      quotes: [{ id: null, quote: "Sehr praxisnah." }],
    });
    const [quote] = await quotesOf(id);
    await approve(quote.id);

    await updateSeminarReportAction(
      id,
      reportForm({ quotes: [{ id: quote.id, quote: "Sehr, sehr praxisnah." }] })
    );

    expect((await quotesOf(id))[0]).toMatchObject({
      id: quote.id,
      quote: "Sehr, sehr praxisnah.",
      websiteApproved: false,
    });
    expect((await auditFor("seminarbericht", id))[0].details).toMatchObject({
      zitate_freigabe_zurueckgesetzt: 1,
    });
  });

  it("lässt den Admin einen fremden Bericht korrigieren — Freigabe bleibt", async () => {
    const id = await submitAs(seed.employee, {
      quotes: [{ id: null, quote: "- 5, weil es praxisnah war" }],
    });
    const [quote] = await quotesOf(id);
    await approve(quote.id);
    await actAs(seed.admin);

    expect(
      await updateSeminarReportAction(
        id,
        reportForm({
          quotes: [{ id: quote.id, quote: "Weil es praxisnah war" }],
        })
      )
    ).toEqual({ ok: true, data: null });

    expect((await loadReport(id))?.userId).toBe(seed.employee.id);
    expect((await quotesOf(id))[0]).toMatchObject({
      quote: "Weil es praxisnah war",
      websiteApproved: true,
    });
    expect((await auditFor("seminarbericht", id))[0]).toMatchObject({
      action: "aktualisiert",
      actorUserId: seed.admin.id,
      details: { als_admin: true, zitate_freigabe_zurueckgesetzt: 0 },
    });
  });

  it("lässt fremde Mitarbeitende den Bericht nicht bearbeiten", async () => {
    const id = await submitAs(seed.employee);
    await actAs(await createUser());
    nextCacheModule.revalidatePath.mockClear();

    expect(
      await updateSeminarReportAction(id, reportForm({ title: "Gekapert" }))
    ).toEqual({ ok: false, error: "Bericht nicht gefunden." });
    expect((await loadReport(id))?.title).toBe("KI-Grundlagen");
    expect(nextCacheModule.revalidatePath).not.toHaveBeenCalled();
  });

  it("meldet unbekannte Berichte", async () => {
    await actAs(seed.employee);
    expect(await updateSeminarReportAction(UNKNOWN_ID, reportForm())).toEqual({
      ok: false,
      error: "Bericht nicht gefunden.",
    });
  });

  it("validiert das Payload wie beim Anlegen", async () => {
    const id = await submitAs(seed.employee);
    expect(await updateSeminarReportAction(id, formData({}))).toEqual({
      ok: false,
      error: "Ungültige Formulardaten.",
    });
    expect(
      await updateSeminarReportAction(id, reportForm({ whatWentWell: "" }))
    ).toEqual({ ok: false, error: "Bitte angeben, was gut lief." });
    expect((await loadReport(id))?.whatWentWell).toBe("Übungen kamen gut an.");
  });

  it("verlangt eine Anmeldung", async () => {
    const id = await submitAs(seed.employee);
    await actAs(null);
    expect(
      await expectLoggedFailure(
        updateSeminarReportAction(id, reportForm({ title: "Anonym" }))
      )
    ).toEqual({ ok: false, error: UNEXPECTED_ERROR });
    expect((await loadReport(id))?.title).toBe("KI-Grundlagen");
  });
});

describe("deleteSeminarReportAction", () => {
  it("löscht den eigenen Bericht samt Zitaten, auditiert und leitet weiter", async () => {
    const id = await submitAs(seed.employee, {
      quotes: [
        { id: null, quote: "Eins" },
        { id: null, quote: "Zwei" },
      ],
    });
    const [first] = await quotesOf(id);
    await approve(first.id);
    nextCacheModule.revalidatePath.mockClear();

    await expectRedirect(deleteSeminarReportAction(id), "/berichte");

    expect(await loadReport(id)).toBeUndefined();
    expect(await quotesOf(id)).toHaveLength(0);
    expect((await auditFor("seminarbericht", id))[0]).toMatchObject({
      action: "geloescht",
      actorUserId: seed.employee.id,
      details: {
        titel: "KI-Grundlagen",
        zitate: 2,
        zitate_website_freigegeben: 1,
      },
    });
    expectReportViewsRevalidated(id);
  });

  it("lässt fremde Mitarbeitende den Bericht nicht löschen", async () => {
    const id = await submitAs(seed.employee);
    await actAs(await createUser());
    await expect(deleteSeminarReportAction(id)).rejects.toThrow(
      "Bericht nicht gefunden."
    );
    expect(await loadReport(id)).toBeDefined();
  });

  it("lässt auch den Admin fremde Berichte nicht löschen", async () => {
    const id = await submitAs(seed.employee, {
      quotes: [{ id: null, quote: "Bleibt" }],
    });
    await actAs(seed.admin);
    await expect(deleteSeminarReportAction(id)).rejects.toThrow(
      "Bericht nicht gefunden."
    );
    expect(await loadReport(id)).toBeDefined();
    expect(await quotesOf(id)).toHaveLength(1);
  });

  it("meldet unbekannte Berichte", async () => {
    await actAs(seed.employee);
    await expect(deleteSeminarReportAction(UNKNOWN_ID)).rejects.toThrow(
      "Bericht nicht gefunden."
    );
  });

  it("verlangt eine Anmeldung", async () => {
    const id = await submitAs(seed.employee);
    await actAs(null);
    await expect(deleteSeminarReportAction(id)).rejects.toThrow(
      "Nicht angemeldet"
    );
    expect(await loadReport(id)).toBeDefined();
  });
});

describe("updateQuoteTextAction", () => {
  it("lässt den Admin den Wortlaut korrigieren — die Freigabe bleibt bestehen", async () => {
    const id = await submitAs(seed.employee, {
      quotes: [
        { id: null, quote: "- 5, weil ich jetzt weiß, was möglich ist" },
        { id: null, quote: "Unberührt" },
      ],
    });
    const [quote, other] = await quotesOf(id);
    await approve(quote.id);
    await actAs(seed.admin);
    nextCacheModule.revalidatePath.mockClear();

    expect(
      await updateQuoteTextAction(
        quote.id,
        formData({ quote: "  Weil ich jetzt weiß, was möglich ist  " })
      )
    ).toEqual({ ok: true, data: null });

    const after = await quotesOf(id);
    expect(after[0]).toMatchObject({
      id: quote.id,
      quote: "Weil ich jetzt weiß, was möglich ist",
      websiteApproved: true,
      position: 0,
    });
    expect(after[1]).toMatchObject({ id: other.id, quote: "Unberührt" });
    expect((await auditFor("seminarbericht", id))[0]).toMatchObject({
      action: "zitat_bearbeitet",
      actorUserId: seed.admin.id,
      details: {
        zitatId: quote.id,
        vorher: "- 5, weil ich jetzt weiß, was möglich ist",
        nachher: "Weil ich jetzt weiß, was möglich ist",
      },
    });
    expectReportViewsRevalidated(id);
  });

  it("schreibt bei unverändertem Wortlaut keinen Audit-Eintrag", async () => {
    const id = await submitAs(seed.employee, {
      quotes: [{ id: null, quote: "Gleich" }],
    });
    const [quote] = await quotesOf(id);
    await actAs(seed.admin);

    expect(
      await updateQuoteTextAction(quote.id, formData({ quote: " Gleich " }))
    ).toEqual({
      ok: true,
      data: null,
    });
    const audits = await auditFor("seminarbericht", id);
    expect(audits.map((a) => a.action)).toEqual(["erstellt"]);
  });

  it("lehnt leere und zu lange Zitate ab", async () => {
    const id = await submitAs(seed.employee, {
      quotes: [{ id: null, quote: "Bleibt" }],
    });
    const [quote] = await quotesOf(id);
    await actAs(seed.admin);

    expect(
      await updateQuoteTextAction(quote.id, formData({ quote: "   " }))
    ).toEqual({
      ok: false,
      error: "Bitte das Zitat eingeben.",
    });
    expect(await updateQuoteTextAction(quote.id, formData({}))).toEqual({
      ok: false,
      error: "Bitte das Zitat eingeben.",
    });
    expect(
      await updateQuoteTextAction(
        quote.id,
        formData({ quote: "x".repeat(1001) })
      )
    ).toEqual({
      ok: false,
      error: "Zitate dürfen höchstens 1000 Zeichen lang sein.",
    });
    expect((await quotesOf(id))[0].quote).toBe("Bleibt");
  });

  it("akzeptiert genau 1000 Zeichen", async () => {
    const id = await submitAs(seed.employee, {
      quotes: [{ id: null, quote: "Kurz" }],
    });
    const [quote] = await quotesOf(id);
    await actAs(seed.admin);
    expect(
      await updateQuoteTextAction(
        quote.id,
        formData({ quote: "x".repeat(1000) })
      )
    ).toEqual({ ok: true, data: null });
  });

  it("meldet unbekannte Zitate", async () => {
    await actAs(seed.admin);
    expect(
      await updateQuoteTextAction(UNKNOWN_ID, formData({ quote: "Neu" }))
    ).toEqual({
      ok: false,
      error: "Zitat nicht gefunden.",
    });
  });

  it("ist nur für den Admin zulässig — auch nicht für die verfassende Person", async () => {
    const id = await submitAs(seed.employee, {
      quotes: [{ id: null, quote: "Original" }],
    });
    const [quote] = await quotesOf(id);
    nextCacheModule.revalidatePath.mockClear();

    // requireAdmin() läuft innerhalb von runAction() → generische Meldung
    expect(
      await expectLoggedFailure(
        updateQuoteTextAction(quote.id, formData({ quote: "Geändert" }))
      )
    ).toEqual({ ok: false, error: UNEXPECTED_ERROR });
    expect((await quotesOf(id))[0].quote).toBe("Original");
    expect(nextCacheModule.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("toggleQuoteWebsiteApproval", () => {
  it("gibt ein Zitat für die Website frei und zieht die Freigabe wieder zurück", async () => {
    const id = await submitAs(seed.employee, {
      quotes: [{ id: null, quote: "Top" }],
    });
    const [quote] = await quotesOf(id);
    await actAs(seed.admin);
    nextCacheModule.revalidatePath.mockClear();

    expect(await toggleQuoteWebsiteApproval(quote.id, true)).toEqual({
      ok: true,
      data: null,
    });
    expect((await quotesOf(id))[0].websiteApproved).toBe(true);
    expect((await auditFor("seminarbericht", id))[0]).toMatchObject({
      action: "zitat_website_freigegeben",
      actorUserId: seed.admin.id,
      details: { zitatId: quote.id },
    });
    expectReportViewsRevalidated();

    expect(await toggleQuoteWebsiteApproval(quote.id, false)).toEqual({
      ok: true,
      data: null,
    });
    expect((await quotesOf(id))[0].websiteApproved).toBe(false);
    expect((await auditFor("seminarbericht", id))[0].action).toBe(
      "zitat_website_freigabe_zurueckgezogen"
    );
  });

  it("ist nur für den Admin zulässig", async () => {
    const id = await submitAs(seed.employee, {
      quotes: [{ id: null, quote: "Top" }],
    });
    const [quote] = await quotesOf(id);
    nextCacheModule.revalidatePath.mockClear();

    expect(
      await expectLoggedFailure(toggleQuoteWebsiteApproval(quote.id, true))
    ).toEqual({ ok: false, error: UNEXPECTED_ERROR });
    expect((await quotesOf(id))[0].websiteApproved).toBe(false);
    expect(nextCacheModule.revalidatePath).not.toHaveBeenCalled();
  });

  it("meldet unbekannte Zitate", async () => {
    await actAs(seed.admin);
    expect(await toggleQuoteWebsiteApproval(UNKNOWN_ID, true)).toEqual({
      ok: false,
      error: "Zitat nicht gefunden.",
    });
    expect(await auditFor("seminarbericht")).toHaveLength(0);
  });
});
