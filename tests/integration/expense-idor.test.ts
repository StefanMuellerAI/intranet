import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createExpenseReport } from "@/lib/requests/expense";
import { expenseReports, receipts } from "../../src/db/schema";
import { resetDb, seedTestData, testDb, type SeedResult } from "../helpers/db";

let seed: SeedResult;

beforeAll(async () => {
  await resetDb();
  seed = await seedTestData();
});

describe("Reisekosten — Beleg-Zuordnung (IDOR)", () => {
  it("hängt einen fremden Beleg nicht an den eigenen Bericht um", async () => {
    const db = testDb();

    // Opfer (employee) hat einen Bericht mit hochgeladenem Beleg.
    const [victimReport] = await db
      .insert(expenseReports)
      .values({
        userId: seed.employee.id,
        destination: "Berlin",
        customerPurpose: "Workshop",
        departureDate: "2026-07-01",
        departureTime: "08:00",
        returnDate: "2026-07-02",
        returnTime: "18:00",
      })
      .returning();
    const [victimReceipt] = await db
      .insert(receipts)
      .values({
        reportId: victimReport.id,
        userId: seed.employee.id,
        filename: "hotel.pdf",
        contentType: "application/pdf",
        sizeBytes: 10,
        blobUrl: "http://localhost/blob/hotel.pdf",
      })
      .returning();

    // Angreifer (admin) reicht einen eigenen Bericht ein und referenziert
    // per untergeschobener existingReceiptId den fremden Beleg.
    const attackerReport = await createExpenseReport(
      seed.admin,
      {
        destination: "Angriff",
        customerPurpose: "Test",
        departureDate: "2026-07-01",
        departureTime: "08:00",
        returnDate: "2026-07-02",
        returnTime: "18:00",
        isAbroad: false,
        mealDays: [],
        transport: [
          {
            date: "2026-07-01",
            description: "Taxi",
            amountCents: 1000,
            existingReceiptId: victimReceipt.id,
          },
        ],
        carKilometers: 0,
        carPassengers: 0,
        lodging: [],
        incidentals: [],
      },
      "web",
      { getFile: () => null }
    );

    // Der fremde Beleg bleibt unverändert dem Opfer-Bericht zugeordnet.
    const [after] = await db
      .select()
      .from(receipts)
      .where(eq(receipts.id, victimReceipt.id));
    expect(after.userId).toBe(seed.employee.id);
    expect(after.reportId).toBe(victimReport.id);
    expect(after.reportId).not.toBe(attackerReport.id);
    expect(after.itemId).toBeNull();
  });
});
