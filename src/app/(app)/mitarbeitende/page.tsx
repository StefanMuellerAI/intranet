import { asc, desc } from "drizzle-orm";
import { db, employeeDocuments, users } from "@/db";
import { fullName, requireAdmin, ALLOWED_EMAIL_DOMAIN } from "@/lib/auth";
import { formatDateDE, toISODate } from "@/lib/dates";
import { DOCUMENT_CATEGORY_LABELS } from "@/lib/documents";
import { getSettings } from "@/lib/settings";
import { PageHeader } from "@/components/page-header";
import {
  UserAdminTabs,
  type EmployeeDocumentItem,
  type EmployeeRow,
  type SupervisorOption,
  type UserStatus,
} from "@/components/user-admin";

export const metadata = { title: "Mitarbeitende" };

export default async function MitarbeitendePage() {
  const admin = await requireAdmin();
  const settings = await getSettings();
  const allUsers = await db.select().from(users).orderBy(asc(users.lastName));

  const allDocuments = await db
    .select()
    .from(employeeDocuments)
    .orderBy(desc(employeeDocuments.createdAt));
  const documentsByUser = new Map<string, EmployeeDocumentItem[]>();
  for (const doc of allDocuments) {
    const list = documentsByUser.get(doc.userId) ?? [];
    list.push({
      id: doc.id,
      category: doc.category,
      categoryLabel: DOCUMENT_CATEGORY_LABELS[doc.category],
      title: doc.title,
      filename: doc.filename,
      createdAtLabel: doc.createdAt.toLocaleDateString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }),
    });
    documentsByUser.set(doc.userId, list);
  }

  // Auswahlliste für Vorgesetzte: alle nicht deaktivierten Mitarbeitenden
  const supervisorOptions: SupervisorOption[] = allUsers
    .filter((u) => u.status !== "deaktiviert")
    .map((u) => ({ id: u.id, name: fullName(u) }));

  const nameById = new Map(allUsers.map((u) => [u.id, fullName(u)]));

  /** Kurzfassung der Vorgesetzten-Zuordnung für die Tabellenspalte. */
  function supervisorsLabel(user: (typeof allUsers)[number]): string {
    if (user.isManagingDirector) return "Geschäftsführung";
    const technical = user.technicalSupervisorId
      ? nameById.get(user.technicalSupervisorId)
      : null;
    const disciplinary = user.disciplinarySupervisorId
      ? nameById.get(user.disciplinarySupervisorId)
      : null;
    const parts = [
      technical && `fachlich: ${technical}`,
      disciplinary && `diszipl.: ${disciplinary}`,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(" · ") : "—";
  }

  const today = toISODate(new Date());

  const rows: EmployeeRow[] = allUsers.map((u) => ({
    id: u.id,
    name: fullName(u),
    email: u.email,
    status: u.status as UserStatus,
    isAdmin: u.role === "admin",
    isSelf: u.id === admin.id,
    isManagingDirector: u.isManagingDirector,
    annualVacationDays: u.annualVacationDays,
    vacationCarryoverDays: u.vacationCarryoverDays,
    entryDate: u.entryDate,
    entryYearVacationDays: u.entryYearVacationDays,
    entryLabel: u.entryDate ? formatDateDE(u.entryDate) : "—",
    entryPending: u.entryDate !== null && u.entryDate > today,
    birthDate: u.birthDate,
    birthdayLabel: u.birthDate ? formatDateDE(u.birthDate) : "—",
    technicalSupervisorId: u.technicalSupervisorId,
    disciplinarySupervisorId: u.disciplinarySupervisorId,
    supervisorsLabel: supervisorsLabel(u),
    documents: documentsByUser.get(u.id) ?? [],
  }));

  return (
    <div data-page-width="wide">
      <PageHeader
        title="Mitarbeitende"
        description={`User-Verwaltung — zulässig sind ausschließlich Adressen der Domain @${ALLOWED_EMAIL_DOMAIN}`}
      />

      <UserAdminTabs
        users={rows}
        supervisorOptions={supervisorOptions}
        defaultVacationDays={settings.defaultAnnualVacationDays}
        emailDomain={ALLOWED_EMAIL_DOMAIN}
      />
    </div>
  );
}
