import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { approveAction, rejectAction } from "@/app/(app)/freigaben/actions";
import { resubmitExpenseReport } from "@/app/(app)/reisekosten/actions";
import { toISODate } from "@/lib/dates";
import type { WorkflowType } from "@/lib/workflow";
import * as schema from "../../../src/db/schema";
import {
  actAs,
  auditFor,
  createUser,
  expectRedirect,
  formData,
  makeDeputy,
} from "../../helpers/actions";
import { resetDb, seedTestData, testDb, type SeedResult } from "../../helpers/db";
import { mailbox, mailsTo, nextCacheModule } from "../../helpers/framework-fakes";

let seed: SeedResult;

const TYPES: WorkflowType[] = ["urlaub", "workation", "reisekosten", "provision"];

const TABLES = {
  urlaub: schema.vacationRequests,
  workation: schema.workationRequests,
  reisekosten: schema.expenseReports,
  provision: schema.commissionClaims,
} as const;

const LABELS: Record<WorkflowType, string> = {
  urlaub: "Urlaubsantrag",
  workation: "Workation-Antrag",
  reisekosten: "Reisekostenabrechnung",
  provision: "Provisionsanspruch",
};

/** ISO-Datum relativ zu heute — Vertretungszeiträume prüfen gegen "heute". */
function daysFromToday(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return toISODate(d);
}

/** Offenen Antrag des Typs direkt in der DB anlegen. */
async function insertRequest(
  type: WorkflowType,
  userId: string,
  status: schema.RequestStatus = "eingereicht"
): Promise<string> {
  const db = testDb();
  if (type === "urlaub") {
    const [row] = await db
      .insert(schema.vacationRequests)
      .values({ userId, status, startDate: "2026-11-02", endDate: "2026-11-06", days: 5 })
      .returning();
    return row.id;
  }
  if (type === "workation") {
    const [row] = await db
      .insert(schema.workationRequests)
      .values({
        userId,
        status,
        country: "Spanien",
        countryCategory: "eu_ewr_ch",
        city: "Valencia",
        accommodationAddress: "Calle Mayor 1",
        startDate: "2026-11-02",
        endDate: "2026-11-13",
        workDays: 10,
        timezoneAvailability: "MEZ, Kernzeit 9–15 Uhr",
        emergencyContactName: "Erika Muster",
        emergencyContactPhone: "+49 170 0000000",
        visaType: "EU-Bürger",
        insuranceDetails: "EHIC",
        plannedTasks: "Konzeption",
        domesticSubstitution: "Team",
      })
      .returning();
    return row.id;
  }
  if (type === "reisekosten") {
    const [row] = await db
      .insert(schema.expenseReports)
      .values({
        userId,
        status,
        destination: "Berlin",
        customerPurpose: "Workshop",
        departureDate: "2026-07-01",
        departureTime: "08:00",
        returnDate: "2026-07-02",
        returnTime: "18:00",
        totalCents: 12345,
      })
      .returning();
    return row.id;
  }
  const [row] = await db
    .insert(schema.commissionClaims)
    .values({
      userId,
      status,
      businessType: "schulung",
      customerType: "bestandskunde",
      customerName: "Haufe",
      orderDate: "2026-06-15",
      unit: "tage",
      quantity: 2,
      trainingFormat: "ganztaegig",
      trainingCount: 2,
      calculatedAmountCents: 15000,
      finalAmountCents: 15000,
    })
    .returning();
  return row.id;
}

async function load(type: WorkflowType, id: string) {
  const table = TABLES[type];
  const [row] = await testDb().select().from(table).where(eq(table.id, id));
  if (!row) throw new Error("Antrag fehlt");
  return row;
}

beforeAll(async () => {
  await resetDb();
  seed = await seedTestData();
});

beforeEach(async () => {
  const db = testDb();
  await db.delete(schema.requestHistory);
  await db.delete(schema.receipts);
  await db.delete(schema.expenseItems);
  await db.delete(schema.expenseReports);
  await db.delete(schema.vacationRequests);
  await db.delete(schema.workationRequests);
  await db.delete(schema.commissionClaims);
  await db.delete(schema.deputyAssignments);
});

describe("approveAction", () => {
  it.each(TYPES)(
    "genehmigt %s, protokolliert und benachrichtigt die antragstellende Person",
    async (type) => {
      const id = await insertRequest(type, seed.employee.id);
      await actAs(seed.admin);

      await approveAction(type, id);

      const row = await load(type, id);
      expect(row).toMatchObject({
        status: "genehmigt",
        decidedById: seed.admin.id,
        version: 1,
      });
      expect(row.decidedAt).toBeInstanceOf(Date);
      expect((await auditFor(type, id))[0]).toMatchObject({
        action: "genehmigt",
        actorUserId: seed.admin.id,
        actorLabel: "Erika Admin",
        source: "web",
      });
      const mails = mailsTo(seed.employee.email);
      expect(mails).toHaveLength(1);
      expect(mails[0]).toMatchObject({
        subject: `${LABELS[type]} genehmigt`,
        linkPath: `/${type}/${id}`,
      });
      expect(mailsTo(seed.admin.email)).toHaveLength(0);
      expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/freigaben");
      expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith(`/${type}`);
      // Entscheidungen erzeugen keinen Historien-Snapshot
      expect(await testDb().select().from(schema.requestHistory)).toHaveLength(0);
    }
  );

  it("nennt in der Genehmigungsmail die Eckdaten des Antrags", async () => {
    const id = await insertRequest("reisekosten", seed.employee.id);
    await actAs(seed.admin);
    await approveAction("reisekosten", id);
    expect(mailbox[0].paragraphs.join(" ")).toContain(
      "Reisekostenabrechnung Berlin (Workshop), Gesamterstattung 123,45"
    );
  });

  it("lehnt Mitarbeitende ohne Vertretung ab", async () => {
    const id = await insertRequest("urlaub", seed.employee.id);
    await actAs(await createUser());
    await expect(approveAction("urlaub", id)).rejects.toThrow(
      "Keine Berechtigung für Freigaben."
    );
    expect((await load("urlaub", id)).status).toBe("eingereicht");
    expect(mailbox).toHaveLength(0);
  });

  it.each(TYPES)("erlaubt der aktiven Vertretung die Genehmigung von %s", async (type) => {
    const deputy = await createUser({ firstName: "Vera", lastName: "Vertretung" });
    await makeDeputy(deputy, { startsOn: daysFromToday(-1), endsOn: daysFromToday(1) });
    const id = await insertRequest(type, seed.employee.id);
    await actAs(deputy);

    await approveAction(type, id);

    expect(await load(type, id)).toMatchObject({
      status: "genehmigt",
      decidedById: deputy.id,
    });
    expect((await auditFor(type, id))[0]).toMatchObject({
      action: "genehmigt",
      actorUserId: deputy.id,
      actorLabel: "Vera Vertretung",
    });
  });

  it("lehnt eine Vertretung vor Beginn ihres Zeitraums ab", async () => {
    const deputy = await createUser();
    await makeDeputy(deputy, { startsOn: daysFromToday(1) });
    const id = await insertRequest("urlaub", seed.employee.id);
    await actAs(deputy);
    await expect(approveAction("urlaub", id)).rejects.toThrow(
      "Keine Berechtigung für Freigaben."
    );
  });

  it("lehnt eine abgelaufene Vertretung ab", async () => {
    const deputy = await createUser();
    await makeDeputy(deputy, { startsOn: daysFromToday(-10), endsOn: daysFromToday(-1) });
    const id = await insertRequest("workation", seed.employee.id);
    await actAs(deputy);
    await expect(approveAction("workation", id)).rejects.toThrow(
      "Keine Berechtigung für Freigaben."
    );
    expect((await load("workation", id)).status).toBe("eingereicht");
  });

  it("lehnt eine ausgeschaltete Vertretung ab", async () => {
    const deputy = await createUser();
    await makeDeputy(deputy);
    await testDb()
      .update(schema.deputyAssignments)
      .set({ active: false })
      .where(eq(schema.deputyAssignments.userId, deputy.id));
    const id = await insertRequest("reisekosten", seed.employee.id);
    await actAs(deputy);
    await expect(approveAction("reisekosten", id)).rejects.toThrow(
      "Keine Berechtigung für Freigaben."
    );
  });

  it.each(TYPES)(
    "verweigert der Vertretung die Genehmigung eigener Anträge (%s, Vier-Augen-Prinzip)",
    async (type) => {
      const deputy = await createUser();
      await makeDeputy(deputy);
      const id = await insertRequest(type, deputy.id);
      await actAs(deputy);
      await expect(approveAction(type, id)).rejects.toThrow(
        "Eigene Anträge dürfen nicht selbst genehmigt werden (Vier-Augen-Prinzip)."
      );
      expect((await load(type, id)).status).toBe("eingereicht");
      expect(await auditFor(type, id)).toHaveLength(0);
    }
  );

  it("verweigert dem Admin die Genehmigung eigener Anträge", async () => {
    const id = await insertRequest("reisekosten", seed.admin.id);
    await actAs(seed.admin);
    await expect(approveAction("reisekosten", id)).rejects.toThrow("Vier-Augen-Prinzip");
  });

  it.each(["genehmigt", "beanstandet", "zurueckgezogen", "storniert"] as const)(
    "lehnt Anträge im Status %s als nicht offen ab",
    async (status) => {
      const id = await insertRequest("urlaub", seed.employee.id, status);
      await actAs(seed.admin);
      await expect(approveAction("urlaub", id)).rejects.toThrow(
        `Antrag ist nicht offen (Status: ${status}).`
      );
      expect((await load("urlaub", id)).status).toBe(status);
    }
  );

  it("verlangt vor der Genehmigung einer Provision den finalen Betrag", async () => {
    const id = await insertRequest("provision", seed.employee.id);
    await testDb()
      .update(schema.commissionClaims)
      .set({ finalAmountCents: null })
      .where(eq(schema.commissionClaims.id, id));
    await actAs(seed.admin);
    await expect(approveAction("provision", id)).rejects.toThrow(
      "Vor der Genehmigung muss der finale Provisionsbetrag gepflegt werden"
    );
    expect((await load("provision", id)).status).toBe("eingereicht");
  });

  it("genehmigt eine Provision mit Betrag 0 €", async () => {
    const id = await insertRequest("provision", seed.employee.id);
    await testDb()
      .update(schema.commissionClaims)
      .set({ finalAmountCents: 0 })
      .where(eq(schema.commissionClaims.id, id));
    await actAs(seed.admin);
    await approveAction("provision", id);
    expect((await load("provision", id)).status).toBe("genehmigt");
  });

  it("bestätigt einen Storno → storniert und informiert die antragstellende Person", async () => {
    const id = await insertRequest("urlaub", seed.employee.id, "storno_beantragt");
    await actAs(seed.admin);

    await approveAction("urlaub", id);

    expect(await load("urlaub", id)).toMatchObject({
      status: "storniert",
      decidedById: seed.admin.id,
    });
    expect((await auditFor("urlaub", id))[0].action).toBe("storno_bestaetigt");
    const [mail] = mailsTo(seed.employee.email);
    expect(mail).toMatchObject({
      subject: "Urlaubs-Storno bestätigt",
      linkPath: `/urlaub/${id}`,
    });
    expect(mail.paragraphs.join(" ")).toContain("wieder gutgeschrieben");
  });

  it("meldet unbekannte Anträge als nicht gefunden", async () => {
    await actAs(seed.admin);
    await expect(approveAction("urlaub", crypto.randomUUID())).rejects.toThrow(
      "Antrag nicht gefunden."
    );
  });

  it("findet Anträge nur im angegebenen Typ", async () => {
    const id = await insertRequest("urlaub", seed.employee.id);
    await actAs(seed.admin);
    await expect(approveAction("workation", id)).rejects.toThrow(
      "Antrag nicht gefunden."
    );
  });

  it("verlangt eine Anmeldung", async () => {
    const id = await insertRequest("urlaub", seed.employee.id);
    await actAs(null);
    await expect(approveAction("urlaub", id)).rejects.toThrow("Nicht angemeldet");
  });
});

describe("rejectAction", () => {
  it.each(TYPES)(
    "beanstandet %s mit Kommentar, protokolliert und benachrichtigt",
    async (type) => {
      const id = await insertRequest(type, seed.employee.id);
      await actAs(seed.admin);

      await rejectAction(type, id, formData({ comment: "  Bitte Angaben ergänzen.  " }));

      const row = await load(type, id);
      expect(row).toMatchObject({
        status: "beanstandet",
        rejectionComment: "Bitte Angaben ergänzen.",
        decidedById: seed.admin.id,
        version: 1,
      });
      expect((await auditFor(type, id))[0]).toMatchObject({
        action: "beanstandet",
        actorUserId: seed.admin.id,
        source: "web",
        details: { kommentar: "Bitte Angaben ergänzen." },
      });
      const mails = mailsTo(seed.employee.email);
      expect(mails).toHaveLength(1);
      expect(mails[0]).toMatchObject({
        subject: `${LABELS[type]} beanstandet`,
        linkPath: `/${type}/${id}`,
      });
      expect(mails[0].paragraphs.join(" ")).toContain("Bitte Angaben ergänzen.");
      expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/freigaben");
      expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith(`/${type}`);
    }
  );

  it("beanstandet eine Provision auch ohne finalen Betrag", async () => {
    const id = await insertRequest("provision", seed.employee.id);
    await testDb()
      .update(schema.commissionClaims)
      .set({ finalAmountCents: null })
      .where(eq(schema.commissionClaims.id, id));
    await actAs(seed.admin);
    await rejectAction("provision", id, formData({ comment: "Betrag klären" }));
    expect((await load("provision", id)).status).toBe("beanstandet");
  });

  it("verlangt einen Kommentar", async () => {
    const id = await insertRequest("urlaub", seed.employee.id);
    await actAs(seed.admin);
    for (const fd of [formData({}), formData({ comment: "" }), formData({ comment: "   " })]) {
      await expect(rejectAction("urlaub", id, fd)).rejects.toThrow(
        "Eine Beanstandung erfordert einen Kommentar (Grund)."
      );
    }
    expect((await load("urlaub", id)).status).toBe("eingereicht");
    expect(mailbox).toHaveLength(0);
  });

  it("lehnt Mitarbeitende ohne Vertretung ab", async () => {
    const id = await insertRequest("reisekosten", seed.employee.id);
    await actAs(await createUser());
    await expect(
      rejectAction("reisekosten", id, formData({ comment: "Nein" }))
    ).rejects.toThrow("Keine Berechtigung für Freigaben.");
    expect((await load("reisekosten", id)).status).toBe("eingereicht");
  });

  it("erlaubt der aktiven Vertretung die Beanstandung", async () => {
    const deputy = await createUser();
    await makeDeputy(deputy, { endsOn: daysFromToday(0) });
    const id = await insertRequest("provision", seed.employee.id);
    await actAs(deputy);
    await rejectAction("provision", id, formData({ comment: "Kunde fehlt" }));
    expect(await load("provision", id)).toMatchObject({
      status: "beanstandet",
      decidedById: deputy.id,
    });
  });

  it("lehnt eine Vertretung außerhalb ihres Zeitraums ab", async () => {
    const deputy = await createUser();
    await makeDeputy(deputy, { startsOn: daysFromToday(2), endsOn: daysFromToday(5) });
    const id = await insertRequest("workation", seed.employee.id);
    await actAs(deputy);
    await expect(
      rejectAction("workation", id, formData({ comment: "Nein" }))
    ).rejects.toThrow("Keine Berechtigung für Freigaben.");
  });

  it.each(TYPES)(
    "verweigert die Beanstandung eigener Anträge (%s, Vier-Augen-Prinzip)",
    async (type) => {
      const deputy = await createUser();
      await makeDeputy(deputy);
      const id = await insertRequest(type, deputy.id);
      await actAs(deputy);
      await expect(
        rejectAction(type, id, formData({ comment: "selbst" }))
      ).rejects.toThrow(
        "Eigene Anträge dürfen nicht selbst bearbeitet werden (Vier-Augen-Prinzip)."
      );
      expect((await load(type, id)).status).toBe("eingereicht");
    }
  );

  it.each(["genehmigt", "beanstandet", "zurueckgezogen", "storniert"] as const)(
    "lehnt Anträge im Status %s als nicht offen ab",
    async (status) => {
      const id = await insertRequest("workation", seed.employee.id, status);
      await actAs(seed.admin);
      await expect(
        rejectAction("workation", id, formData({ comment: "zu spät" }))
      ).rejects.toThrow(`Antrag ist nicht offen (Status: ${status}).`);
      expect((await load("workation", id)).status).toBe(status);
    }
  );

  it("lehnt einen Storno ab → Urlaub bleibt genehmigt", async () => {
    const id = await insertRequest("urlaub", seed.employee.id, "storno_beantragt");
    await actAs(seed.admin);

    await rejectAction("urlaub", id, formData({ comment: "Projektphase" }));

    expect(await load("urlaub", id)).toMatchObject({
      status: "genehmigt",
      rejectionComment: "Projektphase",
      decidedById: seed.admin.id,
    });
    expect((await auditFor("urlaub", id))[0]).toMatchObject({
      action: "storno_abgelehnt",
      details: { kommentar: "Projektphase" },
    });
    // Aktuell geht dieselbe Mail wie bei einer Beanstandung raus
    const [mail] = mailsTo(seed.employee.email);
    expect(mail.subject).toBe("Urlaubsantrag beanstandet");
    expect(mail.paragraphs.join(" ")).toContain("Begründung: Projektphase");
  });

  it("meldet unbekannte Anträge als nicht gefunden", async () => {
    await actAs(seed.admin);
    await expect(
      rejectAction("provision", crypto.randomUUID(), formData({ comment: "x" }))
    ).rejects.toThrow("Antrag nicht gefunden.");
  });

  it("verlangt eine Anmeldung", async () => {
    const id = await insertRequest("urlaub", seed.employee.id);
    await actAs(null);
    await expect(
      rejectAction("urlaub", id, formData({ comment: "x" }))
    ).rejects.toThrow("Nicht angemeldet");
  });

  it("Beanstandung → Korrektur → Genehmigung: Version 2 mit Historie", async () => {
    const id = await insertRequest("reisekosten", seed.employee.id);
    await actAs(seed.admin);
    await rejectAction("reisekosten", id, formData({ comment: "Hotelbeleg fehlt" }));

    await actAs(seed.employee);
    await expectRedirect(
      resubmitExpenseReport(
        id,
        formData({
          payload: JSON.stringify({
            destination: "Berlin",
            customerPurpose: "Workshop",
            departureDate: "2026-07-01",
            departureTime: "08:00",
            returnDate: "2026-07-02",
            returnTime: "18:00",
          }),
        })
      ),
      `/reisekosten/${id}`
    );
    expect((await load("reisekosten", id)).status).toBe("eingereicht");

    await actAs(seed.admin);
    await approveAction("reisekosten", id);

    expect(await load("reisekosten", id)).toMatchObject({
      status: "genehmigt",
      version: 2,
      // Der Kommentar der letzten Beanstandung bleibt stehen
      rejectionComment: "Hotelbeleg fehlt",
    });
    const history = await testDb().select().from(schema.requestHistory);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ requestId: id, version: 1 });
    expect((history[0].snapshot as { status: string }).status).toBe("beanstandet");
    expect((await auditFor("reisekosten", id)).map((a) => a.action)).toEqual([
      "genehmigt",
      "korrigiert_erneut_eingereicht",
      "beanstandet",
    ]);
  });
});
