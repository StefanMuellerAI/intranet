import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createHelpfulLink,
  createNewsItem,
  createSalesNews,
  createTeamEvent,
  deleteHelpfulLink,
  deleteNewsItem,
  deleteSalesNews,
  deleteTeamEvent,
  toggleHelpfulLink,
  toggleNewsItem,
  toggleSalesNews,
  toggleTeamEvent,
  updateHelpfulLink,
  updateNewsItem,
  updateSalesNews,
  updateTeamEvent,
} from "@/app/(app)/inhalte/actions";
import * as schema from "../../../src/db/schema";
import { actAs, auditFor, createUser, formData } from "../../helpers/actions";
import { resetDb, seedTestData, testDb, type SeedResult } from "../../helpers/db";
import { nextCacheModule } from "../../helpers/framework-fakes";

let seed: SeedResult;

const LINK = {
  title: "Reisekostenrichtlinie",
  url: "https://intranet.stefanai.de/richtlinie",
  description: "Alles zu Spesen",
  sortOrder: "20",
};
const NEWS = { title: "Neues Büro", body: "Ab Montag in der Graeffstraße." };
const EVENT = {
  title: "Sommerfest",
  startDate: "2026-08-14",
  endDate: "2026-08-15",
};

function salesForm(overrides: Record<string, string> = {}) {
  return formData({
    customerName: "Muster AG",
    volume: "12500,50",
    soldById: seed.employee.id,
    deliveryStart: "2026-09-01",
    deliveryEnd: "2026-09-30",
    ...overrides,
  });
}

/** Mitarbeitende dürfen keine der Inhalts-Actions ausführen. */
async function expectAdminOnly(run: () => Promise<unknown>) {
  await actAs(seed.employee);
  await expect(run()).rejects.toThrow("Nur für den Admin zulässig.");
  expect(await testDb().select().from(schema.auditLog)).toHaveLength(0);
}

async function onlyLink() {
  const rows = await testDb().select().from(schema.helpfulLinks);
  expect(rows).toHaveLength(1);
  return rows[0];
}

async function onlyNews() {
  const rows = await testDb().select().from(schema.newsItems);
  expect(rows).toHaveLength(1);
  return rows[0];
}

async function onlyEvent() {
  const rows = await testDb().select().from(schema.teamEvents);
  expect(rows).toHaveLength(1);
  return rows[0];
}

async function onlySales() {
  const rows = await testDb().select().from(schema.salesNews);
  expect(rows).toHaveLength(1);
  return rows[0];
}

async function insertLink(values: Partial<typeof schema.helpfulLinks.$inferInsert> = {}) {
  const [row] = await testDb()
    .insert(schema.helpfulLinks)
    .values({ title: "Alt", url: "https://alt.example/", ...values })
    .returning();
  return row;
}

async function insertNews(values: Partial<typeof schema.newsItems.$inferInsert> = {}) {
  const [row] = await testDb()
    .insert(schema.newsItems)
    .values({ title: "Alt", body: "Alter Text", createdById: seed.admin.id, ...values })
    .returning();
  return row;
}

async function insertEvent(values: Partial<typeof schema.teamEvents.$inferInsert> = {}) {
  const [row] = await testDb()
    .insert(schema.teamEvents)
    .values({
      title: "Alt",
      startDate: "2026-07-01",
      endDate: "2026-07-01",
      createdById: seed.admin.id,
      ...values,
    })
    .returning();
  return row;
}

async function insertSales(values: Partial<typeof schema.salesNews.$inferInsert> = {}) {
  const [row] = await testDb()
    .insert(schema.salesNews)
    .values({
      customerName: "Alt GmbH",
      volumeCents: 100_00,
      soldById: seed.employee.id,
      deliveryStart: "2026-07-01",
      deliveryEnd: "2026-07-01",
      createdById: seed.admin.id,
      ...values,
    })
    .returning();
  return row;
}

beforeAll(async () => {
  await resetDb();
  seed = await seedTestData();
});

beforeEach(async () => {
  const db = testDb();
  await db.delete(schema.salesNewsDismissals);
  await db.delete(schema.salesNews);
  await db.delete(schema.teamEvents);
  await db.delete(schema.newsItems);
  await db.delete(schema.helpfulLinks);
  await db.delete(schema.auditLog);
  await actAs(seed.admin);
});

// ---------------------------------------------------------------------------
// Hilfreiche Links
// ---------------------------------------------------------------------------

describe("createHelpfulLink", () => {
  it("legt den Link an, auditiert und aktualisiert Inhalte und Dashboard", async () => {
    await createHelpfulLink(formData(LINK));

    const link = await onlyLink();
    expect(link).toMatchObject({
      title: LINK.title,
      url: LINK.url,
      description: LINK.description,
      sortOrder: 20,
      active: true,
    });
    expect((await auditFor("hilfreicher_link", link.id))[0]).toMatchObject({
      action: "erstellt",
      actorUserId: seed.admin.id,
      actorLabel: "Erika Admin",
      source: "web",
      details: { title: LINK.title, url: LINK.url },
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/inhalte");
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("normalisiert URL und Sortierung, leere Beschreibung wird null", async () => {
    await createHelpfulLink(
      formData({
        title: "  Wiki  ",
        url: "https://Wiki.Example.com",
        description: "   ",
        sortOrder: "2.6",
      })
    );
    expect(await onlyLink()).toMatchObject({
      title: "Wiki",
      url: "https://wiki.example.com/",
      description: null,
      sortOrder: 3,
    });
  });

  it("setzt die Sortierung ohne Angabe auf 0", async () => {
    await createHelpfulLink(formData({ title: "Wiki", url: "https://wiki.example/" }));
    expect((await onlyLink()).sortOrder).toBe(0);
  });

  it("lehnt eine ungültige URL ab", async () => {
    await expect(
      createHelpfulLink(formData({ ...LINK, url: "kein link" }))
    ).rejects.toThrow("Ungültige URL.");
    await expect(
      createHelpfulLink(formData({ ...LINK, url: "javascript:alert(1)" }))
    ).rejects.toThrow("URL muss mit http:// oder https:// beginnen.");
    await expect(createHelpfulLink(formData({ ...LINK, url: " " }))).rejects.toThrow(
      "URL ist erforderlich."
    );
    expect(await testDb().select().from(schema.helpfulLinks)).toHaveLength(0);
  });

  it("lehnt eine ungültige Sortierung ab", async () => {
    await expect(
      createHelpfulLink(formData({ ...LINK, sortOrder: "-1" }))
    ).rejects.toThrow("Ungültige Sortierung.");
    await expect(
      createHelpfulLink(formData({ ...LINK, sortOrder: "zehn" }))
    ).rejects.toThrow("Ungültige Sortierung.");
  });

  it("verlangt einen Titel", async () => {
    await expect(
      createHelpfulLink(formData({ ...LINK, title: "   " }))
    ).rejects.toThrow("Titel ist erforderlich.");
  });

  it("lehnt Mitarbeitende ab", async () => {
    await expectAdminOnly(() => createHelpfulLink(formData(LINK)));
    expect(await testDb().select().from(schema.helpfulLinks)).toHaveLength(0);
  });
});

describe("updateHelpfulLink", () => {
  it("bearbeitet den Link und auditiert", async () => {
    const { id } = await insertLink({ description: "alt", sortOrder: 5 });

    await updateHelpfulLink(formData({ id, ...LINK }));

    expect(await onlyLink()).toMatchObject({
      id,
      title: LINK.title,
      url: LINK.url,
      description: LINK.description,
      sortOrder: 20,
    });
    expect((await auditFor("hilfreicher_link", id))[0]).toMatchObject({
      action: "aktualisiert",
      actorUserId: seed.admin.id,
      details: { title: LINK.title, url: LINK.url },
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("prüft URL und Sortierung und lässt den Link dann unverändert", async () => {
    const link = await insertLink();
    await expect(
      updateHelpfulLink(formData({ id: link.id, ...LINK, url: "ftp://files.example" }))
    ).rejects.toThrow("URL muss mit http:// oder https:// beginnen.");
    await expect(
      updateHelpfulLink(formData({ id: link.id, ...LINK, sortOrder: "-3" }))
    ).rejects.toThrow("Ungültige Sortierung.");
    expect((await onlyLink()).title).toBe("Alt");
    expect(await auditFor("hilfreicher_link", link.id)).toHaveLength(0);
  });

  it("verlangt eine ID", async () => {
    await expect(updateHelpfulLink(formData(LINK))).rejects.toThrow(
      "ID ist erforderlich."
    );
  });

  it("lehnt eine unbekannte ID ab und auditiert nichts", async () => {
    const id = randomUUID();
    await expect(updateHelpfulLink(formData({ id, ...LINK }))).rejects.toThrow(
      "Link nicht gefunden."
    );
    expect(await testDb().select().from(schema.helpfulLinks)).toHaveLength(0);
    expect(await auditFor("hilfreicher_link", id)).toHaveLength(0);
  });

  it("lehnt Mitarbeitende ab", async () => {
    const link = await insertLink();
    await expectAdminOnly(() => updateHelpfulLink(formData({ id: link.id, ...LINK })));
    expect((await onlyLink()).title).toBe("Alt");
  });
});

describe("toggleHelpfulLink", () => {
  it("blendet den Link aus und wieder ein", async () => {
    const { id } = await insertLink();

    await toggleHelpfulLink(id);
    expect((await onlyLink()).active).toBe(false);
    expect((await auditFor("hilfreicher_link", id))[0].action).toBe("deaktiviert");

    await toggleHelpfulLink(id);
    expect((await onlyLink()).active).toBe(true);
    const audit = await auditFor("hilfreicher_link", id);
    expect(audit.map((a) => a.action).sort()).toEqual(["aktiviert", "deaktiviert"]);
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/inhalte");
  });

  it("meldet unbekannte Links", async () => {
    const id = randomUUID();
    await expect(toggleHelpfulLink(id)).rejects.toThrow("Link nicht gefunden.");
    expect(await auditFor("hilfreicher_link", id)).toHaveLength(0);
  });

  it("lehnt Mitarbeitende ab", async () => {
    const link = await insertLink();
    await expectAdminOnly(() => toggleHelpfulLink(link.id));
    expect((await onlyLink()).active).toBe(true);
  });
});

describe("deleteHelpfulLink", () => {
  it("löscht den Link und auditiert", async () => {
    const { id } = await insertLink();
    const other = await insertLink({ title: "Bleibt" });

    await deleteHelpfulLink(id);

    expect(await onlyLink()).toMatchObject({ id: other.id });
    expect((await auditFor("hilfreicher_link", id))[0]).toMatchObject({
      action: "geloescht",
      actorUserId: seed.admin.id,
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("lehnt eine unbekannte ID ab und auditiert nichts", async () => {
    const id = randomUUID();
    await expect(deleteHelpfulLink(id)).rejects.toThrow("Link nicht gefunden.");
    expect(await auditFor("hilfreicher_link", id)).toHaveLength(0);
  });

  it("lehnt Mitarbeitende ab", async () => {
    const link = await insertLink();
    await expectAdminOnly(() => deleteHelpfulLink(link.id));
    await onlyLink();
  });
});

// ---------------------------------------------------------------------------
// Neuigkeiten
// ---------------------------------------------------------------------------

describe("createNewsItem", () => {
  it("legt die Neuigkeit an, auditiert und aktualisiert Inhalte und Dashboard", async () => {
    await createNewsItem(formData({ title: "  Neues Büro ", body: ` ${NEWS.body} ` }));

    const news = await onlyNews();
    expect(news).toMatchObject({
      title: NEWS.title,
      body: NEWS.body,
      active: true,
      createdById: seed.admin.id,
    });
    expect((await auditFor("neuigkeit", news.id))[0]).toMatchObject({
      action: "erstellt",
      actorUserId: seed.admin.id,
      source: "web",
      details: { title: NEWS.title },
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/inhalte");
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("verlangt Titel und Nachricht", async () => {
    await expect(createNewsItem(formData({ ...NEWS, title: " " }))).rejects.toThrow(
      "Titel ist erforderlich."
    );
    await expect(createNewsItem(formData({ title: NEWS.title }))).rejects.toThrow(
      "Nachricht ist erforderlich."
    );
    expect(await testDb().select().from(schema.newsItems)).toHaveLength(0);
  });

  it("lehnt Mitarbeitende ab", async () => {
    await expectAdminOnly(() => createNewsItem(formData(NEWS)));
    expect(await testDb().select().from(schema.newsItems)).toHaveLength(0);
  });
});

describe("updateNewsItem", () => {
  it("bearbeitet die Neuigkeit und auditiert", async () => {
    const { id } = await insertNews();

    await updateNewsItem(formData({ id, ...NEWS }));

    expect(await onlyNews()).toMatchObject({ id, title: NEWS.title, body: NEWS.body });
    expect((await auditFor("neuigkeit", id))[0]).toMatchObject({
      action: "aktualisiert",
      details: { title: NEWS.title },
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("verlangt Titel und Nachricht und lässt die Neuigkeit dann unverändert", async () => {
    const { id } = await insertNews();
    await expect(updateNewsItem(formData({ id, title: "", body: "x" }))).rejects.toThrow(
      "Titel ist erforderlich."
    );
    await expect(updateNewsItem(formData({ id, title: "x", body: "  " }))).rejects.toThrow(
      "Nachricht ist erforderlich."
    );
    expect(await onlyNews()).toMatchObject({ title: "Alt", body: "Alter Text" });
  });

  it("verlangt eine ID", async () => {
    await expect(updateNewsItem(formData(NEWS))).rejects.toThrow("ID ist erforderlich.");
  });

  it("lehnt eine unbekannte ID ab und auditiert nichts", async () => {
    const id = randomUUID();
    await expect(updateNewsItem(formData({ id, ...NEWS }))).rejects.toThrow(
      "Neuigkeit nicht gefunden."
    );
    expect(await testDb().select().from(schema.newsItems)).toHaveLength(0);
    expect(await auditFor("neuigkeit", id)).toHaveLength(0);
  });

  it("lehnt Mitarbeitende ab", async () => {
    const { id } = await insertNews();
    await expectAdminOnly(() => updateNewsItem(formData({ id, ...NEWS })));
    expect((await onlyNews()).title).toBe("Alt");
  });
});

describe("toggleNewsItem", () => {
  it("blendet die Neuigkeit aus und wieder ein", async () => {
    const { id } = await insertNews();

    await toggleNewsItem(id);
    expect((await onlyNews()).active).toBe(false);
    expect((await auditFor("neuigkeit", id))[0].action).toBe("deaktiviert");

    await toggleNewsItem(id);
    expect((await onlyNews()).active).toBe(true);
    expect((await auditFor("neuigkeit", id)).map((a) => a.action).sort()).toEqual([
      "aktiviert",
      "deaktiviert",
    ]);
  });

  it("blendet eine ausgeblendete Neuigkeit ein", async () => {
    const { id } = await insertNews({ active: false });
    await toggleNewsItem(id);
    expect((await onlyNews()).active).toBe(true);
    expect((await auditFor("neuigkeit", id))[0].action).toBe("aktiviert");
  });

  it("meldet unbekannte Neuigkeiten", async () => {
    await expect(toggleNewsItem(randomUUID())).rejects.toThrow(
      "Neuigkeit nicht gefunden."
    );
  });

  it("lehnt Mitarbeitende ab", async () => {
    const { id } = await insertNews();
    await expectAdminOnly(() => toggleNewsItem(id));
    expect((await onlyNews()).active).toBe(true);
  });
});

describe("deleteNewsItem", () => {
  it("löscht die Neuigkeit und auditiert", async () => {
    const { id } = await insertNews();

    await deleteNewsItem(id);

    expect(await testDb().select().from(schema.newsItems)).toHaveLength(0);
    expect((await auditFor("neuigkeit", id))[0]).toMatchObject({
      action: "geloescht",
      actorUserId: seed.admin.id,
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("lehnt eine unbekannte ID ab und auditiert nichts", async () => {
    const id = randomUUID();
    await expect(deleteNewsItem(id)).rejects.toThrow("Neuigkeit nicht gefunden.");
    expect(await auditFor("neuigkeit", id)).toHaveLength(0);
  });

  it("lehnt Mitarbeitende ab", async () => {
    const { id } = await insertNews();
    await expectAdminOnly(() => deleteNewsItem(id));
    await onlyNews();
  });
});

// ---------------------------------------------------------------------------
// Teamevents
// ---------------------------------------------------------------------------

describe("createTeamEvent", () => {
  it("legt das Teamevent an, auditiert und aktualisiert auch den Kalender", async () => {
    await createTeamEvent(formData(EVENT));

    const event = await onlyEvent();
    expect(event).toMatchObject({
      ...EVENT,
      active: true,
      createdById: seed.admin.id,
    });
    expect((await auditFor("teamevent", event.id))[0]).toMatchObject({
      action: "erstellt",
      actorUserId: seed.admin.id,
      source: "web",
      details: EVENT,
    });
    for (const path of ["/inhalte", "/dashboard", "/kalender"])
      expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith(path);
  });

  it("ohne Enddatum ist das Event eintägig", async () => {
    await createTeamEvent(formData({ title: "Workshop", startDate: "2026-09-10" }));
    expect(await onlyEvent()).toMatchObject({
      startDate: "2026-09-10",
      endDate: "2026-09-10",
    });
  });

  it("lehnt ein Enddatum vor dem Startdatum ab", async () => {
    await expect(
      createTeamEvent(formData({ ...EVENT, endDate: "2026-08-13" }))
    ).rejects.toThrow("Das Enddatum darf nicht vor dem Startdatum liegen.");
    expect(await testDb().select().from(schema.teamEvents)).toHaveLength(0);
  });

  it("verlangt Titel und ein gültiges Startdatum", async () => {
    await expect(createTeamEvent(formData({ ...EVENT, title: "" }))).rejects.toThrow(
      "Titel ist erforderlich."
    );
    await expect(
      createTeamEvent(formData({ title: "Fest", startDate: "" }))
    ).rejects.toThrow("Startdatum ist erforderlich.");
    await expect(
      createTeamEvent(formData({ title: "Fest", startDate: "2026-02-30" }))
    ).rejects.toThrow("Startdatum ist ungültig.");
    await expect(
      createTeamEvent(formData({ ...EVENT, endDate: "15.08.2026" }))
    ).rejects.toThrow("Enddatum ist ungültig.");
  });

  it("lehnt Mitarbeitende ab", async () => {
    await expectAdminOnly(() => createTeamEvent(formData(EVENT)));
    expect(await testDb().select().from(schema.teamEvents)).toHaveLength(0);
  });
});

describe("updateTeamEvent", () => {
  it("bearbeitet das Teamevent und auditiert", async () => {
    const { id } = await insertEvent();

    await updateTeamEvent(formData({ id, ...EVENT }));

    expect(await onlyEvent()).toMatchObject({ id, ...EVENT });
    expect((await auditFor("teamevent", id))[0]).toMatchObject({
      action: "aktualisiert",
      details: EVENT,
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/kalender");
  });

  it("lehnt ein Enddatum vor dem Startdatum ab und lässt das Event unverändert", async () => {
    const { id } = await insertEvent();
    await expect(
      updateTeamEvent(formData({ id, ...EVENT, startDate: "2026-08-20" }))
    ).rejects.toThrow("Das Enddatum darf nicht vor dem Startdatum liegen.");
    expect(await onlyEvent()).toMatchObject({ title: "Alt", startDate: "2026-07-01" });
  });

  it("verlangt eine ID", async () => {
    await expect(updateTeamEvent(formData(EVENT))).rejects.toThrow("ID ist erforderlich.");
  });

  it("lehnt eine unbekannte ID ab und auditiert nichts", async () => {
    const id = randomUUID();
    await expect(updateTeamEvent(formData({ id, ...EVENT }))).rejects.toThrow(
      "Teamevent nicht gefunden."
    );
    expect(await testDb().select().from(schema.teamEvents)).toHaveLength(0);
    expect(await auditFor("teamevent", id)).toHaveLength(0);
  });

  it("lehnt Mitarbeitende ab", async () => {
    const { id } = await insertEvent();
    await expectAdminOnly(() => updateTeamEvent(formData({ id, ...EVENT })));
    expect((await onlyEvent()).title).toBe("Alt");
  });
});

describe("toggleTeamEvent", () => {
  it("blendet das Teamevent aus und wieder ein", async () => {
    const { id } = await insertEvent();

    await toggleTeamEvent(id);
    expect((await onlyEvent()).active).toBe(false);
    expect((await auditFor("teamevent", id))[0].action).toBe("deaktiviert");
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/kalender");

    await toggleTeamEvent(id);
    expect((await onlyEvent()).active).toBe(true);
    expect((await auditFor("teamevent", id)).map((a) => a.action).sort()).toEqual([
      "aktiviert",
      "deaktiviert",
    ]);
  });

  it("meldet unbekannte Teamevents", async () => {
    await expect(toggleTeamEvent(randomUUID())).rejects.toThrow(
      "Teamevent nicht gefunden."
    );
  });

  it("lehnt Mitarbeitende ab", async () => {
    const { id } = await insertEvent();
    await expectAdminOnly(() => toggleTeamEvent(id));
    expect((await onlyEvent()).active).toBe(true);
  });
});

describe("deleteTeamEvent", () => {
  it("löscht das Teamevent, auditiert und aktualisiert den Kalender", async () => {
    const { id } = await insertEvent();

    await deleteTeamEvent(id);

    expect(await testDb().select().from(schema.teamEvents)).toHaveLength(0);
    expect((await auditFor("teamevent", id))[0]).toMatchObject({
      action: "geloescht",
      actorUserId: seed.admin.id,
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/kalender");
  });

  it("lehnt eine unbekannte ID ab und auditiert nichts", async () => {
    const id = randomUUID();
    await expect(deleteTeamEvent(id)).rejects.toThrow("Teamevent nicht gefunden.");
    expect(await auditFor("teamevent", id)).toHaveLength(0);
  });

  it("lehnt Mitarbeitende ab", async () => {
    const { id } = await insertEvent();
    await expectAdminOnly(() => deleteTeamEvent(id));
    await onlyEvent();
  });
});

// ---------------------------------------------------------------------------
// Sales-Nachrichten
// ---------------------------------------------------------------------------

describe("createSalesNews", () => {
  it("legt die Sales-Nachricht an, rechnet in Cents um und auditiert", async () => {
    await createSalesNews(salesForm());

    const item = await onlySales();
    expect(item).toMatchObject({
      customerName: "Muster AG",
      volumeCents: 1_250_050,
      soldById: seed.employee.id,
      deliveryStart: "2026-09-01",
      deliveryEnd: "2026-09-30",
      active: true,
      createdById: seed.admin.id,
    });
    expect((await auditFor("sales_nachricht", item.id))[0]).toMatchObject({
      action: "erstellt",
      actorUserId: seed.admin.id,
      source: "web",
      details: {
        customerName: "Muster AG",
        volumeCents: 1_250_050,
        soldBy: "Max Mitarbeiter",
      },
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/inhalte");
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("akzeptiert einen Punkt als Dezimaltrenner und ein leeres Leistungsende", async () => {
    await createSalesNews(salesForm({ volume: "999.99", deliveryEnd: "" }));
    expect(await onlySales()).toMatchObject({
      volumeCents: 99_999,
      deliveryStart: "2026-09-01",
      deliveryEnd: "2026-09-01",
    });
  });

  it("meldet eine unbekannte ursächliche Person", async () => {
    await expect(createSalesNews(salesForm({ soldById: randomUUID() }))).rejects.toThrow(
      "Mitarbeiter/in nicht gefunden."
    );
    await expect(createSalesNews(salesForm({ soldById: "" }))).rejects.toThrow(
      "Ursächliche/r Mitarbeiter/in ist erforderlich."
    );
    expect(await testDb().select().from(schema.salesNews)).toHaveLength(0);
  });

  it("lehnt ungültige Volumina ab", async () => {
    await expect(createSalesNews(salesForm({ volume: "" }))).rejects.toThrow(
      "Volumen ist erforderlich."
    );
    await expect(createSalesNews(salesForm({ volume: "0" }))).rejects.toThrow(
      "Ungültiges Volumen."
    );
    await expect(createSalesNews(salesForm({ volume: "-5" }))).rejects.toThrow(
      "Ungültiges Volumen."
    );
    await expect(createSalesNews(salesForm({ volume: "1.250,00" }))).rejects.toThrow(
      "Ungültiges Volumen."
    );
    await expect(
      createSalesNews(salesForm({ volume: "20000000,01" }))
    ).rejects.toThrow("Volumen ist zu groß (max. 20 Mio. €).");
    expect(await testDb().select().from(schema.salesNews)).toHaveLength(0);
  });

  it("nimmt genau 20 Mio. € noch an", async () => {
    await createSalesNews(salesForm({ volume: "20000000" }));
    expect((await onlySales()).volumeCents).toBe(2_000_000_000);
  });

  it("verlangt Kundenname und einen stimmigen Leistungszeitraum", async () => {
    await expect(createSalesNews(salesForm({ customerName: " " }))).rejects.toThrow(
      "Kundenname ist erforderlich."
    );
    await expect(
      createSalesNews(salesForm({ deliveryEnd: "2026-08-31" }))
    ).rejects.toThrow("Das Leistungsende darf nicht vor dem Beginn liegen.");
    await expect(createSalesNews(salesForm({ deliveryStart: "" }))).rejects.toThrow(
      "Leistungsbeginn ist erforderlich."
    );
  });

  it("lehnt Mitarbeitende ab", async () => {
    await expectAdminOnly(() => createSalesNews(salesForm()));
    expect(await testDb().select().from(schema.salesNews)).toHaveLength(0);
  });
});

describe("updateSalesNews", () => {
  it("bearbeitet die Sales-Nachricht inkl. neuer ursächlicher Person und auditiert", async () => {
    const { id } = await insertSales();
    const seller = await createUser({ firstName: "Sina", lastName: "Sales" });

    await updateSalesNews(salesForm({ id, soldById: seller.id, volume: "5000" }));

    expect(await onlySales()).toMatchObject({
      id,
      customerName: "Muster AG",
      volumeCents: 500_000,
      soldById: seller.id,
      deliveryStart: "2026-09-01",
      deliveryEnd: "2026-09-30",
      createdById: seed.admin.id,
    });
    expect((await auditFor("sales_nachricht", id))[0]).toMatchObject({
      action: "aktualisiert",
      details: { customerName: "Muster AG", volumeCents: 500_000, soldBy: "Sina Sales" },
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("meldet eine unbekannte Person und lässt die Nachricht unverändert", async () => {
    const { id } = await insertSales();
    await expect(
      updateSalesNews(salesForm({ id, soldById: randomUUID() }))
    ).rejects.toThrow("Mitarbeiter/in nicht gefunden.");
    expect(await onlySales()).toMatchObject({
      customerName: "Alt GmbH",
      soldById: seed.employee.id,
    });
    expect(await auditFor("sales_nachricht", id)).toHaveLength(0);
  });

  it("prüft das Volumen", async () => {
    const { id } = await insertSales();
    await expect(updateSalesNews(salesForm({ id, volume: "abc" }))).rejects.toThrow(
      "Ungültiges Volumen."
    );
    expect((await onlySales()).volumeCents).toBe(100_00);
  });

  it("verlangt eine ID", async () => {
    await expect(updateSalesNews(salesForm())).rejects.toThrow("ID ist erforderlich.");
  });

  it("lehnt eine unbekannte ID ab und auditiert nichts", async () => {
    const id = randomUUID();
    await expect(updateSalesNews(salesForm({ id }))).rejects.toThrow(
      "Sales-Nachricht nicht gefunden."
    );
    expect(await testDb().select().from(schema.salesNews)).toHaveLength(0);
    expect(await auditFor("sales_nachricht", id)).toHaveLength(0);
  });

  it("lehnt Mitarbeitende ab", async () => {
    const { id } = await insertSales();
    await expectAdminOnly(() => updateSalesNews(salesForm({ id })));
    expect((await onlySales()).customerName).toBe("Alt GmbH");
  });
});

describe("toggleSalesNews", () => {
  it("blendet die Sales-Nachricht aus und wieder ein", async () => {
    const { id } = await insertSales();

    await toggleSalesNews(id);
    expect((await onlySales()).active).toBe(false);
    expect((await auditFor("sales_nachricht", id))[0].action).toBe("deaktiviert");

    await toggleSalesNews(id);
    expect((await onlySales()).active).toBe(true);
    expect(
      (await auditFor("sales_nachricht", id)).map((a) => a.action).sort()
    ).toEqual(["aktiviert", "deaktiviert"]);
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("meldet unbekannte Sales-Nachrichten", async () => {
    await expect(toggleSalesNews(randomUUID())).rejects.toThrow(
      "Sales-Nachricht nicht gefunden."
    );
  });

  it("lehnt Mitarbeitende ab", async () => {
    const { id } = await insertSales();
    await expectAdminOnly(() => toggleSalesNews(id));
    expect((await onlySales()).active).toBe(true);
  });
});

describe("deleteSalesNews", () => {
  it("löscht die Sales-Nachricht samt persönlicher Ausblendungen und auditiert", async () => {
    const { id } = await insertSales();
    await testDb()
      .insert(schema.salesNewsDismissals)
      .values({ salesNewsId: id, userId: seed.employee.id });

    await deleteSalesNews(id);

    expect(await testDb().select().from(schema.salesNews)).toHaveLength(0);
    expect(await testDb().select().from(schema.salesNewsDismissals)).toHaveLength(0);
    expect((await auditFor("sales_nachricht", id))[0]).toMatchObject({
      action: "geloescht",
      actorUserId: seed.admin.id,
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("lehnt eine unbekannte ID ab und auditiert nichts", async () => {
    const id = randomUUID();
    await expect(deleteSalesNews(id)).rejects.toThrow("Sales-Nachricht nicht gefunden.");
    expect(await auditFor("sales_nachricht", id)).toHaveLength(0);
  });

  it("lehnt Mitarbeitende ab", async () => {
    const { id } = await insertSales();
    await expectAdminOnly(() => deleteSalesNews(id));
    expect((await onlySales()).id).toBe(id);
  });
});
