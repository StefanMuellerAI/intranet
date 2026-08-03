import { asc, desc } from "drizzle-orm";
import {
  db,
  itEquipment,
  itEquipmentDocuments,
  itEquipmentTypes,
  users,
} from "@/db";
import { fullName, requireAdmin } from "@/lib/auth";
import { formatDateDE } from "@/lib/dates";
import { PageHeader } from "@/components/page-header";
import {
  ITEquipmentTabs,
  type EmployeeOption,
  type EquipmentDocumentItem,
  type EquipmentRow,
  type EquipmentTypeOption,
  type EquipmentTypeRow,
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
    db
      .select()
      .from(itEquipmentDocuments)
      .orderBy(desc(itEquipmentDocuments.createdAt)),
  ]);

  const documentsByEquipment = new Map<string, EquipmentDocumentItem[]>();
  for (const doc of documents) {
    const list = documentsByEquipment.get(doc.equipmentId) ?? [];
    list.push({
      id: doc.id,
      filename: doc.filename,
      createdAtLabel: doc.createdAt.toLocaleDateString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }),
    });
    documentsByEquipment.set(doc.equipmentId, list);
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
        serialNumber: item.serialNumber,
        notes: item.notes,
        handoverDate: item.handoverDate,
        handoverLabel: formatDateDE(item.handoverDate),
        returnDate: item.returnDate,
        returnLabel: item.returnDate ? formatDateDE(item.returnDate) : "—",
        documents: documentsByEquipment.get(item.id) ?? [],
      };
    })
    .sort(
      (a, b) =>
        a.userName.localeCompare(b.userName, "de") ||
        a.typeName.localeCompare(b.typeName, "de") ||
        a.handoverDate.localeCompare(b.handoverDate)
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

  return (
    <div>
      <PageHeader
        title="IT-Management"
        description="Ausstattung der Mitarbeitenden inklusive Seriennummern, Übernahme, Rückgabe und Übergabeprotokollen"
      />

      <ITEquipmentTabs
        active={rows.filter((r) => r.returnDate === null)}
        returned={rows.filter((r) => r.returnDate !== null)}
        employees={employees}
        types={typeOptions}
        typeRows={typeRows}
      />
    </div>
  );
}
