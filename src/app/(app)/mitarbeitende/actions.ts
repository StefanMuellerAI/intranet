"use server";

import { revalidatePath } from "next/cache";
import { clerkClient } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, users } from "@/db";
import { writeAudit } from "@/lib/audit";
import { fullName, isAllowedEmail, requireAdmin, ALLOWED_EMAIL_DOMAIN } from "@/lib/auth";
import { notifyInvitation } from "@/lib/notifications";

const inviteSchema = z.object({
  firstName: z.string().min(1, "Bitte Vornamen angeben."),
  lastName: z.string().min(1, "Bitte Nachnamen angeben."),
  email: z.string().email("Ungültige E-Mail-Adresse."),
  annualVacationDays: z.coerce
    .number()
    .min(0.5, "Der Jahresurlaubsanspruch ist Pflichtfeld."),
});

/** Clerk-Einladung erstellen und Link zurückgeben. */
async function createClerkInvitation(email: string): Promise<string | null> {
  try {
    const client = await clerkClient();
    const invitation = await client.invitations.createInvitation({
      emailAddress: email,
      redirectUrl: `${process.env.APP_BASE_URL ?? "http://localhost:3000"}/anmelden`,
      ignoreExisting: true,
      // Clerk versendet selbst keine Mail — der Versand läuft über Brevo
      notify: false,
    });
    return invitation.url ?? null;
  } catch (err) {
    console.error("Clerk-Einladung fehlgeschlagen:", err);
    return null;
  }
}

export async function inviteUser(formData: FormData) {
  const admin = await requireAdmin();
  const data = inviteSchema.parse({
    firstName: String(formData.get("firstName") ?? ""),
    lastName: String(formData.get("lastName") ?? ""),
    email: String(formData.get("email") ?? "").trim().toLowerCase(),
    annualVacationDays: formData.get("annualVacationDays"),
  });

  // Serverseitige Domain-Validierung (zusätzlich zur Clerk-Allowlist)
  if (!isAllowedEmail(data.email))
    throw new Error(
      `Zulässig sind ausschließlich Adressen der Domain @${ALLOWED_EMAIL_DOMAIN}.`
    );

  const existing = await db.query.users.findFirst({
    where: eq(users.email, data.email),
  });
  if (existing)
    throw new Error("Für diese E-Mail-Adresse existiert bereits ein Konto.");

  const invitationUrl = await createClerkInvitation(data.email);

  const [user] = await db
    .insert(users)
    .values({
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName,
      annualVacationDays: data.annualVacationDays,
      status: "eingeladen",
    })
    .returning();

  await writeAudit({
    objectType: "user",
    objectId: user.id,
    action: "eingeladen",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
    details: { email: data.email, jahresurlaub: data.annualVacationDays },
  });
  await notifyInvitation({
    email: data.email,
    name: `${data.firstName} ${data.lastName}`,
    invitationUrl:
      invitationUrl ??
      `${process.env.APP_BASE_URL ?? "http://localhost:3000"}/anmelden`,
    resent: false,
  });

  revalidatePath("/mitarbeitende");
}

/** Einladung jederzeit erneut versenden. */
export async function resendInvitation(userId: string) {
  const admin = await requireAdmin();
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw new Error("User nicht gefunden.");
  if (user.status !== "eingeladen")
    throw new Error("Nur eingeladene User können erneut eingeladen werden.");

  const invitationUrl = await createClerkInvitation(user.email);

  await writeAudit({
    objectType: "user",
    objectId: userId,
    action: "einladung_erneut_versendet",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
  });
  await notifyInvitation({
    email: user.email,
    name: fullName(user),
    invitationUrl:
      invitationUrl ??
      `${process.env.APP_BASE_URL ?? "http://localhost:3000"}/anmelden`,
    resent: true,
  });

  revalidatePath("/mitarbeitende");
}

/** Jahresurlaubsanspruch und Übertrag pro User anpassen. */
export async function updateUserVacation(userId: string, formData: FormData) {
  const admin = await requireAdmin();
  const annual = Number(formData.get("annualVacationDays"));
  const carryover = Number(formData.get("vacationCarryoverDays"));
  if (!Number.isFinite(annual) || annual < 0)
    throw new Error("Ungültiger Jahresurlaubsanspruch.");

  await db
    .update(users)
    .set({
      annualVacationDays: annual,
      vacationCarryoverDays: Number.isFinite(carryover) ? carryover : 0,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  await writeAudit({
    objectType: "user",
    objectId: userId,
    action: "urlaubsanspruch_geaendert",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
    details: { jahresurlaub: annual, uebertrag: carryover },
  });
  revalidatePath("/mitarbeitende");
}

/** Offboarding: Login sperren, Antragsdaten bleiben erhalten (Abschnitt 9). */
export async function setUserStatus(
  userId: string,
  status: "aktiv" | "deaktiviert"
) {
  const admin = await requireAdmin();
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw new Error("User nicht gefunden.");
  if (user.id === admin.id)
    throw new Error("Das eigene Admin-Konto kann nicht deaktiviert werden.");

  await db
    .update(users)
    .set({ status, updatedAt: new Date() })
    .where(eq(users.id, userId));

  // Login in Clerk sperren/entsperren
  if (user.clerkId) {
    try {
      const client = await clerkClient();
      if (status === "deaktiviert") await client.users.banUser(user.clerkId);
      else await client.users.unbanUser(user.clerkId);
    } catch (err) {
      console.error("Clerk-Statusänderung fehlgeschlagen:", err);
    }
  }

  await writeAudit({
    objectType: "user",
    objectId: userId,
    action: status === "deaktiviert" ? "deaktiviert" : "reaktiviert",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source: "web",
  });
  revalidatePath("/mitarbeitende");
}
