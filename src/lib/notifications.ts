import "server-only";
import { eq } from "drizzle-orm";
import { db, users, type User } from "@/db";
import { fullName, getActiveDeputy } from "@/lib/auth";
import { formatDateDE, toISODate } from "@/lib/dates";
import { sendMail, type MailRecipient } from "@/lib/mail";

export const TYPE_LABELS: Record<string, string> = {
  urlaub: "Urlaubsantrag",
  workation: "Workation-Antrag",
  reisekosten: "Reisekostenabrechnung",
  provision: "Provisionsanspruch",
};

async function adminRecipients(): Promise<MailRecipient[]> {
  const admins = await db.query.users.findMany({
    where: eq(users.role, "admin"),
  });
  return admins
    .filter((a) => a.status === "aktiv")
    .map((a) => ({ email: a.email, name: fullName(a) }));
}

/** Neuer Antrag / korrigiert erneut eingereicht → Admin + aktive Vertretung */
export async function notifyRequestSubmitted(opts: {
  type: "urlaub" | "workation" | "reisekosten" | "provision";
  requestId: string;
  applicant: User;
  resubmitted: boolean;
  summary: string;
}) {
  const recipients = await adminRecipients();
  const deputy = await getActiveDeputy();
  if (deputy && !recipients.some((r) => r.email === deputy.email)) {
    recipients.push({ email: deputy.email, name: fullName(deputy) });
  }
  const label = TYPE_LABELS[opts.type];
  await sendMail({
    to: recipients,
    subject: `${label} ${opts.resubmitted ? "korrigiert erneut eingereicht" : "eingereicht"}: ${fullName(opts.applicant)}`,
    heading: `${label} ${opts.resubmitted ? "korrigiert erneut eingereicht" : "eingereicht"}`,
    paragraphs: [
      `${fullName(opts.applicant)} hat ${opts.resubmitted ? "einen beanstandeten Antrag korrigiert und erneut" : "einen neuen Antrag"} eingereicht.`,
      opts.summary,
    ],
    linkPath: `/freigaben/${opts.type}/${opts.requestId}`,
    linkLabel: "Zur Freigabe",
  });
}

/** Antrag genehmigt → Antragsteller/in */
export async function notifyRequestApproved(opts: {
  type: "urlaub" | "workation" | "reisekosten" | "provision";
  requestId: string;
  applicant: User;
  summary: string;
}) {
  await sendMail({
    to: [{ email: opts.applicant.email, name: fullName(opts.applicant) }],
    subject: `${TYPE_LABELS[opts.type]} genehmigt`,
    heading: `Ihr ${TYPE_LABELS[opts.type]} wurde genehmigt`,
    paragraphs: [opts.summary],
    linkPath: `/${opts.type}/${opts.requestId}`,
  });
}

/** Antrag beanstandet (inkl. Kommentar) → Antragsteller/in */
export async function notifyRequestRejected(opts: {
  type: "urlaub" | "workation" | "reisekosten" | "provision";
  requestId: string;
  applicant: User;
  comment: string;
}) {
  await sendMail({
    to: [{ email: opts.applicant.email, name: fullName(opts.applicant) }],
    subject: `${TYPE_LABELS[opts.type]} beanstandet`,
    heading: `Ihr ${TYPE_LABELS[opts.type]} wurde beanstandet`,
    paragraphs: [
      `Begründung: ${opts.comment}`,
      "Sie können den Antrag korrigieren und erneut einreichen.",
    ],
    linkPath: `/${opts.type}/${opts.requestId}`,
  });
}

/** Storno bestätigt → Antragsteller/in */
export async function notifyCancellationConfirmed(opts: {
  requestId: string;
  applicant: User;
  summary: string;
}) {
  await sendMail({
    to: [{ email: opts.applicant.email, name: fullName(opts.applicant) }],
    subject: "Urlaubs-Storno bestätigt",
    heading: "Ihr Storno wurde bestätigt",
    paragraphs: [
      opts.summary,
      "Die Urlaubstage wurden Ihrem Konto wieder gutgeschrieben.",
    ],
    linkPath: `/urlaub/${opts.requestId}`,
  });
}

/** Krankmeldung eingegangen / Ende nachgetragen → nur Admin */
export async function notifySickLeave(opts: {
  sickLeaveId: string;
  applicant: User;
  kind: "gemeldet" | "abgeschlossen";
  summary: string;
}) {
  await sendMail({
    to: await adminRecipients(),
    subject:
      opts.kind === "gemeldet"
        ? `Krankmeldung eingegangen: ${fullName(opts.applicant)}`
        : `Krankmeldung abgeschlossen: ${fullName(opts.applicant)}`,
    heading:
      opts.kind === "gemeldet"
        ? "Neue Krankmeldung"
        : "Enddatum einer Krankmeldung nachgetragen",
    paragraphs: [opts.summary],
    linkPath: `/krankmeldung/${opts.sickLeaveId}`,
  });
}

/**
 * Faktura: Admin hat eine Zeitbuchung angepasst, ausgeblendet oder gelöscht
 * → betroffene/r Mitarbeiter/in mit Alt-/Neu-Werten bzw. Begründung (FA-8.1).
 */
export async function notifyFakturaEntryChanged(opts: {
  employee: User;
  /** z. B. "angepasst", "ausgeblendet", "wieder eingeblendet", "gelöscht", "neu angelegt" */
  action: string;
  projectLabel: string;
  entryDateLabel: string;
  details: string[];
}) {
  await sendMail({
    to: [{ email: opts.employee.email, name: fullName(opts.employee) }],
    subject: `Zeitbuchung ${opts.action}: ${opts.projectLabel} (${opts.entryDateLabel})`,
    heading: `Eine Ihrer Zeitbuchungen wurde ${opts.action}`,
    paragraphs: [
      `Der Admin hat Ihre Zeitbuchung für ${opts.projectLabel} am ${opts.entryDateLabel} ${opts.action}.`,
      ...opts.details,
    ],
    linkPath: "/faktura",
    linkLabel: "Zur Zeiterfassung",
  });
}

/** Einladung / erneute Einladung → neue/r Mitarbeiter/in */
export async function notifyInvitation(opts: {
  email: string;
  name: string;
  invitationUrl: string;
  resent: boolean;
  entryDate?: string | null;
}) {
  // Vor dem Eintritt ist die Anmeldung gesperrt — ohne Hinweis wirkt das
  // wie ein Fehler.
  const beforeEntry =
    !!opts.entryDate && opts.entryDate > toISODate(new Date());

  await sendMail({
    to: [{ email: opts.email, name: opts.name }],
    subject: opts.resent
      ? "Ihre Einladung zum StefanAI Intranet (erneut gesendet)"
      : "Ihre Einladung zum StefanAI Intranet",
    heading: `Willkommen, ${opts.name}!`,
    paragraphs: [
      "Sie wurden zum Mitarbeiter-Intranet der StefanAI Solutions GmbH eingeladen.",
      "Über den folgenden Link vergeben Sie Ihr Passwort und aktivieren Ihren Zugang.",
      ...(beforeEntry && opts.entryDate
        ? [
            `Der Zugang zum Intranet ist ab Ihrem Eintrittsdatum am ${formatDateDE(opts.entryDate)} freigeschaltet — bis dahin ist eine Anmeldung noch nicht möglich.`,
          ]
        : []),
    ],
    linkUrl: opts.invitationUrl,
    linkLabel: "Zugang aktivieren",
  });
}
