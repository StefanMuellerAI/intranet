import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  deleteVacationRequest,
  requestVacationCancellation,
  resubmitVacationRequest,
  submitVacationRequest,
  withdrawVacationRequest,
} from "@/app/(app)/urlaub/actions";
import { approveAction, rejectAction } from "@/app/(app)/freigaben/actions";
import * as schema from "../../../src/db/schema";
import {
  actAs,
  auditFor,
  createUser,
  expectRedirect,
  formData,
  idFromUrl,
  makeDeputy,
} from "../../helpers/actions";
import { resetDb, seedTestData, testDb, type SeedResult } from "../../helpers/db";
import { mailbox, mailsTo, nextCacheModule } from "../../helpers/framework-fakes";

let seed: SeedResult;

// Mo 03.08. – Fr 07.08.2026 = 5 Arbeitstage
const WEEK = { startDate: "2026-08-03", endDate: "2026-08-07" };

async function submitAsEmployee(values: Record<string, string> = WEEK) {
  await actAs(seed.employee);
  const url = await expectRedirect(
    submitVacationRequest(formData(values)),
    /^\/urlaub\/[0-9a-f-]+$/
  );
  return idFromUrl(url);
}

async function load(id: string) {
  const row = await testDb().query.vacationRequests.findFirst({
    where: eq(schema.vacationRequests.id, id),
  });
  if (!row) throw new Error("Antrag fehlt");
  return row;
}

async function setStatus(id: string, status: schema.RequestStatus) {
  await testDb()
    .update(schema.vacationRequests)
    .set({ status })
    .where(eq(schema.vacationRequests.id, id));
}

beforeAll(async () => {
  await resetDb();
  seed = await seedTestData();
});

beforeEach(async () => {
  const db = testDb();
  await db.delete(schema.requestHistory);
  await db.delete(schema.vacationRequests);
  await db.delete(schema.deputyAssignments);
  await db
    .update(schema.users)
    .set({ entryDate: null, entryYearVacationDays: null, annualVacationDays: 30 })
    .where(eq(schema.users.id, seed.employee.id));
  seed.employee.entryDate = null;
  seed.employee.annualVacationDays = 30;
});

describe("submitVacationRequest", () => {
  it("legt den Antrag an, auditiert und benachrichtigt Admin und Vertretung", async () => {
    const deputy = await createUser({ firstName: "Vera", lastName: "Vertretung" });
    await makeDeputy(deputy);

    const id = await submitAsEmployee({
      ...WEEK,
      note: "Sommerurlaub",
      substituteText: "Kollegin Müller",
    });

    const request = await load(id);
    expect(request).toMatchObject({
      userId: seed.employee.id,
      status: "eingereicht",
      days: 5,
      note: "Sommerurlaub",
      substituteText: "Kollegin Müller",
    });
    expect((await auditFor("urlaub", id))[0]).toMatchObject({
      action: "eingereicht",
      actorUserId: seed.employee.id,
      source: "web",
    });
    expect(mailsTo(seed.admin.email)).toHaveLength(1);
    expect(mailsTo(deputy.email)).toHaveLength(1);
    expect(mailbox[0].linkPath).toBe(`/freigaben/urlaub/${id}`);
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/urlaub");
  });

  it("rechnet halbe Tage am Anfang und Ende ab", async () => {
    const id = await submitAsEmployee({
      ...WEEK,
      halfDayStart: "on",
      halfDayEnd: "on",
    });
    expect((await load(id)).days).toBe(4);
  });

  it("übernimmt eine Vertretung aus der Auswahlliste", async () => {
    const colleague = await createUser();
    const id = await submitAsEmployee({ ...WEEK, substituteUserId: colleague.id });
    expect((await load(id)).substituteUserId).toBe(colleague.id);
  });

  it("lehnt ein Enddatum vor dem Startdatum ab", async () => {
    await actAs(seed.employee);
    await expect(
      submitVacationRequest(
        formData({ startDate: "2026-08-07", endDate: "2026-08-03" })
      )
    ).rejects.toThrow("Das Enddatum darf nicht vor dem Startdatum liegen.");
  });

  it("lehnt einen Zeitraum ohne Arbeitstage serverseitig ab", async () => {
    await actAs(seed.employee);
    // Sa/So 08./09.08.2026
    await expect(
      submitVacationRequest(
        formData({ startDate: "2026-08-08", endDate: "2026-08-09" })
      )
    ).rejects.toThrow("keine Arbeitstage");
  });

  it("lehnt Urlaub vor dem Eintrittsdatum ab", async () => {
    await testDb()
      .update(schema.users)
      .set({ entryDate: "2026-08-05", entryYearVacationDays: 10 })
      .where(eq(schema.users.id, seed.employee.id));
    seed.employee.entryDate = "2026-08-05";
    await actAs(seed.employee);
    await expect(submitVacationRequest(formData(WEEK))).rejects.toThrow(
      "erst ab Ihrem Eintrittsdatum"
    );
  });

  it("lehnt Anträge über den Resturlaub hinaus ab", async () => {
    await testDb()
      .update(schema.users)
      .set({ annualVacationDays: 3 })
      .where(eq(schema.users.id, seed.employee.id));
    await actAs(seed.employee);
    await expect(submitVacationRequest(formData(WEEK))).rejects.toThrow(
      "übersteigt Ihren Resturlaub von 3 Tagen"
    );
  });

  it("verlangt eine Anmeldung", async () => {
    await actAs(null);
    await expect(submitVacationRequest(formData(WEEK))).rejects.toThrow(
      "Nicht angemeldet"
    );
  });

  it("sperrt deaktivierte Konten", async () => {
    const inactive = await createUser({ status: "deaktiviert" });
    await actAs(inactive);
    await expect(submitVacationRequest(formData(WEEK))).rejects.toThrow(
      "Nicht angemeldet"
    );
  });
});

describe("resubmitVacationRequest", () => {
  it("korrigiert einen beanstandeten Antrag, erhöht die Version und sichert die Historie", async () => {
    const id = await submitAsEmployee();
    await setStatus(id, "beanstandet");

    await expectRedirect(
      resubmitVacationRequest(
        id,
        formData({ startDate: "2026-08-10", endDate: "2026-08-12" })
      ),
      `/urlaub/${id}`
    );

    const request = await load(id);
    expect(request).toMatchObject({
      status: "eingereicht",
      version: 2,
      startDate: "2026-08-10",
      days: 3,
    });
    const history = await testDb().select().from(schema.requestHistory);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ requestId: id, version: 1 });
    expect((await auditFor("urlaub", id))[0].action).toBe(
      "korrigiert_erneut_eingereicht"
    );
    expect(mailbox.at(-1)?.subject).toContain("korrigiert erneut eingereicht");
  });

  it("korrigiert auch einen zurückgezogenen Antrag", async () => {
    const id = await submitAsEmployee();
    await setStatus(id, "zurueckgezogen");
    await expectRedirect(resubmitVacationRequest(id, formData(WEEK)));
    expect((await load(id)).status).toBe("eingereicht");
  });

  it("lehnt die Korrektur eines eingereichten Antrags ab", async () => {
    const id = await submitAsEmployee();
    await expect(resubmitVacationRequest(id, formData(WEEK))).rejects.toThrow(
      "Nur beanstandete oder zurückgezogene Anträge"
    );
  });

  it("lässt fremde Anträge nicht korrigieren", async () => {
    const id = await submitAsEmployee();
    await setStatus(id, "beanstandet");
    await actAs(await createUser());
    await expect(resubmitVacationRequest(id, formData(WEEK))).rejects.toThrow(
      "Antrag nicht gefunden."
    );
  });

  it("prüft auch bei der Korrektur den Resturlaub", async () => {
    const id = await submitAsEmployee();
    await setStatus(id, "beanstandet");
    await testDb()
      .update(schema.users)
      .set({ annualVacationDays: 3 })
      .where(eq(schema.users.id, seed.employee.id));
    await expect(resubmitVacationRequest(id, formData(WEEK))).rejects.toThrow(
      "übersteigt Ihren Resturlaub von 3 Tagen"
    );
    expect((await load(id)).status).toBe("beanstandet");
  });

  it("lehnt eine Korrektur ohne Arbeitstage ab", async () => {
    const id = await submitAsEmployee();
    await setStatus(id, "beanstandet");
    await expect(
      resubmitVacationRequest(
        id,
        formData({ startDate: "2026-08-08", endDate: "2026-08-09" })
      )
    ).rejects.toThrow("keine Arbeitstage");
  });
});

describe("withdrawVacationRequest", () => {
  it("zieht einen eingereichten Antrag zurück", async () => {
    const id = await submitAsEmployee();
    await withdrawVacationRequest(id);
    expect((await load(id)).status).toBe("zurueckgezogen");
    expect((await auditFor("urlaub", id))[0].action).toBe("zurueckgezogen");
  });

  it("zieht einen beanstandeten Antrag zurück", async () => {
    const id = await submitAsEmployee();
    await setStatus(id, "beanstandet");
    await withdrawVacationRequest(id);
    expect((await load(id)).status).toBe("zurueckgezogen");
  });

  it("lässt genehmigte Anträge nicht zurückziehen", async () => {
    const id = await submitAsEmployee();
    await setStatus(id, "genehmigt");
    await expect(withdrawVacationRequest(id)).rejects.toThrow(
      "Nur eingereichte oder beanstandete Anträge"
    );
  });

  it("lässt fremde Anträge nicht zurückziehen", async () => {
    const id = await submitAsEmployee();
    await actAs(seed.admin);
    await expect(withdrawVacationRequest(id)).rejects.toThrow(
      "Antrag nicht gefunden."
    );
  });
});

describe("deleteVacationRequest", () => {
  it("löscht einen zurückgezogenen Antrag samt Historie und auditiert", async () => {
    const id = await submitAsEmployee();
    await setStatus(id, "beanstandet");
    await expectRedirect(resubmitVacationRequest(id, formData(WEEK)));
    await withdrawVacationRequest(id);

    await expectRedirect(deleteVacationRequest(id), "/urlaub");

    expect(
      await testDb().query.vacationRequests.findFirst({
        where: eq(schema.vacationRequests.id, id),
      })
    ).toBeUndefined();
    expect(await testDb().select().from(schema.requestHistory)).toHaveLength(0);
    expect((await auditFor("urlaub", id))[0]).toMatchObject({
      action: "geloescht",
      details: { startDate: WEEK.startDate, endDate: WEEK.endDate, days: 5 },
    });
  });

  it("löscht nur zurückgezogene Anträge", async () => {
    const id = await submitAsEmployee();
    await expect(deleteVacationRequest(id)).rejects.toThrow(
      "Nur zurückgezogene Anträge können endgültig gelöscht werden."
    );
  });

  it("lässt fremde Anträge nicht löschen", async () => {
    const id = await submitAsEmployee();
    await setStatus(id, "zurueckgezogen");
    await actAs(seed.admin);
    await expect(deleteVacationRequest(id)).rejects.toThrow(
      "Antrag nicht gefunden."
    );
  });
});

describe("requestVacationCancellation", () => {
  it("beantragt den Storno eines genehmigten Urlaubs und informiert die Freigabe", async () => {
    const id = await submitAsEmployee();
    await setStatus(id, "genehmigt");
    mailbox.length = 0;

    await requestVacationCancellation(id);

    expect((await load(id)).status).toBe("storno_beantragt");
    expect((await auditFor("urlaub", id))[0].action).toBe("storno_beantragt");
    expect(mailsTo(seed.admin.email)[0].paragraphs.join(" ")).toContain(
      "Storno beantragt"
    );
  });

  it("lässt nur genehmigte Urlaube stornieren", async () => {
    const id = await submitAsEmployee();
    await expect(requestVacationCancellation(id)).rejects.toThrow(
      "Nur genehmigte Urlaube können storniert werden."
    );
  });

  it("lässt fremde Urlaube nicht stornieren", async () => {
    const id = await submitAsEmployee();
    await setStatus(id, "genehmigt");
    await actAs(await createUser());
    await expect(requestVacationCancellation(id)).rejects.toThrow(
      "Antrag nicht gefunden."
    );
  });

  it("Storno-Runde: Admin bestätigt → storniert, Admin lehnt ab → wieder genehmigt", async () => {
    const id = await submitAsEmployee();
    await setStatus(id, "genehmigt");
    await requestVacationCancellation(id);

    await actAs(seed.admin);
    await rejectAction("urlaub", id, formData({ comment: "Projektphase" }));
    expect((await load(id)).status).toBe("genehmigt");

    await actAs(seed.employee);
    await requestVacationCancellation(id);
    await actAs(seed.admin);
    await approveAction("urlaub", id);
    expect((await load(id)).status).toBe("storniert");
  });
});
