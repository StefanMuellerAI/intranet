import { ne, asc } from "drizzle-orm";
import { db, users } from "@/db";
import { fullName, requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { OrgChart, type OrgChartNode } from "@/components/org-chart";

export const metadata = { title: "Organigramm" };

export default async function OrganigrammPage() {
  const current = await requireUser();

  const allUsers = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      isManagingDirector: users.isManagingDirector,
      technicalSupervisorId: users.technicalSupervisorId,
      disciplinarySupervisorId: users.disciplinarySupervisorId,
      status: users.status,
    })
    .from(users)
    .where(ne(users.status, "deaktiviert"))
    .orderBy(asc(users.lastName), asc(users.firstName));

  const nodes: OrgChartNode[] = allUsers.map((u) => ({
    id: u.id,
    name: fullName(u),
    isManagingDirector: u.isManagingDirector,
    technicalSupervisorId: u.technicalSupervisorId,
    disciplinarySupervisorId: u.disciplinarySupervisorId,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organigramm"
        description="Hierarchie der Mitarbeitenden — fachliche und disziplinarische Vorgesetzten-Beziehungen"
      />
      <OrgChart nodes={nodes} currentUserId={current.id} />
    </div>
  );
}
