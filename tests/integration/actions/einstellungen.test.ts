import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addWebhook,
  clearDeputy,
  createApiKey,
  deleteWebhook,
  revokeApiKey,
  setDeputy,
  toggleWebhook,
  updateCommissionRates,
  updateQuotas,
  updateRates,
  updateRetention,
} from "@/app/(app)/einstellungen/actions";
import { authenticateApiRequest } from "@/lib/api-auth";
import { getActiveDeputy } from "@/lib/auth";
import * as schema from "../../../src/db/schema";
import { actAs, auditFor, createUser, formData, makeDeputy } from "../../helpers/actions";
import { resetDb, seedTestData, testDb, type SeedResult } from "../../helpers/db";
import { nextCacheModule } from "../../helpers/framework-fakes";

let seed: SeedResult;

const ADMIN_ONLY = "Nur für den Admin zulässig.";

const QUOTAS = {
  defaultAnnualVacationDays: "27.5",
  workationYearlyLimitDays: "40",
  workationConsecutiveLimitDays: "15",
};

const RATES = {
  rateFullDay: "28,00",
  ratePartialDay: "14,00",
  rateReductionBreakfast: "5,60",
  rateReductionLunch: "11,20",
  rateReductionDinner: "11,20",
  rateKm: "0,30",
  ratePassengerKm: "0,02",
  employerDailySupplement: "0,00",
};

const COMMISSION = {
  commissionHalfDay: "50,00",
  commissionFullDay: "75,00",
  commissionTwoDay: "100,00",
  commissionConsultingPercent: "4",
};

const RETENTION = {
  retentionExpenseYears: "10",
  retentionSickLeaveYears: "6",
  retentionRequestYears: "4",
};

const WEBHOOK = {
  category: "urlaub",
  event: "genehmigt",
  url: "https://n8n.example.com/webhook/urlaub",
  secret: "geheimes-secret-1234",
};

async function loadSettings() {
  const row = await testDb().query.settings.findFirst({
    where: eq(schema.settings.id, 1),
  });
  if (!row) throw new Error("Einstellungen fehlen");
  return row;
}

async function activeAssignments() {
  return testDb()
    .select()
    .from(schema.deputyAssignments)
    .where(eq(schema.deputyAssignments.active, true));
}

async function insertWebhook(values: Partial<typeof schema.webhookConfigs.$inferInsert> = {}) {
  const [row] = await testDb()
    .insert(schema.webhookConfigs)
    .values({
      category: "urlaub",
      event: "genehmigt",
      url: "https://n8n.example.com/webhook/x",
      secret: "geheimes-secret-1234",
      ...values,
    })
    .returning();
  return row;
}

async function loadWebhook(id: string) {
  return testDb().query.webhookConfigs.findFirst({
    where: eq(schema.webhookConfigs.id, id),
  });
}

async function loadKey(id: string) {
  const row = await testDb().query.apiKeys.findFirst({
    where: eq(schema.apiKeys.id, id),
  });
  if (!row) throw new Error("API-Key fehlt");
  return row;
}

/** Key über die Action anlegen; liefert Klartext und DB-Zeile. */
async function createKey(values: Record<string, string> = { name: "n8n" }) {
  const plaintext = await createApiKey(formData(values));
  const [row] = await testDb().select().from(schema.apiKeys);
  return { plaintext, row };
}

function bearer(key: string): Request {
  return new Request("http://localhost/api/v1/requests", {
    headers: { authorization: `Bearer ${key}` },
  });
}

beforeAll(async () => {
  await resetDb();
  seed = await seedTestData();
});

beforeEach(async () => {
  const db = testDb();
  await db.delete(schema.auditLog);
  await db.delete(schema.webhookDeliveries);
  await db.delete(schema.webhookConfigs);
  await db.delete(schema.apiKeys);
  await db.delete(schema.deputyAssignments);
  await db.delete(schema.settings);
  await db.insert(schema.settings).values({ id: 1 });
  await actAs(seed.admin);
});

describe("updateQuotas", () => {
  it("speichert Jahresurlaub und beide Workation-Limits und auditiert", async () => {
    await updateQuotas(formData(QUOTAS));

    expect(await loadSettings()).toMatchObject({
      defaultAnnualVacationDays: 27.5,
      workationYearlyLimitDays: 40,
      workationConsecutiveLimitDays: 15,
    });
    expect((await auditFor("settings"))[0]).toMatchObject({
      action: "kontingente_geaendert",
      actorUserId: seed.admin.id,
      actorLabel: "Erika Admin",
      source: "web",
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/einstellungen");
  });

  it("speichert leere Felder als 0 (fachlich so festgelegt)", async () => {
    await updateQuotas(
      formData({
        defaultAnnualVacationDays: "",
        workationYearlyLimitDays: "",
        workationConsecutiveLimitDays: "",
      })
    );
    expect(await loadSettings()).toMatchObject({
      defaultAnnualVacationDays: 0,
      workationYearlyLimitDays: 0,
      workationConsecutiveLimitDays: 0,
    });
  });

  it.each([
    ["negativen Jahresurlaub", { defaultAnnualVacationDays: "-1" }],
    ["negative Workation-Grenzen", { workationYearlyLimitDays: "-5" }],
    ["Bruchteile bei Workation-Arbeitstagen", { workationConsecutiveLimitDays: "2.5" }],
  ])("lehnt %s ab", async (_label, override) => {
    await expect(updateQuotas(formData({ ...QUOTAS, ...override }))).rejects.toThrow(
      "Ungültige Werte."
    );
    expect(await auditFor("settings")).toHaveLength(0);
  });

  it("erlaubt halbe Tage beim Standard-Jahresurlaub", async () => {
    await updateQuotas(formData({ ...QUOTAS, defaultAnnualVacationDays: "27.5" }));
    expect((await loadSettings()).defaultAnnualVacationDays).toBe(27.5);
  });

  it("lehnt nicht-numerische Werte ab und lässt die Einstellungen unverändert", async () => {
    await expect(
      updateQuotas(formData({ ...QUOTAS, workationConsecutiveLimitDays: "zwanzig" }))
    ).rejects.toThrow("Ungültige Werte.");
    expect(await loadSettings()).toMatchObject({
      defaultAnnualVacationDays: 30,
      workationYearlyLimitDays: 30,
      workationConsecutiveLimitDays: 20,
    });
    expect(await auditFor("settings")).toHaveLength(0);
  });

  it("lehnt Mitarbeitende ab", async () => {
    await actAs(seed.employee);
    await expect(updateQuotas(formData(QUOTAS))).rejects.toThrow(ADMIN_ONLY);
    expect((await loadSettings()).defaultAnnualVacationDays).toBe(30);
    expect(await auditFor("settings")).toHaveLength(0);
  });

  it("verlangt eine Anmeldung", async () => {
    await actAs(null);
    await expect(updateQuotas(formData(QUOTAS))).rejects.toThrow("Nicht angemeldet");
  });
});

describe("updateRates", () => {
  it("rechnet Komma-Beträge in Cent um, speichert alle Sätze und auditiert", async () => {
    await updateRates(
      formData({
        ...RATES,
        rateFullDay: "30,50",
        rateKm: "0,35",
        employerDailySupplement: "5,00",
      })
    );

    expect(await loadSettings()).toMatchObject({
      rateFullDayCents: 3050,
      ratePartialDayCents: 1400,
      rateReductionBreakfastCents: 560,
      rateReductionLunchCents: 1120,
      rateReductionDinnerCents: 1120,
      rateKmCents: 35,
      ratePassengerKmCents: 2,
      employerDailySupplementCents: 500,
    });
    expect((await auditFor("settings"))[0]).toMatchObject({
      action: "saetze_geaendert",
      actorUserId: seed.admin.id,
      source: "web",
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/einstellungen");
  });

  it("akzeptiert auch Punkt als Dezimaltrenner", async () => {
    await updateRates(formData({ ...RATES, rateFullDay: "31.25" }));
    expect((await loadSettings()).rateFullDayCents).toBe(3125);
  });

  it("versteht Tausenderpunkte vor dem Dezimalkomma", async () => {
    await updateRates(formData({ ...RATES, employerDailySupplement: "1.234,56" }));
    expect((await loadSettings()).employerDailySupplementCents).toBe(123456);
  });

  it("speichert ein leeres Betragsfeld derzeit als 0 €", async () => {
    await updateRates(formData({ ...RATES, ratePassengerKm: "" }));
    expect((await loadSettings()).ratePassengerKmCents).toBe(0);
  });

  it.each([
    ["nicht-numerisch", "abc"],
    ["negativ", "-1,00"],
    ["mehrere Kommas", "1,2,3"],
  ])("lehnt einen ungültigen Betrag ab (%s)", async (_label, value) => {
    await expect(
      updateRates(formData({ ...RATES, rateReductionDinner: value }))
    ).rejects.toThrow("Ungültiger Betrag.");
    expect((await loadSettings()).rateFullDayCents).toBe(2800);
    expect(await auditFor("settings")).toHaveLength(0);
  });

  it("lehnt Mitarbeitende ab", async () => {
    await actAs(seed.employee);
    await expect(updateRates(formData(RATES))).rejects.toThrow(ADMIN_ONLY);
    expect(await auditFor("settings")).toHaveLength(0);
  });

  it("lehnt auch die aktive Vertretung ab (keine Verwaltungsfunktionen)", async () => {
    await makeDeputy(seed.employee);
    await actAs(seed.employee);
    await expect(updateRates(formData(RATES))).rejects.toThrow(ADMIN_ONLY);
  });
});

describe("updateCommissionRates", () => {
  it("speichert Beträge in Cent und den Prozentsatz mit Komma und auditiert", async () => {
    await updateCommissionRates(
      formData({
        commissionHalfDay: "60,00",
        commissionFullDay: "80,50",
        commissionTwoDay: "120",
        commissionConsultingPercent: "4,5",
      })
    );

    expect(await loadSettings()).toMatchObject({
      commissionHalfDayCents: 6000,
      commissionFullDayCents: 8050,
      commissionTwoDayCents: 12000,
      commissionConsultingPercent: 4.5,
    });
    expect((await auditFor("settings"))[0]).toMatchObject({
      action: "provisionssaetze_geaendert",
      actorUserId: seed.admin.id,
      source: "web",
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/einstellungen");
  });

  it("akzeptiert die Grenzwerte 0 % und 100 %", async () => {
    await updateCommissionRates(formData({ ...COMMISSION, commissionConsultingPercent: "0" }));
    expect((await loadSettings()).commissionConsultingPercent).toBe(0);
    await updateCommissionRates(formData({ ...COMMISSION, commissionConsultingPercent: "100" }));
    expect((await loadSettings()).commissionConsultingPercent).toBe(100);
  });

  it.each([
    ["unter 0", "-0,5"],
    ["über 100", "100,1"],
    ["nicht-numerisch", "vier"],
  ])("lehnt einen Prozentsatz %s ab", async (_label, value) => {
    await expect(
      updateCommissionRates(formData({ ...COMMISSION, commissionConsultingPercent: value }))
    ).rejects.toThrow("Ungültiger Prozentsatz.");
    expect((await loadSettings()).commissionConsultingPercent).toBe(4);
    expect(await auditFor("settings")).toHaveLength(0);
  });

  it("lehnt ungültige Beträge ab", async () => {
    await expect(
      updateCommissionRates(formData({ ...COMMISSION, commissionTwoDay: "-10" }))
    ).rejects.toThrow("Ungültiger Betrag.");
    await expect(
      updateCommissionRates(formData({ ...COMMISSION, commissionHalfDay: "x" }))
    ).rejects.toThrow("Ungültiger Betrag.");
    expect((await loadSettings()).commissionTwoDayCents).toBe(10000);
  });

  it("lehnt Mitarbeitende ab", async () => {
    await actAs(seed.employee);
    await expect(updateCommissionRates(formData(COMMISSION))).rejects.toThrow(ADMIN_ONLY);
    expect(await auditFor("settings")).toHaveLength(0);
  });
});

describe("updateRetention", () => {
  it("speichert alle drei Fristen und auditiert", async () => {
    await updateRetention(formData(RETENTION));

    expect(await loadSettings()).toMatchObject({
      retentionExpenseYears: 10,
      retentionSickLeaveYears: 6,
      retentionRequestYears: 4,
    });
    expect((await auditFor("settings"))[0]).toMatchObject({
      action: "aufbewahrungsfristen_geaendert",
      actorUserId: seed.admin.id,
      source: "web",
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/einstellungen");
  });

  it.each([
    ["0", { retentionExpenseYears: "0" }],
    ["leer", { retentionSickLeaveYears: "" }],
    ["Text", { retentionRequestYears: "drei" }],
    ["negativ", { retentionRequestYears: "-2" }],
    ["Bruchteil", { retentionExpenseYears: "2.5" }],
  ])("lehnt ungültige Fristen ab (%s) und ändert nichts", async (_label, override) => {
    await expect(
      updateRetention(formData({ ...RETENTION, ...override }))
    ).rejects.toThrow("Aufbewahrungsfristen müssen ganze Jahre ab 1 sein.");
    expect(await loadSettings()).toMatchObject({
      retentionExpenseYears: 8,
      retentionSickLeaveYears: 5,
      retentionRequestYears: 3,
    });
    expect(await auditFor("settings")).toHaveLength(0);
  });

  it("lehnt Mitarbeitende ab", async () => {
    await actAs(seed.employee);
    await expect(updateRetention(formData(RETENTION))).rejects.toThrow(ADMIN_ONLY);
    expect((await loadSettings()).retentionExpenseYears).toBe(8);
    expect(await auditFor("settings")).toHaveLength(0);
  });
});

describe("setDeputy", () => {
  it("aktiviert eine Vertretung ohne Zeitraum und auditiert", async () => {
    await setDeputy(formData({ userId: seed.employee.id }));

    const active = await activeAssignments();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      userId: seed.employee.id,
      startsOn: null,
      endsOn: null,
    });
    expect((await getActiveDeputy())?.id).toBe(seed.employee.id);
    expect((await auditFor("vertretung"))[0]).toMatchObject({
      action: "vertretung_aktiviert",
      actorUserId: seed.admin.id,
      source: "web",
      details: { userId: seed.employee.id, startsOn: null, endsOn: null },
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/einstellungen");
  });

  it("speichert einen Zeitraum", async () => {
    await setDeputy(
      formData({ userId: seed.employee.id, startsOn: "2026-01-01", endsOn: "2099-12-31" })
    );
    expect((await activeAssignments())[0]).toMatchObject({
      startsOn: "2026-01-01",
      endsOn: "2099-12-31",
    });
    expect((await auditFor("vertretung"))[0].details).toEqual({
      userId: seed.employee.id,
      startsOn: "2026-01-01",
      endsOn: "2099-12-31",
    });
  });

  it("löst eine bestehende Vertretung ab", async () => {
    const colleague = await createUser();
    await setDeputy(formData({ userId: seed.employee.id }));
    await setDeputy(formData({ userId: colleague.id }));

    const active = await activeAssignments();
    expect(active).toHaveLength(1);
    expect(active[0].userId).toBe(colleague.id);
    expect(await testDb().select().from(schema.deputyAssignments)).toHaveLength(2);
    expect((await getActiveDeputy())?.id).toBe(colleague.id);
  });

  it("verlangt eine Auswahl", async () => {
    await expect(setDeputy(formData({ userId: "" }))).rejects.toThrow(
      "Bitte eine/n Mitarbeiter/in auswählen."
    );
    expect(await testDb().select().from(schema.deputyAssignments)).toHaveLength(0);
  });

  it("lässt die bestehende Vertretung bei ungültiger Auswahl unangetastet", async () => {
    await makeDeputy(seed.employee);
    for (const userId of ["00000000-0000-4000-8000-000000000000", "kein-uuid"])
      await expect(setDeputy(formData({ userId }))).rejects.toThrow();
    expect((await activeAssignments())[0]?.userId).toBe(seed.employee.id);
    expect((await getActiveDeputy())?.id).toBe(seed.employee.id);
  });

  it("lehnt eine unbekannte Person ab", async () => {
    await expect(
      setDeputy(formData({ userId: "00000000-0000-4000-8000-000000000000" }))
    ).rejects.toThrow("Die ausgewählte Person ist nicht aktiv.");
    expect(await activeAssignments()).toHaveLength(0);
  });

  it("lehnt eine deaktivierte Person ab", async () => {
    const inactive = await createUser({ status: "deaktiviert" });
    await expect(setDeputy(formData({ userId: inactive.id }))).rejects.toThrow(
      "Die ausgewählte Person ist nicht aktiv."
    );
    expect(await activeAssignments()).toHaveLength(0);
  });

  it("lehnt den Admin als eigene Vertretung ab", async () => {
    await expect(setDeputy(formData({ userId: seed.admin.id }))).rejects.toThrow(
      "Der Admin kann nicht die eigene Vertretung sein."
    );
    expect(await activeAssignments()).toHaveLength(0);
  });

  it("lehnt ein Ende vor dem Beginn ab", async () => {
    await expect(
      setDeputy(
        formData({ userId: seed.employee.id, startsOn: "2026-12-31", endsOn: "2026-01-01" })
      )
    ).rejects.toThrow("Das Enddatum darf nicht vor dem Startdatum liegen.");
    expect(await activeAssignments()).toHaveLength(0);
  });

  it("lehnt Mitarbeitende ab", async () => {
    await actAs(seed.employee);
    await expect(setDeputy(formData({ userId: seed.employee.id }))).rejects.toThrow(
      ADMIN_ONLY
    );
    expect(await testDb().select().from(schema.deputyAssignments)).toHaveLength(0);
    expect(await auditFor("vertretung")).toHaveLength(0);
  });
});

describe("clearDeputy", () => {
  it("beendet die aktive Vertretung und auditiert", async () => {
    await makeDeputy(seed.employee);

    await clearDeputy();

    expect(await activeAssignments()).toHaveLength(0);
    expect(await testDb().select().from(schema.deputyAssignments)).toHaveLength(1);
    expect(await getActiveDeputy()).toBeNull();
    expect((await auditFor("vertretung"))[0]).toMatchObject({
      action: "vertretung_entzogen",
      actorUserId: seed.admin.id,
      source: "web",
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/einstellungen");
  });

  it("läuft ohne aktive Vertretung fehlerfrei durch", async () => {
    await clearDeputy();
    expect(await auditFor("vertretung")).toHaveLength(1);
  });

  it("lehnt Mitarbeitende ab — auch die Vertretung selbst", async () => {
    await makeDeputy(seed.employee);
    await actAs(seed.employee);
    await expect(clearDeputy()).rejects.toThrow(ADMIN_ONLY);
    expect(await activeAssignments()).toHaveLength(1);
    expect(await auditFor("vertretung")).toHaveLength(0);
  });
});

describe("addWebhook", () => {
  it("legt einen aktiven Webhook an und auditiert ohne Secret", async () => {
    await addWebhook(formData(WEBHOOK));

    const rows = await testDb().select().from(schema.webhookConfigs);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ...WEBHOOK, active: true });
    const audit = (await auditFor("webhook"))[0];
    expect(audit).toMatchObject({
      action: "webhook_angelegt",
      actorUserId: seed.admin.id,
      source: "web",
      details: { category: "urlaub", event: "genehmigt", url: WEBHOOK.url },
    });
    expect(JSON.stringify(audit.details)).not.toContain(WEBHOOK.secret);
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/einstellungen");
  });

  it("akzeptiert ein Secret mit genau 16 Zeichen", async () => {
    await addWebhook(formData({ ...WEBHOOK, secret: "a".repeat(16) }));
    expect(await testDb().select().from(schema.webhookConfigs)).toHaveLength(1);
  });

  it("lehnt eine ungültige Kategorie ab", async () => {
    await expect(addWebhook(formData({ ...WEBHOOK, category: "faktura" }))).rejects.toThrow(
      "Ungültige Kategorie."
    );
    expect(await testDb().select().from(schema.webhookConfigs)).toHaveLength(0);
  });

  it("lehnt ein ungültiges Ereignis ab", async () => {
    await expect(addWebhook(formData({ ...WEBHOOK, event: "geloescht" }))).rejects.toThrow(
      "Ungültiges Ereignis."
    );
    expect(await testDb().select().from(schema.webhookConfigs)).toHaveLength(0);
  });

  it("lehnt ein Secret mit weniger als 16 Zeichen ab", async () => {
    await expect(
      addWebhook(formData({ ...WEBHOOK, secret: "a".repeat(15) }))
    ).rejects.toThrow("Das Secret muss mindestens 16 Zeichen lang sein.");
    expect(await testDb().select().from(schema.webhookConfigs)).toHaveLength(0);
    expect(await auditFor("webhook")).toHaveLength(0);
  });

  it("lehnt eine unlesbare URL ab", async () => {
    await expect(addWebhook(formData({ ...WEBHOOK, url: "n8n.example.com" }))).rejects.toThrow(
      "Ungültige Webhook-URL."
    );
  });

  it("verlangt https", async () => {
    await expect(
      addWebhook(formData({ ...WEBHOOK, url: "http://n8n.example.com/webhook/x" }))
    ).rejects.toThrow("Die Webhook-URL muss mit https:// beginnen.");
    expect(await testDb().select().from(schema.webhookConfigs)).toHaveLength(0);
  });

  it.each([
    "https://localhost/x",
    "https://intern.local/x",
    "https://127.0.0.1/x",
    "https://10.1.2.3/x",
    "https://172.16.0.1/x",
    "https://192.168.178.1/x",
    "https://169.254.169.254/latest/meta-data",
    "https://100.64.0.1/x",
    "https://[::1]/x",
    "https://[::]/x",
    "https://[fd00::1]/x",
    "https://[fc00::1]/x",
    "https://[fe80::1]/x",
    "https://[::ffff:127.0.0.1]/x",
    "https://[64:ff9b::a00:1]/x",
  ])("lehnt die interne Adresse %s ab (SSRF-Schutz)", async (url) => {
    await expect(addWebhook(formData({ ...WEBHOOK, url }))).rejects.toThrow(
      "Die Webhook-URL darf keine internen oder privaten Adressen ansprechen."
    );
    expect(await testDb().select().from(schema.webhookConfigs)).toHaveLength(0);
  });

  it("lehnt Mitarbeitende ab", async () => {
    await actAs(seed.employee);
    await expect(addWebhook(formData(WEBHOOK))).rejects.toThrow(ADMIN_ONLY);
    expect(await testDb().select().from(schema.webhookConfigs)).toHaveLength(0);
    expect(await auditFor("webhook")).toHaveLength(0);
  });
});

describe("toggleWebhook", () => {
  it("deaktiviert und aktiviert einen Webhook und auditiert beides", async () => {
    const hook = await insertWebhook();

    await toggleWebhook(hook.id, false);
    expect((await loadWebhook(hook.id))?.active).toBe(false);
    expect((await auditFor("webhook", hook.id))[0]).toMatchObject({
      action: "webhook_deaktiviert",
      actorUserId: seed.admin.id,
      source: "web",
    });

    await toggleWebhook(hook.id, true);
    expect((await loadWebhook(hook.id))?.active).toBe(true);
    expect((await auditFor("webhook", hook.id)).map((a) => a.action)).toEqual(
      expect.arrayContaining(["webhook_aktiviert", "webhook_deaktiviert"])
    );
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/einstellungen");
  });

  it("lehnt eine unbekannte ID ab und auditiert nichts", async () => {
    const id = "00000000-0000-4000-8000-000000000001";
    await expect(toggleWebhook(id, false)).rejects.toThrow("Webhook nicht gefunden.");
    expect(await auditFor("webhook", id)).toHaveLength(0);
  });

  it("lehnt Mitarbeitende ab", async () => {
    const hook = await insertWebhook();
    await actAs(seed.employee);
    await expect(toggleWebhook(hook.id, false)).rejects.toThrow(ADMIN_ONLY);
    expect((await loadWebhook(hook.id))?.active).toBe(true);
    expect(await auditFor("webhook")).toHaveLength(0);
  });
});

describe("deleteWebhook", () => {
  it("löscht den Webhook samt Zustell-Log (Cascade) und auditiert", async () => {
    const hook = await insertWebhook();
    const other = await insertWebhook({ event: "eingereicht" });
    await testDb()
      .insert(schema.webhookDeliveries)
      .values([
        { configId: hook.id, event: "genehmigt", payload: { a: 1 } },
        { configId: hook.id, event: "genehmigt", payload: { a: 2 } },
        { configId: other.id, event: "eingereicht", payload: { b: 1 } },
      ]);

    await deleteWebhook(hook.id);

    expect(await loadWebhook(hook.id)).toBeUndefined();
    const deliveries = await testDb().select().from(schema.webhookDeliveries);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].configId).toBe(other.id);
    expect((await auditFor("webhook", hook.id))[0]).toMatchObject({
      action: "webhook_geloescht",
      actorUserId: seed.admin.id,
      source: "web",
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/einstellungen");
  });

  it("lehnt eine unbekannte ID ab und auditiert nichts", async () => {
    const hook = await insertWebhook();
    const id = "00000000-0000-4000-8000-000000000002";
    await expect(deleteWebhook(id)).rejects.toThrow("Webhook nicht gefunden.");
    expect(await loadWebhook(hook.id)).toBeDefined();
    expect(await auditFor("webhook", id)).toHaveLength(0);
  });

  it("lehnt Mitarbeitende ab", async () => {
    const hook = await insertWebhook();
    await actAs(seed.employee);
    await expect(deleteWebhook(hook.id)).rejects.toThrow(ADMIN_ONLY);
    expect(await loadWebhook(hook.id)).toBeDefined();
    expect(await auditFor("webhook")).toHaveLength(0);
  });
});

describe("createApiKey", () => {
  it("gibt den Klartext einmalig zurück und speichert nur Hash und Präfix", async () => {
    const { plaintext, row } = await createKey({ name: "  Claude via n8n  ", scope: "full" });

    expect(plaintext).toMatch(/^sk_stefanai_[0-9a-f]{64}$/);
    expect(row).toMatchObject({
      name: "Claude via n8n",
      keyHash: createHash("sha256").update(plaintext).digest("hex"),
      keyPrefix: plaintext.slice(0, 16),
      scope: "full",
      createdById: seed.admin.id,
      revokedAt: null,
    });
    // Der Klartext steht in keiner Spalte
    expect(JSON.stringify(row)).not.toContain(plaintext);

    const audit = (await auditFor("api_key"))[0];
    expect(audit).toMatchObject({
      action: "api_key_erstellt",
      actorUserId: seed.admin.id,
      source: "web",
      details: { name: "Claude via n8n", scope: "full" },
    });
    expect(JSON.stringify(audit.details)).not.toContain(plaintext);
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/einstellungen");
  });

  it("der zurückgegebene Klartext authentifiziert gegen die API", async () => {
    const { plaintext, row } = await createKey({ name: "n8n", scope: "full" });
    const result = await authenticateApiRequest(bearer(plaintext), {
      allowScopes: ["full"],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.context.apiKey.id).toBe(row.id);
  });

  it.each(["readonly", "full", "website"] as const)(
    "speichert den gewählten Umfang %s",
    async (scope) => {
      const { row } = await createKey({ name: `Key ${scope}`, scope });
      expect(row.scope).toBe(scope);
    }
  );

  it.each([
    ["ohne Angabe", undefined],
    ["unbekannter Wert", "admin"],
    ["Groß-/Kleinschreibung", "FULL"],
  ])("fällt bei ungültigem Umfang auf readonly zurück (%s)", async (_label, scope) => {
    const { row } = await createKey(scope ? { name: "Key", scope } : { name: "Key" });
    expect(row.scope).toBe("readonly");
    expect((await auditFor("api_key"))[0].details).toEqual({
      name: "Key",
      scope: "readonly",
    });
  });

  it("erzeugt bei jedem Aufruf einen anderen Key", async () => {
    const a = await createApiKey(formData({ name: "A" }));
    const b = await createApiKey(formData({ name: "B" }));
    expect(a).not.toBe(b);
    expect(await testDb().select().from(schema.apiKeys)).toHaveLength(2);
  });

  it.each(["", "   "])("verlangt einen Namen (%j)", async (name) => {
    await expect(createApiKey(formData({ name, scope: "full" }))).rejects.toThrow(
      "Bitte einen Namen für den Key angeben."
    );
    expect(await testDb().select().from(schema.apiKeys)).toHaveLength(0);
  });

  it("lehnt Mitarbeitende ab", async () => {
    await actAs(seed.employee);
    await expect(createApiKey(formData({ name: "Mein Key" }))).rejects.toThrow(ADMIN_ONLY);
    expect(await testDb().select().from(schema.apiKeys)).toHaveLength(0);
    expect(await auditFor("api_key")).toHaveLength(0);
  });
});

describe("revokeApiKey", () => {
  it("setzt revokedAt, auditiert und sperrt den Key für die API", async () => {
    const { plaintext, row } = await createKey({ name: "n8n", scope: "full" });

    await revokeApiKey(row.id);

    expect((await loadKey(row.id)).revokedAt).toBeInstanceOf(Date);
    expect((await auditFor("api_key", row.id))[0]).toMatchObject({
      action: "api_key_widerrufen",
      actorUserId: seed.admin.id,
      source: "web",
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/einstellungen");

    const result = await authenticateApiRequest(bearer(plaintext), {
      allowScopes: ["full"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
      expect(await result.response.json()).toEqual({
        fehler: "Dieser API-Key wurde widerrufen.",
      });
    }
  });

  it("lehnt einen doppelten Widerruf ab und behält den ersten Zeitpunkt", async () => {
    const { row } = await createKey();
    await revokeApiKey(row.id);
    const first = (await loadKey(row.id)).revokedAt!;

    await expect(revokeApiKey(row.id)).rejects.toThrow(
      "API-Key nicht gefunden oder bereits widerrufen."
    );

    // Der ursprüngliche Widerrufszeitpunkt bleibt erhalten
    expect((await loadKey(row.id)).revokedAt).toEqual(first);
    expect(await auditFor("api_key", row.id)).toHaveLength(1);
  });

  it("lehnt eine unbekannte ID ab und auditiert nichts", async () => {
    const { row } = await createKey();
    const id = "00000000-0000-4000-8000-000000000003";
    await expect(revokeApiKey(id)).rejects.toThrow(
      "API-Key nicht gefunden oder bereits widerrufen."
    );
    expect((await loadKey(row.id)).revokedAt).toBeNull();
    expect(await auditFor("api_key", id)).toHaveLength(0);
  });

  it("lehnt Mitarbeitende ab", async () => {
    const { row } = await createKey();
    await actAs(seed.employee);
    await expect(revokeApiKey(row.id)).rejects.toThrow(ADMIN_ONLY);
    expect((await loadKey(row.id)).revokedAt).toBeNull();
    expect(await auditFor("api_key", row.id)).toHaveLength(0);
  });
});
