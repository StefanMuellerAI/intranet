import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { toISODate } from "@/lib/dates";
import {
  notifyCancellationConfirmed,
  notifyFakturaEntryChanged,
  notifyInvitation,
  notifyRequestApproved,
  notifyRequestRejected,
  notifyRequestSubmitted,
  notifySickLeave,
} from "@/lib/notifications";
import * as schema from "../../src/db/schema";
import { createUser, makeDeputy } from "../helpers/actions";
import { resetDb, seedTestData, testDb, type SeedResult } from "../helpers/db";
import { mailbox, mailsTo } from "../helpers/framework-fakes";

let seed: SeedResult;

const REQUEST_ID = "6f1c2c1e-0000-4000-8000-000000000001";

/** Datum relativ zu heute als ISO-String */
function daysFromToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

function recipients(index = 0): string[] {
  return mailbox[index].to.map((t) => t.email).sort();
}

function submitted(
  overrides: Partial<Parameters<typeof notifyRequestSubmitted>[0]> = {}
) {
  return notifyRequestSubmitted({
    type: "urlaub",
    requestId: REQUEST_ID,
    applicant: seed.employee,
    resubmitted: false,
    summary: "Zeitraum 03.08.2026 bis 07.08.2026, 5 Urlaubstage.",
    ...overrides,
  });
}

beforeAll(async () => {
  await resetDb();
  seed = await seedTestData();
});

beforeEach(async () => {
  const db = testDb();
  await db.delete(schema.deputyAssignments);
  // Zusätzliche Test-User aus vorherigen Fällen nicht als Admin mitzählen
  await db
    .update(schema.users)
    .set({ role: "mitarbeiter" })
    .where(eq(schema.users.role, "admin"));
  await db
    .update(schema.users)
    .set({ role: "admin", status: "aktiv" })
    .where(eq(schema.users.id, seed.admin.id));
});

describe("notifyRequestSubmitted", () => {
  it("benachrichtigt aktive Admins mit Link zur Freigabe", async () => {
    await submitted();

    expect(mailbox).toHaveLength(1);
    expect(mailbox[0]).toMatchObject({
      to: [{ email: seed.admin.email, name: "Erika Admin" }],
      subject: "Urlaubsantrag eingereicht: Max Mitarbeiter",
      heading: "Urlaubsantrag eingereicht",
      paragraphs: [
        "Max Mitarbeiter hat einen neuen Antrag eingereicht.",
        "Zeitraum 03.08.2026 bis 07.08.2026, 5 Urlaubstage.",
      ],
      linkPath: `/freigaben/urlaub/${REQUEST_ID}`,
      linkLabel: "Zur Freigabe",
    });
  });

  it("formuliert Betreff und Text für korrigiert erneut eingereichte Anträge", async () => {
    await submitted({ resubmitted: true });
    expect(mailbox[0].subject).toBe(
      "Urlaubsantrag korrigiert erneut eingereicht: Max Mitarbeiter"
    );
    expect(mailbox[0].heading).toBe("Urlaubsantrag korrigiert erneut eingereicht");
    expect(mailbox[0].paragraphs[0]).toBe(
      "Max Mitarbeiter hat einen beanstandeten Antrag korrigiert und erneut eingereicht."
    );
  });

  it("verwendet die Bezeichnung und den Freigabe-Pfad je Antragsart", async () => {
    await submitted({ type: "workation" });
    await submitted({ type: "reisekosten" });
    await submitted({ type: "provision" });

    expect(mailbox.map((m) => [m.subject, m.linkPath])).toEqual([
      [
        "Workation-Antrag eingereicht: Max Mitarbeiter",
        `/freigaben/workation/${REQUEST_ID}`,
      ],
      [
        "Reisekostenabrechnung eingereicht: Max Mitarbeiter",
        `/freigaben/reisekosten/${REQUEST_ID}`,
      ],
      [
        "Provisionsanspruch eingereicht: Max Mitarbeiter",
        `/freigaben/provision/${REQUEST_ID}`,
      ],
    ]);
  });

  it("schreibt alle aktiven Admins an, aber keine deaktivierten", async () => {
    const zweiterAdmin = await createUser({ role: "admin" });
    const exAdmin = await createUser({ role: "admin", status: "deaktiviert" });
    const eingeladen = await createUser({ role: "admin", status: "eingeladen" });

    await submitted();

    expect(recipients()).toEqual([seed.admin.email, zweiterAdmin.email].sort());
    expect(mailsTo(exAdmin.email)).toHaveLength(0);
    expect(mailsTo(eingeladen.email)).toHaveLength(0);
    expect(mailsTo(seed.employee.email)).toHaveLength(0);
  });

  it("ergänzt die aktive Vertretung", async () => {
    const vertretung = await createUser({ firstName: "Vera", lastName: "Vertretung" });
    await makeDeputy(vertretung);

    await submitted();

    expect(mailbox).toHaveLength(1);
    expect(mailbox[0].to).toContainEqual({
      email: vertretung.email,
      name: "Vera Vertretung",
    });
    expect(recipients()).toEqual([seed.admin.email, vertretung.email].sort());
  });

  it("nennt eine Vertretung, die selbst Admin ist, nur einmal", async () => {
    await makeDeputy(seed.admin);
    await submitted();
    expect(mailbox[0].to).toHaveLength(1);
  });

  it("übergeht Vertretungen außerhalb des Zeitfensters, inaktive und deaktivierte", async () => {
    const zukuenftig = await createUser();
    await makeDeputy(zukuenftig, { startsOn: daysFromToday(1) });
    await submitted();

    const abgelaufen = await createUser();
    await makeDeputy(abgelaufen, { endsOn: daysFromToday(-1) });
    await submitted();

    const deaktiviert = await createUser({ status: "deaktiviert" });
    await makeDeputy(deaktiviert);
    await submitted();

    const abgeschaltet = await createUser();
    await makeDeputy(abgeschaltet);
    await testDb()
      .update(schema.deputyAssignments)
      .set({ active: false })
      .where(eq(schema.deputyAssignments.userId, abgeschaltet.id));
    await submitted();

    expect(mailbox).toHaveLength(4);
    for (const m of mailbox) expect(m.to.map((t) => t.email)).toEqual([seed.admin.email]);
  });

  it("schließt den Tag des Beginns und des Endes der Vertretung ein", async () => {
    const vertretung = await createUser();
    const heute = toISODate(new Date());
    await makeDeputy(vertretung, { startsOn: heute, endsOn: heute });

    await submitted();

    expect(mailsTo(vertretung.email)).toHaveLength(1);
  });
});

describe("Überschriften je Antragstyp", () => {
  it("verwendet das passende Possessivpronomen („Ihre Reisekostenabrechnung“)", async () => {
    await notifyRequestApproved({
      type: "reisekosten",
      requestId: REQUEST_ID,
      applicant: seed.employee,
      summary: "Berlin",
    });
    await notifyRequestRejected({
      type: "reisekosten",
      requestId: REQUEST_ID,
      applicant: seed.employee,
      comment: "Beleg fehlt",
    });
    expect(mailbox.map((m) => m.heading)).toEqual([
      "Ihre Reisekostenabrechnung wurde genehmigt",
      "Ihre Reisekostenabrechnung wurde beanstandet",
    ]);
  });
});

describe("notifyRequestApproved", () => {
  it("informiert nur die antragstellende Person mit Link auf den Antrag", async () => {
    await makeDeputy(await createUser());
    await notifyRequestApproved({
      type: "workation",
      requestId: REQUEST_ID,
      applicant: seed.employee,
      summary: "Valencia, Spanien · 01.09.2026 bis 12.09.2026.",
    });

    expect(mailbox).toHaveLength(1);
    expect(mailbox[0]).toMatchObject({
      to: [{ email: seed.employee.email, name: "Max Mitarbeiter" }],
      subject: "Workation-Antrag genehmigt",
      heading: "Ihr Workation-Antrag wurde genehmigt",
      paragraphs: ["Valencia, Spanien · 01.09.2026 bis 12.09.2026."],
      linkPath: `/workation/${REQUEST_ID}`,
    });
  });

  it("verlinkt je Antragsart auf die eigene Detailseite", async () => {
    for (const type of ["urlaub", "reisekosten", "provision"] as const) {
      await notifyRequestApproved({
        type,
        requestId: REQUEST_ID,
        applicant: seed.employee,
        summary: "ok",
      });
    }
    expect(mailbox.map((m) => [m.subject, m.linkPath])).toEqual([
      ["Urlaubsantrag genehmigt", `/urlaub/${REQUEST_ID}`],
      ["Reisekostenabrechnung genehmigt", `/reisekosten/${REQUEST_ID}`],
      ["Provisionsanspruch genehmigt", `/provision/${REQUEST_ID}`],
    ]);
  });
});

describe("notifyRequestRejected", () => {
  it("schickt der antragstellenden Person die Begründung", async () => {
    await notifyRequestRejected({
      type: "provision",
      requestId: REQUEST_ID,
      applicant: seed.employee,
      comment: "Bestelldatum fehlt.",
    });

    expect(mailbox).toHaveLength(1);
    expect(mailbox[0]).toMatchObject({
      to: [{ email: seed.employee.email, name: "Max Mitarbeiter" }],
      subject: "Provisionsanspruch beanstandet",
      heading: "Ihr Provisionsanspruch wurde beanstandet",
      paragraphs: [
        "Begründung: Bestelldatum fehlt.",
        "Sie können den Antrag korrigieren und erneut einreichen.",
      ],
      linkPath: `/provision/${REQUEST_ID}`,
    });
  });

  it("verlinkt auch bei Reisekosten auf die eigene Abrechnung", async () => {
    await notifyRequestRejected({
      type: "reisekosten",
      requestId: REQUEST_ID,
      applicant: seed.employee,
      comment: "Hotelbeleg fehlt.",
    });
    expect(mailbox[0]).toMatchObject({
      subject: "Reisekostenabrechnung beanstandet",
      linkPath: `/reisekosten/${REQUEST_ID}`,
    });
  });
});

describe("notifyCancellationConfirmed", () => {
  it("bestätigt den Storno und verweist auf den Urlaubsantrag", async () => {
    await notifyCancellationConfirmed({
      requestId: REQUEST_ID,
      applicant: seed.employee,
      summary: "Zeitraum 03.08.2026 bis 07.08.2026 storniert.",
    });

    expect(mailbox).toHaveLength(1);
    expect(mailbox[0]).toMatchObject({
      to: [{ email: seed.employee.email, name: "Max Mitarbeiter" }],
      subject: "Urlaubs-Storno bestätigt",
      heading: "Ihr Storno wurde bestätigt",
      paragraphs: [
        "Zeitraum 03.08.2026 bis 07.08.2026 storniert.",
        "Die Urlaubstage wurden Ihrem Konto wieder gutgeschrieben.",
      ],
      linkPath: `/urlaub/${REQUEST_ID}`,
    });
  });
});

describe("notifySickLeave", () => {
  it("meldet eine neue Krankmeldung nur den aktiven Admins, nicht der Vertretung", async () => {
    const vertretung = await createUser();
    await makeDeputy(vertretung);
    const exAdmin = await createUser({ role: "admin", status: "deaktiviert" });

    await notifySickLeave({
      sickLeaveId: REQUEST_ID,
      applicant: seed.employee,
      kind: "gemeldet",
      summary: "eigene Erkrankung, ab 10.08.2026, Ende offen.",
    });

    expect(mailbox).toHaveLength(1);
    expect(mailbox[0]).toMatchObject({
      to: [{ email: seed.admin.email, name: "Erika Admin" }],
      subject: "Krankmeldung eingegangen: Max Mitarbeiter",
      heading: "Neue Krankmeldung",
      paragraphs: ["eigene Erkrankung, ab 10.08.2026, Ende offen."],
      linkPath: `/krankmeldung/${REQUEST_ID}`,
    });
    expect(mailsTo(vertretung.email)).toHaveLength(0);
    expect(mailsTo(exAdmin.email)).toHaveLength(0);
  });

  it("meldet das nachgetragene Ende einer Krankmeldung", async () => {
    await notifySickLeave({
      sickLeaveId: REQUEST_ID,
      applicant: seed.employee,
      kind: "abgeschlossen",
      summary: "Abwesenheit von 10.08.2026 bis 12.08.2026 wurde abgeschlossen.",
    });

    expect(mailbox[0]).toMatchObject({
      subject: "Krankmeldung abgeschlossen: Max Mitarbeiter",
      heading: "Enddatum einer Krankmeldung nachgetragen",
      linkPath: `/krankmeldung/${REQUEST_ID}`,
    });
  });
});

describe("notifyFakturaEntryChanged", () => {
  it("informiert die betroffene Person mit Alt-/Neu-Werten", async () => {
    await notifyFakturaEntryChanged({
      employee: seed.employee,
      action: "angepasst",
      projectLabel: "ACME · Rollout",
      entryDateLabel: "01.10.2026",
      details: ["Dauer: 8,00 h → 6,50 h", "Begründung: Doppelbuchung"],
    });

    expect(mailbox).toHaveLength(1);
    expect(mailbox[0]).toMatchObject({
      to: [{ email: seed.employee.email, name: "Max Mitarbeiter" }],
      subject: "Zeitbuchung angepasst: ACME · Rollout (01.10.2026)",
      heading: "Eine Ihrer Zeitbuchungen wurde angepasst",
      paragraphs: [
        "Der Admin hat Ihre Zeitbuchung für ACME · Rollout am 01.10.2026 angepasst.",
        "Dauer: 8,00 h → 6,50 h",
        "Begründung: Doppelbuchung",
      ],
      linkPath: "/faktura",
      linkLabel: "Zur Zeiterfassung",
    });
  });
});

describe("notifyInvitation", () => {
  function invite(overrides: Partial<Parameters<typeof notifyInvitation>[0]> = {}) {
    return notifyInvitation({
      email: "neu@stefanai.de",
      name: "Nora Neu",
      invitationUrl: "https://clerk.test/einladung?ticket=abc",
      resent: false,
      ...overrides,
    });
  }

  it("lädt mit Aktivierungslink ein", async () => {
    await invite();

    expect(mailbox).toHaveLength(1);
    expect(mailbox[0]).toMatchObject({
      to: [{ email: "neu@stefanai.de", name: "Nora Neu" }],
      subject: "Ihre Einladung zum StefanAI Intranet",
      heading: "Willkommen, Nora Neu!",
      linkUrl: "https://clerk.test/einladung?ticket=abc",
      linkLabel: "Zugang aktivieren",
    });
    expect(mailbox[0].linkPath).toBeUndefined();
    expect(mailbox[0].paragraphs).toEqual([
      "Sie wurden zum Mitarbeiter-Intranet der StefanAI Solutions GmbH eingeladen.",
      "Über den folgenden Link vergeben Sie Ihr Passwort und aktivieren Ihren Zugang.",
    ]);
  });

  it("kennzeichnet eine erneut gesendete Einladung im Betreff", async () => {
    await invite({ resent: true });
    expect(mailbox[0].subject).toBe(
      "Ihre Einladung zum StefanAI Intranet (erneut gesendet)"
    );
  });

  it("weist vor dem Eintritt auf die Freischaltung ab dem Eintrittsdatum hin", async () => {
    await invite({ entryDate: "2099-01-04" });
    expect(mailbox[0].paragraphs).toHaveLength(3);
    expect(mailbox[0].paragraphs[2]).toBe(
      "Der Zugang zum Intranet ist ab Ihrem Eintrittsdatum am 04.01.2099 freigeschaltet — bis dahin ist eine Anmeldung noch nicht möglich."
    );
  });

  it("verzichtet auf den Hinweis bei Eintritt heute, in der Vergangenheit oder ohne Datum", async () => {
    await invite({ entryDate: toISODate(new Date()) });
    await invite({ entryDate: "2020-01-01" });
    await invite({ entryDate: null });

    expect(mailbox).toHaveLength(3);
    for (const m of mailbox) {
      expect(m.paragraphs).toHaveLength(2);
      expect(m.paragraphs.join(" ")).not.toContain("Eintrittsdatum");
    }
  });
});
