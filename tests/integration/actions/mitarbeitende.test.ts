import { and, eq, notInArray } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteEmployeeDocument,
  inviteUser,
  resendInvitation,
  setUserStatus,
  updateUserBirthday,
  updateUserEntry,
  updateUserSupervisors,
  updateUserVacation,
  uploadEmployeeDocuments,
} from "@/app/(app)/mitarbeitende/actions";
import { decryptDocument } from "@/lib/document-crypto";
import * as schema from "../../../src/db/schema";
import { actAs, auditFor, createUser, formData, testFile } from "../../helpers/actions";
import { resetDb, seedTestData, testDb, type SeedResult } from "../../helpers/db";
import {
  blobModule,
  blobStore,
  clerkBackend,
  mailbox,
  mailsTo,
  nextCacheModule,
} from "../../helpers/framework-fakes";

let seed: SeedResult;

const ADMIN_ONLY = "Nur für den Admin zulässig.";
const UNKNOWN_ID = "00000000-0000-4000-8000-0000000000aa";
const APP_LOGIN_URL = `${process.env.APP_BASE_URL ?? "http://localhost:3000"}/anmelden`;
const NEXT_YEAR = new Date().getFullYear() + 1;

const INVITE = {
  firstName: "Nina",
  lastName: "Neu",
  email: "nina.neu@stefanai.de",
  annualVacationDays: "28",
  entryDate: "2026-01-15",
  entryYearVacationDays: "20",
  birthDate: "1990-04-12",
};

const PDF_CONTENT = "%PDF-1.4 Arbeitsvertrag Nina Neu — streng vertraulich";

async function loadUser(id: string) {
  const row = await testDb().query.users.findFirst({ where: eq(schema.users.id, id) });
  if (!row) throw new Error("User fehlt");
  return row;
}

async function userByEmail(email: string) {
  return testDb().query.users.findFirst({ where: eq(schema.users.email, email) });
}

async function documentsOf(userId: string) {
  return testDb()
    .select()
    .from(schema.employeeDocuments)
    .where(eq(schema.employeeDocuments.userId, userId));
}

/** Konsolen-Fehlerausgabe erwarteter Fehlerpfade stummschalten */
function silenceConsoleError() {
  return vi.spyOn(console, "error").mockImplementation(() => {});
}

/** Ein Dokument über die Action hochladen und die DB-Zeile liefern. */
async function uploadOne(userId: string, file = testFile("vertrag.pdf", PDF_CONTENT)) {
  await uploadEmployeeDocuments(
    userId,
    formData({ documents: file, category: "arbeitsvertrag" })
  );
  const [doc] = await documentsOf(userId);
  return doc;
}

beforeAll(async () => {
  await resetDb();
  seed = await seedTestData();
});

beforeEach(async () => {
  const db = testDb();
  await db.delete(schema.employeeDocuments);
  await db.delete(schema.auditLog);
  await db.delete(schema.deputyAssignments);
  await db
    .update(schema.users)
    .set({
      status: "aktiv",
      entryDate: null,
      entryYearVacationDays: null,
      birthDate: null,
      annualVacationDays: 30,
      vacationCarryoverDays: 0,
      technicalSupervisorId: null,
      disciplinarySupervisorId: null,
      isManagingDirector: false,
    })
    .where(eq(schema.users.id, seed.employee.id));
  await db
    .delete(schema.users)
    .where(notInArray(schema.users.id, [seed.admin.id, seed.employee.id]));
  blobStore.clear();
  await actAs(seed.admin);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("inviteUser", () => {
  it("legt den User als eingeladen an, erzeugt die Clerk-Einladung und versendet die Mail", async () => {
    await inviteUser(formData({ ...INVITE, email: "  Nina.Neu@StefanAI.de " }));

    const user = await userByEmail("nina.neu@stefanai.de");
    expect(user).toMatchObject({
      firstName: "Nina",
      lastName: "Neu",
      role: "mitarbeiter",
      status: "eingeladen",
      clerkId: null,
      annualVacationDays: 28,
      entryDate: "2026-01-15",
      entryYearVacationDays: 20,
      birthDate: "1990-04-12",
    });

    expect(clerkBackend.invitations.createInvitation).toHaveBeenCalledWith({
      emailAddress: "nina.neu@stefanai.de",
      redirectUrl: APP_LOGIN_URL,
      ignoreExisting: true,
      notify: false,
    });

    const mails = mailsTo("nina.neu@stefanai.de");
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({
      subject: "Ihre Einladung zum StefanAI Intranet",
      heading: "Willkommen, Nina Neu!",
      linkUrl: "https://clerk.test/einladung?mail=nina.neu%40stefanai.de",
      linkLabel: "Zugang aktivieren",
    });
    // Eintritt liegt in der Vergangenheit → kein Hinweis auf gesperrten Zugang
    expect(mails[0].paragraphs.join(" ")).not.toContain("freigeschaltet");

    expect((await auditFor("user", user!.id))[0]).toMatchObject({
      action: "eingeladen",
      actorUserId: seed.admin.id,
      source: "web",
      details: {
        email: "nina.neu@stefanai.de",
        jahresurlaub: 28,
        eintrittsdatum: "2026-01-15",
        resturlaubEintrittsjahr: 20,
        geburtsdatum: "1990-04-12",
      },
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/mitarbeitende");
  });

  it("weist in der Mail auf den gesperrten Zugang bis zum Eintrittsdatum hin", async () => {
    await inviteUser(formData({ ...INVITE, entryDate: `${NEXT_YEAR}-02-01` }));
    const [mail] = mailsTo(INVITE.email);
    expect(mail.paragraphs.join(" ")).toContain(
      `ab Ihrem Eintrittsdatum am 01.02.${NEXT_YEAR} freigeschaltet`
    );
  });

  it("übernimmt ein leeres Geburtsdatum als null", async () => {
    await inviteUser(formData({ ...INVITE, birthDate: "" }));
    expect((await userByEmail(INVITE.email))?.birthDate).toBeNull();
  });

  it("lädt mitgelieferte Dokumente verschlüsselt mit der gewählten Kategorie hoch", async () => {
    await inviteUser(
      formData({
        ...INVITE,
        documents: [
          testFile("vertrag.pdf", PDF_CONTENT),
          testFile("ausweis.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), "image/png"),
        ],
        documentCategory: "arbeitsvertrag",
      })
    );

    const user = await userByEmail(INVITE.email);
    const docs = await documentsOf(user!.id);
    expect(docs).toHaveLength(2);
    expect(docs.map((d) => d.filename).sort()).toEqual(["ausweis.png", "vertrag.pdf"]);
    for (const doc of docs) {
      expect(doc).toMatchObject({
        category: "arbeitsvertrag",
        title: null,
        uploadedById: seed.admin.id,
        keyVersion: 1,
      });
      expect(blobStore.has(doc.blobUrl)).toBe(true);
    }
    const pdf = docs.find((d) => d.filename === "vertrag.pdf")!;
    expect(decryptDocument(blobStore.get(pdf.blobUrl)!.body).toString()).toBe(PDF_CONTENT);
    expect(await auditFor("dokument")).toHaveLength(2);
  });

  it("legt ohne Dokument-Kategorie unter „sonstiges“ ab", async () => {
    await inviteUser(formData({ ...INVITE, documents: testFile("scan.pdf") }));
    const user = await userByEmail(INVITE.email);
    expect((await documentsOf(user!.id))[0].category).toBe("sonstiges");
  });

  it("lädt bei einem Clerk-Fehler trotzdem ein und verlinkt die Anmeldeseite", async () => {
    silenceConsoleError();
    clerkBackend.invitations.createInvitation.mockRejectedValueOnce(
      new Error("Clerk nicht erreichbar")
    );

    await inviteUser(formData(INVITE));

    expect((await userByEmail(INVITE.email))?.status).toBe("eingeladen");
    const [mail] = mailsTo(INVITE.email);
    expect(mail.linkUrl).toBe(APP_LOGIN_URL);
  });

  it.each([
    ["fremde Domain", "nina@example.com"],
    ["Domain nur als Präfix", "nina@stefanai.de.example.com"],
  ])("lehnt Adressen außerhalb der Firmendomain ab (%s)", async (_label, email) => {
    await expect(inviteUser(formData({ ...INVITE, email }))).rejects.toThrow(
      "Zulässig sind ausschließlich Adressen der Domain @stefanai.de."
    );
    expect(await userByEmail(email)).toBeUndefined();
    expect(clerkBackend.invitations.createInvitation).not.toHaveBeenCalled();
    expect(mailbox).toHaveLength(0);
  });

  it("lehnt eine bereits vorhandene E-Mail-Adresse ab (unabhängig von Groß-/Kleinschreibung)", async () => {
    await expect(
      inviteUser(formData({ ...INVITE, email: seed.employee.email.toUpperCase() }))
    ).rejects.toThrow("Für diese E-Mail-Adresse existiert bereits ein Konto.");
    expect(clerkBackend.invitations.createInvitation).not.toHaveBeenCalled();
    expect(mailbox).toHaveLength(0);
  });

  it.each([
    ["Vorname fehlt", { firstName: "" }, "Bitte Vornamen angeben."],
    ["Nachname fehlt", { lastName: "" }, "Bitte Nachnamen angeben."],
    ["ungültige E-Mail", { email: "keine-mail" }, "Ungültige E-Mail-Adresse."],
    ["Jahresurlaub < 0,5", { annualVacationDays: "0" }, "Der Jahresurlaubsanspruch ist Pflichtfeld."],
    ["Jahresurlaub fehlt", { annualVacationDays: undefined }, "Der Jahresurlaubsanspruch ist Pflichtfeld."],
    ["Eintrittsdatum fehlt", { entryDate: "" }, "Bitte ein Eintrittsdatum angeben."],
    ["Eintrittsdatum im falschen Format", { entryDate: "15.01.2026" }, "Bitte ein Eintrittsdatum angeben."],
    [
      "Resturlaub mit Komma",
      { entryYearVacationDays: "2,5" },
      "Der Resturlaub im Eintrittsjahr ist als ganze Zahl anzugeben.",
    ],
    [
      "Resturlaub leer",
      { entryYearVacationDays: "" },
      "Der Resturlaub im Eintrittsjahr ist als ganze Zahl anzugeben.",
    ],
    [
      "Resturlaub negativ",
      { entryYearVacationDays: "-3" },
      "Der Resturlaub im Eintrittsjahr ist als ganze Zahl anzugeben.",
    ],
    ["Geburtsdatum im falschen Format", { birthDate: "12.04.1990" }, "Ungültiges Geburtsdatum."],
    [
      "Geburtsdatum in der Zukunft",
      { birthDate: `${NEXT_YEAR}-01-01` },
      "Das Geburtsdatum muss in der Vergangenheit liegen.",
    ],
  ])("validiert die Eingaben: %s", async (_label, overrides, message) => {
    await expect(inviteUser(formData({ ...INVITE, ...overrides }))).rejects.toThrow(message);
    expect(await userByEmail(INVITE.email)).toBeUndefined();
    expect(clerkBackend.invitations.createInvitation).not.toHaveBeenCalled();
    expect(mailbox).toHaveLength(0);
  });

  it("prüft Dokumente vor der Einladung — eine ungültige Datei legt keinen halben User an", async () => {
    await expect(
      inviteUser(
        formData({
          ...INVITE,
          documents: [testFile("vertrag.pdf"), testFile("notiz.txt", "Hallo", "text/plain")],
        })
      )
    ).rejects.toThrow('Dokument "notiz.txt": Nur PDF, JPG oder PNG sind zulässig.');
    expect(await userByEmail(INVITE.email)).toBeUndefined();
    expect(clerkBackend.invitations.createInvitation).not.toHaveBeenCalled();
    expect(blobStore.size).toBe(0);
    expect(mailbox).toHaveLength(0);
  });

  it("lehnt eine ungültige Dokument-Kategorie vor der Einladung ab", async () => {
    await expect(
      inviteUser(
        formData({ ...INVITE, documents: testFile("vertrag.pdf"), documentCategory: "gehalt" })
      )
    ).rejects.toThrow("Ungültige Dokument-Kategorie.");
    expect(await userByEmail(INVITE.email)).toBeUndefined();
    expect(clerkBackend.invitations.createInvitation).not.toHaveBeenCalled();
  });

  it("lehnt Mitarbeitende ab", async () => {
    await actAs(seed.employee);
    await expect(inviteUser(formData(INVITE))).rejects.toThrow(ADMIN_ONLY);
    expect(await userByEmail(INVITE.email)).toBeUndefined();
    expect(clerkBackend.invitations.createInvitation).not.toHaveBeenCalled();
    expect(mailbox).toHaveLength(0);
  });
});

describe("resendInvitation", () => {
  it("erzeugt eine neue Clerk-Einladung, versendet die Mail erneut und auditiert", async () => {
    const invited = await createUser({
      firstName: "Ida",
      lastName: "Eingeladen",
      status: "eingeladen",
      entryDate: `${NEXT_YEAR}-03-01`,
    });

    await resendInvitation(invited.id);

    expect(clerkBackend.invitations.createInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ emailAddress: invited.email, notify: false })
    );
    const mails = mailsTo(invited.email);
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({
      subject: "Ihre Einladung zum StefanAI Intranet (erneut gesendet)",
      heading: "Willkommen, Ida Eingeladen!",
      linkUrl: expect.stringContaining("https://clerk.test/einladung"),
    });
    expect(mails[0].paragraphs.join(" ")).toContain(`01.03.${NEXT_YEAR}`);
    expect((await auditFor("user", invited.id))[0]).toMatchObject({
      action: "einladung_erneut_versendet",
      actorUserId: seed.admin.id,
      source: "web",
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/mitarbeitende");
  });

  it("fällt bei einem Clerk-Fehler auf den Link zur Anmeldeseite zurück", async () => {
    silenceConsoleError();
    const invited = await createUser({ status: "eingeladen" });
    clerkBackend.invitations.createInvitation.mockRejectedValueOnce(new Error("Clerk down"));

    await resendInvitation(invited.id);

    expect(mailsTo(invited.email)[0].linkUrl).toBe(APP_LOGIN_URL);
  });

  it.each(["aktiv", "deaktiviert"] as const)(
    "lädt nur eingeladene User erneut ein (Status %s)",
    async (status) => {
      const user = await createUser({ status });
      await expect(resendInvitation(user.id)).rejects.toThrow(
        "Nur eingeladene User können erneut eingeladen werden."
      );
      expect(clerkBackend.invitations.createInvitation).not.toHaveBeenCalled();
      expect(mailbox).toHaveLength(0);
    }
  );

  it("meldet einen unbekannten User", async () => {
    await expect(resendInvitation(UNKNOWN_ID)).rejects.toThrow("User nicht gefunden.");
  });

  it("lehnt Mitarbeitende ab", async () => {
    const invited = await createUser({ status: "eingeladen" });
    await actAs(seed.employee);
    await expect(resendInvitation(invited.id)).rejects.toThrow(ADMIN_ONLY);
    expect(mailbox).toHaveLength(0);
  });
});

describe("updateUserVacation", () => {
  it("speichert Jahresanspruch und Übertrag und auditiert", async () => {
    await updateUserVacation(
      seed.employee.id,
      formData({ annualVacationDays: "28.5", vacationCarryoverDays: "3" })
    );

    expect(await loadUser(seed.employee.id)).toMatchObject({
      annualVacationDays: 28.5,
      vacationCarryoverDays: 3,
    });
    expect((await auditFor("user", seed.employee.id))[0]).toMatchObject({
      action: "urlaubsanspruch_geaendert",
      actorUserId: seed.admin.id,
      source: "web",
      details: { jahresurlaub: 28.5, uebertrag: 3 },
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/mitarbeitende");
  });

  it.each([
    ["negativ", "-1"],
    ["nicht-numerisch", "dreißig"],
  ])("lehnt einen ungültigen Jahresanspruch ab (%s)", async (_label, value) => {
    await expect(
      updateUserVacation(
        seed.employee.id,
        formData({ annualVacationDays: value, vacationCarryoverDays: "0" })
      )
    ).rejects.toThrow("Ungültiger Jahresurlaubsanspruch.");
    expect((await loadUser(seed.employee.id)).annualVacationDays).toBe(30);
    expect(await auditFor("user", seed.employee.id)).toHaveLength(0);
  });

  it("setzt einen ungültigen Übertrag derzeit still auf 0", async () => {
    await updateUserVacation(
      seed.employee.id,
      formData({ annualVacationDays: "30", vacationCarryoverDays: "zwei" })
    );
    expect((await loadUser(seed.employee.id)).vacationCarryoverDays).toBe(0);
  });

  it("übernimmt einen negativen Übertrag", async () => {
    await updateUserVacation(
      seed.employee.id,
      formData({ annualVacationDays: "30", vacationCarryoverDays: "-2" })
    );
    expect((await loadUser(seed.employee.id)).vacationCarryoverDays).toBe(-2);
  });

  it("speichert einen leeren Jahresanspruch derzeit als 0 Tage", async () => {
    await updateUserVacation(
      seed.employee.id,
      formData({ annualVacationDays: "", vacationCarryoverDays: "" })
    );
    expect(await loadUser(seed.employee.id)).toMatchObject({
      annualVacationDays: 0,
      vacationCarryoverDays: 0,
    });
  });

  it("lehnt einen unbekannten User ab und auditiert nichts", async () => {
    await expect(
      updateUserVacation(
        UNKNOWN_ID,
        formData({ annualVacationDays: "25", vacationCarryoverDays: "0" })
      )
    ).rejects.toThrow("User nicht gefunden.");
    expect(await auditFor("user", UNKNOWN_ID)).toHaveLength(0);
  });

  it("lehnt Mitarbeitende ab — auch für das eigene Konto", async () => {
    await actAs(seed.employee);
    await expect(
      updateUserVacation(
        seed.employee.id,
        formData({ annualVacationDays: "40", vacationCarryoverDays: "10" })
      )
    ).rejects.toThrow(ADMIN_ONLY);
    expect((await loadUser(seed.employee.id)).annualVacationDays).toBe(30);
  });
});

describe("updateUserEntry", () => {
  it("speichert Eintrittsdatum und Resturlaub und auditiert", async () => {
    await updateUserEntry(
      seed.employee.id,
      formData({ entryDate: "2026-11-01", entryYearVacationDays: " 5 " })
    );

    expect(await loadUser(seed.employee.id)).toMatchObject({
      entryDate: "2026-11-01",
      entryYearVacationDays: 5,
    });
    expect((await auditFor("user", seed.employee.id))[0]).toMatchObject({
      action: "eintritt_geaendert",
      actorUserId: seed.admin.id,
      source: "web",
      details: { eintrittsdatum: "2026-11-01", resturlaubEintrittsjahr: 5 },
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/mitarbeitende");
  });

  it("leert Eintrittsdatum und Resturlaub, wenn kein Datum angegeben ist", async () => {
    await updateUserEntry(
      seed.employee.id,
      formData({ entryDate: "2026-11-01", entryYearVacationDays: "5" })
    );

    await updateUserEntry(
      seed.employee.id,
      formData({ entryDate: "", entryYearVacationDays: "12" })
    );

    expect(await loadUser(seed.employee.id)).toMatchObject({
      entryDate: null,
      entryYearVacationDays: null,
    });
    expect((await auditFor("user", seed.employee.id))[0].details).toEqual({
      eintrittsdatum: null,
      resturlaubEintrittsjahr: null,
    });
  });

  it.each([
    ["fehlt", ""],
    ["mit Komma", "2,5"],
    ["negativ", "-1"],
  ])("verlangt bei gesetztem Datum den Resturlaub als ganze Zahl (%s)", async (_label, days) => {
    await expect(
      updateUserEntry(
        seed.employee.id,
        formData({ entryDate: "2026-11-01", entryYearVacationDays: days })
      )
    ).rejects.toThrow("Der Resturlaub im Eintrittsjahr ist als ganze Zahl anzugeben.");
    expect((await loadUser(seed.employee.id)).entryDate).toBeNull();
  });

  it("lehnt ein ungültiges Datumsformat ab", async () => {
    await expect(
      updateUserEntry(
        seed.employee.id,
        formData({ entryDate: "01.11.2026", entryYearVacationDays: "5" })
      )
    ).rejects.toThrow("Ungültiges Eintrittsdatum.");
  });

  it("meldet einen unbekannten User", async () => {
    await expect(
      updateUserEntry(UNKNOWN_ID, formData({ entryDate: "", entryYearVacationDays: "" }))
    ).rejects.toThrow("User nicht gefunden.");
  });

  it("lehnt Mitarbeitende ab", async () => {
    await actAs(seed.employee);
    await expect(
      updateUserEntry(
        seed.employee.id,
        formData({ entryDate: "2026-11-01", entryYearVacationDays: "5" })
      )
    ).rejects.toThrow(ADMIN_ONLY);
    expect((await loadUser(seed.employee.id)).entryDate).toBeNull();
  });
});

describe("updateUserBirthday", () => {
  it("speichert das Geburtsdatum, auditiert und aktualisiert den Kalender", async () => {
    await updateUserBirthday(seed.employee.id, formData({ birthDate: "1990-05-17" }));

    expect((await loadUser(seed.employee.id)).birthDate).toBe("1990-05-17");
    expect((await auditFor("user", seed.employee.id))[0]).toMatchObject({
      action: "geburtsdatum_geaendert",
      actorUserId: seed.admin.id,
      source: "web",
      details: { geburtsdatum: "1990-05-17" },
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/mitarbeitende");
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/kalender");
  });

  it("leert das Geburtsdatum", async () => {
    await updateUserBirthday(seed.employee.id, formData({ birthDate: "1990-05-17" }));
    await updateUserBirthday(seed.employee.id, formData({ birthDate: "  " }));
    expect((await loadUser(seed.employee.id)).birthDate).toBeNull();
    expect((await auditFor("user", seed.employee.id))[0].details).toEqual({
      geburtsdatum: null,
    });
  });

  it("lehnt ein Geburtsdatum in der Zukunft ab", async () => {
    await expect(
      updateUserBirthday(seed.employee.id, formData({ birthDate: `${NEXT_YEAR}-01-01` }))
    ).rejects.toThrow("Das Geburtsdatum muss in der Vergangenheit liegen.");
    expect((await loadUser(seed.employee.id)).birthDate).toBeNull();
  });

  it("lehnt ein ungültiges Format ab", async () => {
    await expect(
      updateUserBirthday(seed.employee.id, formData({ birthDate: "17.05.1990" }))
    ).rejects.toThrow("Ungültiges Geburtsdatum.");
  });

  it("meldet einen unbekannten User", async () => {
    await expect(
      updateUserBirthday(UNKNOWN_ID, formData({ birthDate: "1990-05-17" }))
    ).rejects.toThrow("User nicht gefunden.");
  });

  it("lehnt Mitarbeitende ab", async () => {
    await actAs(seed.employee);
    await expect(
      updateUserBirthday(seed.employee.id, formData({ birthDate: "1990-05-17" }))
    ).rejects.toThrow(ADMIN_ONLY);
    expect((await loadUser(seed.employee.id)).birthDate).toBeNull();
  });
});

describe("updateUserSupervisors", () => {
  it("ordnet fachliche/n und disziplinarische/n Vorgesetzte/n zu und auditiert", async () => {
    const lead = await createUser({ firstName: "Lea", lastName: "Lead" });

    await updateUserSupervisors(
      seed.employee.id,
      formData({ technicalSupervisorId: lead.id, disciplinarySupervisorId: seed.admin.id })
    );

    expect(await loadUser(seed.employee.id)).toMatchObject({
      technicalSupervisorId: lead.id,
      disciplinarySupervisorId: seed.admin.id,
      isManagingDirector: false,
    });
    expect((await auditFor("user", seed.employee.id))[0]).toMatchObject({
      action: "vorgesetzte_geaendert",
      actorUserId: seed.admin.id,
      source: "web",
      details: {
        geschaeftsfuehrung: false,
        fachlicherVorgesetzter: lead.id,
        disziplinarischerVorgesetzter: seed.admin.id,
      },
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/mitarbeitende");
  });

  it("leert Zuordnungen bei leerer Auswahl", async () => {
    await updateUserSupervisors(
      seed.employee.id,
      formData({ technicalSupervisorId: seed.admin.id, disciplinarySupervisorId: seed.admin.id })
    );
    await updateUserSupervisors(
      seed.employee.id,
      formData({ technicalSupervisorId: "", disciplinarySupervisorId: "" })
    );
    expect(await loadUser(seed.employee.id)).toMatchObject({
      technicalSupervisorId: null,
      disciplinarySupervisorId: null,
    });
  });

  it("Geschäftsführung leert beide Zuordnungen, auch wenn welche mitgeschickt werden", async () => {
    await updateUserSupervisors(
      seed.employee.id,
      formData({ technicalSupervisorId: seed.admin.id, disciplinarySupervisorId: seed.admin.id })
    );

    await updateUserSupervisors(
      seed.employee.id,
      formData({
        isManagingDirector: "on",
        technicalSupervisorId: seed.admin.id,
        disciplinarySupervisorId: seed.employee.id,
      })
    );

    expect(await loadUser(seed.employee.id)).toMatchObject({
      isManagingDirector: true,
      technicalSupervisorId: null,
      disciplinarySupervisorId: null,
    });
    expect((await auditFor("user", seed.employee.id))[0].details).toEqual({
      geschaeftsfuehrung: true,
      fachlicherVorgesetzter: null,
      disziplinarischerVorgesetzter: null,
    });
  });

  it.each(["technicalSupervisorId", "disciplinarySupervisorId"])(
    "lehnt die Person als eigene/n Vorgesetzte/n ab (%s)",
    async (field) => {
      await expect(
        updateUserSupervisors(seed.employee.id, formData({ [field]: seed.employee.id }))
      ).rejects.toThrow("Mitarbeitende können nicht ihre eigenen Vorgesetzten sein.");
      expect(await auditFor("user", seed.employee.id)).toHaveLength(0);
    }
  );

  it("lehnt eine/n unbekannte/n Vorgesetzte/n ab", async () => {
    await expect(
      updateUserSupervisors(seed.employee.id, formData({ disciplinarySupervisorId: UNKNOWN_ID }))
    ).rejects.toThrow("Ausgewählte/r Vorgesetzte/r nicht gefunden.");
    expect((await loadUser(seed.employee.id)).disciplinarySupervisorId).toBeNull();
  });

  it("meldet einen unbekannten User", async () => {
    await expect(updateUserSupervisors(UNKNOWN_ID, formData({}))).rejects.toThrow(
      "User nicht gefunden."
    );
  });

  it("lehnt Mitarbeitende ab", async () => {
    await actAs(seed.employee);
    await expect(
      updateUserSupervisors(seed.employee.id, formData({ technicalSupervisorId: seed.admin.id }))
    ).rejects.toThrow(ADMIN_ONLY);
    expect((await loadUser(seed.employee.id)).technicalSupervisorId).toBeNull();
  });
});

describe("setUserStatus", () => {
  it("deaktiviert ein Konto, sperrt es in Clerk und auditiert", async () => {
    const user = await createUser({ clerkId: "user_clerk_offboarding" });

    await setUserStatus(user.id, "deaktiviert");

    expect((await loadUser(user.id)).status).toBe("deaktiviert");
    expect(clerkBackend.users.banUser).toHaveBeenCalledWith("user_clerk_offboarding");
    expect(clerkBackend.users.unbanUser).not.toHaveBeenCalled();
    expect((await auditFor("user", user.id))[0]).toMatchObject({
      action: "deaktiviert",
      actorUserId: seed.admin.id,
      source: "web",
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/mitarbeitende");

    // Das deaktivierte Konto kommt nicht mehr in die App
    await actAs(user);
    await expect(updateUserVacation(user.id, formData({}))).rejects.toThrow("Nicht angemeldet");
  });

  it("reaktiviert ein Konto und entsperrt es in Clerk", async () => {
    const user = await createUser({ clerkId: "user_clerk_rueckkehr", status: "deaktiviert" });

    await setUserStatus(user.id, "aktiv");

    expect((await loadUser(user.id)).status).toBe("aktiv");
    expect(clerkBackend.users.unbanUser).toHaveBeenCalledWith("user_clerk_rueckkehr");
    expect(clerkBackend.users.banUser).not.toHaveBeenCalled();
    expect((await auditFor("user", user.id))[0].action).toBe("reaktiviert");
  });

  it("ruft Clerk ohne verknüpftes Konto nicht auf", async () => {
    const invited = await createUser({ status: "eingeladen" });
    await setUserStatus(invited.id, "deaktiviert");
    expect((await loadUser(invited.id)).status).toBe("deaktiviert");
    expect(clerkBackend.users.banUser).not.toHaveBeenCalled();
  });

  it("deaktiviert auch dann, wenn Clerk einen Fehler meldet", async () => {
    silenceConsoleError();
    const user = await createUser({ clerkId: "user_clerk_fehler" });
    clerkBackend.users.banUser.mockRejectedValueOnce(new Error("Clerk down"));

    await setUserStatus(user.id, "deaktiviert");

    expect((await loadUser(user.id)).status).toBe("deaktiviert");
    expect((await auditFor("user", user.id))[0].action).toBe("deaktiviert");
  });

  it("verhindert, dass der Admin das eigene Konto deaktiviert", async () => {
    await expect(setUserStatus(seed.admin.id, "deaktiviert")).rejects.toThrow(
      "Das eigene Admin-Konto kann nicht deaktiviert werden."
    );
    expect((await loadUser(seed.admin.id)).status).toBe("aktiv");
    expect(clerkBackend.users.banUser).not.toHaveBeenCalled();
  });

  it("meldet einen unbekannten User", async () => {
    await expect(setUserStatus(UNKNOWN_ID, "deaktiviert")).rejects.toThrow(
      "User nicht gefunden."
    );
  });

  it("lehnt Mitarbeitende ab", async () => {
    const colleague = await createUser({ clerkId: "user_clerk_kollege" });
    await actAs(seed.employee);
    await expect(setUserStatus(colleague.id, "deaktiviert")).rejects.toThrow(ADMIN_ONLY);
    expect((await loadUser(colleague.id)).status).toBe("aktiv");
    expect(clerkBackend.users.banUser).not.toHaveBeenCalled();
  });
});

describe("uploadEmployeeDocuments", () => {
  it("legt das Dokument nur als Ciphertext ab, speichert die Metadaten und auditiert", async () => {
    await uploadEmployeeDocuments(
      seed.employee.id,
      formData({
        documents: testFile("vertrag.pdf", PDF_CONTENT),
        category: "arbeitsvertrag",
        title: "  Arbeitsvertrag vom 01.01.2026 ",
      })
    );

    const [doc] = await documentsOf(seed.employee.id);
    expect(doc).toMatchObject({
      category: "arbeitsvertrag",
      title: "Arbeitsvertrag vom 01.01.2026",
      filename: "vertrag.pdf",
      contentType: "application/pdf",
      sizeBytes: Buffer.byteLength(PDF_CONTENT),
      keyVersion: 1,
      uploadedById: seed.admin.id,
    });

    // Blob: neutraler Pfad, neutraler Typ, nur Ciphertext
    expect(blobModule.put).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(`^dokumente/${seed.employee.id}/[0-9a-f-]{36}\\.bin$`)
      ),
      expect.anything(),
      { access: "public", addRandomSuffix: false, contentType: "application/octet-stream" }
    );
    const blob = blobStore.get(doc.blobUrl)!;
    expect(blob.pathname).not.toContain("vertrag");
    expect(blob.contentType).toBe("application/octet-stream");
    expect(blob.body.equals(Buffer.from(PDF_CONTENT))).toBe(false);
    expect(blob.body.includes(Buffer.from("Arbeitsvertrag"))).toBe(false);
    expect(decryptDocument(blob.body).toString()).toBe(PDF_CONTENT);

    expect((await auditFor("dokument", doc.id))[0]).toMatchObject({
      action: "hochgeladen",
      actorUserId: seed.admin.id,
      source: "web",
      details: {
        userId: seed.employee.id,
        filename: "vertrag.pdf",
        kategorie: "arbeitsvertrag",
      },
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/mitarbeitende");
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/dokumente");
  });

  it("lädt mehrere Dateien auf einmal hoch (PDF, JPG, PNG)", async () => {
    await uploadEmployeeDocuments(
      seed.employee.id,
      formData({
        documents: [
          testFile("a.pdf"),
          testFile("b.jpg", Buffer.from([0xff, 0xd8, 0xff]), "image/jpeg"),
          testFile("c.png", Buffer.from([0x89, 0x50, 0x4e, 0x47]), "image/png"),
        ],
        category: "bescheinigung",
      })
    );

    const docs = await documentsOf(seed.employee.id);
    expect(docs.map((d) => d.filename).sort()).toEqual(["a.pdf", "b.jpg", "c.png"]);
    expect(docs.every((d) => d.category === "bescheinigung")).toBe(true);
    expect(blobStore.size).toBe(3);
    expect(await auditFor("dokument")).toHaveLength(3);
  });

  it("nutzt ohne Angabe die Kategorie „sonstiges“ und keinen Titel", async () => {
    await uploadEmployeeDocuments(seed.employee.id, formData({ documents: testFile("x.pdf") }));
    expect((await documentsOf(seed.employee.id))[0]).toMatchObject({
      category: "sonstiges",
      title: null,
    });
  });

  it("akzeptiert eine Datei mit genau 10 MB", async () => {
    await uploadEmployeeDocuments(
      seed.employee.id,
      formData({ documents: testFile("gross.pdf", Buffer.alloc(10 * 1024 * 1024)) })
    );
    expect(await documentsOf(seed.employee.id)).toHaveLength(1);
  });

  it("lehnt Dateien über 10 MB ab", async () => {
    await expect(
      uploadEmployeeDocuments(
        seed.employee.id,
        formData({ documents: testFile("riesig.pdf", Buffer.alloc(10 * 1024 * 1024 + 1)) })
      )
    ).rejects.toThrow('Dokument "riesig.pdf": Maximal 10 MB pro Datei sind zulässig.');
    expect(blobStore.size).toBe(0);
  });

  it("lehnt andere Dateitypen ab und lädt dann auch die gültigen Dateien nicht hoch", async () => {
    await expect(
      uploadEmployeeDocuments(
        seed.employee.id,
        formData({
          documents: [testFile("ok.pdf"), testFile("seite.html", "<script>", "text/html")],
        })
      )
    ).rejects.toThrow('Dokument "seite.html": Nur PDF, JPG oder PNG sind zulässig.');
    expect(await documentsOf(seed.employee.id)).toHaveLength(0);
    expect(blobStore.size).toBe(0);
    expect(await auditFor("dokument")).toHaveLength(0);
  });

  it("lehnt eine ungültige Kategorie ab", async () => {
    await expect(
      uploadEmployeeDocuments(
        seed.employee.id,
        formData({ documents: testFile("x.pdf"), category: "gehaltsabrechnung" })
      )
    ).rejects.toThrow("Ungültige Dokument-Kategorie.");
    expect(blobStore.size).toBe(0);
  });

  it("verlangt mindestens eine (nicht leere) Datei", async () => {
    await expect(
      uploadEmployeeDocuments(seed.employee.id, formData({ category: "sonstiges" }))
    ).rejects.toThrow("Bitte mindestens eine Datei auswählen.");
    await expect(
      uploadEmployeeDocuments(seed.employee.id, formData({ documents: testFile("leer.pdf", "") }))
    ).rejects.toThrow("Bitte mindestens eine Datei auswählen.");
  });

  it("meldet einen unbekannten User", async () => {
    await expect(
      uploadEmployeeDocuments(UNKNOWN_ID, formData({ documents: testFile("x.pdf") }))
    ).rejects.toThrow("User nicht gefunden.");
    expect(blobStore.size).toBe(0);
  });

  it("lehnt Mitarbeitende ab — auch für das eigene Konto", async () => {
    await actAs(seed.employee);
    await expect(
      uploadEmployeeDocuments(seed.employee.id, formData({ documents: testFile("x.pdf") }))
    ).rejects.toThrow(ADMIN_ONLY);
    expect(blobStore.size).toBe(0);
    expect(await documentsOf(seed.employee.id)).toHaveLength(0);
  });
});

describe("deleteEmployeeDocument", () => {
  it("löscht DB-Zeile und Blob und auditiert", async () => {
    const doc = await uploadOne(seed.employee.id);
    expect(blobStore.has(doc.blobUrl)).toBe(true);

    await deleteEmployeeDocument(doc.id);

    expect(await documentsOf(seed.employee.id)).toHaveLength(0);
    expect(blobModule.del).toHaveBeenCalledWith(doc.blobUrl);
    expect(blobStore.has(doc.blobUrl)).toBe(false);
    expect((await auditFor("dokument", doc.id))[0]).toMatchObject({
      action: "geloescht",
      actorUserId: seed.admin.id,
      source: "web",
      details: {
        userId: seed.employee.id,
        filename: "vertrag.pdf",
        kategorie: "arbeitsvertrag",
      },
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/mitarbeitende");
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/dokumente");
  });

  it("löscht die DB-Zeile auch dann, wenn das Entfernen des Blobs scheitert", async () => {
    silenceConsoleError();
    const doc = await uploadOne(seed.employee.id);
    blobModule.del.mockRejectedValueOnce(new Error("Blob-Speicher nicht erreichbar"));

    await deleteEmployeeDocument(doc.id);

    expect(await documentsOf(seed.employee.id)).toHaveLength(0);
    // Übrig bleibt nur der verwaiste Ciphertext
    expect(blobStore.has(doc.blobUrl)).toBe(true);
    expect((await auditFor("dokument", doc.id))[0].action).toBe("geloescht");
  });

  it("meldet ein unbekanntes Dokument", async () => {
    await expect(deleteEmployeeDocument(UNKNOWN_ID)).rejects.toThrow("Dokument nicht gefunden.");
    expect(blobModule.del).not.toHaveBeenCalled();
  });

  it("lehnt Mitarbeitende ab — auch für eigene Dokumente", async () => {
    const doc = await uploadOne(seed.employee.id);
    await actAs(seed.employee);
    await expect(deleteEmployeeDocument(doc.id)).rejects.toThrow(ADMIN_ONLY);
    expect(await documentsOf(seed.employee.id)).toHaveLength(1);
    expect(blobStore.has(doc.blobUrl)).toBe(true);
    expect(
      await testDb()
        .select()
        .from(schema.auditLog)
        .where(and(eq(schema.auditLog.objectId, doc.id), eq(schema.auditLog.action, "geloescht")))
    ).toHaveLength(0);
  });
});
