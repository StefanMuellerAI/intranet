import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  deleteWorkationRequest,
  resubmitWorkationRequest,
  submitWorkationRequest,
  updateWorkationAdminFields,
  withdrawWorkationRequest,
} from "@/app/(app)/workation/actions";
import { toISODate } from "@/lib/dates";
import { validateWorkation } from "@/lib/workation/validate";
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

const DECLARATIONS = {
  declResidence: "on",
  declVisa: "on",
  declWorkingTime: "on",
  declDataProtection: "on",
  declNoForbiddenActivities: "on",
  declReportChanges: "on",
  declCosts: "on",
};

// Mo 07.06. – Fr 18.06.2027 = 10 Arbeitstage in Spanien (EU)
const EU_TRIP: Record<string, string> = {
  country: "Spanien",
  city: "Valencia",
  accommodationAddress: "Calle de la Paz 12, 46003 Valencia",
  startDate: "2027-06-07",
  endDate: "2027-06-18",
  workDays: "10",
  vacationDays: "0",
  timezoneAvailability: "MESZ, erreichbar 9–17 Uhr",
  daysInCountryThisYear: "0",
  emergencyContactName: "Eva Mitarbeiter",
  emergencyContactPhone: "+49 221 123456",
  visaType: "EU-Bürger, kein Visum erforderlich",
  insuranceDetails: "Auslandskrankenversicherung inkl. Rücktransport",
  plannedTasks: "Konzeption Kundenworkshop",
  domesticSubstitution: "Kollegin Müller",
  ...DECLARATIONS,
};

function trip(overrides: Record<string, string | undefined> = {}) {
  return formData({ ...EU_TRIP, ...overrides });
}

async function submitAsEmployee(overrides: Record<string, string | undefined> = {}) {
  await actAs(seed.employee);
  const url = await expectRedirect(
    submitWorkationRequest(trip(overrides)),
    /^\/workation\/[0-9a-f-]+$/
  );
  return idFromUrl(url);
}

/** Antrag direkt in der DB anlegen (z. B. für Kontingent-Vorbelegung). */
async function insertWorkation(
  overrides: Partial<typeof schema.workationRequests.$inferInsert> = {}
) {
  const [row] = await testDb()
    .insert(schema.workationRequests)
    .values({
      userId: seed.employee.id,
      country: "Portugal",
      countryCategory: "eu_ewr_ch",
      city: "Lissabon",
      accommodationAddress: "Rua Augusta 1, Lissabon",
      startDate: "2027-03-01",
      endDate: "2027-03-26",
      workDays: 20,
      timezoneAvailability: "WEZ",
      emergencyContactName: "Eva",
      emergencyContactPhone: "0221 1",
      visaType: "EU",
      insuranceDetails: "Versichert",
      plannedTasks: "Entwicklung",
      domesticSubstitution: "Team",
      status: "genehmigt",
      ...overrides,
    })
    .returning();
  return row;
}

async function load(id: string) {
  const row = await testDb().query.workationRequests.findFirst({
    where: eq(schema.workationRequests.id, id),
  });
  if (!row) throw new Error("Antrag fehlt");
  return row;
}

async function setStatus(id: string, status: schema.RequestStatus) {
  await testDb()
    .update(schema.workationRequests)
    .set({ status })
    .where(eq(schema.workationRequests.id, id));
}

async function countRequests() {
  return (await testDb().select().from(schema.workationRequests)).length;
}

beforeAll(async () => {
  await resetDb();
  seed = await seedTestData();
});

beforeEach(async () => {
  const db = testDb();
  await db.delete(schema.requestHistory);
  await db.delete(schema.workationRequests);
  await db.delete(schema.deputyAssignments);
  await db.delete(schema.auditLog);
  await db
    .update(schema.settings)
    .set({ workationYearlyLimitDays: 30, workationConsecutiveLimitDays: 20 })
    .where(eq(schema.settings.id, 1));
});

describe("submitWorkationRequest", () => {
  it("legt einen EU-Antrag an, auditiert und benachrichtigt Admin und Vertretung", async () => {
    const deputy = await createUser({ firstName: "Vera", lastName: "Vertretung" });
    await makeDeputy(deputy);

    const id = await submitAsEmployee();

    const request = await load(id);
    expect(request).toMatchObject({
      userId: seed.employee.id,
      status: "eingereicht",
      version: 1,
      country: "Spanien",
      countryCategory: "eu_ewr_ch",
      city: "Valencia",
      startDate: "2027-06-07",
      endDate: "2027-06-18",
      workDays: 10,
      vacationDays: 0,
      visaValidUntil: null,
      a1Status: null,
      declResidence: true,
      declCosts: true,
    });
    expect((await auditFor("workation", id))[0]).toMatchObject({
      action: "eingereicht",
      actorUserId: seed.employee.id,
      source: "web",
    });
    expect(mailsTo(seed.admin.email)).toHaveLength(1);
    expect(mailsTo(deputy.email)).toHaveLength(1);
    expect(mailbox[0]).toMatchObject({
      subject: "Workation-Antrag eingereicht: Max Mitarbeiter",
      linkPath: `/freigaben/workation/${id}`,
    });
    expect(mailbox[0].paragraphs.join(" ")).toContain(
      "Valencia, Spanien · 07.06.2027 bis 18.06.2027 (10 Arbeitstage)"
    );
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/workation");
  });

  it("übernimmt optionale Felder wie Visum-Gültigkeit und Urlaubstage", async () => {
    const id = await submitAsEmployee({
      visaValidUntil: "2027-12-31",
      vacationDays: "2",
      daysInCountryThisYear: "14",
    });
    expect(await load(id)).toMatchObject({
      visaValidUntil: "2027-12-31",
      vacationDays: 2,
      daysInCountryThisYear: 14,
    });
  });

  it("nimmt einen Drittstaat-Antrag mit kurzem Vorlauf an — der 8-Wochen-Vorlauf ist nur ein Hinweis", async () => {
    // Fünf Wochen Vorlauf: reicht für EU (4 Wochen), nicht für Drittstaaten (8 Wochen)
    const start = new Date();
    start.setDate(start.getDate() + 35);
    const end = new Date(start);
    end.setDate(end.getDate() + 4);
    const startDate = toISODate(start);
    const endDate = toISODate(end);

    const id = await submitAsEmployee({
      country: "Thailand",
      city: "Bangkok",
      startDate,
      endDate,
      workDays: "5",
    });

    expect(await load(id)).toMatchObject({
      country: "Thailand",
      countryCategory: "drittstaat",
      status: "eingereicht",
      a1Status: null,
    });
    // Die Richtlinie warnt (Formular/Freigabe), blockiert aber nicht
    const common = {
      startDate,
      endDate,
      workDays: 5,
      daysInCountryThisYear: 0,
      usedWorkDaysThisYear: 0,
      yearlyLimitDays: 30,
      consecutiveLimitDays: 20,
    };
    const drittstaat = validateWorkation({ ...common, countryCategory: "drittstaat" });
    expect(drittstaat.errors).toEqual([]);
    expect(drittstaat.warnings.join(" ")).toContain(
      "Mindestvorlauf von 8 Wochen (Drittstaat)"
    );
    const eu = validateWorkation({ ...common, countryCategory: "eu_ewr_ch" });
    expect(eu.warnings.join(" ")).not.toContain("Mindestvorlauf");
  });

  it("erkennt EU/EWR/CH-Länder unabhängig von Groß-/Kleinschreibung und Leerzeichen", async () => {
    const id = await submitAsEmployee({ country: "  schweiz " });
    expect((await load(id)).countryCategory).toBe("eu_ewr_ch");
  });

  it("blockiert serverseitig mehr als 20 zusammenhängende Arbeitstage", async () => {
    await actAs(seed.employee);
    // 07.06. – 05.07.2027 = 21 Arbeitstage
    await expect(
      submitWorkationRequest(trip({ endDate: "2027-07-05", workDays: "21" }))
    ).rejects.toThrow("höchstens 20 zusammenhängende Arbeitstage");
    expect(await countRequests()).toBe(0);
    expect(mailbox).toHaveLength(0);
  });

  it("lässt genau 20 zusammenhängende Arbeitstage zu", async () => {
    const id = await submitAsEmployee({ endDate: "2027-07-02", workDays: "20" });
    expect((await load(id)).workDays).toBe(20);
  });

  it("blockiert serverseitig mehr als 30 Arbeitstage im Kalenderjahr", async () => {
    await insertWorkation({ workDays: 20, status: "genehmigt" });
    await actAs(seed.employee);
    await expect(
      submitWorkationRequest(trip({ workDays: "11" }))
    ).rejects.toThrow(
      "Das Jahreskontingent von 30 Arbeitstagen wird überschritten: 20 Tage sind bereits verplant"
    );
    expect(await countRequests()).toBe(1);
  });

  it("schöpft das Jahreskontingent bis genau 30 Tage aus", async () => {
    await insertWorkation({ workDays: 20, status: "eingereicht" });
    const id = await submitAsEmployee({ workDays: "10" });
    expect((await load(id)).status).toBe("eingereicht");
  });

  it("zählt nur eingereichte und genehmigte Anträge desselben Jahres auf das Kontingent", async () => {
    await insertWorkation({ workDays: 20, status: "zurueckgezogen" });
    await insertWorkation({ workDays: 20, status: "beanstandet" });
    await insertWorkation({
      workDays: 20,
      status: "genehmigt",
      startDate: "2026-11-02",
      endDate: "2026-11-27",
    });
    // Fremder Antrag zählt nicht für Max
    const colleague = await createUser();
    await insertWorkation({ userId: colleague.id, workDays: 20 });

    const id = await submitAsEmployee({ workDays: "20", endDate: "2027-07-02" });
    expect((await load(id)).workDays).toBe(20);
  });

  it("verwendet die Grenzen aus den Einstellungen", async () => {
    await testDb()
      .update(schema.settings)
      .set({ workationYearlyLimitDays: 15, workationConsecutiveLimitDays: 8 })
      .where(eq(schema.settings.id, 1));
    await actAs(seed.employee);
    await expect(submitWorkationRequest(trip({ workDays: "10" }))).rejects.toThrow(
      "höchstens 8 zusammenhängende Arbeitstage"
    );

    await insertWorkation({ workDays: 8 });
    await expect(submitWorkationRequest(trip({ workDays: "8" }))).rejects.toThrow(
      "Das Jahreskontingent von 15 Arbeitstagen wird überschritten"
    );
  });

  it("verlangt alle sieben Erklärungen", async () => {
    await actAs(seed.employee);
    await expect(
      submitWorkationRequest(trip({ declCosts: undefined }))
    ).rejects.toThrow(
      "Alle sieben Erklärungen müssen bestätigt werden, sonst ist keine Einreichung möglich."
    );
    expect(await countRequests()).toBe(0);
  });

  it("lehnt ein Enddatum vor dem Startdatum ab", async () => {
    await actAs(seed.employee);
    await expect(
      submitWorkationRequest(
        trip({ startDate: "2027-06-18", endDate: "2027-06-07" })
      )
    ).rejects.toThrow("Das Enddatum darf nicht vor dem Startdatum liegen.");
  });

  it("verlangt die Pflichtangaben", async () => {
    await actAs(seed.employee);
    await expect(
      submitWorkationRequest(trip({ accommodationAddress: "" }))
    ).rejects.toThrow("Bitte Anschrift der Unterkunft angeben (für den A1-Antrag).");
    await expect(
      submitWorkationRequest(trip({ insuranceDetails: "" }))
    ).rejects.toThrow("Bitte Auslandskranken- und Rückholversicherung angeben.");
    await expect(submitWorkationRequest(trip({ workDays: "0" }))).rejects.toThrow(
      "Arbeitstage müssen größer 0 sein."
    );
    expect(await countRequests()).toBe(0);
  });

  it("verlangt eine Anmeldung", async () => {
    await actAs(null);
    await expect(submitWorkationRequest(trip())).rejects.toThrow(
      "Nicht angemeldet"
    );
  });
});

describe("resubmitWorkationRequest", () => {
  it("korrigiert einen beanstandeten Antrag, erhöht die Version und sichert die Historie", async () => {
    const id = await submitAsEmployee();
    await setStatus(id, "beanstandet");
    mailbox.length = 0;

    await expectRedirect(
      resubmitWorkationRequest(
        id,
        trip({ country: "Mexiko", city: "Oaxaca", workDays: "8" })
      ),
      `/workation/${id}`
    );

    expect(await load(id)).toMatchObject({
      status: "eingereicht",
      version: 2,
      country: "Mexiko",
      countryCategory: "drittstaat",
      city: "Oaxaca",
      workDays: 8,
    });
    const history = await testDb().select().from(schema.requestHistory);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      requestType: "workation",
      requestId: id,
      version: 1,
    });
    expect(history[0].snapshot).toMatchObject({ country: "Spanien", workDays: 10 });
    expect((await auditFor("workation", id))[0]).toMatchObject({
      action: "korrigiert_erneut_eingereicht",
      actorUserId: seed.employee.id,
    });
    expect(mailsTo(seed.admin.email)[0].subject).toBe(
      "Workation-Antrag korrigiert erneut eingereicht: Max Mitarbeiter"
    );
    expect(mailbox[0].paragraphs.join(" ")).toContain("(Version 2)");
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/workation");
  });

  it("korrigiert auch einen zurückgezogenen Antrag", async () => {
    const id = await submitAsEmployee();
    await setStatus(id, "zurueckgezogen");
    await expectRedirect(resubmitWorkationRequest(id, trip()));
    expect(await load(id)).toMatchObject({ status: "eingereicht", version: 2 });
  });

  it.each(["eingereicht", "genehmigt"] as const)(
    "lehnt die Korrektur im Status %s ab",
    async (status) => {
      const id = await submitAsEmployee();
      await setStatus(id, status);
      await expect(resubmitWorkationRequest(id, trip())).rejects.toThrow(
        "Nur beanstandete oder zurückgezogene Anträge können korrigiert werden."
      );
      expect((await load(id)).version).toBe(1);
    }
  );

  it("lässt fremde Anträge nicht korrigieren", async () => {
    const id = await submitAsEmployee();
    await setStatus(id, "beanstandet");
    await actAs(seed.admin);
    await expect(resubmitWorkationRequest(id, trip())).rejects.toThrow(
      "Antrag nicht gefunden."
    );
  });

  it("meldet unbekannte Anträge als nicht gefunden", async () => {
    await actAs(seed.employee);
    await expect(
      resubmitWorkationRequest("00000000-0000-4000-8000-000000000000", trip())
    ).rejects.toThrow("Antrag nicht gefunden.");
  });

  it("prüft die Limits bei der Korrektur ohne den Antrag selbst mitzuzählen", async () => {
    await insertWorkation({ workDays: 20, status: "genehmigt" });
    const own = await insertWorkation({ workDays: 10, status: "beanstandet" });
    await actAs(seed.employee);

    await expect(
      resubmitWorkationRequest(own.id, trip({ workDays: "11" }))
    ).rejects.toThrow("Das Jahreskontingent von 30 Arbeitstagen wird überschritten");
    expect(await load(own.id)).toMatchObject({ status: "beanstandet", version: 1 });
    expect(await testDb().select().from(schema.requestHistory)).toHaveLength(0);

    await expectRedirect(resubmitWorkationRequest(own.id, trip({ workDays: "10" })));
    expect(await load(own.id)).toMatchObject({ status: "eingereicht", workDays: 10 });
  });

  it("blockiert auch bei der Korrektur mehr als 20 zusammenhängende Arbeitstage", async () => {
    const id = await submitAsEmployee();
    await setStatus(id, "beanstandet");
    await expect(
      resubmitWorkationRequest(id, trip({ endDate: "2027-07-05", workDays: "21" }))
    ).rejects.toThrow("höchstens 20 zusammenhängende Arbeitstage");
    expect((await load(id)).status).toBe("beanstandet");
  });

  it("verlangt auch bei der Korrektur alle Erklärungen", async () => {
    const id = await submitAsEmployee();
    await setStatus(id, "beanstandet");
    await expect(
      resubmitWorkationRequest(id, trip({ declVisa: undefined }))
    ).rejects.toThrow("Alle sieben Erklärungen müssen bestätigt werden");
  });
});

describe("withdrawWorkationRequest", () => {
  it("zieht einen eingereichten Antrag zurück und auditiert", async () => {
    const id = await submitAsEmployee();
    await withdrawWorkationRequest(id);
    expect((await load(id)).status).toBe("zurueckgezogen");
    expect((await auditFor("workation", id))[0]).toMatchObject({
      action: "zurueckgezogen",
      actorUserId: seed.employee.id,
      source: "web",
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith(`/workation/${id}`);
  });

  it("zieht einen beanstandeten Antrag zurück", async () => {
    const id = await submitAsEmployee();
    await setStatus(id, "beanstandet");
    await withdrawWorkationRequest(id);
    expect((await load(id)).status).toBe("zurueckgezogen");
  });

  it.each(["genehmigt", "zurueckgezogen"] as const)(
    "lässt Anträge im Status %s nicht zurückziehen",
    async (status) => {
      const id = await submitAsEmployee();
      await setStatus(id, status);
      await expect(withdrawWorkationRequest(id)).rejects.toThrow(
        "Nur eingereichte oder beanstandete Anträge können zurückgezogen werden."
      );
      expect((await load(id)).status).toBe(status);
    }
  );

  it("lässt fremde Anträge nicht zurückziehen", async () => {
    const id = await submitAsEmployee();
    await actAs(seed.admin);
    await expect(withdrawWorkationRequest(id)).rejects.toThrow(
      "Antrag nicht gefunden."
    );
    expect((await load(id)).status).toBe("eingereicht");
  });
});

describe("deleteWorkationRequest", () => {
  it("löscht einen zurückgezogenen Antrag samt eigener Historie und auditiert", async () => {
    const id = await submitAsEmployee();
    const otherId = await submitAsEmployee({
      startDate: "2027-09-06",
      endDate: "2027-09-10",
      workDays: "5",
    });
    for (const requestId of [id, otherId]) {
      await setStatus(requestId, "beanstandet");
      await expectRedirect(resubmitWorkationRequest(requestId, trip()));
    }
    await withdrawWorkationRequest(id);

    await expectRedirect(deleteWorkationRequest(id), "/workation");

    expect(
      await testDb().query.workationRequests.findFirst({
        where: eq(schema.workationRequests.id, id),
      })
    ).toBeUndefined();
    const history = await testDb().select().from(schema.requestHistory);
    expect(history.map((h) => h.requestId)).toEqual([otherId]);
    expect((await auditFor("workation", id))[0]).toMatchObject({
      action: "geloescht",
      actorUserId: seed.employee.id,
      details: {
        country: "Spanien",
        city: "Valencia",
        startDate: "2027-06-07",
        endDate: "2027-06-18",
      },
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/workation");
  });

  it.each(["eingereicht", "beanstandet", "genehmigt"] as const)(
    "löscht keine Anträge im Status %s",
    async (status) => {
      const id = await submitAsEmployee();
      await setStatus(id, status);
      await expect(deleteWorkationRequest(id)).rejects.toThrow(
        "Nur zurückgezogene Anträge können endgültig gelöscht werden."
      );
      expect((await load(id)).status).toBe(status);
    }
  );

  it("lässt fremde Anträge nicht löschen — auch nicht durch den Admin", async () => {
    const id = await submitAsEmployee();
    await setStatus(id, "zurueckgezogen");
    await actAs(seed.admin);
    await expect(deleteWorkationRequest(id)).rejects.toThrow(
      "Antrag nicht gefunden."
    );
    await actAs(await createUser());
    await expect(deleteWorkationRequest(id)).rejects.toThrow(
      "Antrag nicht gefunden."
    );
    expect((await load(id)).status).toBe("zurueckgezogen");
  });
});

describe("updateWorkationAdminFields", () => {
  it("lehnt einen ungültigen A1-Status ab", async () => {
    const id = await submitAsEmployee();
    await actAs(seed.admin);
    await expect(
      updateWorkationAdminFields(id, formData({ a1Status: "gefaelscht" }))
    ).rejects.toThrow("Ungültiger A1-Status.");
    expect((await load(id)).a1Status).toBeNull();
    expect((await auditFor("workation", id)).map((a) => a.action)).not.toContain(
      "admin_felder_aktualisiert"
    );
  });

  it("speichert A1-Status, Nachweisdatum und ausgeschlossene Projekte bei EU-Anträgen", async () => {
    const id = await submitAsEmployee();
    await actAs(seed.admin);

    await updateWorkationAdminFields(
      id,
      formData({
        a1Status: "beantragt",
        proofProvidedAt: "2027-05-20",
        excludedProjects: "Mandat Contoso",
      })
    );

    expect(await load(id)).toMatchObject({
      a1Status: "beantragt",
      proofProvidedAt: "2027-05-20",
      excludedProjects: "Mandat Contoso",
    });
    expect((await auditFor("workation", id))[0]).toMatchObject({
      action: "admin_felder_aktualisiert",
      actorUserId: seed.admin.id,
      source: "web",
      details: {
        a1Status: "beantragt",
        proofProvidedAt: "2027-05-20",
        excludedProjects: "Mandat Contoso",
      },
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith(`/workation/${id}`);
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith(
      `/freigaben/workation/${id}`
    );
  });

  it("behält bei EU-Anträgen ohne A1-Angabe den bisherigen A1-Status und leert die übrigen Felder", async () => {
    const id = await submitAsEmployee();
    await actAs(seed.admin);
    await updateWorkationAdminFields(
      id,
      formData({
        a1Status: "liegt_vor",
        proofProvidedAt: "2027-05-20",
        excludedProjects: "Mandat Contoso",
      })
    );

    await updateWorkationAdminFields(
      id,
      formData({ proofProvidedAt: "", excludedProjects: "" })
    );

    expect(await load(id)).toMatchObject({
      a1Status: "liegt_vor",
      proofProvidedAt: null,
      excludedProjects: null,
    });
  });

  it("setzt bei Drittstaaten keinen A1-Status, speichert aber die übrigen Felder", async () => {
    const id = await submitAsEmployee({ country: "Japan", city: "Tokio" });
    await actAs(seed.admin);

    await updateWorkationAdminFields(
      id,
      formData({
        a1Status: "liegt_vor",
        proofProvidedAt: "2027-05-01",
        excludedProjects: "keine",
      })
    );

    expect(await load(id)).toMatchObject({
      countryCategory: "drittstaat",
      a1Status: null,
      proofProvidedAt: "2027-05-01",
      excludedProjects: "keine",
    });
  });

  it("verweigert die Pflege durch eine aktive Vertretung", async () => {
    const id = await submitAsEmployee();
    const deputy = await createUser();
    await makeDeputy(deputy);
    await actAs(deputy);
    await expect(
      updateWorkationAdminFields(id, formData({ a1Status: "beantragt" }))
    ).rejects.toThrow("Nur für den Admin zulässig.");
    expect((await load(id)).a1Status).toBeNull();
  });

  it("verweigert die Pflege durch Mitarbeitende — auch für den eigenen Antrag", async () => {
    const id = await submitAsEmployee();
    await expect(
      updateWorkationAdminFields(id, formData({ a1Status: "liegt_vor" }))
    ).rejects.toThrow("Nur für den Admin zulässig.");
    expect((await load(id)).a1Status).toBeNull();
  });

  it("meldet unbekannte Anträge als nicht gefunden", async () => {
    await actAs(seed.admin);
    await expect(
      updateWorkationAdminFields(
        "00000000-0000-4000-8000-000000000000",
        formData({ a1Status: "beantragt" })
      )
    ).rejects.toThrow("Antrag nicht gefunden.");
    expect(await auditFor("workation")).toHaveLength(0);
  });
});
