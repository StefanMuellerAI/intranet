import { SignOutButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { listOpenApprovals } from "@/lib/approvals";
import { fullName, getActiveDeputy, resolveAccess } from "@/lib/auth";
import { formatDateDE } from "@/lib/dates";
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

  const access = await resolveAccess();

  if (access.user === null) {
    const beforeEntry = access.reason === "vor_eintritt";
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-xl font-semibold">
            {beforeEntry ? "Zugang noch nicht freigeschaltet" : "Kein Zugang"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {beforeEntry
              ? `Ihr Intranet-Zugang steht ab Ihrem Eintrittsdatum${
                  access.entryDate ? ` am ${formatDateDE(access.entryDate)}` : ""
                } bereit. Bitte melden Sie sich ab diesem Tag erneut an.`
              : "Für Ihr Konto ist kein aktiver Intranet-Zugang hinterlegt oder das Konto wurde deaktiviert. Bitte wenden Sie sich an die Geschäftsführung."}
          </p>
          <SignOutButton redirectUrl="/anmelden">
            <Button variant="outline">Abmelden</Button>
          </SignOutButton>
        </div>
      </main>
    );
  }

  const user = access.user;

  const deputy = await getActiveDeputy();
  const isAdmin = user.role === "admin";
  const isDeputy = deputy?.id === user.id;
  const canApprove = isAdmin || isDeputy;

  const openApprovals = canApprove ? (await listOpenApprovals()).length : 0;

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar
        userName={fullName(user)}
        roleLabel={
          isAdmin ? "Admin" : isDeputy ? "Vertretung (aktiv)" : "Mitarbeiter/in"
        }
        isAdmin={isAdmin}
        canApprove={canApprove}
        openApprovals={openApprovals}
      />
      {/*
        Einheitliche Inhaltsbreite für alle Seiten: max-w-[90rem] (1440px).
        Die Seitenbreite wird nicht mehr pro Seite gesteuert; Formulare
        begrenzen ihre Lesebreite weiterhin selbst (z. B. max-w-xl).
      */}
      <main className="flex-1 p-4 md:p-8 max-w-[90rem] w-full mx-auto">
        {children}
      </main>
    </div>
  );
}
