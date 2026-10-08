/**
 * Integrationstests der Faktura-Routen: CSV-Rohdatenexport, Download
 * archivierter Stundenzettel und die Admin-API zur Wochenfreigabe.
 *
 * „Jetzt" ist über FAKTURA_TEST_NOW fixiert: Freitag, 24.07.2026 (KW 30/2026).
 * KW 29 und älter sind abgeschlossen.
 */
import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as exportFaktura } from "@/app/api/exports/faktura/route";
import { GET as downloadTimesheet } from "@/app/api/faktura/stundenzettel/[id]/route";
import { GET as getFreigaben } from "@/app/api/v1/faktura/freigaben/route";
import { POST as postFreigeben } from "@/app/api/v1/faktura/freigaben/freigeben/route";
import { generateTimesheet } from "@/lib/faktura/stundenzettel";
import * as schema from "../../../src/db/schema";
import { actAs, auditFor, createUser } from "../../helpers/actions";
import {
  createTestApiKey,
  resetDb,
  seedTestData,
  testDb,
  type SeedResult,
} from "../../helpers/db";
import { failingBlobUrls, storeBlob } from "../../helpers/framework-fakes";

let seed: SeedResult;
let customer: schema.FakturaCustomer;
let project: schema.FakturaProject;

const TODAY = "2026-07-24";
const KW29_MONDAY = "2026-07-13";
const KW29_FRIDAY = "2026-07-17";
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

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
      revokeReason: status === "widerrufen" ? "Nachtrag" : null,
    });
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
  await db.delete(schema.fakturaTimesheets);
  await db.delete(schema.fakturaTimeEntries);
  await db.delete(schema.fakturaWeekApprovals);
  await db.delete(schema.fakturaProjects);
  await db.delete(schema.fakturaCustomers);
  await db.delete(schema.auditLog);
  await db.delete(schema.apiKeys);
  [customer] = await db
    .insert(schema.fakturaCustomers)
    .values({ name: "ACME GmbH" })
    .returning();
  [project] = await db
    .insert(schema.fakturaProjects)
    .values({ customerId: customer.id, name: "Website-Relaunch" })
    .returning();
});

// ---------------------------------------------------------------------------
// GET /api/exports/faktura
// ---------------------------------------------------------------------------

describe("GET /api/exports/faktura", () => {
  function exportRequest(params: Record<string, string>) {
    const url = new URL("http://localhost/api/exports/faktura");
    for (const [key, value] of Object.entries(params))
      url.searchParams.set(key, value);
    return new Request(url);
  }

  function julyParams(overrides: Record<string, string> = {}) {
    return {
      kunde: customer.id,
      von: "2026-07-01",
      bis: "2026-07-31",
      ...overrides,
    };
  }

  it("verweigert den Export ohne Session und für Mitarbeitende (403)", async () => {
    await actAs(null);
    const anonymous = await exportFaktura(exportRequest(julyParams()));
    expect(anonymous.status).toBe(403);
    expect(await anonymous.json()).toEqual({ fehler: "Nur für den Admin." });

    await actAs(seed.employee);
    expect((await exportFaktura(exportRequest(julyParams()))).status).toBe(403);
  });

  it("prüft die Parameter (400)", async () => {
    await actAs(seed.admin);
    const cases: Record<string, string>[] = [
      { von: "2026-07-01", bis: "2026-07-31" },
      julyParams({ kunde: "acme" }),
      { kunde: customer.id, bis: "2026-07-31" },
      { kunde: customer.id, von: "2026-07-01" },
      julyParams({ von: "01.07.2026" }),
      julyParams({ bis: "2026-02-30" }),
      julyParams({ von: "2026-07-31", bis: "2026-07-01" }),
    ];
    for (const params of cases) {
      const res = await exportFaktura(exportRequest(params));
      expect(res.status, JSON.stringify(params)).toBe(400);
      expect(await res.json()).toEqual({
        fehler:
          "Parameter 'kunde' (UUID), 'von' und 'bis' (YYYY-MM-DD) erforderlich.",
      });
    }
  });

  it("meldet einen unbekannten Kunden mit 404", async () => {
    await actAs(seed.admin);
    const res = await exportFaktura(
      exportRequest(julyParams({ kunde: UNKNOWN_ID }))
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ fehler: "Kunde nicht gefunden." });
  });

  it("liefert die Rohdaten als CSV inkl. ausgeblendeter und gelöschter Buchungen", async () => {
    const other = await createUser({ firstName: "Ola", lastName: "Andere" });
    const visible = await insertEntry({
      entryDate: "2026-07-20",
      durationMinutes: 75,
      description: 'Workshop "KI"; Teil 1',
      status: "freigegeben",
      overbooked: true,
    });
    const hidden = await insertEntry({
      userId: other.id,
      entryDate: "2026-07-21",
      description: "Ausgeblendet",
      visibleOnTimesheet: false,
    });
    const deleted = await insertEntry({
      entryDate: "2026-07-22",
      description: "Gelöscht",
      deleted: true,
    });
    // Außerhalb des Zeitraums bzw. anderer Kunde → nicht im Export
    await insertEntry({ entryDate: "2026-06-30", description: "Juni" });
    const [beta] = await testDb()
      .insert(schema.fakturaCustomers)
      .values({ name: "Beta AG" })
      .returning();
    const [betaProject] = await testDb()
      .insert(schema.fakturaProjects)
      .values({ customerId: beta.id, name: "Schulung" })
      .returning();
    await insertEntry({ projectId: betaProject.id, description: "Fremdkunde" });
    await actAs(seed.admin);

    const res = await exportFaktura(exportRequest(julyParams()));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toMatch(
      /^attachment; filename="Faktura_ACME-GmbH_2026-07\.csv"/
    );

    const csv = await csvText(res);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split("\r\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe(
      "Datum;Kalenderwoche;Mitarbeiter/in;Kunde;Projekt;Tätigkeit;Dauer (h);Status;Im Stundenzettel sichtbar;Überbuchung;Gelöscht;Erstellt am;Zuletzt geändert am;Buchungs-ID"
    );
    expect(lines[1]).toBe(
      [
        "20.07.2026",
        "KW 30/2026",
        "Max Mitarbeiter",
        "ACME GmbH",
        "Website-Relaunch",
        'Workshop ""KI""; Teil 1',
        "1,25",
        "freigegeben",
        "ja",
        "ja",
        "nein",
        visible.createdAt.toISOString(),
        visible.updatedAt.toISOString(),
        visible.id,
      ]
        .map((v) => `"${v}"`)
        .join(";")
    );
    expect(lines[2]).toContain(
      `"Ola Andere";"ACME GmbH";"Website-Relaunch";"Ausgeblendet"`
    );
    expect(lines[2]).toContain(`"offen";"nein (ausgeblendet)";"nein";"nein"`);
    expect(lines[2]).toContain(hidden.id);
    expect(lines[3]).toContain(`"Gelöscht"`);
    expect(lines[3]).toContain(`"ja";"nein";"ja (soft-delete)"`);
    expect(lines[3]).toContain(deleted.id);
    expect(csv).not.toContain("Juni");
    expect(csv).not.toContain("Fremdkunde");
  });

  it("benennt die Datei bei freiem Zeitraum mit von_bis", async () => {
    await insertEntry();
    await actAs(seed.admin);
    const res = await exportFaktura(
      exportRequest(julyParams({ von: "2026-07-20", bis: TODAY }))
    );
    expect(res.headers.get("content-disposition")).toMatch(
      /^attachment; filename="Faktura_ACME-GmbH_2026-07-20_2026-07-24\.csv"/
    );
  });

  it("liefert für einen Kunden ohne Buchungen nur die Kopfzeile", async () => {
    await actAs(seed.admin);
    const res = await exportFaktura(exportRequest(julyParams()));
    expect(res.status).toBe(200);
    const csv = await csvText(res);
    expect(csv.slice(1).split("\r\n")).toHaveLength(1);
    // Ohne Zeilen fällt der Dateiname auf „Export" statt des Kundennamens zurück
    expect(res.headers.get("content-disposition")).toMatch(
      /^attachment; filename="Faktura_Export_2026-07\.csv"/
    );
  });
});

// ---------------------------------------------------------------------------
// GET /api/faktura/stundenzettel/[id]
// ---------------------------------------------------------------------------

describe("GET /api/faktura/stundenzettel/[id]", () => {
  function download(id: string) {
    return downloadTimesheet(
      new Request(`http://localhost/api/faktura/stundenzettel/${id}`),
      { params: Promise.resolve({ id }) }
    );
  }

  async function insertTimesheet(blobUrl: string) {
    const [row] = await testDb()
      .insert(schema.fakturaTimesheets)
      .values({
        customerId: customer.id,
        periodFrom: KW29_MONDAY,
        periodTo: KW29_FRIDAY,
        docNumber: "SZ-2026-0042",
        version: 3,
        filename: "Stundenzettel_ACME-GmbH_2026-07-13_2026-07-17_v3.pdf",
        blobUrl,
        sha256: "a".repeat(64),
        createdById: seed.admin.id,
      })
      .returning();
    return row;
  }

  it("verweigert den Download ohne Session und für Mitarbeitende (403)", async () => {
    const sheet = await insertTimesheet("data:application/pdf;base64,JVBERi0=");
    await actAs(null);
    const anonymous = await download(sheet.id);
    expect(anonymous.status).toBe(403);
    expect(await anonymous.json()).toEqual({ fehler: "Nur für den Admin." });

    await actAs(seed.employee);
    expect((await download(sheet.id)).status).toBe(403);
  });

  it("meldet unbekannte Stundenzettel mit 404", async () => {
    await actAs(seed.admin);
    const res = await download(UNKNOWN_ID);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      fehler: "Stundenzettel nicht gefunden.",
    });
  });

  it("meldet auch eine ID, die keine UUID ist, mit 404", async () => {
    await actAs(seed.admin);
    expect((await download("kein-uuid")).status).toBe(404);
  });

  it("liefert ein erzeugtes PDF (data-URL) mit Metadaten aus", async () => {
    await insertEntry({ entryDate: KW29_MONDAY, status: "freigegeben" });
    const { timesheet } = await generateTimesheet(seed.admin, {
      customerId: customer.id,
      fromISO: KW29_MONDAY,
      toISO: KW29_FRIDAY,
    });
    await actAs(seed.admin);

    const res = await download(timesheet.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain(
      `filename="${timesheet.filename}"`
    );
    expect(res.headers.get("x-dokumentnummer")).toBe(timesheet.docNumber);
    expect(res.headers.get("x-version")).toBe("1");
    expect(res.headers.get("x-sha256")).toBe(timesheet.sha256);
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("reicht ein PDF aus dem Blob-Speicher durch", async () => {
    const url = await storeBlob(
      "stundenzettel/SZ-2026-0042_v3-abc.pdf",
      "%PDF-1.4 Blob",
      "application/pdf"
    );
    const sheet = await insertTimesheet(url);
    await actAs(seed.admin);

    const res = await download(sheet.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-dokumentnummer")).toBe("SZ-2026-0042");
    expect(res.headers.get("x-version")).toBe("3");
    expect(await res.text()).toBe("%PDF-1.4 Blob");
  });

  it("meldet einen Blob-Fehler mit 502", async () => {
    const url = await storeBlob(
      "stundenzettel/SZ-2026-0042_v3-def.pdf",
      "%PDF-1.4",
      "application/pdf"
    );
    failingBlobUrls.add(url);
    const sheet = await insertTimesheet(url);
    await actAs(seed.admin);

    const res = await download(sheet.id);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      fehler: "PDF konnte nicht geladen werden.",
    });
  });

  it("meldet einen fehlenden Blob mit 502", async () => {
    const url = await storeBlob(
      "stundenzettel/weg.pdf",
      "%PDF-1.4",
      "application/pdf"
    );
    const sheet = await insertTimesheet(url.replace("weg.pdf", "nie-da.pdf"));
    await actAs(seed.admin);
    expect((await download(sheet.id)).status).toBe(502);
  });
});

// ---------------------------------------------------------------------------
// Admin-API /api/v1/faktura/freigaben (Ergänzungen zu faktura.test.ts)
// ---------------------------------------------------------------------------

describe("GET /api/v1/faktura/freigaben", () => {
  function listRequest(key?: string, query = "") {
    return new Request(`http://localhost/api/v1/faktura/freigaben${query}`, {
      headers: key ? { authorization: `Bearer ${key}` } : {},
    });
  }

  it("lehnt eine fehlende oder unplausible Jahresangabe ab (400)", async () => {
    const { key } = await createTestApiKey(seed.admin.id, "Lesen", "readonly");
    for (const query of ["?kw=29", "?jahr=&kw=29", "?jahr=0&kw=29"])
      expect((await getFreigaben(listRequest(key, query))).status, query).toBe(400);
  });

  it("lehnt einen JSON-Body null ab (400 statt 500)", async () => {
    const { key } = await createTestApiKey(seed.admin.id);
    const res = await postFreigeben(
      new Request("http://localhost/api/v1/faktura/freigaben/freigeben", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: "null",
      })
    );
    expect(res.status).toBe(400);
  });

  it("verlangt einen gültigen API-Key (401)", async () => {
    expect((await getFreigaben(listRequest())).status).toBe(401);
    const res = await getFreigaben(listRequest("sk_test_unbekannt"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ fehler: "Ungültiger API-Key." });
  });

  it("lehnt Website-Keys ab (403)", async () => {
    const { key } = await createTestApiKey(seed.admin.id, "Website", "website");
    expect((await getFreigaben(listRequest(key))).status).toBe(403);
  });

  it("liefert die Wochenliste auch mit einem Lese-Key inkl. aller Status", async () => {
    // KW 30 offen, KW 29 widerrufen, KW 28 leer, KW 27 freigegeben,
    // KW 26 nur mit gelöschter Buchung → leer
    await insertEntry({
      entryDate: TODAY,
      durationMinutes: 90,
      overbooked: true,
    });
    await insertEntry({ entryDate: KW29_MONDAY, durationMinutes: 60 });
    await insertApproval(29, "widerrufen");
    await insertEntry({ entryDate: "2026-06-29", status: "freigegeben" });
    await insertApproval(27, "freigegeben");
    await insertEntry({ entryDate: "2026-06-22", deleted: true });
    const { key } = await createTestApiKey(seed.admin.id, "Lesen", "readonly");

    const res = await getFreigaben(listRequest(key));
    expect(res.status).toBe(200);
    const { wochen } = await res.json();
    expect(wochen).toHaveLength(8);
    expect(wochen.slice(0, 5)).toEqual([
      {
        jahr: 2026,
        kw: 30,
        montag: "2026-07-20",
        freitag: "2026-07-24",
        abgeschlossen: false,
        status: "offen",
        anzahlBuchungen: 1,
        summeStunden: "1,50",
        ueberbuchungen: 1,
      },
      expect.objectContaining({
        kw: 29,
        status: "widerrufen",
        abgeschlossen: true,
      }),
      expect.objectContaining({ kw: 28, status: "leer", anzahlBuchungen: 0 }),
      expect.objectContaining({
        kw: 27,
        status: "freigegeben",
        summeStunden: "1,00",
      }),
      expect.objectContaining({ kw: 26, status: "leer", anzahlBuchungen: 0 }),
    ]);
  });

  it("liefert die Detailansicht mit Status „leer“ und „widerrufen“", async () => {
    await insertEntry({ entryDate: KW29_MONDAY, description: "Nachtrag" });
    await insertApproval(29, "widerrufen");
    const { key } = await createTestApiKey(seed.admin.id, "Lesen", "readonly");

    const revoked = await (
      await getFreigaben(listRequest(key, "?jahr=2026&kw=29"))
    ).json();
    expect(revoked).toMatchObject({
      jahr: 2026,
      kw: 29,
      montag: KW29_MONDAY,
      freitag: KW29_FRIDAY,
      abgeschlossen: true,
      status: "widerrufen",
      summeStunden: "1,00",
    });
    expect(revoked.kunden[0].projekte[0]).toMatchObject({
      projekt: "ACME GmbH – Website-Relaunch",
      monatslimitStunden: null,
      buchungen: [
        expect.objectContaining({
          datum: KW29_MONDAY,
          mitarbeiter: "Max Mitarbeiter",
          taetigkeit: "Nachtrag",
          stunden: "1,00",
          status: "offen",
          sichtbarImStundenzettel: true,
          ueberbuchung: false,
        }),
      ],
    });

    const empty = await (
      await getFreigaben(listRequest(key, "?jahr=2026&kw=28"))
    ).json();
    expect(empty).toMatchObject({
      kw: 28,
      status: "leer",
      summeStunden: "0,00",
      kunden: [],
    });
  });

  it("lehnt unvollständige oder ungültige Wochenangaben ab (400)", async () => {
    const { key } = await createTestApiKey(seed.admin.id, "Lesen", "readonly");
    for (const query of [
      "?jahr=2026",
      "?jahr=2026&kw=0",
      "?jahr=2026&kw=2.5",
      "?jahr=abc&kw=29",
    ])
      expect((await getFreigaben(listRequest(key, query))).status, query).toBe(
        400
      );
  });
});

describe("POST /api/v1/faktura/freigaben/freigeben", () => {
  function approveRequest(body: unknown, key?: string) {
    return new Request("http://localhost/api/v1/faktura/freigaben/freigeben", {
      method: "POST",
      headers: key ? { authorization: `Bearer ${key}` } : {},
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  it("verlangt einen API-Key (401)", async () => {
    await insertEntry({ entryDate: KW29_MONDAY });
    const res = await postFreigeben(approveRequest({ jahr: 2026, kw: 29 }));
    expect(res.status).toBe(401);
    expect(
      await testDb().select().from(schema.fakturaWeekApprovals)
    ).toHaveLength(0);
  });

  it("lehnt Lese-Keys ab (403)", async () => {
    await insertEntry({ entryDate: KW29_MONDAY });
    const { key } = await createTestApiKey(seed.admin.id, "Lesen", "readonly");
    const res = await postFreigeben(
      approveRequest({ jahr: 2026, kw: 29 }, key)
    );
    expect(res.status).toBe(403);
    expect((await res.json()).fehler).toContain("Nur lesen");
    expect(
      await testDb().select().from(schema.fakturaWeekApprovals)
    ).toHaveLength(0);
  });

  it("lehnt gültiges JSON ohne gültige Jahr/KW-Angabe ab (400)", async () => {
    const { key } = await createTestApiKey(seed.admin.id);
    for (const body of [
      {},
      { jahr: 2026 },
      { kw: 29 },
      { jahr: 2026, kw: 54 },
      { jahr: 2026, kw: 0 },
      { jahr: 2026.5, kw: 29 },
      { jahr: "zwanzig", kw: 29 },
      { jahr: null, kw: 29 },
      { jahr: "", kw: 29 },
      { jahr: 0, kw: 29 },
    ]) {
      const res = await postFreigeben(approveRequest(body, key));
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await res.json()).toEqual({
        fehler: "Body benötigt 'jahr' und 'kw' als Zahlen.",
      });
    }
  });

  it("lehnt leere und bereits freigegebene Wochen ab (409)", async () => {
    const { key } = await createTestApiKey(seed.admin.id);

    const empty = await postFreigeben(
      approveRequest({ jahr: 2026, kw: 28 }, key)
    );
    expect(empty.status).toBe(409);
    expect((await empty.json()).fehler).toContain("keine Buchungen");

    await insertEntry({ entryDate: KW29_MONDAY, status: "freigegeben" });
    await insertApproval(29, "freigegeben");
    const twice = await postFreigeben(
      approveRequest({ jahr: 2026, kw: 29 }, key)
    );
    expect(twice.status).toBe(409);
    expect(await twice.json()).toEqual({
      fehler: "Diese Woche ist bereits freigegeben.",
    });
  });

  it("gibt frei und vermerkt den API-Key im Audit", async () => {
    const entry = await insertEntry({ entryDate: KW29_MONDAY });
    const { key, id: apiKeyId } = await createTestApiKey(seed.admin.id);

    const res = await postFreigeben(
      approveRequest({ jahr: 2026, kw: 29 }, key)
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      jahr: 2026,
      kw: 29,
      status: "freigegeben",
    });

    const approval = await testDb().query.fakturaWeekApprovals.findFirst({
      where: and(
        eq(schema.fakturaWeekApprovals.isoYear, 2026),
        eq(schema.fakturaWeekApprovals.isoWeek, 29)
      ),
    });
    expect(approval).toMatchObject({
      status: "freigegeben",
      approvedById: seed.admin.id,
    });
    const [row] = await testDb()
      .select()
      .from(schema.fakturaTimeEntries)
      .where(eq(schema.fakturaTimeEntries.id, entry.id));
    expect(row.status).toBe("freigegeben");
    expect((await auditFor("faktura_freigabe"))[0]).toMatchObject({
      action: "woche_freigegeben",
      source: "api",
      apiKeyId,
      actorUserId: seed.admin.id,
    });
  });
});
