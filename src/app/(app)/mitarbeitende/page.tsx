import { asc } from "drizzle-orm";
import { db, users } from "@/db";
import { fullName, requireAdmin, ALLOWED_EMAIL_DOMAIN } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { PageHeader } from "@/components/page-header";
import {
  InviteForm,
  UserRowActions,
  VacationEntitlementForm,
} from "@/components/user-admin";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { inviteUser } from "./actions";

export const metadata = { title: "Mitarbeitende" };

const STATUS_LABELS: Record<string, string> = {
  eingeladen: "Eingeladen",
  aktiv: "Aktiv",
  deaktiviert: "Deaktiviert",
};

export default async function MitarbeitendePage() {
  const admin = await requireAdmin();
  const settings = await getSettings();
  const allUsers = await db.select().from(users).orderBy(asc(users.lastName));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mitarbeitende"
        description={`User-Verwaltung — zulässig sind ausschließlich Adressen der Domain @${ALLOWED_EMAIL_DOMAIN}`}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Neue/n Mitarbeiter/in einladen
          </CardTitle>
        </CardHeader>
        <CardContent>
          <InviteForm
            action={inviteUser}
            defaultVacationDays={settings.defaultAnnualVacationDays}
            emailDomain={ALLOWED_EMAIL_DOMAIN}
          />
        </CardContent>
      </Card>

      <div className="space-y-4">
        {allUsers.map((u) => (
          <Card key={u.id}>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center gap-3">
                <CardTitle className="text-base">{fullName(u)}</CardTitle>
                <Badge
                  variant="outline"
                  className={
                    u.status === "aktiv"
                      ? "bg-green-100 text-green-800 border-green-200"
                      : u.status === "eingeladen"
                        ? "bg-blue-100 text-blue-800 border-blue-200"
                        : "bg-gray-100 text-gray-600 border-gray-200"
                  }
                >
                  {STATUS_LABELS[u.status]}
                </Badge>
                {u.role === "admin" && <Badge>Admin</Badge>}
                <span className="text-sm text-muted-foreground">
                  {u.email}
                </span>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <VacationEntitlementForm
                userId={u.id}
                annualVacationDays={u.annualVacationDays}
                vacationCarryoverDays={u.vacationCarryoverDays}
              />
              <UserRowActions
                userId={u.id}
                status={u.status}
                isSelf={u.id === admin.id}
              />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
