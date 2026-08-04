/**
 * Datenbankzugriffe für den CSV-Austausch des IT-Managements. Export und
 * Import teilen sich die Ladelogik, damit die Datei, die man herunterlädt,
 * genau der Datei entspricht, die der Import wieder erwartet.
 */

import { asc } from "drizzle-orm";
import { db, itEquipment, itEquipmentTypes, users } from "@/db";
import { fullName } from "@/lib/auth";
import type {
  EquipmentExportRow,
  ImportContext,
} from "@/lib/it-equipment-csv";

/** Sortierung wie in der Oberfläche, damit sich Zeilen wiederfinden lassen. */
function byDeviceId(a: { deviceId: string }, b: { deviceId: string }) {
  return a.deviceId.localeCompare(b.deviceId, "de", { numeric: true });
}

async function loadAll() {
  const [allUsers, types, equipment] = await Promise.all([
    db.select().from(users).orderBy(asc(users.lastName)),
    db.select().from(itEquipmentTypes).orderBy(asc(itEquipmentTypes.name)),
    db.select().from(itEquipment),
  ]);
  return { allUsers, types, equipment };
}

export async function getEquipmentExportRows(): Promise<EquipmentExportRow[]> {
  const { allUsers, types, equipment } = await loadAll();
  const userById = new Map(allUsers.map((u) => [u.id, u]));
  const typeById = new Map(types.map((t) => [t.id, t]));

  return equipment
    .map((item) => {
      const user = userById.get(item.userId);
      return {
        deviceId: item.deviceId,
        email: user?.email ?? "",
        userName: user ? fullName(user) : "Unbekannt",
        typeName: typeById.get(item.typeId)?.name ?? "Unbekannt",
        serialNumber: item.serialNumber,
        handoverDate: item.handoverDate,
        returnDate: item.returnDate,
        notes: item.notes,
      };
    })
    .sort(byDeviceId);
}

export async function getImportContext(): Promise<ImportContext> {
  const { allUsers, types, equipment } = await loadAll();

  return {
    users: allUsers.map((u) => ({
      id: u.id,
      email: u.email,
      active: u.status !== "deaktiviert",
    })),
    types: types.map((t) => ({ id: t.id, name: t.name, active: t.active })),
    equipment: equipment.map((e) => ({
      id: e.id,
      deviceId: e.deviceId,
      userId: e.userId,
      typeId: e.typeId,
      serialNumber: e.serialNumber,
      notes: e.notes,
      handoverDate: e.handoverDate,
      returnDate: e.returnDate,
    })),
  };
}
