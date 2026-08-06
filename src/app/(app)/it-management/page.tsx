import { asc } from "drizzle-orm";
import {
  db,
  itEquipment,
  itEquipmentDocuments,
  itEquipmentTypes,
  users,
} from "@/db";
import { fullName, requireAdmin } from "@/lib/auth";
import { formatDateDE } from "@/lib/dates";
import { suggestNextDeviceId } from "@/lib/it-equipment";
import { PageHeader } from "@/components/page-header";
import {
  ITEquipmentTabs,
  type EmployeeOption,
  type EmployeeProtocolRow,
  type EquipmentRow,
  type EquipmentTypeOption,
  type EquipmentTypeRow,
  type HandoverProtocolItem,
} from "@/components/it-equipment-admin";

export const metadata = { title: "IT-Management" };

export default async function ITManagementPage() {
  await requireAdmin();

  const [allUsers, types, equipment, documents] = await Promise.all([
    db.select().from(users).orderBy(asc(users.lastName)),
    db
      .select()
      .from(itEquipmentTypes)
      .orderBy(asc(itEquipmentTypes.sortOrder), asc(itEquipmentTypes.name)),
    db.select().from(itEquipment),
    db.select().from(itEquipmentDocuments),
  ]);

  // Je Person und Art existiert genau ein Protokoll (Unique-Index)
  const protocolByUserAndKind = new Map<string, HandoverProtocolItem>();
  for (const doc of documents) {
    protocolByUserAndKind.set(`${doc.userId}:${doc.kind}`, {
      id: doc.id,
      filename: doc.filename,
      createdAtLabel: doc.createdAt.toLocaleDateString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }),
    });
  }

  const userById = new Map(allUsers.map((u) => [u.id, u]));
  const typeById = new Map(types.map((t) => [t.id, t]));

  const rows: EquipmentRow[] = equipment
    .map((item) => {
      const user = userById.get(item.userId);
      return {
        id: item.id,
        userId: item.userId,
        userName: user ? fullName(user) : "Unbekannt",
        typeId: item.typeId,
        typeName: typeById.get(item.typeId)?.name ?? "Unbekannt",
        deviceId: item.deviceId,
        serialNumber: item.serialNumber,
        notes: item.notes,
        handoverDate: item.handoverDate,
        handoverLabel: formatDateDE(item.handoverDate),
        returnDate: item.returnDate,
        returnLabel: item.returnDate ? formatDateDE(item.returnDate) : "—",
      };
    })
    // Primär nach Geräte-ID, damit die Liste dieselbe Ordnung hat wie der
    // CSV-Export und sich Zeilen darüber wiederfinden lassen.
    .sort((a, b) =>
      a.deviceId.localeCompare(b.deviceId, "de", { numeric: true })
    );

  // Deaktivierte Zugänge behalten ihre Ausstattung, stehen für neue
  // Zuordnungen aber nicht mehr zur Auswahl.
  const employees: EmployeeOption[] = allUsers.map((u) => ({
    id: u.id,
    name: fullName(u),
    selectable: u.status !== "deaktiviert",
  }));

  const typeOptions: EquipmentTypeOption[] = types.map((t) => ({
    id: t.id,
    name: t.name,
    selectable: t.active,
  }));

  const usageByType = new Map<string, number>();
  for (const item of equipment) {
    usageByType.set(item.typeId, (usageByType.get(item.typeId) ?? 0) + 1);
  }

  const typeRows: EquipmentTypeRow[] = types.map((t) => ({
    id: t.id,
    name: t.name,
    sortOrder: t.sortOrder,
    active: t.active,
    usageCount: usageByType.get(t.id) ?? 0,
  }));

  // Vorschlag für das Anlegen-Formular — über alle Geräte hinweg, damit eine
  // Nummer auch nach der Rückgabe eines Geräts nicht erneut vergeben wird.
  const nextDeviceId = suggestNextDeviceId(
    equipment.map((item) => item.deviceId),
    new Date().getFullYear()
  );

  const activeDevicesByUser = new Map<string, number>();
  const totalDevicesByUser = new Map<string, number>();
  for (const item of equipment) {
    totalDevicesByUser.set(
      item.userId,
      (totalDevicesByUser.get(item.userId) ?? 0) + 1
    );
    if (item.returnDate === null)
      activeDevicesByUser.set(
        item.userId,
        (activeDevicesByUser.get(item.userId) ?? 0) + 1
      );
  }

  // Auch deaktivierte Zugänge werden gelistet — gerade beim Offboarding wird
  // das Rücknahmeprotokoll gebraucht.
  const protocolRows: EmployeeProtocolRow[] = allUsers.map((u) => ({
    userId: u.id,
    userName: fullName(u),
    active: u.status !== "deaktiviert",
    activeDevices: activeDevicesByUser.get(u.id) ?? 0,
    totalDevices: totalDevicesByUser.get(u.id) ?? 0,
    uebergabe: protocolByUserAndKind.get(`${u.id}:uebergabe`) ?? null,
    ruecknahme: protocolByUserAndKind.get(`${u.id}:ruecknahme`) ?? null,
  }));

  return (
    <div>
      <PageHeader
        title="IT-Management"
        description="Ausstattung der Mitarbeitenden inklusive Geräte-IDs, Übernahme, Rückgabe und Übergabeprotokollen"
      />

      <ITEquipmentTabs
        active={rows.filter((r) => r.returnDate === null)}
        returned={rows.filter((r) => r.returnDate !== null)}
        employees={employees}
        types={typeOptions}
        typeRows={typeRows}
        protocolRows={protocolRows}
        nextDeviceId={nextDeviceId}
      />
    </div>
  );
}
