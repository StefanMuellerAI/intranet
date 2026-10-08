import { asc, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  deleteExpenseReport,
  resubmitExpenseReport,
  submitExpenseReport,
  withdrawExpenseReport,
} from "@/app/(app)/reisekosten/actions";
import { decryptDocument } from "@/lib/document-crypto";
import type { ExpenseReportInput } from "@/lib/requests/expense";
import * as schema from "../../../src/db/schema";
import {
  actAs,
  auditFor,
  createUser,
  expectRedirect,
  formData,
  idFromUrl,
  testFile,
} from "../../helpers/actions";
import { resetDb, seedTestData, testDb, type SeedResult } from "../../helpers/db";
import {
  blobModule,
  blobStore,
  mailbox,
  mailsTo,
  nextCacheModule,
} from "../../helpers/framework-fakes";

let seed: SeedResult;

/** Zwei-Tages-Reise ohne Positionen — Basis für alle Varianten */
function payload(overrides: Partial<ExpenseReportInput> = {}): ExpenseReportInput {
  return {
    destination: "Berlin",
    customerPurpose: "Kundenworkshop Haufe",
    departureDate: "2026-07-01",
    departureTime: "07:30",
    returnDate: "2026-07-02",
    returnTime: "19:00",
    isAbroad: false,
    mealDays: [],
    transport: [],
    carKilometers: 0,
    carPassengers: 0,
    lodging: [],
    incidentals: [],
    ...overrides,
  };
}

/** FormData wie aus src/components/expense-form.tsx: JSON-Feld + receipt_<n> */
function expenseForm(
  data: ExpenseReportInput | Record<string, unknown>,
  files: File[] = []
): FormData {
  const values: Record<string, string | File> = { payload: JSON.stringify(data) };
  files.forEach((file, idx) => {
    values[`receipt_${idx}`] = file;
  });
  return formData(values);
}

async function submitAs(
  user: schema.User,
  data: ExpenseReportInput = payload(),
  files: File[] = []
): Promise<string> {
  await actAs(user);
  const url = await expectRedirect(
    submitExpenseReport(expenseForm(data, files)),
    /^\/reisekosten\/[0-9a-f-]+$/
  );
  return idFromUrl(url);
}

async function load(id: string) {
  const row = await testDb().query.expenseReports.findFirst({
    where: eq(schema.expenseReports.id, id),
  });
  if (!row) throw new Error("Abrechnung fehlt");
  return row;
}

async function itemsOf(id: string) {
  return testDb()
    .select()
    .from(schema.expenseItems)
    .where(eq(schema.expenseItems.reportId, id))
    .orderBy(asc(schema.expenseItems.position));
}

async function receiptsOf(id: string) {
  return testDb()
    .select()
    .from(schema.receipts)
    .where(eq(schema.receipts.reportId, id));
}

async function setStatus(id: string, status: schema.RequestStatus) {
  await testDb()
    .update(schema.expenseReports)
    .set({ status })
    .where(eq(schema.expenseReports.id, id));
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
  await db.delete(schema.deputyAssignments);
  await db
    .update(schema.settings)
    .set({ employerDailySupplementCents: 0 })
    .where(eq(schema.settings.id, 1));
  blobStore.clear();
});

describe("submitExpenseReport", () => {
  it("berechnet Verpflegung, Privat-Pkw und Positionen und speichert die Summen", async () => {
    const id = await submitAs(
      seed.employee,
      payload({
        departureDate: "2026-07-01",
        returnDate: "2026-07-03",
        mealDays: [
          // An-/Abreisetag: 14,00 €
          {
            date: "2026-07-01",
            absenceType: "an_abreisetag",
            breakfastProvided: false,
            lunchProvided: false,
            dinnerProvided: false,
          },
          // ganzer Tag mit Frühstück: 28,00 € − 5,60 € = 22,40 €
          {
            date: "2026-07-02",
            absenceType: "ganzer_tag",
            breakfastProvided: true,
            lunchProvided: false,
            dinnerProvided: false,
          },
          // Abreisetag mit Mittag + Abend: Kürzung 22,40 € gekappt auf 14,00 €
          {
            date: "2026-07-03",
            absenceType: "an_abreisetag",
            breakfastProvided: false,
            lunchProvided: true,
            dinnerProvided: true,
          },
        ],
        transport: [
          { date: "2026-07-01", description: "Bahn Köln–Berlin", amountCents: 4590 },
        ],
        lodging: [
          { date: "2026-07-01", description: "Hotel, 2 Nächte", amountCents: 18000 },
        ],
        incidentals: [
          { date: "2026-07-02", description: "Parken", amountCents: 1200 },
          { date: "2026-07-03", description: "Taxi", amountCents: 850 },
        ],
        // 100 km × 0,30 € + 100 km × 2 Personen × 0,02 € = 34,00 €
        carKilometers: 100,
        carPassengers: 2,
      })
    );

    const report = await load(id);
    expect(report).toMatchObject({
      userId: seed.employee.id,
      status: "eingereicht",
      version: 1,
      destination: "Berlin",
      mealAllowanceCents: 3640,
      transportCents: 4590,
      carCents: 3400,
      lodgingCents: 18000,
      incidentalsCents: 2050,
      employerSupplementCents: 0,
      totalCents: 3640 + 4590 + 3400 + 18000 + 2050,
    });
    expect(report.ratesSnapshot).toMatchObject({
      fullDayCents: 2800,
      partialDayCents: 1400,
      kmCents: 30,
      passengerKmCents: 2,
    });

    const items = await itemsOf(id);
    expect(items.map((i) => i.kind)).toEqual([
      "verpflegung",
      "verpflegung",
      "verpflegung",
      "fahrt",
      "uebernachtung",
      "nebenkosten",
      "nebenkosten",
      "pkw",
    ]);
    expect(items.map((i) => i.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(items[1]).toMatchObject({
      absenceType: "ganzer_tag",
      breakfastProvided: true,
      grossCents: 2800,
      reductionCents: 560,
      netCents: 2240,
    });
    expect(items[2]).toMatchObject({
      grossCents: 1400,
      reductionCents: 1400,
      netCents: 0,
    });
    expect(items[4]).toMatchObject({
      description: "Hotel, 2 Nächte",
      amountCents: 18000,
      netCents: 18000,
    });
    expect(items[7]).toMatchObject({
      description: "Privat-Pkw",
      kilometers: 100,
      passengers: 2,
      netCents: 3400,
    });

    expect((await auditFor("reisekosten", id))[0]).toMatchObject({
      action: "eingereicht",
      actorUserId: seed.employee.id,
      source: "web",
    });
    expect(mailsTo(seed.admin.email)).toHaveLength(1);
    expect(mailbox[0].linkPath).toBe(`/freigaben/reisekosten/${id}`);
    expect(mailbox[0].paragraphs.join(" ")).toContain("316,80");
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/reisekosten");
  });

  it("legt ohne Pkw-Kilometer keine Pkw-Position an", async () => {
    const id = await submitAs(seed.employee, payload({ carPassengers: 3 }));
    expect(await itemsOf(id)).toHaveLength(0);
    expect((await load(id)).carCents).toBe(0);
  });

  it("rechnet den freiwilligen Arbeitgeber-Zuschlag nur für Tage mit Pauschalen-Anspruch", async () => {
    await testDb()
      .update(schema.settings)
      .set({ employerDailySupplementCents: 500 })
      .where(eq(schema.settings.id, 1));

    const id = await submitAs(
      seed.employee,
      payload({
        mealDays: [
          {
            date: "2026-07-01",
            absenceType: "an_abreisetag",
            breakfastProvided: false,
            lunchProvided: false,
            dinnerProvided: false,
          },
          {
            date: "2026-07-02",
            absenceType: "unter_8_std",
            breakfastProvided: false,
            lunchProvided: false,
            dinnerProvided: false,
          },
        ],
      })
    );

    expect(await load(id)).toMatchObject({
      mealAllowanceCents: 1400,
      employerSupplementCents: 500,
      totalCents: 1900,
    });
  });

  it("legt Belege verschlüsselt im Blob-Store ab und ordnet sie der Position zu", async () => {
    const id = await submitAs(
      seed.employee,
      payload({
        transport: [
          { date: "2026-07-01", description: "Bahn", amountCents: 4590, fileIndex: 1 },
        ],
        lodging: [
          { date: "2026-07-01", description: "Hotel", amountCents: 9900, fileIndex: 0 },
        ],
      }),
      [
        testFile("hotel.pdf", "%PDF-1.4 HOTEL-KLARTEXT"),
        testFile("bahn.png", "PNG-BAHN-KLARTEXT", "image/png"),
      ]
    );

    const items = await itemsOf(id);
    const fahrt = items.find((i) => i.kind === "fahrt")!;
    const hotel = items.find((i) => i.kind === "uebernachtung")!;
    const rows = await receiptsOf(id);
    expect(rows).toHaveLength(2);

    const hotelReceipt = rows.find((r) => r.filename === "hotel.pdf")!;
    expect(hotelReceipt).toMatchObject({
      userId: seed.employee.id,
      itemId: hotel.id,
      contentType: "application/pdf",
      sizeBytes: Buffer.byteLength("%PDF-1.4 HOTEL-KLARTEXT"),
    });
    const bahnReceipt = rows.find((r) => r.filename === "bahn.png")!;
    expect(bahnReceipt).toMatchObject({ itemId: fahrt.id, contentType: "image/png" });

    // Im Blob-Store liegt nur Ciphertext, entschlüsselbar zum Original
    const blob = blobStore.get(hotelReceipt.blobUrl)!;
    expect(blob.pathname).toMatch(new RegExp(`^belege/${id}/[0-9a-f-]+\\.bin$`));
    expect(blob.contentType).toBe("application/octet-stream");
    expect(blob.body.toString("latin1")).not.toContain("HOTEL-KLARTEXT");
    expect(decryptDocument(blob.body).toString()).toBe("%PDF-1.4 HOTEL-KLARTEXT");
    expect(blobStore.size).toBe(2);
  });

  it("übergeht leere Dateien und nicht vorhandene Datei-Indizes", async () => {
    const id = await submitAs(
      seed.employee,
      payload({
        lodging: [
          { date: "2026-07-01", description: "Hotel", amountCents: 9900, fileIndex: 0 },
          { date: "2026-07-02", description: "Hotel 2", amountCents: 9900, fileIndex: 5 },
        ],
      }),
      [testFile("leer.pdf", "")]
    );
    expect(await receiptsOf(id)).toHaveLength(0);
    expect(blobStore.size).toBe(0);
    expect((await load(id)).lodgingCents).toBe(19800);
  });

  it("lehnt unzulässige Dateitypen für Belege ab", async () => {
    await actAs(seed.employee);
    await expect(
      submitExpenseReport(
        expenseForm(
          payload({
            incidentals: [
              { date: "2026-07-01", description: "Parken", amountCents: 500, fileIndex: 0 },
            ],
          }),
          [testFile("parken.exe", "MZ...", "application/x-msdownload")]
        )
      )
    ).rejects.toThrow('Beleg "parken.exe": Nur PDF, JPG oder PNG sind zulässig.');
    expect(blobStore.size).toBe(0);
  });

  it("kennt kein eigenes Größenlimit — die Grenze setzt bodySizeLimit bzw. der Vercel-Proxy", async () => {
    // Das 4-MB-Budget (MAX_RECEIPTS_TOTAL_BYTES) prüft nur das Formular im
    // Browser; die Action selbst nimmt auch größere Belege an.
    const big = Buffer.alloc(5 * 1024 * 1024, 0x41);
    const id = await submitAs(
      seed.employee,
      payload({
        lodging: [
          { date: "2026-07-01", description: "Hotel", amountCents: 9900, fileIndex: 0 },
        ],
      }),
      [testFile("gross.pdf", big)]
    );
    const [receipt] = await receiptsOf(id);
    expect(receipt.sizeBytes).toBe(big.length);
  });

  it("verlangt das Formularfeld payload", async () => {
    await actAs(seed.employee);
    await expect(submitExpenseReport(formData({}))).rejects.toThrow(
      "Ungültige Formulardaten."
    );
  });

  it("meldet ungültiges JSON als ungültige Formulardaten", async () => {
    await actAs(seed.employee);
    await expect(
      submitExpenseReport(formData({ payload: "{kein json" }))
    ).rejects.toThrow("Ungültige Formulardaten.");
    expect(await testDb().select().from(schema.expenseReports)).toHaveLength(0);
  });

  it("legt bei unzulässigem Belegtyp keine Abrechnung an", async () => {
    await actAs(seed.employee);
    await expect(
      submitExpenseReport(
        expenseForm(
          payload({
            lodging: [
              { date: "2026-07-01", description: "Hotel", amountCents: 9900, fileIndex: 0 },
            ],
            incidentals: [
              { date: "2026-07-01", description: "Parken", amountCents: 500, fileIndex: 1 },
            ],
          }),
          [testFile("hotel.pdf"), testFile("parken.exe", "MZ", "application/x-msdownload")]
        )
      )
    ).rejects.toThrow("Nur PDF, JPG oder PNG");
    expect(await testDb().select().from(schema.expenseReports)).toHaveLength(0);
    expect(await testDb().select().from(schema.receipts)).toHaveLength(0);
    expect(blobStore.size).toBe(0);
  });

  it("validiert Pflichtangaben mit deutschen Meldungen", async () => {
    await actAs(seed.employee);
    await expect(
      submitExpenseReport(expenseForm(payload({ destination: "" })))
    ).rejects.toThrow("Bitte Reiseziel angeben.");
    await expect(
      submitExpenseReport(expenseForm(payload({ customerPurpose: "" })))
    ).rejects.toThrow("Bitte Kunde / Anlass angeben.");
    await expect(
      submitExpenseReport(expenseForm(payload({ carKilometers: -5 })))
    ).rejects.toThrow();
    await expect(
      submitExpenseReport(
        expenseForm(
          payload({
            transport: [{ date: "2026-07-01", description: "Bahn", amountCents: 12.5 }],
          })
        )
      )
    ).rejects.toThrow();
    expect(await testDb().select().from(schema.expenseReports)).toHaveLength(0);
  });

  it("lehnt eine Rückkehr vor oder gleich der Abreise ab", async () => {
    await actAs(seed.employee);
    await expect(
      submitExpenseReport(
        expenseForm(
          payload({
            departureDate: "2026-07-02",
            departureTime: "08:00",
            returnDate: "2026-07-02",
            returnTime: "08:00",
          })
        )
      )
    ).rejects.toThrow("Die Rückkehr muss nach der Abreise liegen.");
    await expect(
      submitExpenseReport(
        expenseForm(payload({ departureDate: "2026-07-03", returnDate: "2026-07-02" }))
      )
    ).rejects.toThrow("Die Rückkehr muss nach der Abreise liegen.");
    expect(await testDb().select().from(schema.expenseReports)).toHaveLength(0);
  });

  it("verlangt eine Anmeldung", async () => {
    await actAs(null);
    await expect(submitExpenseReport(expenseForm(payload()))).rejects.toThrow(
      "Nicht angemeldet"
    );
  });

  it("sperrt deaktivierte Konten", async () => {
    await actAs(await createUser({ status: "deaktiviert" }));
    await expect(submitExpenseReport(expenseForm(payload()))).rejects.toThrow(
      "Nicht angemeldet"
    );
  });
});

describe("resubmitExpenseReport", () => {
  it("lässt eine beanstandete Abrechnung bei unzulässigem Belegtyp unverändert", async () => {
    const id = await submitAs(
      seed.employee,
      payload({
        transport: [{ date: "2026-07-01", description: "Bahn", amountCents: 4590 }],
      })
    );
    await setStatus(id, "beanstandet");
    await expect(
      resubmitExpenseReport(
        id,
        expenseForm(
          payload({
            destination: "Hamburg",
            lodging: [
              { date: "2026-07-01", description: "Hotel", amountCents: 999, fileIndex: 0 },
            ],
          }),
          [testFile("x.exe", "MZ", "application/x-msdownload")]
        )
      )
    ).rejects.toThrow("Nur PDF, JPG oder PNG");
    expect(await load(id)).toMatchObject({
      status: "beanstandet",
      version: 1,
      destination: "Berlin",
      totalCents: 4590,
    });
    expect(await testDb().select().from(schema.requestHistory)).toHaveLength(0);
  });

  it("korrigiert eine beanstandete Abrechnung, erhöht die Version und sichert die Historie", async () => {
    const id = await submitAs(
      seed.employee,
      payload({
        transport: [{ date: "2026-07-01", description: "Bahn", amountCents: 4590 }],
      })
    );
    await setStatus(id, "beanstandet");
    mailbox.length = 0;

    await expectRedirect(
      resubmitExpenseReport(
        id,
        expenseForm(
          payload({
            destination: "Hamburg",
            transport: [{ date: "2026-07-01", description: "Bahn", amountCents: 3990 }],
            carKilometers: 10,
          })
        )
      ),
      `/reisekosten/${id}`
    );

    expect(await load(id)).toMatchObject({
      status: "eingereicht",
      version: 2,
      destination: "Hamburg",
      transportCents: 3990,
      carCents: 300,
      totalCents: 4290,
    });
    // Positionen werden ersetzt, nicht ergänzt
    expect((await itemsOf(id)).map((i) => i.kind)).toEqual(["fahrt", "pkw"]);

    const history = await testDb().select().from(schema.requestHistory);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      requestType: "reisekosten",
      requestId: id,
      version: 1,
    });
    const snapshot = history[0].snapshot as {
      destination: string;
      items: { description: string; amountCents: number }[];
    };
    expect(snapshot.destination).toBe("Berlin");
    expect(snapshot.items).toEqual([
      expect.objectContaining({ description: "Bahn", amountCents: 4590 }),
    ]);

    expect((await auditFor("reisekosten", id))[0]).toMatchObject({
      action: "korrigiert_erneut_eingereicht",
      actorUserId: seed.employee.id,
    });
    expect(mailsTo(seed.admin.email)[0].subject).toContain(
      "korrigiert erneut eingereicht"
    );
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/reisekosten");
  });

  it("korrigiert auch eine zurückgezogene Abrechnung", async () => {
    const id = await submitAs(seed.employee);
    await setStatus(id, "zurueckgezogen");
    await expectRedirect(resubmitExpenseReport(id, expenseForm(payload())));
    expect(await load(id)).toMatchObject({ status: "eingereicht", version: 2 });
  });

  it("übernimmt eigene Belege per existingReceiptId an die neue Position", async () => {
    const id = await submitAs(
      seed.employee,
      payload({
        lodging: [
          { date: "2026-07-01", description: "Hotel", amountCents: 9900, fileIndex: 0 },
        ],
      }),
      [testFile("hotel.pdf")]
    );
    const [receipt] = await receiptsOf(id);
    await setStatus(id, "beanstandet");

    await expectRedirect(
      resubmitExpenseReport(
        id,
        expenseForm(
          payload({
            lodging: [
              {
                date: "2026-07-01",
                description: "Hotel (korrigiert)",
                amountCents: 8900,
                existingReceiptId: receipt.id,
              },
            ],
          })
        )
      )
    );

    const newHotel = (await itemsOf(id)).find((i) => i.kind === "uebernachtung")!;
    expect(newHotel.id).not.toBe(receipt.itemId);
    const [after] = await receiptsOf(id);
    expect(after).toMatchObject({
      id: receipt.id,
      itemId: newHotel.id,
      blobUrl: receipt.blobUrl,
    });
    expect(blobStore.has(receipt.blobUrl)).toBe(true);
  });

  it("behält nicht mehr referenzierte Belege ohne Positionszuordnung", async () => {
    const id = await submitAs(
      seed.employee,
      payload({
        lodging: [
          { date: "2026-07-01", description: "Hotel", amountCents: 9900, fileIndex: 0 },
        ],
      }),
      [testFile("hotel.pdf")]
    );
    await setStatus(id, "beanstandet");

    await expectRedirect(resubmitExpenseReport(id, expenseForm(payload())));

    const [after] = await receiptsOf(id);
    expect(after.itemId).toBeNull();
  });

  it("hängt fremde Belege nicht an die eigene Abrechnung", async () => {
    const colleague = await createUser();
    const foreignId = await submitAs(
      colleague,
      payload({
        lodging: [
          { date: "2026-07-01", description: "Hotel", amountCents: 9900, fileIndex: 0 },
        ],
      }),
      [testFile("fremd.pdf")]
    );
    const [foreignReceipt] = await receiptsOf(foreignId);

    const id = await submitAs(seed.employee);
    await setStatus(id, "beanstandet");
    await expectRedirect(
      resubmitExpenseReport(
        id,
        expenseForm(
          payload({
            lodging: [
              {
                date: "2026-07-01",
                description: "Hotel",
                amountCents: 9900,
                existingReceiptId: foreignReceipt.id,
              },
            ],
          })
        )
      )
    );

    expect(await receiptsOf(id)).toHaveLength(0);
    const [unchanged] = await receiptsOf(foreignId);
    expect(unchanged).toMatchObject({
      userId: colleague.id,
      reportId: foreignId,
      itemId: foreignReceipt.itemId,
    });
  });

  it("hängt eigene Belege aus einer anderen Abrechnung nicht um", async () => {
    const otherId = await submitAs(
      seed.employee,
      payload({
        lodging: [
          { date: "2026-07-01", description: "Hotel", amountCents: 9900, fileIndex: 0 },
        ],
      }),
      [testFile("andere.pdf")]
    );
    const [otherReceipt] = await receiptsOf(otherId);

    const id = await submitAs(seed.employee);
    await setStatus(id, "beanstandet");
    await expectRedirect(
      resubmitExpenseReport(
        id,
        expenseForm(
          payload({
            lodging: [
              {
                date: "2026-07-01",
                description: "Hotel",
                amountCents: 9900,
                existingReceiptId: otherReceipt.id,
              },
            ],
          })
        )
      )
    );

    const [unchanged] = await receiptsOf(otherId);
    expect(unchanged.itemId).toBe(otherReceipt.itemId);
  });

  it("lädt bei der Korrektur neue Belege verschlüsselt hoch", async () => {
    const id = await submitAs(seed.employee);
    await setStatus(id, "beanstandet");
    await actAs(seed.employee);
    await expectRedirect(
      resubmitExpenseReport(
        id,
        expenseForm(
          payload({
            incidentals: [
              { date: "2026-07-01", description: "Parken", amountCents: 700, fileIndex: 0 },
            ],
          }),
          [testFile("parken.jpg", "JPEG-PARKEN", "image/jpeg")]
        )
      )
    );
    const [receipt] = await receiptsOf(id);
    expect(receipt.contentType).toBe("image/jpeg");
    expect(decryptDocument(blobStore.get(receipt.blobUrl)!.body).toString()).toBe(
      "JPEG-PARKEN"
    );
  });

  it("lehnt die Korrektur einer eingereichten oder genehmigten Abrechnung ab", async () => {
    const id = await submitAs(seed.employee);
    await expect(resubmitExpenseReport(id, expenseForm(payload()))).rejects.toThrow(
      "Nur beanstandete oder zurückgezogene Abrechnungen können korrigiert werden."
    );
    await setStatus(id, "genehmigt");
    await expect(resubmitExpenseReport(id, expenseForm(payload()))).rejects.toThrow(
      "Nur beanstandete oder zurückgezogene"
    );
    expect(await testDb().select().from(schema.requestHistory)).toHaveLength(0);
  });

  it("lässt fremde Abrechnungen nicht korrigieren — auch nicht durch den Admin", async () => {
    const id = await submitAs(seed.employee);
    await setStatus(id, "beanstandet");
    await actAs(seed.admin);
    await expect(resubmitExpenseReport(id, expenseForm(payload()))).rejects.toThrow(
      "Abrechnung nicht gefunden."
    );
    expect((await load(id)).status).toBe("beanstandet");
  });

  it("meldet unbekannte Abrechnungen als nicht gefunden", async () => {
    await actAs(seed.employee);
    await expect(
      resubmitExpenseReport(crypto.randomUUID(), expenseForm(payload()))
    ).rejects.toThrow("Abrechnung nicht gefunden.");
  });

  it("validiert die Korrektur vor jeder Änderung", async () => {
    const id = await submitAs(seed.employee);
    await setStatus(id, "beanstandet");
    await expect(resubmitExpenseReport(id, formData({}))).rejects.toThrow(
      "Ungültige Formulardaten."
    );
    await expect(
      resubmitExpenseReport(
        id,
        expenseForm(payload({ departureDate: "2026-07-05", returnDate: "2026-07-02" }))
      )
    ).rejects.toThrow("Die Rückkehr muss nach der Abreise liegen.");
    expect(await load(id)).toMatchObject({ status: "beanstandet", version: 1 });
    expect(await testDb().select().from(schema.requestHistory)).toHaveLength(0);
  });
});

describe("withdrawExpenseReport", () => {
  it("zieht eine eingereichte Abrechnung zurück", async () => {
    const id = await submitAs(seed.employee);
    await withdrawExpenseReport(id);
    expect((await load(id)).status).toBe("zurueckgezogen");
    expect((await auditFor("reisekosten", id))[0]).toMatchObject({
      action: "zurueckgezogen",
      actorUserId: seed.employee.id,
      source: "web",
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith(`/reisekosten/${id}`);
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/reisekosten");
  });

  it("zieht eine beanstandete Abrechnung zurück", async () => {
    const id = await submitAs(seed.employee);
    await setStatus(id, "beanstandet");
    await withdrawExpenseReport(id);
    expect((await load(id)).status).toBe("zurueckgezogen");
  });

  it("lässt genehmigte oder bereits zurückgezogene Abrechnungen nicht zurückziehen", async () => {
    const id = await submitAs(seed.employee);
    for (const status of ["genehmigt", "zurueckgezogen"] as const) {
      await setStatus(id, status);
      await expect(withdrawExpenseReport(id)).rejects.toThrow(
        "Nur eingereichte oder beanstandete Abrechnungen können zurückgezogen werden."
      );
    }
  });

  it("lässt fremde Abrechnungen nicht zurückziehen", async () => {
    const id = await submitAs(seed.employee);
    await actAs(seed.admin);
    await expect(withdrawExpenseReport(id)).rejects.toThrow(
      "Abrechnung nicht gefunden."
    );
    expect((await load(id)).status).toBe("eingereicht");
  });

  it("verlangt eine Anmeldung", async () => {
    const id = await submitAs(seed.employee);
    await actAs(null);
    await expect(withdrawExpenseReport(id)).rejects.toThrow("Nicht angemeldet");
  });
});

describe("deleteExpenseReport", () => {
  it("löscht eine zurückgezogene Abrechnung samt Positionen, Belegen, Blobs und Historie", async () => {
    const id = await submitAs(
      seed.employee,
      payload({
        lodging: [
          { date: "2026-07-01", description: "Hotel", amountCents: 9900, fileIndex: 0 },
        ],
        incidentals: [
          { date: "2026-07-02", description: "Parken", amountCents: 700, fileIndex: 1 },
        ],
      }),
      [testFile("hotel.pdf"), testFile("parken.png", "PNG", "image/png")]
    );
    await setStatus(id, "beanstandet");
    await expectRedirect(resubmitExpenseReport(id, expenseForm(payload())));
    await withdrawExpenseReport(id);
    const report = await load(id);
    expect(blobStore.size).toBe(2);

    await expectRedirect(deleteExpenseReport(id), "/reisekosten");

    expect(
      await testDb().query.expenseReports.findFirst({
        where: eq(schema.expenseReports.id, id),
      })
    ).toBeUndefined();
    expect(await itemsOf(id)).toHaveLength(0);
    expect(await receiptsOf(id)).toHaveLength(0);
    expect(blobStore.size).toBe(0);
    expect(await testDb().select().from(schema.requestHistory)).toHaveLength(0);
    expect((await auditFor("reisekosten", id))[0]).toMatchObject({
      action: "geloescht",
      actorUserId: seed.employee.id,
      details: {
        destination: "Berlin",
        departureDate: "2026-07-01",
        returnDate: "2026-07-02",
        totalCents: report.totalCents,
      },
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/reisekosten");
  });

  it("ruft ohne Belege kein Blob-Löschen auf", async () => {
    const id = await submitAs(seed.employee);
    await setStatus(id, "zurueckgezogen");
    await expectRedirect(deleteExpenseReport(id), "/reisekosten");
    expect(blobModule.del).not.toHaveBeenCalled();
  });

  it("löscht nur zurückgezogene Abrechnungen", async () => {
    const id = await submitAs(seed.employee);
    for (const status of ["eingereicht", "beanstandet", "genehmigt"] as const) {
      await setStatus(id, status);
      await expect(deleteExpenseReport(id)).rejects.toThrow(
        "Nur zurückgezogene Abrechnungen können endgültig gelöscht werden."
      );
    }
    expect((await load(id)).id).toBe(id);
  });

  it("lässt fremde Abrechnungen nicht löschen", async () => {
    const id = await submitAs(seed.employee, payload(), []);
    await setStatus(id, "zurueckgezogen");
    await actAs(seed.admin);
    await expect(deleteExpenseReport(id)).rejects.toThrow("Abrechnung nicht gefunden.");
    expect((await load(id)).id).toBe(id);
  });

  it("meldet unbekannte Abrechnungen als nicht gefunden", async () => {
    await actAs(seed.employee);
    await expect(deleteExpenseReport(crypto.randomUUID())).rejects.toThrow(
      "Abrechnung nicht gefunden."
    );
  });
});
