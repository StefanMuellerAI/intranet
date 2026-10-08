import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getCalendarAbsences, type CalendarAbsence } from "@/lib/absences";
import * as schema from "../../src/db/schema";
import { createUser, makeDeputy } from "../helpers/actions";
import { resetDb, seedTestData, testDb, type SeedResult } from "../helpers/db";

let seed: SeedResult;

// Kalendermonat August 2026
const FROM = "2026-08-01";
const TO = "2026-08-31";

async function insertVacation(
  userId: string,
  values: Partial<typeof schema.vacationRequests.$inferInsert> = {}
) {
  const [row] = await testDb()
    .insert(schema.vacationRequests)
    .values({
      userId,
      status: "genehmigt",
      startDate: "2026-08-03",
      endDate: "2026-08-07",
      days: 5,
      ...values,
    })
    .returning();
  return row;
}

async function insertWorkation(
  userId: string,
  values: Partial<typeof schema.workationRequests.$inferInsert> = {}
) {
  const [row] = await testDb()
    .insert(schema.workationRequests)
    .values({
      userId,
      status: "genehmigt",
      country: "Spanien",
      countryCategory: "eu_ewr_ch",
      city: "Valencia",
      accommodationAddress: "Calle Mayor 1",
      startDate: "2026-08-17",
      endDate: "2026-08-28",
      workDays: 10,
      timezoneAvailability: "10–16 Uhr MEZ",
      emergencyContactName: "Erika Muster",
      emergencyContactPhone: "+49 221 123456",
      visaType: "keins",
      insuranceDetails: "Auslandskrankenversicherung XYZ",
      plannedTasks: "Projektarbeit",
      domesticSubstitution: "Erika Admin",
      ...values,
    })
    .returning();
  return row;
}

async function insertSickLeave(
  userId: string,
  values: Partial<typeof schema.sickLeaves.$inferInsert> = {}
) {
  const [row] = await testDb()
    .insert(schema.sickLeaves)
    .values({
      userId,
      type: "eigene_erkrankung",
      startDate: "2026-08-10",
      endDate: "2026-08-12",
      status: "abgeschlossen",
      ...values,
    })
    .returning();
  return row;
}

async function insertTeamEvent(
  values: Partial<typeof schema.teamEvents.$inferInsert> = {}
) {
  const [row] = await testDb()
    .insert(schema.teamEvents)
    .values({
      title: "Sommerfest",
      startDate: "2026-08-21",
      endDate: "2026-08-21",
      createdById: seed.admin.id,
      ...values,
    })
    .returning();
  return row;
}

async function setBirthDate(user: schema.User, birthDate: string | null) {
  await testDb()
    .update(schema.users)
    .set({ birthDate })
    .where(eq(schema.users.id, user.id));
}

function ofType(entries: CalendarAbsence[], type: CalendarAbsence["type"]) {
  return entries.filter((e) => e.type === type);
}

beforeAll(async () => {
  await resetDb();
  seed = await seedTestData();
});

beforeEach(async () => {
  const db = testDb();
  await db.delete(schema.vacationRequests);
  await db.delete(schema.workationRequests);
  await db.delete(schema.sickLeaves);
  await db.delete(schema.teamEvents);
  await db.delete(schema.deputyAssignments);
  await db.update(schema.users).set({ birthDate: null });
});

describe("getCalendarAbsences", () => {
  it("zeigt genehmigte Urlaube und Urlaube mit beantragtem Storno", async () => {
    const genehmigt = await insertVacation(seed.employee.id);
    const storno = await insertVacation(seed.employee.id, {
      status: "storno_beantragt",
      startDate: "2026-08-24",
      endDate: "2026-08-25",
      days: 2,
    });
    for (const status of [
      "eingereicht",
      "beanstandet",
      "storniert",
      "zurueckgezogen",
    ] as const) {
      await insertVacation(seed.employee.id, { status });
    }

    const urlaub = ofType(
      await getCalendarAbsences(seed.employee, FROM, TO),
      "urlaub"
    );

    expect(urlaub).toEqual(
      expect.arrayContaining([
        {
          userId: seed.employee.id,
          userName: "Max Mitarbeiter",
          type: "urlaub",
          from: genehmigt.startDate,
          to: genehmigt.endDate,
        },
        expect.objectContaining({ from: storno.startDate, to: storno.endDate }),
      ])
    );
    expect(urlaub).toHaveLength(2);
  });

  it("berücksichtigt Abwesenheiten, die den Zeitraum nur teilweise überlappen", async () => {
    await insertVacation(seed.employee.id, {
      startDate: "2026-07-27",
      endDate: "2026-08-03",
    });
    await insertVacation(seed.employee.id, {
      startDate: "2026-08-31",
      endDate: "2026-09-04",
    });
    // komplett außerhalb
    await insertVacation(seed.employee.id, {
      startDate: "2026-07-20",
      endDate: "2026-07-31",
    });
    await insertVacation(seed.employee.id, {
      startDate: "2026-09-01",
      endDate: "2026-09-04",
    });

    const urlaub = ofType(
      await getCalendarAbsences(seed.admin, FROM, TO),
      "urlaub"
    );
    expect(urlaub.map((u) => u.from).sort()).toEqual(["2026-07-27", "2026-08-31"]);
  });

  it("zeigt nur genehmigte Workations", async () => {
    const w = await insertWorkation(seed.employee.id);
    await insertWorkation(seed.employee.id, { status: "eingereicht" });
    await insertWorkation(seed.employee.id, { status: "storno_beantragt" });

    const workations = ofType(
      await getCalendarAbsences(seed.admin, FROM, TO),
      "workation"
    );
    expect(workations).toEqual([
      {
        userId: seed.employee.id,
        userName: "Max Mitarbeiter",
        type: "workation",
        from: w.startDate,
        to: w.endDate,
      },
    ]);
  });

  it("zeigt Krankheit dem Admin als krank", async () => {
    await insertSickLeave(seed.employee.id);
    const [eintrag] = await getCalendarAbsences(seed.admin, FROM, TO);
    expect(eintrag).toEqual({
      userId: seed.employee.id,
      userName: "Max Mitarbeiter",
      type: "krank",
      from: "2026-08-10",
      to: "2026-08-12",
    });
  });

  it("zeigt der betroffenen Person die eigene Krankheit als krank", async () => {
    await insertSickLeave(seed.employee.id);
    const [eintrag] = await getCalendarAbsences(seed.employee, FROM, TO);
    expect(eintrag.type).toBe("krank");
  });

  it("zeigt Kolleg/innen Krankheit nur neutral als abwesend (Datenschutz)", async () => {
    await insertSickLeave(seed.employee.id, { type: "kind_krank" });
    const kollegin = await createUser();

    const eintraege = await getCalendarAbsences(kollegin, FROM, TO);
    expect(eintraege).toEqual([
      {
        userId: seed.employee.id,
        userName: "Max Mitarbeiter",
        type: "abwesend",
        from: "2026-08-10",
        to: "2026-08-12",
      },
    ]);
  });

  it("zeigt auch der aktiven Vertretung Krankheit nur als abwesend", async () => {
    await insertSickLeave(seed.employee.id);
    const vertretung = await createUser({ firstName: "Vera", lastName: "Vertretung" });
    await makeDeputy(vertretung);

    const [eintrag] = await getCalendarAbsences(vertretung, FROM, TO);
    expect(eintrag.type).toBe("abwesend");
  });

  it("zeigt eine offene Krankmeldung ohne Enddatum bis zum Ende des Zeitraums", async () => {
    await insertSickLeave(seed.employee.id, {
      status: "gemeldet",
      startDate: "2026-07-28",
      endDate: null,
    });

    const [eintrag] = await getCalendarAbsences(seed.admin, FROM, TO);
    expect(eintrag).toMatchObject({ type: "krank", from: "2026-07-28", to: TO });
  });

  it("liefert eine nicht abgeschlossene Krankmeldung mit verstrichenem voraussichtlichem Ende weiterhin mit diesem Ende (aktuelles Verhalten)", async () => {
    await insertSickLeave(seed.employee.id, {
      status: "gemeldet",
      startDate: "2026-07-01",
      endDate: "2026-07-03",
    });

    const eintraege = await getCalendarAbsences(seed.admin, FROM, TO);
    // Der Eintrag liegt komplett vor dem angefragten Zeitraum
    expect(eintraege).toEqual([
      expect.objectContaining({ type: "krank", from: "2026-07-01", to: "2026-07-03" }),
    ]);
  });

  it("blendet abgeschlossene Krankmeldungen vor dem Zeitraum und künftige aus", async () => {
    await insertSickLeave(seed.employee.id, {
      startDate: "2026-07-20",
      endDate: "2026-07-31",
    });
    await insertSickLeave(seed.employee.id, {
      status: "gemeldet",
      startDate: "2026-09-01",
      endDate: null,
    });

    expect(await getCalendarAbsences(seed.admin, FROM, TO)).toEqual([]);
  });

  it("zeigt aktive Teamevents mit Titel statt Personenbezug", async () => {
    const fest = await insertTeamEvent();
    await insertTeamEvent({ title: "Abgesagt", active: false });
    await insertTeamEvent({
      title: "Weihnachtsfeier",
      startDate: "2026-12-11",
      endDate: "2026-12-11",
    });

    const events = ofType(
      await getCalendarAbsences(seed.employee, FROM, TO),
      "teamevent"
    );
    expect(events).toEqual([
      {
        userId: fest.id,
        userName: "Sommerfest",
        type: "teamevent",
        from: "2026-08-21",
        to: "2026-08-21",
      },
    ]);
  });

  it("zeigt Geburtstage ohne Geburtsjahr im angezeigten Jahr", async () => {
    await setBirthDate(seed.employee, "1990-08-14");
    // außerhalb des Zeitraums
    await setBirthDate(seed.admin, "1985-09-02");

    const geburtstage = ofType(
      await getCalendarAbsences(seed.employee, FROM, TO),
      "geburtstag"
    );
    expect(geburtstage).toEqual([
      {
        userId: seed.employee.id,
        userName: "Max Mitarbeiter",
        type: "geburtstag",
        from: "2026-08-14",
        to: "2026-08-14",
      },
    ]);
  });

  it("zeigt den 29.02. in Nicht-Schaltjahren am 28.02.", async () => {
    await setBirthDate(seed.employee, "1996-02-29");

    const [nichtSchaltjahr] = ofType(
      await getCalendarAbsences(seed.admin, "2026-02-01", "2026-02-28"),
      "geburtstag"
    );
    expect(nichtSchaltjahr).toMatchObject({ from: "2026-02-28", to: "2026-02-28" });

    const [schaltjahr] = ofType(
      await getCalendarAbsences(seed.admin, "2028-02-01", "2028-02-29"),
      "geburtstag"
    );
    expect(schaltjahr).toMatchObject({ from: "2028-02-29", to: "2028-02-29" });
  });

  it("wiederholt Geburtstage über den Jahreswechsel", async () => {
    await setBirthDate(seed.employee, "1990-01-02");
    await setBirthDate(seed.admin, "1980-12-20");

    const geburtstage = ofType(
      await getCalendarAbsences(seed.admin, "2026-12-15", "2027-01-15"),
      "geburtstag"
    );
    expect(geburtstage.map((g) => [g.userName, g.from]).sort()).toEqual([
      ["Erika Admin", "2026-12-20"],
      ["Max Mitarbeiter", "2027-01-02"],
    ]);
  });

  it("lässt Geburtstage deaktivierter Personen weg", async () => {
    const ehemalig = await createUser({
      status: "deaktiviert",
      birthDate: "1990-08-14",
    });

    const geburtstage = ofType(
      await getCalendarAbsences(seed.admin, FROM, TO),
      "geburtstag"
    );
    expect(geburtstage.some((g) => g.userId === ehemalig.id)).toBe(false);
  });
});
