import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as getEquipmentExport } from "@/app/api/exports/it-ausstattung/route";
import { GET as getProtocol } from "@/app/api/exports/it-protokoll/route";
import { toISODate } from "@/lib/dates";
import * as schema from "../../../src/db/schema";
import { actAs, auditFor, createUser } from "../../helpers/actions";
import { resetDb, seedTestData, testDb, type SeedResult } from "../../helpers/db";

// Klassisches pdf-parse (1.x) wie im Unit-Test des PDF-Renderers
const nodeRequire = createRequire(import.meta.url);
const parsePdf = nodeRequire("pdf-parse/lib/pdf-parse.js") as (
  data: Buffer
) => Promise<{ text: string }>;

let seed: SeedResult;
let types: Record<string, schema.ItEquipmentType>;

async function insertEquipment(
  values: Partial<typeof schema.itEquipment.$inferInsert> & { deviceId: string }
) {
  const [row] = await testDb()
    .insert(schema.itEquipment)
    .values({
      userId: seed.employee.id,
      typeId: types.Laptop.id,
      handoverDate: "2026-08-03",
      createdById: seed.admin.id,
      ...values,
    })
    .returning();
  return row;
}

function protocolRequest(params: Record<string, string>) {
  return new Request(
    `http://localhost/api/exports/it-protokoll?${new URLSearchParams(params)}`
  );
}

async function protocolText(res: Response) {
  return (await parsePdf(Buffer.from(await res.arrayBuffer()))).text;
}

beforeAll(async () => {
  await resetDb();
  seed = await seedTestData();
  const rows = await testDb().select().from(schema.itEquipmentTypes);
  types = Object.fromEntries(rows.map((t) => [t.name, t]));
});

beforeEach(async () => {
  const db = testDb();
  await db.delete(schema.itEquipment);
  await db.delete(schema.auditLog);
});

describe("GET /api/exports/it-ausstattung", () => {
  it("verweigert Mitarbeitenden und Abgemeldeten den Export", async () => {
    await insertEquipment({ deviceId: "SA-IT-2026-01" });

    await actAs(seed.employee);
    const res = await getEquipmentExport();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ fehler: "Nur für den Admin." });

    await actAs(null);
    expect((await getEquipmentExport()).status).toBe(403);
    expect(await auditFor("it_ausstattung")).toHaveLength(0);
  });

  it("liefert die Liste als Excel-taugliche CSV mit BOM und auditiert den Abruf", async () => {
    const colleague = await createUser({
      email: "clara.kollegin@stefanai.de",
      firstName: "Clara",
      lastName: "Kollegin",
    });
    await insertEquipment({
      deviceId: "SA-IT-2026-10",
      userId: colleague.id,
      typeId: types.Maus.id,
      handoverDate: "2026-07-01",
      returnDate: "2026-09-15",
    });
    await insertEquipment({
      deviceId: "SA-IT-2026-9",
      serialNumber: "C02XL0THJGH5",
      notes: 'MacBook Pro 14"; mit Hülle',
    });
    await actAs(seed.admin);

    const res = await getEquipmentExport();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="IT-Ausstattung_${toISODate(new Date())}.csv"`
    );
    expect(res.headers.get("cache-control")).toBe("private, no-store");

    const bytes = Buffer.from(await res.arrayBuffer());
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const lines = bytes.subarray(3).toString("utf8").split("\r\n");
    expect(lines).toEqual([
      "Geräte-ID;Geräte-ID neu (optional);Mitarbeiter-E-Mail;Mitarbeiter/in (nur Info);Ausstattungsart;Seriennummer;Übernahme am;Rückgabe am;Zusatzinformationen;Status (nur Info)",
      // numerische Sortierung: 9 vor 10
      `"SA-IT-2026-9";"";"${seed.employee.email}";"Max Mitarbeiter";"Laptop";"C02XL0THJGH5";"03.08.2026";"";"MacBook Pro 14""; mit Hülle";"im Einsatz"`,
      `"SA-IT-2026-10";"";"clara.kollegin@stefanai.de";"Clara Kollegin";"Maus";"";"01.07.2026";"15.09.2026";"";"zurückgegeben"`,
    ]);

    const audit = await auditFor("it_ausstattung");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "exportiert",
      objectId: null,
      actorUserId: seed.admin.id,
      actorLabel: "Erika Admin",
      source: "web",
      details: { geraete: 2 },
    });
  });

  it("liefert ohne Ausstattung nur die Kopfzeile", async () => {
    await actAs(seed.admin);
    const res = await getEquipmentExport();
    expect(res.status).toBe(200);
    const text = Buffer.from(await res.arrayBuffer()).subarray(3).toString("utf8");
    expect(text.split("\r\n")).toHaveLength(1);
    expect((await auditFor("it_ausstattung"))[0].details).toEqual({ geraete: 0 });
  });
});

describe("GET /api/exports/it-protokoll", () => {
  it("verweigert Mitarbeitenden und Abgemeldeten die Vorlage", async () => {
    await insertEquipment({ deviceId: "SA-IT-2026-01" });
    const req = () => protocolRequest({ art: "uebergabe", mitarbeiter: seed.employee.id });

    await actAs(seed.employee);
    const res = await getProtocol(req());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ fehler: "Nur für den Admin." });

    await actAs(null);
    expect((await getProtocol(req())).status).toBe(403);
    expect(await auditFor("it_ausstattung")).toHaveLength(0);
  });

  it("lehnt unbekannte Protokollarten mit 400 ab — vor der Personensuche", async () => {
    await actAs(seed.admin);
    const cases: Record<string, string>[] = [
      { art: "quittung", mitarbeiter: seed.employee.id },
      { mitarbeiter: seed.employee.id },
      { art: "quittung", mitarbeiter: randomUUID() },
    ];
    for (const params of cases) {
      const res = await getProtocol(protocolRequest(params));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ fehler: "Unbekannte Protokollart." });
    }
  });

  it("meldet unbekannte Personen mit 404 — auch bei Nicht-UUIDs", async () => {
    await actAs(seed.admin);
    for (const mitarbeiter of [randomUUID(), "keine-uuid", ""]) {
      const res = await getProtocol(protocolRequest({ art: "uebergabe", mitarbeiter }));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ fehler: "Mitarbeiter/in nicht gefunden." });
    }
  });

  it("verweigert die Übergabe, wenn nichts im Einsatz ist", async () => {
    await insertEquipment({ deviceId: "SA-IT-2026-01", returnDate: "2026-09-01" });
    await actAs(seed.admin);

    const res = await getProtocol(
      protocolRequest({ art: "uebergabe", mitarbeiter: seed.employee.id })
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      fehler: "Für Max Mitarbeiter ist keine Ausstattung im Einsatz.",
    });
    expect(await auditFor("it_ausstattung")).toHaveLength(0);
  });

  it("verweigert die Rücknahme, wenn gar nichts erfasst ist", async () => {
    await actAs(seed.admin);
    const res = await getProtocol(
      protocolRequest({ art: "ruecknahme", mitarbeiter: seed.employee.id })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      fehler: "Für Max Mitarbeiter ist keine Ausstattung erfasst.",
    });
  });

  it("Übergabe: listet nur die Ausstattung im Einsatz und auditiert", async () => {
    const colleague = await createUser();
    await insertEquipment({ deviceId: "SA-IT-2026-02", serialNumber: "SN-ZWEI" });
    await insertEquipment({
      deviceId: "SA-IT-2026-01",
      typeId: types.Maus.id,
      handoverDate: "2026-07-15",
    });
    await insertEquipment({ deviceId: "SA-IT-2026-03", returnDate: "2026-09-01" });
    await insertEquipment({ deviceId: "SA-IT-2026-04", userId: colleague.id });
    await actAs(seed.admin);

    const res = await getProtocol(
      protocolRequest({ art: "uebergabe", mitarbeiter: seed.employee.id })
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="Uebergabeprotokoll_Max-Mitarbeiter_${toISODate(new Date())}.pdf"`
    );
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("private, no-store");

    const text = await protocolText(res);
    expect(text).toContain("Übergabeprotokoll");
    expect(text).toContain("Max Mitarbeiter");
    expect(text).toContain("2 Positionen");
    expect(text).toContain("SA-IT-2026-01");
    expect(text).toContain("SA-IT-2026-02");
    expect(text).toContain("SN-ZWEI");
    expect(text).toContain("15.07.2026");
    expect(text).not.toContain("SA-IT-2026-03");
    expect(text).not.toContain("SA-IT-2026-04");
    expect(text).not.toContain("Rückgabe");

    const audit = await auditFor("it_ausstattung");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "protokoll_erstellt",
      objectId: null,
      actorUserId: seed.admin.id,
      source: "web",
      details: { userId: seed.employee.id, art: "uebergabe", geraete: 2 },
    });
  });

  it("Rücknahme: listet alle Geräte mit erfassten Rückgabedaten und Leerfeldern", async () => {
    await insertEquipment({ deviceId: "SA-IT-2026-01", returnDate: "2026-09-15" });
    await insertEquipment({ deviceId: "SA-IT-2026-02", typeId: types.Maus.id });
    await insertEquipment({ deviceId: "SA-IT-2026-03", returnDate: "2026-09-20" });
    await actAs(seed.admin);

    const res = await getProtocol(
      protocolRequest({ art: "ruecknahme", mitarbeiter: seed.employee.id })
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="Ruecknahmeprotokoll_Max-Mitarbeiter_${toISODate(new Date())}.pdf"`
    );
    const text = await protocolText(res);
    expect(text).toContain("Rücknahmeprotokoll");
    expect(text).toContain("3 Positionen");
    expect(text).toContain("Rückgabe am");
    for (const id of ["SA-IT-2026-01", "SA-IT-2026-02", "SA-IT-2026-03"])
      expect(text).toContain(id);
    expect(text).toContain("15.09.2026");
    expect(text).toContain("20.09.2026");
    // Offene Rückgabe: Feld zum Handausfüllen plus Hinweis
    expect(text).toContain("____________");
    expect(text).toContain("handschriftlich ergänzt");

    expect((await auditFor("it_ausstattung"))[0].details).toEqual({
      userId: seed.employee.id,
      art: "ruecknahme",
      geraete: 3,
    });
  });

  it("erstellt die Rücknahme auch für deaktivierte Personen", async () => {
    const leaver = await createUser({
      firstName: "Jörg",
      lastName: "Weg",
      status: "deaktiviert",
    });
    await insertEquipment({ deviceId: "SA-IT-2026-01", userId: leaver.id });
    await actAs(seed.admin);

    const res = await getProtocol(
      protocolRequest({ art: "ruecknahme", mitarbeiter: leaver.id })
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain(
      "Ruecknahmeprotokoll_Joerg-Weg_"
    );
    expect(await protocolText(res)).toContain("1 Position");
  });
});
