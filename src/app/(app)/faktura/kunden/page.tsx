import { asc } from "drizzle-orm";
import { db, fakturaCustomers, fakturaProjects } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { getMonthlyBookedMinutes } from "@/lib/faktura/limit";
import {
  berlinTodayISO,
  formatMinutesAsHours,
  monthOf,
} from "@/lib/faktura/zeitfenster";
import { FakturaNav } from "@/components/faktura/faktura-nav";
import {
  CustomerCard,
  CustomerCreateForm,
  type CustomerView,
} from "@/components/faktura/kunden-admin";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Faktura — Kunden & Projekte" };

export default async function FakturaKundenPage() {
  await requireAdmin();
  const month = monthOf(berlinTodayISO());

  const [customers, projects] = await Promise.all([
    db.select().from(fakturaCustomers).orderBy(asc(fakturaCustomers.name)),
    db.select().from(fakturaProjects).orderBy(asc(fakturaProjects.name)),
  ]);

  const views: CustomerView[] = await Promise.all(
    customers.map(async (customer) => ({
      id: customer.id,
      name: customer.name,
      address: customer.address,
      contactPerson: customer.contactPerson,
      active: customer.active,
      projects: await Promise.all(
        projects
          .filter((p) => p.customerId === customer.id)
          .map(async (project) => {
            const booked = await getMonthlyBookedMinutes(project.id, month);
            return {
              id: project.id,
              name: project.name,
              validFrom: project.validFrom,
              validTo: project.validTo,
              monthlyLimitHours:
                project.monthlyLimitMinutes != null
                  ? formatMinutesAsHours(project.monthlyLimitMinutes)
                  : null,
              active: project.active,
              bookedHours: formatMinutesAsHours(booked),
              overLimit:
                project.monthlyLimitMinutes != null &&
                booked > project.monthlyLimitMinutes,
            };
          })
      ),
    }))
  );

  return (
    <div>
      <PageHeader
        title="Kunden & Projekte"
        description="Stammdaten für die Zeiterfassung — Kunden und Projekte werden nie gelöscht, nur inaktiv gesetzt. Monatssaldo bezieht sich auf den laufenden Kalendermonat."
      />
      <FakturaNav />
      <CustomerCreateForm />
      {views.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Noch keine Kunden angelegt.
        </p>
      ) : (
        views.map((customer) => (
          <CustomerCard key={customer.id} customer={customer} />
        ))
      )}
    </div>
  );
}
