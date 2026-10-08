import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { approveAction } from "@/app/(app)/freigaben/actions";
import {
  deleteCommissionClaim,
  resubmitCommissionClaim,
  submitCommissionClaim,
  updateCommissionAdminFields,
  withdrawCommissionClaim,
} from "@/app/(app)/provision/actions";
import { formatEuro } from "@/lib/expenses/calc";
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

// Folge-Training: drei halbtägige Trainings à 50 € (Standardsätze)
const TRAINING: Record<string, string> = {
  businessType: "schulung",
  customerType: "bestandskunde",
  customerName: "Haufe Akademie",
  orderDate: "2026-09-15",
  unit: "tage",
  quantity: "1,5",
  trainingFormat: "halbtaegig",
  trainingCount: "3",
};

// Folgeberatung mit Nettoauftragswert in deutscher Schreibweise
const CONSULTING: Record<string, string> = {
  businessType: "beratung",
  customerType: "bestandskunde",
  customerName: "dbb akademie",
  orderDate: "2026-09-20",
  unit: "liefergegenstaende",
  quantity: "2",
  netOrderValue: "12.345,67",
};

async function submitAsEmployee(values: Record<string, string | undefined> = TRAINING) {
  await actAs(seed.employee);
  const url = await expectRedirect(
    submitCommissionClaim(formData(values)),
    /^\/provision\/[0-9a-f-]+$/
  );
  return idFromUrl(url);
}

async function load(id: string) {
  const row = await testDb().query.commissionClaims.findFirst({
    where: eq(schema.commissionClaims.id, id),
  });
  if (!row) throw new Error("Anspruch fehlt");
  return row;
}

async function setStatus(id: string, status: schema.RequestStatus) {
  await testDb()
    .update(schema.commissionClaims)
    .set({ status })
    .where(eq(schema.commissionClaims.id, id));
}

async function countClaims() {
  return (await testDb().select().from(schema.commissionClaims)).length;
}

beforeAll(async () => {
  await resetDb();
  seed = await seedTestData();
});

beforeEach(async () => {
  const db = testDb();
  await db.delete(schema.requestHistory);
  await db.delete(schema.commissionClaims);
  await db.delete(schema.deputyAssignments);
  await db.delete(schema.auditLog);
  await db
    .update(schema.settings)
    .set({
      commissionHalfDayCents: 5000,
      commissionFullDayCents: 7500,
      commissionTwoDayCents: 10000,
      commissionConsultingPercent: 4,
    })
    .where(eq(schema.settings.id, 1));
});

describe("submitCommissionClaim", () => {
  it("legt ein Folge-Training an, berechnet den Anspruch und benachrichtigt Admin und Vertretung", async () => {
    const deputy = await createUser({ firstName: "Vera", lastName: "Vertretung" });
    await makeDeputy(deputy);

    const id = await submitAsEmployee({ ...TRAINING, note: "Auftrag 4711" });

    expect(await load(id)).toMatchObject({
      userId: seed.employee.id,
      status: "eingereicht",
      version: 1,
      businessType: "schulung",
      customerType: "bestandskunde",
      customerName: "Haufe Akademie",
      orderDate: "2026-09-15",
      unit: "tage",
      quantity: 1.5,
      trainingFormat: "halbtaegig",
      trainingCount: 3,
      netOrderValueCents: null,
      note: "Auftrag 4711",
      calculatedAmountCents: 15000,
      finalAmountCents: 15000,
      referralBonusCents: null,
      ratesSnapshot: {
        halfDayCents: 5000,
        fullDayCents: 7500,
        twoDayCents: 10000,
        consultingPercent: 4,
      },
    });
    expect((await auditFor("provision", id))[0]).toMatchObject({
      action: "eingereicht",
      actorUserId: seed.employee.id,
      source: "web",
    });
    expect(mailsTo(seed.admin.email)).toHaveLength(1);
    expect(mailsTo(deputy.email)).toHaveLength(1);
    expect(mailbox[0]).toMatchObject({
      subject: "Provisionsanspruch eingereicht: Max Mitarbeiter",
      linkPath: `/freigaben/provision/${id}`,
    });
    expect(mailbox[0].paragraphs.join(" ")).toContain(
      `Folge-Training für Haufe Akademie. Berechneter Anspruch: ${formatEuro(15000)}.`
    );
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/provision");
  });

  it.each([
    ["halbtaegig", "4", 20000],
    ["ganztaegig", "2", 15000],
    ["zweitaegig", "3", 30000],
  ])(
    "berechnet Trainingsformat %s mit %s Trainings auf %i Cent",
    async (trainingFormat, trainingCount, expected) => {
      const id = await submitAsEmployee({ ...TRAINING, trainingFormat, trainingCount });
      expect(await load(id)).toMatchObject({
        calculatedAmountCents: expected,
        finalAmountCents: expected,
      });
    }
  );

  it("nutzt die Provisionssätze aus den Einstellungen und friert sie ein", async () => {
    await testDb()
      .update(schema.settings)
      .set({ commissionFullDayCents: 9000 })
      .where(eq(schema.settings.id, 1));
    const id = await submitAsEmployee({
      ...TRAINING,
      trainingFormat: "ganztaegig",
      trainingCount: "2",
    });
    const claim = await load(id);
    expect(claim.calculatedAmountCents).toBe(18000);
    expect(claim.ratesSnapshot).toMatchObject({ fullDayCents: 9000 });
  });

  it("berechnet bei Folgeberatungen 4 % vom Nettoauftragswert (Komma-Eingabe mit Tausenderpunkt)", async () => {
    const id = await submitAsEmployee(CONSULTING);
    expect(await load(id)).toMatchObject({
      businessType: "beratung",
      unit: "liefergegenstaende",
      quantity: 2,
      netOrderValueCents: 1234567,
      // 4 % von 12.345,67 € = 493,8268 € → gerundet 493,83 €
      calculatedAmountCents: 49383,
      finalAmountCents: 49383,
      trainingFormat: null,
      trainingCount: null,
    });
    expect(mailbox[0].paragraphs.join(" ")).toContain(
      `Folgeberatung für dbb akademie. Berechneter Anspruch: ${formatEuro(49383)}.`
    );
  });

  it("versteht einen Punkt als Dezimaltrenner (wie DECIMAL_PATTERN erlaubt)", async () => {
    const id = await submitAsEmployee({ ...CONSULTING, netOrderValue: "5000.50" });
    // 4 % von 5.000,50 € = 200,02 €
    expect(await load(id)).toMatchObject({
      netOrderValueCents: 500050,
      calculatedAmountCents: 20002,
    });
  });

  it("ignoriert Trainingsangaben bei Beratungen und Auftragswerte bei Schulungen", async () => {
    const consultingId = await submitAsEmployee({
      ...CONSULTING,
      netOrderValue: "1000",
      trainingFormat: "zweitaegig",
      trainingCount: "5",
    });
    expect(await load(consultingId)).toMatchObject({
      trainingFormat: null,
      trainingCount: null,
      calculatedAmountCents: 4000,
    });

    const trainingId = await submitAsEmployee({ ...TRAINING, netOrderValue: "99.999" });
    expect((await load(trainingId)).netOrderValueCents).toBeNull();
  });

  it.each(["abc", "-5"])("lehnt den Auftragswert %s als ungültigen Betrag ab", async (netOrderValue) => {
    await actAs(seed.employee);
    await expect(
      submitCommissionClaim(formData({ ...CONSULTING, netOrderValue }))
    ).rejects.toThrow("Ungültiger Betrag.");
    expect(await countClaims()).toBe(0);
  });

  it("verlangt bei Beratungen einen Nettoauftragswert", async () => {
    await actAs(seed.employee);
    await expect(
      submitCommissionClaim(formData({ ...CONSULTING, netOrderValue: "" }))
    ).rejects.toThrow("Bitte den Nettoauftragswert angeben.");
  });

  it("verlangt bei Schulungen Format und Anzahl der Trainings", async () => {
    await actAs(seed.employee);
    await expect(
      submitCommissionClaim(formData({ ...TRAINING, trainingFormat: "" }))
    ).rejects.toThrow("Bitte das Trainingsformat wählen.");
    await expect(
      submitCommissionClaim(formData({ ...TRAINING, trainingCount: "" }))
    ).rejects.toThrow("Bitte die Anzahl der bestellten Trainings angeben.");
    expect(await countClaims()).toBe(0);
  });

  it("verlangt Kunde, Bestelldatum und einen positiven Umfang", async () => {
    await actAs(seed.employee);
    await expect(
      submitCommissionClaim(formData({ ...TRAINING, customerName: "   " }))
    ).rejects.toThrow("Bitte Kunde/Organisation angeben.");
    await expect(
      submitCommissionClaim(formData({ ...TRAINING, orderDate: "" }))
    ).rejects.toThrow("Bitte das Datum der Bestellung angeben.");
    await expect(
      submitCommissionClaim(formData({ ...TRAINING, quantity: "0" }))
    ).rejects.toThrow("Der Umfang muss größer als 0 sein.");
    expect(await countClaims()).toBe(0);
  });

  it("kennzeichnet Neukunden und weist auf die Vermittlungsprovision hin", async () => {
    const id = await submitAsEmployee({ ...TRAINING, customerType: "neukunde" });
    expect(await load(id)).toMatchObject({
      customerType: "neukunde",
      calculatedAmountCents: 15000,
      finalAmountCents: 15000,
      referralBonusCents: null,
    });
    expect(mailbox[0].paragraphs.join(" ")).toContain(
      "Neukunden-Vermittlung: Vermittlungsprovision wird im Einzelfall abgestimmt."
    );
  });

  it("berechnet bei abweichendem Trainingsformat keinen automatischen Betrag", async () => {
    const id = await submitAsEmployee({ ...TRAINING, trainingFormat: "abweichend" });
    expect(await load(id)).toMatchObject({
      trainingFormat: "abweichend",
      calculatedAmountCents: null,
      finalAmountCents: null,
    });
    expect(mailbox[0].paragraphs.join(" ")).toContain(
      "Betrag individuell zu vereinbaren."
    );
  });

  it("verlangt eine Anmeldung", async () => {
    await actAs(null);
    await expect(submitCommissionClaim(formData(TRAINING))).rejects.toThrow(
      "Nicht angemeldet"
    );
  });
});

describe("resubmitCommissionClaim", () => {
  it("korrigiert einen beanstandeten Anspruch, rechnet neu und sichert die Historie", async () => {
    const id = await submitAsEmployee();
    // Admin hatte bereits eine Vermittlungsprovision gepflegt
    await testDb()
      .update(schema.commissionClaims)
      .set({ status: "beanstandet", referralBonusCents: 50000, finalAmountCents: 65000 })
      .where(eq(schema.commissionClaims.id, id));
    mailbox.length = 0;

    await expectRedirect(
      resubmitCommissionClaim(id, formData(CONSULTING)),
      `/provision/${id}`
    );

    expect(await load(id)).toMatchObject({
      status: "eingereicht",
      version: 2,
      businessType: "beratung",
      customerName: "dbb akademie",
      trainingFormat: null,
      trainingCount: null,
      netOrderValueCents: 1234567,
      note: null,
      calculatedAmountCents: 49383,
      referralBonusCents: null,
      finalAmountCents: 49383,
    });
    const history = await testDb().select().from(schema.requestHistory);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      requestType: "provision",
      requestId: id,
      version: 1,
    });
    expect(history[0].snapshot).toMatchObject({
      businessType: "schulung",
      finalAmountCents: 65000,
    });
    expect((await auditFor("provision", id))[0]).toMatchObject({
      action: "korrigiert_erneut_eingereicht",
      actorUserId: seed.employee.id,
    });
    expect(mailsTo(seed.admin.email)[0].subject).toBe(
      "Provisionsanspruch korrigiert erneut eingereicht: Max Mitarbeiter"
    );
    expect(mailbox[0].paragraphs.join(" ")).toContain("(Version 2)");
  });

  it("korrigiert auch einen zurückgezogenen Anspruch", async () => {
    const id = await submitAsEmployee();
    await setStatus(id, "zurueckgezogen");
    await expectRedirect(
      resubmitCommissionClaim(id, formData({ ...TRAINING, trainingCount: "1" }))
    );
    expect(await load(id)).toMatchObject({
      status: "eingereicht",
      calculatedAmountCents: 5000,
    });
  });

  it.each(["eingereicht", "genehmigt"] as const)(
    "lehnt die Korrektur im Status %s ab",
    async (status) => {
      const id = await submitAsEmployee();
      await setStatus(id, status);
      await expect(resubmitCommissionClaim(id, formData(TRAINING))).rejects.toThrow(
        "Nur beanstandete oder zurückgezogene Ansprüche können korrigiert werden."
      );
      expect((await load(id)).version).toBe(1);
    }
  );

  it("lässt fremde Ansprüche nicht korrigieren", async () => {
    const id = await submitAsEmployee();
    await setStatus(id, "beanstandet");
    await actAs(seed.admin);
    await expect(resubmitCommissionClaim(id, formData(TRAINING))).rejects.toThrow(
      "Anspruch nicht gefunden."
    );
  });

  it("lehnt einen ungültigen Betrag auch bei der Korrektur ab", async () => {
    const id = await submitAsEmployee();
    await setStatus(id, "beanstandet");
    await expect(
      resubmitCommissionClaim(id, formData({ ...CONSULTING, netOrderValue: "zehn" }))
    ).rejects.toThrow("Ungültiger Betrag.");
    expect(await load(id)).toMatchObject({ status: "beanstandet", version: 1 });
    expect(await testDb().select().from(schema.requestHistory)).toHaveLength(0);
  });
});

describe("withdrawCommissionClaim", () => {
  it("zieht einen eingereichten Anspruch zurück und auditiert", async () => {
    const id = await submitAsEmployee();
    await withdrawCommissionClaim(id);
    expect((await load(id)).status).toBe("zurueckgezogen");
    expect((await auditFor("provision", id))[0]).toMatchObject({
      action: "zurueckgezogen",
      actorUserId: seed.employee.id,
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith(`/provision/${id}`);
  });

  it("zieht einen beanstandeten Anspruch zurück", async () => {
    const id = await submitAsEmployee();
    await setStatus(id, "beanstandet");
    await withdrawCommissionClaim(id);
    expect((await load(id)).status).toBe("zurueckgezogen");
  });

  it.each(["genehmigt", "zurueckgezogen"] as const)(
    "lässt Ansprüche im Status %s nicht zurückziehen",
    async (status) => {
      const id = await submitAsEmployee();
      await setStatus(id, status);
      await expect(withdrawCommissionClaim(id)).rejects.toThrow(
        "Nur eingereichte oder beanstandete Ansprüche können zurückgezogen werden."
      );
    }
  );

  it("lässt fremde Ansprüche nicht zurückziehen", async () => {
    const id = await submitAsEmployee();
    await actAs(seed.admin);
    await expect(withdrawCommissionClaim(id)).rejects.toThrow(
      "Anspruch nicht gefunden."
    );
    expect((await load(id)).status).toBe("eingereicht");
  });
});

describe("deleteCommissionClaim", () => {
  it("löscht einen zurückgezogenen Anspruch samt Historie und auditiert", async () => {
    const id = await submitAsEmployee();
    await setStatus(id, "beanstandet");
    await expectRedirect(resubmitCommissionClaim(id, formData(TRAINING)));
    await withdrawCommissionClaim(id);

    await expectRedirect(deleteCommissionClaim(id), "/provision");

    expect(
      await testDb().query.commissionClaims.findFirst({
        where: eq(schema.commissionClaims.id, id),
      })
    ).toBeUndefined();
    expect(await testDb().select().from(schema.requestHistory)).toHaveLength(0);
    expect((await auditFor("provision", id))[0]).toMatchObject({
      action: "geloescht",
      actorUserId: seed.employee.id,
      details: {
        customerName: "Haufe Akademie",
        orderDate: "2026-09-15",
        businessType: "schulung",
      },
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/provision");
  });

  it.each(["eingereicht", "beanstandet", "genehmigt"] as const)(
    "löscht keine Ansprüche im Status %s",
    async (status) => {
      const id = await submitAsEmployee();
      await setStatus(id, status);
      await expect(deleteCommissionClaim(id)).rejects.toThrow(
        "Nur zurückgezogene Ansprüche können endgültig gelöscht werden."
      );
      expect((await load(id)).status).toBe(status);
    }
  );

  it("lässt fremde Ansprüche nicht löschen — auch nicht durch den Admin", async () => {
    const id = await submitAsEmployee();
    await setStatus(id, "zurueckgezogen");
    await actAs(seed.admin);
    await expect(deleteCommissionClaim(id)).rejects.toThrow(
      "Anspruch nicht gefunden."
    );
    expect((await load(id)).status).toBe("zurueckgezogen");
  });
});

describe("updateCommissionAdminFields", () => {
  it("übernimmt einen Override mit Punkt als Dezimaltrenner", async () => {
    const id = await submitAsEmployee();
    await actAs(seed.admin);
    await updateCommissionAdminFields(id, formData({ finalAmount: "180.00" }));
    expect((await load(id)).finalAmountCents).toBe(18000);
  });

  it("übernimmt einen Override als finalen Betrag statt der Berechnung", async () => {
    const id = await submitAsEmployee();
    await actAs(seed.admin);

    await updateCommissionAdminFields(id, formData({ finalAmount: "180,00" }));

    expect(await load(id)).toMatchObject({
      calculatedAmountCents: 15000,
      referralBonusCents: null,
      finalAmountCents: 18000,
    });
    expect((await auditFor("provision", id))[0]).toMatchObject({
      action: "admin_betraege_aktualisiert",
      actorUserId: seed.admin.id,
      source: "web",
      details: { referralBonusCents: null, finalAmountCents: 18000 },
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith(`/provision/${id}`);
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith(
      `/freigaben/provision/${id}`
    );
  });

  it("addiert die Vermittlungsprovision eines Neukunden zum berechneten Betrag", async () => {
    const id = await submitAsEmployee({ ...TRAINING, customerType: "neukunde" });
    await actAs(seed.admin);

    await updateCommissionAdminFields(
      id,
      formData({ referralBonus: "1.500,50", finalAmount: "" })
    );

    expect(await load(id)).toMatchObject({
      referralBonusCents: 150050,
      finalAmountCents: 165050,
    });
  });

  it("der Override hat Vorrang vor Berechnung plus Vermittlungsprovision", async () => {
    const id = await submitAsEmployee({ ...TRAINING, customerType: "neukunde" });
    await actAs(seed.admin);
    await updateCommissionAdminFields(
      id,
      formData({ referralBonus: "500", finalAmount: "600" })
    );
    expect(await load(id)).toMatchObject({
      referralBonusCents: 50000,
      finalAmountCents: 60000,
    });
  });

  it("setzt ohne Eingaben den finalen Betrag auf die Berechnung zurück", async () => {
    const id = await submitAsEmployee();
    await actAs(seed.admin);
    await updateCommissionAdminFields(
      id,
      formData({ referralBonus: "100", finalAmount: "999" })
    );

    await updateCommissionAdminFields(id, formData({ referralBonus: "", finalAmount: "" }));

    expect(await load(id)).toMatchObject({
      referralBonusCents: null,
      finalAmountCents: 15000,
    });
  });

  it("lässt den Betrag bei abweichendem Format ohne Eingaben offen", async () => {
    const id = await submitAsEmployee({ ...TRAINING, trainingFormat: "abweichend" });
    await actAs(seed.admin);

    await updateCommissionAdminFields(id, formData({}));
    expect((await load(id)).finalAmountCents).toBeNull();

    await updateCommissionAdminFields(id, formData({ referralBonus: "250" }));
    expect(await load(id)).toMatchObject({
      referralBonusCents: 25000,
      finalAmountCents: 25000,
    });
  });

  it.each([
    ["finalAmount", "viel"],
    ["referralBonus", "-1"],
  ])("lehnt einen ungültigen Betrag in %s ab", async (field, value) => {
    const id = await submitAsEmployee();
    await actAs(seed.admin);
    await expect(
      updateCommissionAdminFields(id, formData({ [field]: value }))
    ).rejects.toThrow("Ungültiger Betrag.");
    expect((await load(id)).finalAmountCents).toBe(15000);
    expect(
      (await auditFor("provision", id)).map((a) => a.action)
    ).not.toContain("admin_betraege_aktualisiert");
  });

  it("verweigert die Pflege durch eine aktive Vertretung", async () => {
    const id = await submitAsEmployee();
    const deputy = await createUser();
    await makeDeputy(deputy);
    await actAs(deputy);
    await expect(
      updateCommissionAdminFields(id, formData({ finalAmount: "1000" }))
    ).rejects.toThrow("Nur für den Admin zulässig.");
    expect((await load(id)).finalAmountCents).toBe(15000);
  });

  it("verweigert die Pflege durch Mitarbeitende — auch für den eigenen Anspruch", async () => {
    const id = await submitAsEmployee();
    await expect(
      updateCommissionAdminFields(id, formData({ finalAmount: "1000" }))
    ).rejects.toThrow("Nur für den Admin zulässig.");
    expect((await load(id)).finalAmountCents).toBe(15000);
  });

  it("meldet unbekannte Ansprüche als nicht gefunden", async () => {
    await actAs(seed.admin);
    await expect(
      updateCommissionAdminFields(
        "00000000-0000-4000-8000-000000000000",
        formData({ finalAmount: "10" })
      )
    ).rejects.toThrow("Anspruch nicht gefunden.");
  });
});

describe("approveAction (Provision)", () => {
  it("verweigert die Genehmigung ohne finalen Betrag und genehmigt nach Pflege", async () => {
    const id = await submitAsEmployee({ ...TRAINING, trainingFormat: "abweichend" });
    await actAs(seed.admin);

    await expect(approveAction("provision", id)).rejects.toThrow(
      "Vor der Genehmigung muss der finale Provisionsbetrag gepflegt werden"
    );
    expect((await load(id)).status).toBe("eingereicht");

    await updateCommissionAdminFields(id, formData({ finalAmount: "800,00" }));
    mailbox.length = 0;
    await approveAction("provision", id);

    expect(await load(id)).toMatchObject({
      status: "genehmigt",
      decidedById: seed.admin.id,
      finalAmountCents: 80000,
    });
    expect((await auditFor("provision", id))[0]).toMatchObject({
      action: "genehmigt",
      actorUserId: seed.admin.id,
    });
    const [mail] = mailsTo(seed.employee.email);
    expect(mail.subject).toBe("Provisionsanspruch genehmigt");
    expect(mail.paragraphs.join(" ")).toContain(formatEuro(80000));
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/provision");
  });

  it("genehmigt einen Neukunden-Anspruch mit berechnetem Betrag auch ohne Vermittlungsprovision", async () => {
    const id = await submitAsEmployee({ ...TRAINING, customerType: "neukunde" });
    await actAs(seed.admin);
    await approveAction("provision", id);
    expect(await load(id)).toMatchObject({
      status: "genehmigt",
      referralBonusCents: null,
      finalAmountCents: 15000,
    });
  });
});
