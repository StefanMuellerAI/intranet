import { createRequire } from "node:module";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as getWorkationPdf } from "@/app/(app)/workation/[id]/pdf/route";
import { approveAction } from "@/app/(app)/freigaben/actions";
import * as schema from "../../../src/db/schema";
import { actAs, createUser, makeDeputy } from "../../helpers/actions";
import { resetDb, seedTestData, testDb, type SeedResult } from "../../helpers/db";

// Klassisches pdf-parse (1.x) wie in src/lib/it-equipment-pdf.test.ts
const nodeRequire = createRequire(import.meta.url);
const parsePdf = nodeRequire("pdf-parse/lib/pdf-parse.js") as (
  data: Buffer
) => Promise<{ text: string; numpages: number }>;

let seed: SeedResult;

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function pdfRequest(id: string) {
  return new Request(`http://localhost/workation/${id}/pdf`);
}

async function insertWorkation(
  overrides: Partial<typeof schema.workationRequests.$inferInsert> = {}
) {
  const [row] = await testDb()
    .insert(schema.workationRequests)
    .values({
      userId: seed.employee.id,
      country: "Spanien",
      countryCategory: "eu_ewr_ch",
      city: "Valencia",
      accommodationAddress: "Calle de la Paz 12, 46003 Valencia",
      startDate: "2027-06-07",
      endDate: "2027-06-18",
      workDays: 10,
      vacationDays: 2,
      timezoneAvailability: "MESZ, erreichbar 9–17 Uhr",
      daysInCountryThisYear: 14,
      emergencyContactName: "Eva Mitarbeiter",
      emergencyContactPhone: "+49 221 123456",
      visaType: "EU-Bürger, kein Visum erforderlich",
      visaValidUntil: "2027-12-31",
      insuranceDetails: "Auslandskrankenversicherung inkl. Rücktransport",
      proofProvidedAt: "2027-05-20",
      plannedTasks: "Konzeption Kundenworkshop",
      excludedProjects: "Mandat Contoso",
      domesticSubstitution: "Kollegin Müller",
      declResidence: true,
      declVisa: true,
      declWorkingTime: true,
      declDataProtection: true,
      declNoForbiddenActivities: true,
      declReportChanges: true,
      declCosts: true,
      ...overrides,
    })
    .returning();
  return row;
}

/** Antrag einreichen und regulär durch den Admin genehmigen lassen. */
async function approvedWorkation() {
  const request = await insertWorkation();
  await actAs(seed.admin);
  await approveAction("workation", request.id);
  return request;
}

beforeAll(async () => {
  await resetDb();
  seed = await seedTestData();
});

beforeEach(async () => {
  const db = testDb();
  await db.delete(schema.workationRequests);
  await db.delete(schema.deputyAssignments);
});

describe("GET /workation/{id}/pdf", () => {
  it("liefert der antragstellenden Person das Genehmigungs-PDF mit allen Kernangaben", async () => {
    const request = await approvedWorkation();
    await actAs(seed.employee);

    const res = await getWorkationPdf(pdfRequest(request.id), ctx(request.id));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe(
      `inline; filename="Workation-Genehmigung-${request.id}.pdf"`
    );
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.subarray(0, 5).toString()).toBe("%PDF-");

    const { text } = await parsePdf(body);
    expect(text).toContain("Antrag und Einzelvereinbarung Workation");
    expect(text).toContain("StefanAI Solutions GmbH");
    expect(text).toContain("Mitarbeiter, Max");
    expect(text).toContain("Spanien (EU/EWR/Schweiz)");
    expect(text).toContain("Valencia");
    expect(text).toContain("Calle de la Paz 12, 46003 Valencia");
    expect(text).toContain("07.06.2027 — 18.06.2027");
    expect(text).toContain("Eva Mitarbeiter, +49 221 123456");
    expect(text).toContain("31.12.2027");
    expect(text).toContain("20.05.2027");
    expect(text).toContain("Mandat Contoso");
    expect(text).toContain("Kollegin Müller");
    expect(text).toContain("[X]");
    expect(text).toContain("Genehmigungsvermerk");
    expect(text).toContain("Digital eingereicht von Max Mitarbeiter");
    expect(text).toContain("Genehmigt durch Erika Admin");
  });

  it("liefert dem Admin das PDF fremder Anträge", async () => {
    const request = await approvedWorkation();
    await actAs(seed.admin);

    const res = await getWorkationPdf(pdfRequest(request.id), ctx(request.id));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    const { text } = await parsePdf(Buffer.from(await res.arrayBuffer()));
    expect(text).toContain("Mitarbeiter, Max");
  });

  it("nennt die Geschäftsführung, wenn keine genehmigende Person hinterlegt ist", async () => {
    const request = await insertWorkation({
      status: "genehmigt",
      country: "Japan",
      countryCategory: "drittstaat",
      excludedProjects: null,
    });
    await actAs(seed.employee);

    const res = await getWorkationPdf(pdfRequest(request.id), ctx(request.id));

    expect(res.status).toBe(200);
    const { text } = await parsePdf(Buffer.from(await res.arrayBuffer()));
    expect(text).toContain("Japan (Drittstaat)");
    expect(text).toContain("Genehmigt durch Geschäftsführung");
  });

  it("verlangt eine Anmeldung (401)", async () => {
    const request = await approvedWorkation();
    await actAs(null);

    const res = await getWorkationPdf(pdfRequest(request.id), ctx(request.id));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Nicht angemeldet." });
  });

  it("verweigert deaktivierten Konten den Zugriff (401)", async () => {
    const inactive = await createUser({ status: "deaktiviert" });
    const request = await insertWorkation({ userId: inactive.id, status: "genehmigt" });
    await actAs(inactive);

    const res = await getWorkationPdf(pdfRequest(request.id), ctx(request.id));

    expect(res.status).toBe(401);
  });

  it("verbirgt fremde Anträge vor anderen Mitarbeitenden (404)", async () => {
    const request = await approvedWorkation();
    await actAs(await createUser());

    const res = await getWorkationPdf(pdfRequest(request.id), ctx(request.id));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Nicht gefunden." });
  });

  it("verbirgt fremde Anträge auch vor einer aktiven Vertretung (404)", async () => {
    const request = await approvedWorkation();
    const deputy = await createUser();
    await makeDeputy(deputy);
    await actAs(deputy);

    const res = await getWorkationPdf(pdfRequest(request.id), ctx(request.id));

    expect(res.status).toBe(404);
  });

  it("meldet unbekannte Anträge als nicht gefunden (404)", async () => {
    await actAs(seed.admin);
    const id = "00000000-0000-4000-8000-000000000000";

    const res = await getWorkationPdf(pdfRequest(id), ctx(id));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Nicht gefunden." });
  });

  it.each(["eingereicht", "beanstandet", "zurueckgezogen"] as const)(
    "liefert im Status %s noch kein PDF (400)",
    async (status) => {
      const request = await insertWorkation({ status });
      await actAs(seed.employee);

      const res = await getWorkationPdf(pdfRequest(request.id), ctx(request.id));

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: "Das PDF ist erst nach Genehmigung verfügbar.",
      });
    }
  );

  it("liefert auch dem Admin vor der Genehmigung kein PDF (400)", async () => {
    const request = await insertWorkation();
    await actAs(seed.admin);

    const res = await getWorkationPdf(pdfRequest(request.id), ctx(request.id));

    expect(res.status).toBe(400);
    expect(
      (await testDb().query.workationRequests.findFirst({
        where: eq(schema.workationRequests.id, request.id),
      }))?.status
    ).toBe("eingereicht");
  });
});
