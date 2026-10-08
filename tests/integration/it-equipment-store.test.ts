import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildEquipmentCsv, planEquipmentImport } from "@/lib/it-equipment-csv";
import { getEquipmentExportRows, getImportContext } from "@/lib/it-equipment-store";
import * as schema from "../../src/db/schema";
import { createUser } from "../helpers/actions";
import { resetDb, seedTestData, testDb, type SeedResult } from "../helpers/db";

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

beforeAll(async () => {
  await resetDb();
  seed = await seedTestData();
  const rows = await testDb().select().from(schema.itEquipmentTypes);
  types = Object.fromEntries(rows.map((t) => [t.name, t]));
});

beforeEach(async () => {
  await testDb().delete(schema.itEquipment);
  await testDb().update(schema.itEquipmentTypes).set({ active: true });
});

describe("getImportContext", () => {
  it("liefert Personen, Arten und Geräte mit Aktiv-Kennzeichen", async () => {
    const invited = await createUser({ status: "eingeladen" });
    const inactive = await createUser({ status: "deaktiviert" });
    await testDb()
      .update(schema.itEquipmentTypes)
      .set({ active: false })
      .where(eq(schema.itEquipmentTypes.id, types.Koffer.id));
    const item = await insertEquipment({
      deviceId: "SA-IT-2026-01",
      serialNumber: "SN-1",
      notes: "mit Netzteil",
      returnDate: "2026-09-01",
    });

    const context = await getImportContext();

    // Nur deaktivierte Zugänge gelten als inaktiv, Eingeladene nicht
    expect(context.users).toEqual(
      expect.arrayContaining([
        { id: seed.admin.id, email: seed.admin.email, active: true },
        { id: seed.employee.id, email: seed.employee.email, active: true },
        { id: invited.id, email: invited.email, active: true },
        { id: inactive.id, email: inactive.email, active: false },
      ])
    );
    expect(context.types).toHaveLength(6);
    expect(context.types).toContainEqual({
      id: types.Koffer.id,
      name: "Koffer",
      active: false,
    });
    expect(context.types).toContainEqual({
      id: types.Laptop.id,
      name: "Laptop",
      active: true,
    });
    expect(context.equipment).toEqual([
      {
        id: item.id,
        deviceId: "SA-IT-2026-01",
        userId: seed.employee.id,
        typeId: types.Laptop.id,
        serialNumber: "SN-1",
        notes: "mit Netzteil",
        handoverDate: "2026-08-03",
        returnDate: "2026-09-01",
      },
    ]);
  });

  it("liefert ohne Geräte eine leere Ausstattungsliste", async () => {
    expect((await getImportContext()).equipment).toEqual([]);
  });
});

describe("getEquipmentExportRows", () => {
  it("liefert die Zeilen mit Person und Art, numerisch nach Geräte-ID sortiert", async () => {
    const colleague = await createUser({ firstName: "Clara", lastName: "Kollegin" });
    await insertEquipment({
      deviceId: "SA-IT-2026-10",
      userId: colleague.id,
      typeId: types.Maus.id,
      returnDate: "2026-09-15",
    });
    await insertEquipment({ deviceId: "SA-IT-2026-2", serialNumber: "SN-2", notes: "neu" });
    await insertEquipment({ deviceId: "HANDVERGABE-1" });

    const rows = await getEquipmentExportRows();

    expect(rows.map((r) => r.deviceId)).toEqual([
      "HANDVERGABE-1",
      "SA-IT-2026-2",
      "SA-IT-2026-10",
    ]);
    expect(rows[1]).toEqual({
      deviceId: "SA-IT-2026-2",
      email: seed.employee.email,
      userName: "Max Mitarbeiter",
      typeName: "Laptop",
      serialNumber: "SN-2",
      handoverDate: "2026-08-03",
      returnDate: null,
      notes: "neu",
    });
    expect(rows[2]).toMatchObject({
      email: colleague.email,
      userName: "Clara Kollegin",
      typeName: "Maus",
      returnDate: "2026-09-15",
    });
  });

  it("liefert ohne Geräte eine leere Liste", async () => {
    expect(await getEquipmentExportRows()).toEqual([]);
  });

  it("Export und Import passen zusammen: die exportierte Datei ändert beim Re-Import nichts", async () => {
    const colleague = await createUser();
    await insertEquipment({
      deviceId: "SA-IT-2026-01",
      serialNumber: "C02XL0THJGH5",
      notes: 'MacBook Pro 14"; Hülle',
    });
    await insertEquipment({
      deviceId: "SA-IT-2026-02",
      userId: colleague.id,
      typeId: types.Kopfhörer.id,
      returnDate: "2026-09-30",
    });

    const csv = buildEquipmentCsv(await getEquipmentExportRows());
    const result = planEquipmentImport(csv, await getImportContext());

    expect(result).toEqual({
      ok: true,
      plan: {
        create: [],
        update: [],
        unchanged: ["SA-IT-2026-01", "SA-IT-2026-02"],
        remove: [],
      },
    });
  });
});

