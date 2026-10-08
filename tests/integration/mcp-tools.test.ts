import { randomUUID } from "node:crypto";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { registerIntranetMcpTools } from "@/lib/mcp-tools";
import * as schema from "../../src/db/schema";
import { auditFor, createUser } from "../helpers/actions";
import { resetDb, seedTestData, testDb, type SeedResult } from "../helpers/db";
import { mailbox, mailsTo } from "../helpers/framework-fakes";

/**
 * Die MCP-Tools werden über einen Fake-Server aufgerufen, der nur
 * registerTool() erfasst. callTool() bildet das Verhalten des MCP-SDK nach:
 * Argumente gegen das registrierte inputSchema prüfen (Fehler → isError),
 * dann den Handler mit (args, extra) bzw. (extra) aufrufen. Der User kommt
 * echt über resolveUserFromMcpAuth aus extra.authInfo (Clerk-User-ID).
 */

interface ToolResult {
  isError?: boolean;
  content: { type: string; text: string }[];
}
type ToolHandler = (...args: unknown[]) => Promise<ToolResult>;
interface ToolConfig {
  description?: string;
  inputSchema?: z.ZodType | z.ZodRawShape;
}

const tools = new Map<string, ToolConfig & { handler: ToolHandler }>();

const fakeServer = {
  registerTool(name: string, config: ToolConfig, handler: ToolHandler) {
    if (tools.has(name)) throw new Error(`Tool ${name} doppelt registriert`);
    tools.set(name, { ...config, handler });
  },
};
registerIntranetMcpTools(fakeServer as unknown as McpServer);

async function callTool(
  name: string,
  args: Record<string, unknown> | undefined,
  authInfo: AuthInfo | undefined
): Promise<ToolResult> {
  const tool = tools.get(name);
  if (!tool) throw new Error(`Tool ${name} nicht registriert`);
  const extra = { authInfo };
  if (!tool.inputSchema) return tool.handler(extra);
  const inputSchema =
    tool.inputSchema instanceof z.ZodType
      ? tool.inputSchema
      : z.object(tool.inputSchema);
  const parsed = inputSchema.safeParse(args ?? {});
  if (!parsed.success)
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Input validation error: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
        },
      ],
    };
  return tool.handler(parsed.data, extra);
}

function text(result: ToolResult): string {
  return result.content.map((c) => c.text).join("\n");
}

// JSON-Antworten der Tools sind bewusst untypisiert
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function json(result: ToolResult): any {
  expect(result.isError, text(result)).toBeFalsy();
  return JSON.parse(text(result));
}

let seed: SeedResult;
let employeeAuth: AuthInfo;

/** AuthInfo wie von verifyClerkToken; verknüpft bei Bedarf eine Clerk-ID. */
async function authFor(user: schema.User): Promise<AuthInfo> {
  if (!user.clerkId) {
    user.clerkId = `user_mcp_${user.id.slice(0, 8)}`;
    await testDb()
      .update(schema.users)
      .set({ clerkId: user.clerkId })
      .where(eq(schema.users.id, user.id));
  }
  return {
    token: "oauth-test-token",
    clientId: "mcp-client",
    scopes: ["profile", "email"],
    extra: { userId: user.clerkId },
  };
}

// Mo 03.08. – Fr 07.08.2026 = 5 Arbeitstage
const WEEK = { startDate: "2026-08-03", endDate: "2026-08-07" };

const WORKATION = {
  country: "Spanien",
  city: "Valencia",
  accommodationAddress: "Calle Mayor 1, 46001 Valencia",
  startDate: "2026-11-02",
  endDate: "2026-11-13",
  workDays: 10,
  timezoneAvailability: "9–17 Uhr MEZ",
  emergencyContactName: "Erika Muster",
  emergencyContactPhone: "+49 221 123456",
  visaType: "keins (EU-Bürger)",
  insuranceDetails: "Auslandskranken- und Rückholversicherung XYZ",
  plannedTasks: "Projektarbeit Rollout",
  domesticSubstitution: "Erika Admin",
  declResidence: true,
  declVisa: true,
  declWorkingTime: true,
  declDataProtection: true,
  declNoForbiddenActivities: true,
  declReportChanges: true,
  declCosts: true,
};

const EXPENSE = {
  destination: "Berlin",
  customerPurpose: "Kundentermin ACME",
  departureDate: "2026-09-14",
  departureTime: "07:00",
  returnDate: "2026-09-15",
  returnTime: "20:00",
  mealDays: [
    {
      date: "2026-09-14",
      absenceType: "an_abreisetag",
      breakfastProvided: false,
      lunchProvided: false,
      dinnerProvided: false,
    },
    {
      date: "2026-09-15",
      absenceType: "an_abreisetag",
      breakfastProvided: true,
      lunchProvided: false,
      dinnerProvided: false,
    },
  ],
  transport: [{ date: "2026-09-14", description: "Bahn Köln–Berlin", amountCents: 8900 }],
  lodging: [{ date: "2026-09-14", description: "Hotel Mitte", amountCents: 11000 }],
};

const COMMISSION = {
  businessType: "schulung",
  customerType: "bestandskunde",
  customerName: "ACME GmbH",
  orderDate: "2026-09-10",
  unit: "tage",
  quantity: 2,
  trainingFormat: "ganztaegig",
  trainingCount: 2,
};

async function insertVacation(
  userId: string,
  values: Partial<typeof schema.vacationRequests.$inferInsert> = {}
) {
  const [row] = await testDb()
    .insert(schema.vacationRequests)
    .values({ userId, ...WEEK, days: 5, ...values })
    .returning();
  return row;
}

async function insertWorkation(
  userId: string,
  values: Partial<typeof schema.workationRequests.$inferInsert> = {}
) {
  const [row] = await testDb()
    .insert(schema.workationRequests)
    .values({ userId, ...WORKATION, countryCategory: "eu_ewr_ch", ...values })
    .returning();
  return row;
}

async function insertExpense(
  userId: string,
  values: Partial<typeof schema.expenseReports.$inferInsert> = {}
) {
  const [row] = await testDb()
    .insert(schema.expenseReports)
    .values({
      userId,
      destination: "Hamburg",
      customerPurpose: "Messe",
      departureDate: "2026-09-01",
      departureTime: "08:00",
      returnDate: "2026-09-01",
      returnTime: "19:00",
      totalCents: 5000,
      ...values,
    })
    .returning();
  return row;
}

async function insertCommission(
  userId: string,
  values: Partial<typeof schema.commissionClaims.$inferInsert> = {}
) {
  const [row] = await testDb()
    .insert(schema.commissionClaims)
    .values({
      userId,
      businessType: "schulung",
      customerType: "bestandskunde",
      customerName: "Alt GmbH",
      orderDate: "2026-09-01",
      unit: "tage",
      quantity: 1,
      trainingFormat: "halbtaegig",
      trainingCount: 1,
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
    .values({ userId, type: "eigene_erkrankung", startDate: "2026-10-05", ...values })
    .returning();
  return row;
}

beforeAll(async () => {
  await resetDb();
  seed = await seedTestData();
  employeeAuth = await authFor(seed.employee);
});

beforeEach(async () => {
  const db = testDb();
  await db.delete(schema.requestHistory);
  await db.delete(schema.vacationRequests);
  await db.delete(schema.workationRequests);
  await db.delete(schema.expenseReports);
  await db.delete(schema.commissionClaims);
  await db.delete(schema.sickLeaves);
  await db.delete(schema.auditLog);
});

describe("registerIntranetMcpTools", () => {
  it("registriert genau die elf per-User-Tools mit Beschreibung", () => {
    expect([...tools.keys()].sort()).toEqual(
      [
        "close_my_sick_leave",
        "create_commission_claim",
        "create_expense_report",
        "create_sick_leave",
        "create_vacation_request",
        "create_workation_request",
        "get_my_profile",
        "get_my_request",
        "list_my_requests",
        "resubmit_my_request",
        "withdraw_my_request",
      ].sort()
    );
    for (const [name, tool] of tools) expect(tool.description, name).toBeTruthy();
  });

  it("nimmt keine User-ID als Parameter entgegen (Ownership nur aus OAuth)", () => {
    for (const [name, tool] of tools) {
      if (!tool.inputSchema) continue;
      const shape =
        tool.inputSchema instanceof z.ZodObject
          ? tool.inputSchema.shape
          : tool.inputSchema;
      expect(Object.keys(shape), name).not.toContain("userId");
    }
  });
});

describe("get_my_profile", () => {
  it("liefert Profil und Kontingente des verbundenen Users", async () => {
    await insertVacation(seed.employee.id, { status: "genehmigt" });

    const profile = json(await callTool("get_my_profile", undefined, employeeAuth));

    expect(profile).toMatchObject({
      id: seed.employee.id,
      name: "Max Mitarbeiter",
      email: seed.employee.email,
      role: "mitarbeiter",
      vacation: { entitlement: 30 },
      workation: { yearlyLimitDays: 30, consecutiveLimitDays: 20 },
    });
  });

  it("meldet einen fehlenden OAuth-Kontext als Tool-Fehler", async () => {
    const result = await callTool("get_my_profile", undefined, undefined);
    expect(result.isError).toBe(true);
    expect(text(result)).toBe("Nicht angemeldet (fehlendes OAuth-Token).");
  });

  it("meldet deaktivierte Konten als Tool-Fehler", async () => {
    const inactive = await createUser({ status: "deaktiviert" });
    const result = await callTool("get_my_profile", undefined, await authFor(inactive));
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Kein aktives Intranet-Konto");
  });
});

describe("list_my_requests", () => {
  it("listet nur eigene Anträge", async () => {
    const own = await insertVacation(seed.employee.id);
    const sick = await insertSickLeave(seed.employee.id);
    await insertVacation(seed.admin.id);

    const list = json(await callTool("list_my_requests", {}, employeeAuth));

    expect(list.map((r: { id: string }) => r.id).sort()).toEqual(
      [own.id, sick.id].sort()
    );
  });

  it("filtert nach Typ und Status", async () => {
    const genehmigt = await insertVacation(seed.employee.id, { status: "genehmigt" });
    await insertVacation(seed.employee.id);
    await insertWorkation(seed.employee.id, { status: "genehmigt" });

    const list = json(
      await callTool("list_my_requests", { type: "vacation", status: "genehmigt" }, employeeAuth)
    );
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: genehmigt.id, type: "vacation", status: "genehmigt" });
  });

  it("lehnt einen unbekannten Typ ab", async () => {
    const result = await callTool("list_my_requests", { type: "urlaub" }, employeeAuth);
    expect(result.isError).toBe(true);
  });
});

describe("get_my_request", () => {
  it("liefert einen eigenen Antrag mit Historie", async () => {
    const v = await insertVacation(seed.employee.id, { version: 2 });
    await testDb().insert(schema.requestHistory).values({
      requestType: "urlaub",
      requestId: v.id,
      version: 1,
      snapshot: { days: 3 },
    });

    const result = json(
      await callTool("get_my_request", { type: "vacation", id: v.id }, employeeAuth)
    );

    expect(result.type).toBe("vacation");
    expect(result.data).toMatchObject({ id: v.id, days: 5, version: 2 });
    expect(result.history).toHaveLength(1);
  });

  it("behandelt fremde Anträge wie nicht vorhandene", async () => {
    const foreign = await insertVacation(seed.admin.id);
    const result = await callTool(
      "get_my_request",
      { type: "vacation", id: foreign.id },
      employeeAuth
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toBe("Antrag nicht gefunden.");
  });

  it("lehnt eine ungültige ID ab, bevor die Datenbank angefragt wird", async () => {
    const result = await callTool(
      "get_my_request",
      { type: "vacation", id: "kein-uuid" },
      employeeAuth
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Input validation error");
  });
});

describe("create_vacation_request", () => {
  it("meldet Datenbank- und Validierungsfehler ohne SQL-Details", async () => {
    const result = await callTool(
      "create_vacation_request",
      { ...WEEK, substituteUserId: "abc" },
      employeeAuth
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Ungültige Vertretung.");

    // Gültige, aber unbekannte UUID → Fremdschlüssel-Fehler der Datenbank
    const fkResult = await callTool(
      "create_vacation_request",
      { ...WEEK, substituteUserId: "00000000-0000-4000-8000-000000000000" },
      employeeAuth
    );
    expect(fkResult.isError).toBe(true);
    expect(text(fkResult)).toBe(
      "Unerwarteter Fehler. Bitte versuchen Sie es später erneut."
    );
    expect(text(fkResult)).not.toContain("insert into");
  });

  it("legt den Antrag für den Token-User an, auditiert mit Quelle mcp und benachrichtigt", async () => {
    const result = json(
      await callTool(
        "create_vacation_request",
        { ...WEEK, note: "Sommerurlaub" },
        employeeAuth
      )
    );

    const row = await testDb().query.vacationRequests.findFirst({
      where: eq(schema.vacationRequests.id, result.id),
    });
    expect(row).toMatchObject({
      userId: seed.employee.id,
      status: "eingereicht",
      days: 5,
      halfDayStart: false,
      note: "Sommerurlaub",
    });
    expect((await auditFor("urlaub", result.id))[0]).toMatchObject({
      action: "eingereicht",
      actorUserId: seed.employee.id,
      actorLabel: "Max Mitarbeiter",
      source: "mcp",
    });
    expect(mailsTo(seed.admin.email)).toHaveLength(1);
    expect(mailbox[0].linkPath).toBe(`/freigaben/urlaub/${result.id}`);
  });

  it("ignoriert eine untergeschobene userId", async () => {
    const result = json(
      await callTool(
        "create_vacation_request",
        { ...WEEK, userId: seed.admin.id },
        employeeAuth
      )
    );
    expect(result.userId).toBe(seed.employee.id);
  });

  it("meldet ein Enddatum vor dem Startdatum als Tool-Fehler", async () => {
    const result = await callTool(
      "create_vacation_request",
      { startDate: "2026-08-07", endDate: "2026-08-03" },
      employeeAuth
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Das Enddatum darf nicht vor dem Startdatum liegen.");
    expect(await testDb().select().from(schema.vacationRequests)).toHaveLength(0);
  });

  it("meldet fehlende Pflichtfelder als Tool-Fehler", async () => {
    const result = await callTool(
      "create_vacation_request",
      { startDate: "", endDate: "2026-08-07" },
      employeeAuth
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Bitte Startdatum angeben.");
  });

  it("meldet fachliche Fehler wie den überschrittenen Resturlaub", async () => {
    await insertVacation(seed.employee.id, {
      status: "genehmigt",
      startDate: "2026-03-02",
      endDate: "2026-03-31",
      days: 28,
    });
    const result = await callTool("create_vacation_request", WEEK, employeeAuth);
    expect(result.isError).toBe(true);
    expect(text(result)).toBe(
      "Der Antrag über 5 Tage übersteigt Ihren Resturlaub von 2 Tagen."
    );
  });

  it("legt ohne OAuth-Kontext nichts an", async () => {
    const result = await callTool("create_vacation_request", WEEK, undefined);
    expect(result.isError).toBe(true);
    expect(await testDb().select().from(schema.vacationRequests)).toHaveLength(0);
  });
});

describe("create_workation_request", () => {
  it("legt den Antrag an, ordnet das Land ein und auditiert mit Quelle mcp", async () => {
    const result = json(
      await callTool("create_workation_request", WORKATION, employeeAuth)
    );

    expect(result).toMatchObject({
      userId: seed.employee.id,
      status: "eingereicht",
      country: "Spanien",
      countryCategory: "eu_ewr_ch",
      workDays: 10,
      vacationDays: 0,
      visaValidUntil: null,
    });
    expect((await auditFor("workation", result.id))[0]).toMatchObject({
      action: "eingereicht",
      source: "mcp",
    });
    expect(mailsTo(seed.admin.email)[0].linkPath).toBe(
      `/freigaben/workation/${result.id}`
    );
  });

  it("verlangt alle sieben Erklärungen", async () => {
    const result = await callTool(
      "create_workation_request",
      { ...WORKATION, declCosts: false },
      employeeAuth
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Alle sieben Erklärungen müssen bestätigt werden");
    expect(await testDb().select().from(schema.workationRequests)).toHaveLength(0);
  });

  it("meldet Verstöße gegen die Workation-Richtlinie", async () => {
    const result = await callTool(
      "create_workation_request",
      { ...WORKATION, workDays: 21 },
      employeeAuth
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("höchstens 20 zusammenhängende Arbeitstage");
  });
});

describe("create_expense_report", () => {
  it("legt die Abrechnung mit Positionen an und auditiert mit Quelle mcp", async () => {
    const result = json(await callTool("create_expense_report", EXPENSE, employeeAuth));

    expect(result).toMatchObject({
      userId: seed.employee.id,
      status: "eingereicht",
      destination: "Berlin",
      transportCents: 8900,
      lodgingCents: 11000,
    });
    expect(result.mealAllowanceCents).toBeGreaterThan(0);
    expect(result.totalCents).toBe(
      result.mealAllowanceCents + result.transportCents + result.lodgingCents
    );

    const items = await testDb()
      .select()
      .from(schema.expenseItems)
      .where(eq(schema.expenseItems.reportId, result.id));
    expect(items.map((i) => i.kind).sort()).toEqual(
      ["fahrt", "uebernachtung", "verpflegung", "verpflegung"].sort()
    );
    expect(await testDb().select().from(schema.receipts)).toHaveLength(0);
    expect((await auditFor("reisekosten", result.id))[0]).toMatchObject({
      action: "eingereicht",
      source: "mcp",
    });
    expect(mailsTo(seed.admin.email)[0].linkPath).toBe(
      `/freigaben/reisekosten/${result.id}`
    );
  });

  it("verlangt eine Rückkehr nach der Abreise", async () => {
    const result = await callTool(
      "create_expense_report",
      { ...EXPENSE, returnDate: "2026-09-14", returnTime: "06:00" },
      employeeAuth
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Die Rückkehr muss nach der Abreise liegen.");
    expect(await testDb().select().from(schema.expenseReports)).toHaveLength(0);
  });
});

describe("create_commission_claim", () => {
  it("berechnet den Anspruch und auditiert mit Quelle mcp", async () => {
    const result = json(
      await callTool("create_commission_claim", COMMISSION, employeeAuth)
    );

    // 2 ganztägige Trainings × 75 €
    expect(result).toMatchObject({
      userId: seed.employee.id,
      status: "eingereicht",
      customerName: "ACME GmbH",
      calculatedAmountCents: 15000,
      finalAmountCents: 15000,
    });
    expect((await auditFor("provision", result.id))[0]).toMatchObject({
      action: "eingereicht",
      source: "mcp",
    });
    expect(mailsTo(seed.admin.email)[0].linkPath).toBe(
      `/freigaben/provision/${result.id}`
    );
  });

  it("verlangt bei Beratung den Nettoauftragswert", async () => {
    const result = await callTool(
      "create_commission_claim",
      {
        ...COMMISSION,
        businessType: "beratung",
        trainingFormat: undefined,
        trainingCount: undefined,
      },
      employeeAuth
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Bitte den Nettoauftragswert angeben.");
    expect(await testDb().select().from(schema.commissionClaims)).toHaveLength(0);
  });
});

describe("create_sick_leave", () => {
  it("erfasst eine offene Krankmeldung und informiert nur den Admin", async () => {
    const result = json(
      await callTool(
        "create_sick_leave",
        { startDate: "2026-10-05", type: "eigene_erkrankung" },
        employeeAuth
      )
    );

    expect(result).toMatchObject({
      userId: seed.employee.id,
      status: "gemeldet",
      startDate: "2026-10-05",
      endDate: null,
      type: "eigene_erkrankung",
    });
    expect((await auditFor("krankmeldung", result.id))[0]).toMatchObject({
      action: "gemeldet",
      source: "mcp",
    });
    expect(mailbox).toHaveLength(1);
    expect(mailbox[0]).toMatchObject({
      to: [{ email: seed.admin.email }],
      linkPath: `/krankmeldung/${result.id}`,
    });
    expect(mailbox[0].paragraphs[0]).toContain("Ende offen");
  });

  it("lehnt ein Enddatum vor dem ersten Tag ab", async () => {
    const result = await callTool(
      "create_sick_leave",
      { startDate: "2026-10-05", endDate: "2026-10-01", type: "kind_krank" },
      employeeAuth
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Das Enddatum darf nicht vor dem ersten Tag liegen.");
  });

  it("lehnt eine unbekannte Art ab", async () => {
    const result = await callTool(
      "create_sick_leave",
      { startDate: "2026-10-05", type: "grippe" },
      employeeAuth
    );
    expect(result.isError).toBe(true);
    expect(await testDb().select().from(schema.sickLeaves)).toHaveLength(0);
  });
});

describe("withdraw_my_request", () => {
  it("zieht eigene eingereichte Anträge aller vier Arten zurück (Audit-Quelle mcp)", async () => {
    const v = await insertVacation(seed.employee.id);
    const w = await insertWorkation(seed.employee.id);
    const e = await insertExpense(seed.employee.id);
    const c = await insertCommission(seed.employee.id, { status: "beanstandet" });

    const cases = [
      ["vacation", v.id, schema.vacationRequests, "urlaub"],
      ["workation", w.id, schema.workationRequests, "workation"],
      ["expense", e.id, schema.expenseReports, "reisekosten"],
      ["commission", c.id, schema.commissionClaims, "provision"],
    ] as const;

    for (const [type, id, table, auditType] of cases) {
      const result = json(await callTool("withdraw_my_request", { type, id }, employeeAuth));
      expect(result).toEqual({ id, status: "zurueckgezogen" });
      const [row] = await testDb().select().from(table).where(eq(table.id, id));
      expect(row.status, type).toBe("zurueckgezogen");
      expect((await auditFor(auditType, id))[0]).toMatchObject({
        action: "zurueckgezogen",
        source: "mcp",
      });
    }
  });

  it("lässt fremde Anträge nicht zurückziehen", async () => {
    const foreign = await insertExpense(seed.admin.id);
    const result = await callTool(
      "withdraw_my_request",
      { type: "expense", id: foreign.id },
      employeeAuth
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toBe("Abrechnung nicht gefunden.");
  });

  it("lässt genehmigte Anträge nicht zurückziehen", async () => {
    const v = await insertVacation(seed.employee.id, { status: "genehmigt" });
    const result = await callTool(
      "withdraw_my_request",
      { type: "vacation", id: v.id },
      employeeAuth
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toBe(
      "Nur eingereichte oder beanstandete Anträge können zurückgezogen werden."
    );
  });

  it("bietet Krankmeldungen nicht zum Zurückziehen an", async () => {
    const s = await insertSickLeave(seed.employee.id);
    const result = await callTool(
      "withdraw_my_request",
      { type: "sick_leave", id: s.id },
      employeeAuth
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Input validation error");
  });
});

describe("resubmit_my_request", () => {
  it("behält Belegzuordnungen bei der Korrektur per MCP", async () => {
    const created = json(await callTool("create_expense_report", EXPENSE, employeeAuth));
    const fahrt = (
      await testDb()
        .select()
        .from(schema.expenseItems)
        .where(eq(schema.expenseItems.reportId, created.id))
    ).find((i) => i.kind === "fahrt")!;
    const [receipt] = await testDb()
      .insert(schema.receipts)
      .values({
        reportId: created.id,
        itemId: fahrt.id,
        userId: seed.employee.id,
        filename: "bahn.pdf",
        contentType: "application/pdf",
        sizeBytes: 10,
        blobUrl: "http://127.0.0.1/x",
      })
      .returning();
    await testDb()
      .update(schema.expenseReports)
      .set({ status: "beanstandet" })
      .where(eq(schema.expenseReports.id, created.id));

    // Die Beleg-ID ist über get_my_request abrufbar
    const detail = json(
      await callTool("get_my_request", { type: "expense", id: created.id }, employeeAuth)
    );
    expect(detail.data.receipts).toEqual([
      { id: receipt.id, itemId: fahrt.id, filename: "bahn.pdf" },
    ]);

    json(
      await callTool(
        "resubmit_my_request",
        {
          type: "expense",
          id: created.id,
          payload: {
            ...EXPENSE,
            transport: [{ ...EXPENSE.transport[0], existingReceiptId: receipt.id }],
          },
        },
        employeeAuth
      )
    );
    const [after] = await testDb()
      .select()
      .from(schema.receipts)
      .where(eq(schema.receipts.id, receipt.id));
    expect(after.itemId).not.toBeNull();
  });

  it("korrigiert einen beanstandeten Urlaubsantrag, sichert die Historie und auditiert mit mcp", async () => {
    const v = await insertVacation(seed.employee.id, { status: "beanstandet" });

    const result = json(
      await callTool(
        "resubmit_my_request",
        {
          type: "vacation",
          id: v.id,
          payload: { startDate: "2026-08-10", endDate: "2026-08-12" },
        },
        employeeAuth
      )
    );

    expect(result).toMatchObject({
      id: v.id,
      status: "eingereicht",
      version: 2,
      startDate: "2026-08-10",
      days: 3,
    });
    const history = await testDb().select().from(schema.requestHistory);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ requestType: "urlaub", requestId: v.id, version: 1 });
    expect((await auditFor("urlaub", v.id))[0]).toMatchObject({
      action: "korrigiert_erneut_eingereicht",
      source: "mcp",
    });
    expect(mailbox.at(-1)?.subject).toContain("korrigiert erneut eingereicht");
  });

  it("korrigiert zurückgezogene Workations, Abrechnungen und Provisionen", async () => {
    const w = await insertWorkation(seed.employee.id, { status: "zurueckgezogen" });
    const e = await insertExpense(seed.employee.id, { status: "beanstandet" });
    const c = await insertCommission(seed.employee.id, { status: "beanstandet" });

    const workation = json(
      await callTool(
        "resubmit_my_request",
        { type: "workation", id: w.id, payload: { ...WORKATION, city: "Madrid" } },
        employeeAuth
      )
    );
    expect(workation).toMatchObject({ status: "eingereicht", version: 2, city: "Madrid" });

    const expense = json(
      await callTool(
        "resubmit_my_request",
        { type: "expense", id: e.id, payload: EXPENSE },
        employeeAuth
      )
    );
    expect(expense).toMatchObject({ status: "eingereicht", version: 2 });
    const [report] = await testDb()
      .select()
      .from(schema.expenseReports)
      .where(eq(schema.expenseReports.id, e.id));
    expect(report).toMatchObject({ destination: "Berlin", transportCents: 8900 });

    const commission = json(
      await callTool(
        "resubmit_my_request",
        { type: "commission", id: c.id, payload: COMMISSION },
        employeeAuth
      )
    );
    expect(commission).toMatchObject({
      status: "eingereicht",
      version: 2,
      customerName: "ACME GmbH",
      finalAmountCents: 15000,
    });

    const history = await testDb().select().from(schema.requestHistory);
    expect(history.map((h) => h.requestType).sort()).toEqual([
      "provision",
      "reisekosten",
      "workation",
    ]);
    for (const [type, id] of [
      ["workation", w.id],
      ["reisekosten", e.id],
      ["provision", c.id],
    ] as const) {
      expect((await auditFor(type, id))[0]).toMatchObject({
        action: "korrigiert_erneut_eingereicht",
        source: "mcp",
      });
    }
  });

  it("lehnt die Korrektur eines eingereichten Antrags ab", async () => {
    const v = await insertVacation(seed.employee.id);
    const result = await callTool(
      "resubmit_my_request",
      { type: "vacation", id: v.id, payload: WEEK },
      employeeAuth
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toBe(
      "Nur beanstandete oder zurückgezogene Anträge können korrigiert werden."
    );
  });

  it("lässt fremde Anträge nicht korrigieren", async () => {
    const foreign = await insertCommission(seed.admin.id, { status: "beanstandet" });
    const result = await callTool(
      "resubmit_my_request",
      { type: "commission", id: foreign.id, payload: COMMISSION },
      employeeAuth
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toBe("Anspruch nicht gefunden.");
  });

  it("prüft das Payload gegen das Schema der Antragsart, ohne etwas zu ändern", async () => {
    const v = await insertVacation(seed.employee.id, { status: "beanstandet" });
    const result = await callTool(
      "resubmit_my_request",
      { type: "vacation", id: v.id, payload: { startDate: "", endDate: "2026-08-12" } },
      employeeAuth
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Bitte Startdatum angeben.");
    const [row] = await testDb()
      .select()
      .from(schema.vacationRequests)
      .where(eq(schema.vacationRequests.id, v.id));
    expect(row).toMatchObject({ status: "beanstandet", version: 1 });
    expect(await testDb().select().from(schema.requestHistory)).toHaveLength(0);
  });
});

describe("close_my_sick_leave", () => {
  it("schließt eine eigene offene Krankmeldung mit Enddatum ab", async () => {
    const s = await insertSickLeave(seed.employee.id);

    const result = json(
      await callTool("close_my_sick_leave", { id: s.id, endDate: "2026-10-07" }, employeeAuth)
    );

    expect(result).toMatchObject({
      id: s.id,
      status: "abgeschlossen",
      endDate: "2026-10-07",
    });
    expect((await auditFor("krankmeldung", s.id))[0]).toMatchObject({
      action: "abgeschlossen",
      source: "mcp",
    });
    expect(mailbox).toHaveLength(1);
    expect(mailbox[0].subject).toBe("Krankmeldung abgeschlossen: Max Mitarbeiter");
  });

  it("meldet eine bereits abgeschlossene Krankmeldung", async () => {
    const s = await insertSickLeave(seed.employee.id, {
      status: "abgeschlossen",
      endDate: "2026-10-06",
    });
    const result = await callTool(
      "close_my_sick_leave",
      { id: s.id, endDate: "2026-10-07" },
      employeeAuth
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toBe("Die Krankmeldung ist bereits abgeschlossen.");
  });

  it("lehnt ein Enddatum vor dem ersten Tag ab", async () => {
    const s = await insertSickLeave(seed.employee.id);
    const result = await callTool(
      "close_my_sick_leave",
      { id: s.id, endDate: "2026-10-01" },
      employeeAuth
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toBe("Das Enddatum darf nicht vor dem ersten Tag liegen.");
    const [row] = await testDb()
      .select()
      .from(schema.sickLeaves)
      .where(eq(schema.sickLeaves.id, s.id));
    expect(row.status).toBe("gemeldet");
  });

  it("lässt fremde Krankmeldungen nicht abschließen", async () => {
    const foreign = await insertSickLeave(seed.admin.id);
    const result = await callTool(
      "close_my_sick_leave",
      { id: foreign.id, endDate: "2026-10-07" },
      employeeAuth
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toBe("Krankmeldung nicht gefunden.");
  });

  it("verlangt eine gültige ID und ein Enddatum", async () => {
    const s = await insertSickLeave(seed.employee.id);
    for (const args of [
      { id: "kein-uuid", endDate: "2026-10-07" },
      { id: s.id, endDate: "" },
      { id: randomUUID() },
    ]) {
      const result = await callTool("close_my_sick_leave", args, employeeAuth);
      expect(result.isError, JSON.stringify(args)).toBe(true);
      expect(text(result)).toContain("Input validation error");
    }
  });
});
