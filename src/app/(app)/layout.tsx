import { SignOutButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import {
  commissionClaims,
  db,
  expenseReports,
  vacationRequests,
  workationRequests,
} from "@/db";
import { fullName, getActiveDeputy, getCurrentUser } from "@/lib/auth";
import { Sidebar } from "@/components/sidebar";
import { Button } from "@/components/ui/button";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Ressourcenbasierter Zugriffsschutz (statt Middleware-Route-Matching):
  // Unangemeldete werden zur Anmeldung geleitet (inkl. redirect_url); bei
  // abgelaufenem Session-Token übernimmt Clerk den Token-Refresh.
  await auth.protect();

  const user = await getCurrentUser();

  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-xl font-semibold">Kein Zugang</h1>
          <p className="text-sm text-muted-foreground">
            Für Ihr Konto ist kein aktiver Intranet-Zugang hinterlegt oder das
            Konto wurde deaktiviert. Bitte wenden Sie sich an die
            Geschäftsführung.
          </p>
          <SignOutButton redirectUrl="/anmelden">
            <Button variant="outline">Abmelden</Button>
          </SignOutButton>
        </div>
      </main>
    );
  }

  const deputy = await getActiveDeputy();
  const isAdmin = user.role === "admin";
  const isDeputy = deputy?.id === user.id;
  const canApprove = isAdmin || isDeputy;

  let openApprovals = 0;
  if (canApprove) {
    const [v, w, e, c] = await Promise.all([
      db
        .select({ id: vacationRequests.id, status: vacationRequests.status })
        .from(vacationRequests),
      db
        .select({ id: workationRequests.id, status: workationRequests.status })
        .from(workationRequests),
      db
        .select({ id: expenseReports.id, status: expenseReports.status })
        .from(expenseReports),
      db
        .select({ id: commissionClaims.id, status: commissionClaims.status })
        .from(commissionClaims),
    ]);
    openApprovals = [...v, ...w, ...e, ...c].filter(
      (r) => r.status === "eingereicht" || r.status === "storno_beantragt"
    ).length;
  }

  return (
    <div className="flex min-h-screen flex-col md:h-svh md:overflow-hidden md:flex-row">
      <Sidebar
        userName={fullName(user)}
        roleLabel={
          isAdmin ? "Admin" : isDeputy ? "Vertretung (aktiv)" : "Mitarbeiter/in"
        }
        isAdmin={isAdmin}
        canApprove={canApprove}
        openApprovals={openApprovals}
      />
      <main className="flex-1 p-4 md:overflow-y-auto md:p-8 max-w-5xl w-full mx-auto">
        {children}
      </main>
    </div>
  );
}
