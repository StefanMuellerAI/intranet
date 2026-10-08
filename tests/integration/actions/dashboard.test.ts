import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { dismissSalesNews } from "@/app/(app)/dashboard/actions";
import * as schema from "../../../src/db/schema";
import { actAs, auditFor, createUser } from "../../helpers/actions";
import { resetDb, seedTestData, testDb, type SeedResult } from "../../helpers/db";
import { nextCacheModule } from "../../helpers/framework-fakes";

let seed: SeedResult;

async function insertSales(customerName = "Muster AG") {
  const [row] = await testDb()
    .insert(schema.salesNews)
    .values({
      customerName,
      volumeCents: 1_000_000,
      soldById: seed.employee.id,
      deliveryStart: "2026-09-01",
      deliveryEnd: "2026-09-30",
      createdById: seed.admin.id,
    })
    .returning();
  return row;
}

async function dismissals() {
  return testDb().select().from(schema.salesNewsDismissals);
}

beforeAll(async () => {
  await resetDb();
  seed = await seedTestData();
});

beforeEach(async () => {
  const db = testDb();
  await db.delete(schema.salesNewsDismissals);
  await db.delete(schema.salesNews);
  await db.delete(schema.auditLog);
});

describe("dismissSalesNews", () => {
  it("blendet die Nachricht nur für die angemeldete Person aus", async () => {
    const item = await insertSales();
    const other = await insertSales("Andere KG");
    await actAs(seed.employee);

    await dismissSalesNews(item.id);

    const rows = await dismissals();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ salesNewsId: item.id, userId: seed.employee.id });
    // Die Nachricht selbst bleibt aktiv und für alle anderen sichtbar
    const news = await testDb().select().from(schema.salesNews);
    expect(news.every((n) => n.active)).toBe(true);
    expect(rows.some((r) => r.salesNewsId === other.id)).toBe(false);
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("schreibt bewusst keinen Audit-Eintrag", async () => {
    const item = await insertSales();
    await actAs(seed.employee);
    await dismissSalesNews(item.id);
    expect(await auditFor("sales_nachricht", item.id)).toHaveLength(0);
  });

  it("doppeltes Schließen ist unschädlich", async () => {
    const item = await insertSales();
    await actAs(seed.employee);

    await dismissSalesNews(item.id);
    await dismissSalesNews(item.id);

    expect(await dismissals()).toHaveLength(1);
  });

  it("jede Person schließt für sich", async () => {
    const item = await insertSales();
    const colleague = await createUser();

    await actAs(seed.employee);
    await dismissSalesNews(item.id);
    await actAs(colleague);
    await dismissSalesNews(item.id);
    await actAs(seed.admin);
    await dismissSalesNews(item.id);

    const userIds = (await dismissals()).map((d) => d.userId).sort();
    expect(userIds).toEqual([seed.employee.id, colleague.id, seed.admin.id].sort());
  });

  it("meldet unbekannte Sales-Nachrichten", async () => {
    await actAs(seed.employee);
    await expect(dismissSalesNews(randomUUID())).rejects.toThrow(
      "Sales-Nachricht nicht gefunden."
    );
    expect(await dismissals()).toHaveLength(0);
  });

  it("verlangt eine Anmeldung", async () => {
    const item = await insertSales();
    await actAs(null);
    await expect(dismissSalesNews(item.id)).rejects.toThrow("Nicht angemeldet");
    expect(await dismissals()).toHaveLength(0);
  });

  it("sperrt deaktivierte Konten", async () => {
    const item = await insertSales();
    await actAs(await createUser({ status: "deaktiviert" }));
    await expect(dismissSalesNews(item.id)).rejects.toThrow("Nicht angemeldet");
  });
});
