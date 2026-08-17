import "server-only";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db, fakturaCustomers, fakturaProjects, type User } from "@/db";
import { writeAudit, type AuditEntry } from "@/lib/audit";
import { fullName } from "@/lib/auth";
import { isValidISODate, QUARTER_HOUR_MINUTES } from "@/lib/faktura/zeitfenster";
import { UserError } from "@/lib/user-error";

export type FakturaSource = AuditEntry["source"];

/** Anzeige immer als „Kunde – Projekt", um Fehlbuchungen bei namensgleichen Projekten zu vermeiden. */
export function customerProjectLabel(
  customerName: string,
  projectName: string
): string {
  return `${customerName} – ${projectName}`;
}

// ---------------------------------------------------------------------------
// Kunden
// ---------------------------------------------------------------------------

export const customerInputSchema = z.object({
  name: z.string().trim().min(1, "Bitte einen Kundennamen angeben."),
  address: z.string().trim().optional(),
  contactPerson: z.string().trim().optional(),
});

export type CustomerInput = z.infer<typeof customerInputSchema>;

async function assertUniqueCustomerName(name: string, excludeId?: string) {
  const existing = await db.query.fakturaCustomers.findFirst({
    where: excludeId
      ? and(eq(fakturaCustomers.name, name), ne(fakturaCustomers.id, excludeId))
      : eq(fakturaCustomers.name, name),
  });
  if (existing)
    throw new UserError(`Ein Kunde mit dem Namen „${name}" existiert bereits.`);
}

export async function createCustomer(
  admin: User,
  raw: CustomerInput,
  source: FakturaSource = "web"
) {
  const data = customerInputSchema.parse(raw);
  await assertUniqueCustomerName(data.name);

  const [customer] = await db
    .insert(fakturaCustomers)
    .values({
      name: data.name,
      address: data.address || null,
      contactPerson: data.contactPerson || null,
    })
    .returning();

  await writeAudit({
    objectType: "faktura_kunde",
    objectId: customer.id,
    action: "angelegt",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source,
    details: { neu: data },
  });
  return customer;
}

export async function updateCustomer(
  admin: User,
  id: string,
  raw: CustomerInput,
  source: FakturaSource = "web"
) {
  const existing = await db.query.fakturaCustomers.findFirst({
    where: eq(fakturaCustomers.id, id),
  });
  if (!existing) throw new UserError("Kunde nicht gefunden.");

  const data = customerInputSchema.parse(raw);
  await assertUniqueCustomerName(data.name, id);

  const [customer] = await db
    .update(fakturaCustomers)
    .set({
      name: data.name,
      address: data.address || null,
      contactPerson: data.contactPerson || null,
      updatedAt: new Date(),
    })
    .where(eq(fakturaCustomers.id, id))
    .returning();

  await writeAudit({
    objectType: "faktura_kunde",
    objectId: id,
    action: "geaendert",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source,
    details: {
      alt: {
        name: existing.name,
        address: existing.address,
        contactPerson: existing.contactPerson,
      },
      neu: data,
    },
  });
  return customer;
}

/** Inaktiv setzen statt löschen — Bestandsbuchungen bleiben vollständig erhalten (FA-1.1). */
export async function setCustomerActive(
  admin: User,
  id: string,
  active: boolean,
  source: FakturaSource = "web"
) {
  const existing = await db.query.fakturaCustomers.findFirst({
    where: eq(fakturaCustomers.id, id),
  });
  if (!existing) throw new UserError("Kunde nicht gefunden.");

  await db
    .update(fakturaCustomers)
    .set({ active, updatedAt: new Date() })
    .where(eq(fakturaCustomers.id, id));

  await writeAudit({
    objectType: "faktura_kunde",
    objectId: id,
    action: active ? "aktiviert" : "inaktiviert",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source,
    details: { name: existing.name, alt: { active: existing.active }, neu: { active } },
  });
}

// ---------------------------------------------------------------------------
// Projekte
// ---------------------------------------------------------------------------

export const projectInputSchema = z
  .object({
    customerId: z.string().uuid("Bitte einen Kunden auswählen."),
    name: z.string().trim().min(1, "Bitte einen Projektnamen angeben."),
    validFrom: z.string().trim().optional(),
    validTo: z.string().trim().optional(),
    /** Monatslimit in Stunden — Vielfache von 0,25 */
    monthlyLimitHours: z.coerce
      .number()
      .positive("Das Monatslimit muss größer als 0 sein.")
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.validFrom && !isValidISODate(data.validFrom))
      ctx.addIssue({ code: "custom", message: "Ungültiges Laufzeit-Startdatum." });
    if (data.validTo && !isValidISODate(data.validTo))
      ctx.addIssue({ code: "custom", message: "Ungültiges Laufzeit-Enddatum." });
    if (
      data.validFrom &&
      data.validTo &&
      isValidISODate(data.validFrom) &&
      isValidISODate(data.validTo) &&
      data.validTo < data.validFrom
    )
      ctx.addIssue({
        code: "custom",
        message: "Das Laufzeitende darf nicht vor dem Laufzeitbeginn liegen.",
      });
    if (data.monthlyLimitHours !== undefined) {
      const minutes = data.monthlyLimitHours * 60;
      if (
        !Number.isInteger(Math.round(minutes)) ||
        Math.abs(minutes - Math.round(minutes)) > 1e-6 ||
        Math.round(minutes) % QUARTER_HOUR_MINUTES !== 0
      )
        ctx.addIssue({
          code: "custom",
          message:
            "Das Monatslimit muss ein Vielfaches von 0,25 Stunden sein.",
        });
    }
  });

export type ProjectInput = z.infer<typeof projectInputSchema>;

function limitMinutes(data: ProjectInput): number | null {
  return data.monthlyLimitHours !== undefined
    ? Math.round(data.monthlyLimitHours * 60)
    : null;
}

async function assertUniqueProjectName(
  customerId: string,
  name: string,
  excludeId?: string
) {
  const conditions = [
    eq(fakturaProjects.customerId, customerId),
    eq(fakturaProjects.name, name),
  ];
  if (excludeId) conditions.push(ne(fakturaProjects.id, excludeId));
  const existing = await db.query.fakturaProjects.findFirst({
    where: and(...conditions),
  });
  if (existing)
    throw new UserError(
      `Für diesen Kunden existiert bereits ein Projekt „${name}".`
    );
}

export async function createProject(
  admin: User,
  raw: ProjectInput,
  source: FakturaSource = "web"
) {
  const data = projectInputSchema.parse(raw);
  const customer = await db.query.fakturaCustomers.findFirst({
    where: eq(fakturaCustomers.id, data.customerId),
  });
  if (!customer) throw new UserError("Kunde nicht gefunden.");
  await assertUniqueProjectName(data.customerId, data.name);

  const [project] = await db
    .insert(fakturaProjects)
    .values({
      customerId: data.customerId,
      name: data.name,
      validFrom: data.validFrom || null,
      validTo: data.validTo || null,
      monthlyLimitMinutes: limitMinutes(data),
    })
    .returning();

  await writeAudit({
    objectType: "faktura_projekt",
    objectId: project.id,
    action: "angelegt",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source,
    details: { kunde: customer.name, neu: data },
  });
  return project;
}

/**
 * Nachträgliche Änderungen an Laufzeit/Limit lassen Bestandsbuchungen
 * unangetastet — sie gelten ab sofort für neue Buchungen (FA-1.3).
 */
export async function updateProject(
  admin: User,
  id: string,
  raw: Omit<ProjectInput, "customerId">,
  source: FakturaSource = "web"
) {
  const existing = await db.query.fakturaProjects.findFirst({
    where: eq(fakturaProjects.id, id),
  });
  if (!existing) throw new UserError("Projekt nicht gefunden.");

  const data = projectInputSchema.parse({
    ...raw,
    customerId: existing.customerId,
  });
  await assertUniqueProjectName(existing.customerId, data.name, id);

  const [project] = await db
    .update(fakturaProjects)
    .set({
      name: data.name,
      validFrom: data.validFrom || null,
      validTo: data.validTo || null,
      monthlyLimitMinutes: limitMinutes(data),
      updatedAt: new Date(),
    })
    .where(eq(fakturaProjects.id, id))
    .returning();

  await writeAudit({
    objectType: "faktura_projekt",
    objectId: id,
    action: "geaendert",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source,
    details: {
      alt: {
        name: existing.name,
        validFrom: existing.validFrom,
        validTo: existing.validTo,
        monthlyLimitMinutes: existing.monthlyLimitMinutes,
      },
      neu: {
        name: data.name,
        validFrom: data.validFrom || null,
        validTo: data.validTo || null,
        monthlyLimitMinutes: limitMinutes(data),
      },
    },
  });
  return project;
}

/** Inaktiv setzen blockiert nur neue Buchungen — Historie/Freigaben/Exporte bleiben (Edge Case 6). */
export async function setProjectActive(
  admin: User,
  id: string,
  active: boolean,
  source: FakturaSource = "web"
) {
  const existing = await db.query.fakturaProjects.findFirst({
    where: eq(fakturaProjects.id, id),
  });
  if (!existing) throw new UserError("Projekt nicht gefunden.");

  await db
    .update(fakturaProjects)
    .set({ active, updatedAt: new Date() })
    .where(eq(fakturaProjects.id, id));

  await writeAudit({
    objectType: "faktura_projekt",
    objectId: id,
    action: active ? "aktiviert" : "inaktiviert",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source,
    details: { name: existing.name, alt: { active: existing.active }, neu: { active } },
  });
}
