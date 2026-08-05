import { beforeAll, describe, expect, it } from "vitest";
import { GET as listAbsences } from "@/app/api/v1/absences/route";
import {
  sickLeaves,
  vacationRequests,
  workationRequests,
} from "../../src/db/schema";
import {
  createTestApiKey,
  resetDb,
  seedTestData,
  testDb,
  type SeedResult,
} from "../helpers/db";

let seed: SeedResult;
let apiKey: string;

beforeAll(async () => {
  await resetDb();
  seed = await seedTestData();
  ({ key: apiKey } = await createTestApiKey(seed.admin.id));

  const db = testDb();
  await db.insert(vacationRequests).values([
    {
      userId: seed.employee.id,
      status: "genehmigt",
      startDate: "2026-08-03",
      endDate: "2026-08-07",
      days: 5,
    },
    // Eingereicht — darf NICHT in der Abwesenheitsliste erscheinen
    {
      userId: seed.employee.id,
      status: "eingereicht",
      startDate: "2026-10-05",
      endDate: "2026-10-09",
      days: 5,
    },
  ]);
  await db.insert(workationRequests).values({
    userId: seed.employee.id,
    status: "genehmigt",
    country: "Spanien",
    countryCategory: "eu_ewr_ch",
    city: "Valencia",
    accommodationAddress: "Calle Mayor 1",
    startDate: "2026-09-01",
    endDate: "2026-09-12",
    workDays: 9,
    timezoneAvailability: "10-16 Uhr MEZ",
    emergencyContactName: "Erika Muster",
    emergencyContactPhone: "+49 221 123456",
    visaType: "keins",
    insuranceDetails: "Auslandskrankenversicherung XYZ",
    plannedTasks: "Projektarbeit",
    domesticSubstitution: "Erika Admin",
  });
  await db.insert(sickLeaves).values({
    userId: seed.employee.id,
    type: "eigene_erkrankung",
    startDate: "2026-07-20",
  });
});

describe("GET /api/v1/absences", () => {
  it("liefert genehmigte Urlaube, Workations und Krankmeldungen", async () => {
    const res = await listAbsences(
      new Request("http://localhost/api/v1/absences", {
        headers: { authorization: `Bearer ${apiKey}` },
      })
    );
    expect(res.status).toBe(200);
    const { absences } = await res.json();

    const types = absences.map((a: { type: string }) => a.type).sort();
    expect(types).toEqual(["sick_leave", "vacation", "workation"]);

    const vacation = absences.find(
      (a: { type: string }) => a.type === "vacation"
    );
    expect(vacation).toMatchObject({
      von: "2026-08-03",
      bis: "2026-08-07",
      tage: 5,
      status: "genehmigt",
      user: { email: seed.employee.email },
    });

    const workation = absences.find(
      (a: { type: string }) => a.type === "workation"
    );
    expect(workation).toMatchObject({ land: "Spanien", arbeitstage: 9 });

    const sick = absences.find(
      (a: { type: string }) => a.type === "sick_leave"
    );
    expect(sick).toMatchObject({ von: "2026-07-20", bis: null });
  });

  it("liefert die Krankheitsart (Gesundheitsdatum) nur an full-Keys", async () => {
    const { key: readonlyKey } = await createTestApiKey(
      seed.admin.id,
      "Nur-Lesen",
      "readonly"
    );
    const resRead = await listAbsences(
      new Request("http://localhost/api/v1/absences", {
        headers: { authorization: `Bearer ${readonlyKey}` },
      })
    );
    const sickRead = (await resRead.json()).absences.find(
      (a: { type: string }) => a.type === "sick_leave"
    );
    expect(sickRead.typ).toBeUndefined();

    // Der full-Key aus beforeAll sieht weiterhin die Art.
    const resFull = await listAbsences(
      new Request("http://localhost/api/v1/absences", {
        headers: { authorization: `Bearer ${apiKey}` },
      })
    );
    const sickFull = (await resFull.json()).absences.find(
      (a: { type: string }) => a.type === "sick_leave"
    );
    expect(sickFull.typ).toBe("eigene_erkrankung");
  });

  it("verlangt einen API-Key", async () => {
    const res = await listAbsences(
      new Request("http://localhost/api/v1/absences")
    );
    expect(res.status).toBe(401);
  });
});
