import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as listAbsences } from "@/app/api/v1/absences/route";
import { GET as listFakturaFreigaben } from "@/app/api/v1/faktura/freigaben/route";
import { POST as fakturaFreigeben } from "@/app/api/v1/faktura/freigaben/freigeben/route";
import { POST as approveRequest } from "@/app/api/v1/requests/[id]/approve/route";
import { GET as getRequest } from "@/app/api/v1/requests/[id]/route";
import { GET as listRequests } from "@/app/api/v1/requests/route";
import {
  GET as getZitate,
  OPTIONS as optionsZitate,
} from "@/app/api/v1/website/zitate/route";
import type { SeminarReportInput } from "@/lib/seminar-reports";
import {
  createSeminarReport,
  getSeminarReportWithQuotes,
  setQuoteWebsiteApproved,
  updateSeminarReport,
} from "@/lib/seminar-reports-store";
import {
  apiKeys,
  seminarReportQuotes,
  seminarReports,
  vacationRequests,
} from "../../src/db/schema";
import {
  createTestApiKey,
  resetDb,
  seedTestData,
  testDb,
  type SeedResult,
} from "../helpers/db";

const URL_ZITATE = "http://localhost/api/v1/website/zitate";
const CUSTOMER = "Haufe Akademie";

let seed: SeedResult;
let websiteKey: string;
let readonlyKey: string;
let fullKey: string;

function input(
  overrides: Partial<SeminarReportInput> = {}
): SeminarReportInput {
  return {
    kind: "seminar",
    customerName: CUSTOMER,
    title: "KI-Grundlagen",
    eventDate: "2026-05-12",
    durationDays: 1,
    whatWentWell: "Übungen kamen gut an.",
    whatWentBadly: "Raum zu klein.",
    improvements: "Teilnehmendenzahl vorab abfragen.",
    feedbackRating: 5,
    quotes: [],
    ...overrides,
  };
}

function authed(key: string, url = URL_ZITATE, init?: RequestInit): Request {
  return new Request(url, {
    ...init,
    headers: { authorization: `Bearer ${key}`, ...(init?.headers ?? {}) },
  });
}

/** Legt einen Bericht mit zwei Zitaten an und gibt deren Ids zurück. */
async function reportWithTwoQuotes(overrides: Partial<SeminarReportInput> = {}) {
  const reportId = await createSeminarReport(
    seed.employee,
    input({
      quotes: [
        { id: null, quote: "Sehr praxisnah, direkt anwendbar." },
        { id: null, quote: "Noch nicht freigegeben." },
      ],
      ...overrides,
    })
  );
  const found = await getSeminarReportWithQuotes(reportId);
  return { reportId, quotes: found!.quotes };
}

beforeAll(async () => {
  await resetDb();
  seed = await seedTestData();
  ({ key: websiteKey } = await createTestApiKey(
    seed.admin.id,
    "Website",
    "website"
  ));
  ({ key: readonlyKey } = await createTestApiKey(
    seed.admin.id,
    "Nur-Lesen",
    "readonly"
  ));
  ({ key: fullKey } = await createTestApiKey(seed.admin.id, "Voll", "full"));
});

beforeEach(async () => {
  const db = testDb();
  await db.delete(seminarReportQuotes);
  await db.delete(seminarReports);
  delete process.env.WEBSITE_CORS_ORIGINS;
});

afterAll(() => {
  delete process.env.WEBSITE_CORS_ORIGINS;
});

describe("Zitate-Schnittstelle — Inhalt", () => {
  it("liefert ausschließlich freigegebene Zitate", async () => {
    const { quotes } = await reportWithTwoQuotes();
    await setQuoteWebsiteApproved(seed.admin, quotes[0].id, true);

    const res = await getZitate(authed(websiteKey));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.anzahl).toBe(1);
    expect(body.zitate).toEqual([
      { id: quotes[0].id, zitat: "Sehr praxisnah, direkt anwendbar." },
    ]);
  });

  it("gibt weder Mitarbeitenden- noch Kundendaten preis", async () => {
    const { quotes } = await reportWithTwoQuotes();
    await setQuoteWebsiteApproved(seed.admin, quotes[0].id, true);

    const raw = await (await getZitate(authed(websiteKey))).text();
    // Diese Zusicherungen sehen paranoid aus, sind aber der eigentliche Punkt
    // der Schnittstelle: ein Refactor, der die Bericht-Zeile einfach
    // durchreicht, muss hier scheitern.
    expect(raw).not.toContain(seed.employee.firstName);
    expect(raw).not.toContain(seed.employee.lastName);
    expect(raw).not.toContain(seed.employee.email);
    expect(raw).not.toContain(seed.employee.id);
    expect(raw).not.toContain(CUSTOMER);
    expect(raw).not.toContain("KI-Grundlagen");
    expect(raw).not.toContain("2026-05-12");
  });

  it("sortiert nach Veranstaltungsdatum, neueste zuerst", async () => {
    const alt = await createSeminarReport(
      seed.employee,
      input({ eventDate: "2026-01-10", quotes: [{ id: null, quote: "Alt" }] })
    );
    const neu = await createSeminarReport(
      seed.employee,
      input({ eventDate: "2026-07-01", quotes: [{ id: null, quote: "Neu" }] })
    );
    for (const id of [alt, neu]) {
      const found = await getSeminarReportWithQuotes(id);
      await setQuoteWebsiteApproved(seed.admin, found!.quotes[0].id, true);
    }

    const body = await (await getZitate(authed(websiteKey))).json();
    expect(body.zitate.map((z: { zitat: string }) => z.zitat)).toEqual([
      "Neu",
      "Alt",
    ]);
  });

  it("entfernt das Zitat aus der Ausgabe, wenn der Wortlaut geändert wird", async () => {
    const { reportId, quotes } = await reportWithTwoQuotes();
    await setQuoteWebsiteApproved(seed.admin, quotes[0].id, true);

    await updateSeminarReport(
      seed.employee,
      reportId,
      input({
        quotes: [
          { id: quotes[0].id, quote: "Sehr praxisnah, direkt anwendbar!" },
          { id: quotes[1].id, quote: quotes[1].quote },
        ],
      })
    );

    const body = await (await getZitate(authed(websiteKey))).json();
    expect(body.anzahl).toBe(0);
  });
});

describe("Zitate-Schnittstelle — Parameter", () => {
  it("kürzt mit limit", async () => {
    const { quotes } = await reportWithTwoQuotes();
    for (const quote of quotes)
      await setQuoteWebsiteApproved(seed.admin, quote.id, true);

    const body = await (
      await getZitate(authed(websiteKey, `${URL_ZITATE}?limit=1`))
    ).json();
    expect(body.anzahl).toBe(1);
  });

  it.each(["0", "999", "abc", "1.5", "-1"])(
    "weist limit=%s mit 400 ab",
    async (value) => {
      const res = await getZitate(
        authed(websiteKey, `${URL_ZITATE}?limit=${value}`)
      );
      expect(res.status).toBe(400);
      expect((await res.json()).fehler).toContain("limit");
    }
  );
});

describe("Zitate-Schnittstelle — Caching", () => {
  it("beantwortet unveränderte Daten mit 304 und erkennt Änderungen", async () => {
    const { quotes } = await reportWithTwoQuotes();
    await setQuoteWebsiteApproved(seed.admin, quotes[0].id, true);

    const first = await getZitate(authed(websiteKey));
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();
    expect(first.headers.get("cache-control")).toContain("private");

    const cached = await getZitate(
      authed(websiteKey, URL_ZITATE, { headers: { "if-none-match": etag! } })
    );
    expect(cached.status).toBe(304);
    expect(await cached.text()).toBe("");

    // Zurückgezogene Freigabe muss den ETag ändern — genau der Fall, den ein
    // aus updatedAt abgeleitetes Last-Modified verschlafen würde.
    await setQuoteWebsiteApproved(seed.admin, quotes[0].id, false);
    const after = await getZitate(
      authed(websiteKey, URL_ZITATE, { headers: { "if-none-match": etag! } })
    );
    expect(after.status).toBe(200);
    expect(after.headers.get("etag")).not.toBe(etag);
  });
});

describe("Zitate-Schnittstelle — CORS", () => {
  it("setzt ohne WEBSITE_CORS_ORIGINS keine CORS-Header", async () => {
    const res = await getZitate(
      authed(websiteKey, URL_ZITATE, {
        headers: { origin: "https://stefanai.de" },
      })
    );
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("spiegelt nur Origins von der Allowlist", async () => {
    process.env.WEBSITE_CORS_ORIGINS = "https://stefanai.de, https://www.stefanai.de";

    const erlaubt = await optionsZitate(
      new Request(URL_ZITATE, {
        method: "OPTIONS",
        headers: { origin: "https://www.stefanai.de" },
      })
    );
    expect(erlaubt.status).toBe(204);
    expect(erlaubt.headers.get("access-control-allow-origin")).toBe(
      "https://www.stefanai.de"
    );
    expect(erlaubt.headers.get("access-control-expose-headers")).toBe("etag");

    const fremd = await optionsZitate(
      new Request(URL_ZITATE, {
        method: "OPTIONS",
        headers: { origin: "https://boese.example" },
      })
    );
    expect(fremd.headers.get("access-control-allow-origin")).toBeNull();

    const get = await getZitate(
      authed(websiteKey, URL_ZITATE, {
        headers: { origin: "https://stefanai.de" },
      })
    );
    expect(get.headers.get("access-control-allow-origin")).toBe(
      "https://stefanai.de"
    );
    expect(get.headers.get("vary")).toContain("Origin");
  });
});

describe("Website-Keys erreichen ausschließlich die Zitate", () => {
  it("weist alle übrigen v1-Endpunkte mit 403 ab", async () => {
    const [vacation] = await testDb()
      .insert(vacationRequests)
      .values({
        userId: seed.employee.id,
        startDate: "2026-09-07",
        endDate: "2026-09-11",
        days: 5,
        status: "eingereicht",
      })
      .returning();

    const responses = await Promise.all([
      listAbsences(authed(websiteKey, "http://localhost/api/v1/absences")),
      listRequests(authed(websiteKey, "http://localhost/api/v1/requests")),
      getRequest(
        authed(websiteKey, `http://localhost/api/v1/requests/${vacation.id}`),
        { params: Promise.resolve({ id: vacation.id }) }
      ),
      listFakturaFreigaben(
        authed(websiteKey, "http://localhost/api/v1/faktura/freigaben")
      ),
      approveRequest(
        authed(
          websiteKey,
          `http://localhost/api/v1/requests/${vacation.id}/approve`,
          { method: "POST" }
        ),
        { params: Promise.resolve({ id: vacation.id }) }
      ),
      fakturaFreigeben(
        authed(
          websiteKey,
          "http://localhost/api/v1/faktura/freigaben/freigeben",
          { method: "POST", body: JSON.stringify({ jahr: 2026, kw: 30 }) }
        )
      ),
    ]);

    expect(responses.map((res) => res.status)).toEqual([
      403, 403, 403, 403, 403, 403,
    ]);

    // Der Schreibversuch darf den Antrag nicht verändert haben.
    const [row] = await testDb()
      .select()
      .from(vacationRequests)
      .where(eq(vacationRequests.id, vacation.id));
    expect(row.status).toBe("eingereicht");
  });

  it("lässt readonly- und full-Keys die Zitate lesen", async () => {
    for (const key of [readonlyKey, fullKey])
      expect((await getZitate(authed(key))).status).toBe(200);
  });
});

describe("Zitate-Schnittstelle — Authentifizierung", () => {
  it("verlangt einen Bearer-Key", async () => {
    const res = await getZitate(new Request(URL_ZITATE));
    expect(res.status).toBe(401);
  });

  it("lehnt widerrufene Website-Keys ab", async () => {
    const { key, id } = await createTestApiKey(
      seed.admin.id,
      "Widerrufen",
      "website"
    );
    await testDb()
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(eq(apiKeys.id, id));

    const res = await getZitate(authed(key));
    expect(res.status).toBe(401);
  });
});
