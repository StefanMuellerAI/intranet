import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  closeSickLeave,
  correctSickLeave,
  submitSickLeave,
} from "@/app/(app)/krankmeldung/actions";
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

const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

async function reportAsEmployee(values: Record<string, string> = { startDate: "2026-10-05" }) {
  await actAs(seed.employee);
  const url = await expectRedirect(
    submitSickLeave(formData(values)),
    /^\/krankmeldung\/[0-9a-f-]+$/
  );
  return idFromUrl(url);
}

async function load(id: string) {
  const row = await testDb().query.sickLeaves.findFirst({
    where: eq(schema.sickLeaves.id, id),
  });
  if (!row) throw new Error("Krankmeldung fehlt");
  return row;
}

async function countLeaves() {
  return (await testDb().select().from(schema.sickLeaves)).length;
}

beforeAll(async () => {
  await resetDb();
  seed = await seedTestData();
});

beforeEach(async () => {
  const db = testDb();
  await db.delete(schema.sickLeaves);
  await db.delete(schema.deputyAssignments);
  await db.delete(schema.auditLog);
});

describe("submitSickLeave", () => {
  it("meldet eine Erkrankung mit voraussichtlichem Ende, auditiert und informiert nur den Admin", async () => {
    const deputy = await createUser({ firstName: "Vera", lastName: "Vertretung" });
    await makeDeputy(deputy);

    const id = await reportAsEmployee({
      startDate: "2026-10-05",
      endDate: "2026-10-07",
      note: "Rückfragen bitte per Mail",
    });

    expect(await load(id)).toMatchObject({
      userId: seed.employee.id,
      status: "gemeldet",
      type: "eigene_erkrankung",
      startDate: "2026-10-05",
      endDate: "2026-10-07",
      note: "Rückfragen bitte per Mail",
    });
    expect((await auditFor("krankmeldung", id))[0]).toMatchObject({
      action: "gemeldet",
      actorUserId: seed.employee.id,
      source: "web",
    });
    // Krankmeldungen gehen ausschließlich an den Admin, nicht an die Vertretung
    expect(mailbox).toHaveLength(1);
    expect(mailsTo(seed.admin.email)).toHaveLength(1);
    expect(mailsTo(deputy.email)).toHaveLength(0);
    expect(mailbox[0]).toMatchObject({
      subject: "Krankmeldung eingegangen: Max Mitarbeiter",
      heading: "Neue Krankmeldung",
      linkPath: `/krankmeldung/${id}`,
    });
    expect(mailbox[0].paragraphs.join(" ")).toBe(
      "eigene Erkrankung, ab 05.10.2026, voraussichtlich bis 07.10.2026. Der Nachweis läuft über das eAU-Verfahren."
    );
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/krankmeldung");
  });

  it("lässt das Ende offen, wenn kein Enddatum angegeben ist", async () => {
    const id = await reportAsEmployee({ startDate: "2026-10-05", endDate: "" });
    expect(await load(id)).toMatchObject({ endDate: null, note: null, status: "gemeldet" });
    expect(mailbox[0].paragraphs.join(" ")).toContain("ab 05.10.2026, Ende offen.");
  });

  it("meldet „Kind krank“ als eigene Art", async () => {
    const id = await reportAsEmployee({ startDate: "2026-10-05", type: "kind_krank" });
    expect((await load(id)).type).toBe("kind_krank");
    expect(mailbox[0].paragraphs[0]).toMatch(/^Kind krank, ab 05\.10\.2026/);
  });

  it("informiert keine deaktivierten Admins", async () => {
    const formerAdmin = await createUser({ role: "admin", status: "deaktiviert" });
    await reportAsEmployee();
    expect(mailsTo(formerAdmin.email)).toHaveLength(0);
    expect(mailsTo(seed.admin.email)).toHaveLength(1);
  });

  it("lehnt ein Enddatum vor dem ersten Tag ab", async () => {
    await actAs(seed.employee);
    await expect(
      submitSickLeave(formData({ startDate: "2026-10-05", endDate: "2026-10-04" }))
    ).rejects.toThrow("Das Enddatum darf nicht vor dem ersten Tag liegen.");
    expect(await countLeaves()).toBe(0);
    expect(mailbox).toHaveLength(0);
  });

  it("verlangt den ersten Tag der Arbeitsunfähigkeit", async () => {
    await actAs(seed.employee);
    await expect(submitSickLeave(formData({ startDate: "" }))).rejects.toThrow(
      "Bitte ersten Tag der Arbeitsunfähigkeit angeben."
    );
    expect(await countLeaves()).toBe(0);
  });

  it("lehnt eine unbekannte Art ab", async () => {
    await actAs(seed.employee);
    await expect(
      submitSickLeave(formData({ startDate: "2026-10-05", type: "urlaub" }))
    ).rejects.toThrow();
    expect(await countLeaves()).toBe(0);
  });

  it("verlangt eine Anmeldung", async () => {
    await actAs(null);
    await expect(
      submitSickLeave(formData({ startDate: "2026-10-05" }))
    ).rejects.toThrow("Nicht angemeldet");
  });
});

describe("closeSickLeave", () => {
  it("trägt das tatsächliche Ende nach, schließt ab, auditiert und informiert den Admin", async () => {
    const id = await reportAsEmployee();
    mailbox.length = 0;

    await closeSickLeave(id, formData({ endDate: "2026-10-09" }));

    expect(await load(id)).toMatchObject({
      status: "abgeschlossen",
      endDate: "2026-10-09",
    });
    expect((await auditFor("krankmeldung", id))[0]).toMatchObject({
      action: "abgeschlossen",
      actorUserId: seed.employee.id,
      source: "web",
    });
    expect(mailbox).toHaveLength(1);
    expect(mailsTo(seed.admin.email)[0]).toMatchObject({
      subject: "Krankmeldung abgeschlossen: Max Mitarbeiter",
      heading: "Enddatum einer Krankmeldung nachgetragen",
      paragraphs: [
        "Abwesenheit von 05.10.2026 bis 09.10.2026 wurde abgeschlossen.",
      ],
      linkPath: `/krankmeldung/${id}`,
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith(`/krankmeldung/${id}`);
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/krankmeldung");
  });

  it("lässt den ersten Tag als Enddatum zu", async () => {
    const id = await reportAsEmployee();
    await closeSickLeave(id, formData({ endDate: "2026-10-05" }));
    expect((await load(id)).status).toBe("abgeschlossen");
  });

  it("lehnt eine bereits abgeschlossene Meldung ab und überschreibt das Ende nicht", async () => {
    const id = await reportAsEmployee();
    await closeSickLeave(id, formData({ endDate: "2026-10-09" }));
    mailbox.length = 0;

    await expect(
      closeSickLeave(id, formData({ endDate: "2026-10-20" }))
    ).rejects.toThrow("Die Krankmeldung ist bereits abgeschlossen.");
    expect((await load(id)).endDate).toBe("2026-10-09");
    expect(mailbox).toHaveLength(0);
  });

  it("lehnt ein Enddatum vor dem ersten Tag ab", async () => {
    const id = await reportAsEmployee();
    await expect(
      closeSickLeave(id, formData({ endDate: "2026-10-04" }))
    ).rejects.toThrow("Das Enddatum darf nicht vor dem ersten Tag liegen.");
    expect(await load(id)).toMatchObject({ status: "gemeldet", endDate: null });
  });

  it("verlangt ein Enddatum", async () => {
    const id = await reportAsEmployee();
    await expect(closeSickLeave(id, formData({ endDate: "" }))).rejects.toThrow(
      "Bitte das tatsächliche Enddatum angeben."
    );
    expect((await load(id)).status).toBe("gemeldet");
  });

  it("lässt fremde Meldungen nicht abschließen", async () => {
    const id = await reportAsEmployee();
    await actAs(await createUser());
    await expect(
      closeSickLeave(id, formData({ endDate: "2026-10-09" }))
    ).rejects.toThrow("Krankmeldung nicht gefunden.");
    expect((await load(id)).status).toBe("gemeldet");
  });

  it("lässt auch den Admin fremde Meldungen nicht abschließen (dafür gibt es die Korrektur)", async () => {
    const id = await reportAsEmployee();
    await actAs(seed.admin);
    await expect(
      closeSickLeave(id, formData({ endDate: "2026-10-09" }))
    ).rejects.toThrow("Krankmeldung nicht gefunden.");
    expect((await load(id)).status).toBe("gemeldet");
  });

  it("meldet unbekannte Krankmeldungen als nicht gefunden", async () => {
    await actAs(seed.employee);
    await expect(
      closeSickLeave(UNKNOWN_ID, formData({ endDate: "2026-10-09" }))
    ).rejects.toThrow("Krankmeldung nicht gefunden.");
  });
});

describe("correctSickLeave", () => {
  it("korrigiert als Admin alle Angaben und schließt bei Enddatum ab", async () => {
    const id = await reportAsEmployee({ startDate: "2026-10-05", note: "alt" });
    mailbox.length = 0;
    await actAs(seed.admin);

    await correctSickLeave(
      id,
      formData({
        startDate: "2026-10-06",
        endDate: "2026-10-08",
        type: "kind_krank",
        note: "korrigiert",
      })
    );

    expect(await load(id)).toMatchObject({
      startDate: "2026-10-06",
      endDate: "2026-10-08",
      type: "kind_krank",
      note: "korrigiert",
      status: "abgeschlossen",
    });
    expect((await auditFor("krankmeldung", id))[0]).toMatchObject({
      action: "durch_admin_korrigiert",
      actorUserId: seed.admin.id,
      source: "web",
    });
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith(`/krankmeldung/${id}`);
    expect(nextCacheModule.revalidatePath).toHaveBeenCalledWith("/krankmeldung");
    // Die Korrektur verschickt keine Mail
    expect(mailbox).toHaveLength(0);
  });

  it("öffnet eine abgeschlossene Meldung wieder, wenn das Enddatum entfernt wird", async () => {
    const id = await reportAsEmployee({ startDate: "2026-10-05", endDate: "2026-10-07" });
    await closeSickLeave(id, formData({ endDate: "2026-10-07" }));
    await actAs(seed.admin);

    await correctSickLeave(id, formData({ startDate: "2026-10-05", endDate: "" }));

    expect(await load(id)).toMatchObject({
      status: "gemeldet",
      endDate: null,
      note: null,
    });
  });

  it("behält die bisherige Art, wenn das Formular keine Art mitschickt", async () => {
    const id = await reportAsEmployee({ startDate: "2026-10-05", type: "kind_krank" });
    await actAs(seed.admin);
    await correctSickLeave(id, formData({ startDate: "2026-10-05" }));
    expect((await load(id)).type).toBe("kind_krank");
  });

  it("lehnt ein Enddatum vor dem ersten Tag ab", async () => {
    const id = await reportAsEmployee();
    await actAs(seed.admin);
    await expect(
      correctSickLeave(id, formData({ startDate: "2026-10-05", endDate: "2026-10-01" }))
    ).rejects.toThrow("Das Enddatum darf nicht vor dem ersten Tag liegen.");
    expect(await load(id)).toMatchObject({ status: "gemeldet", endDate: null });
    expect(
      (await auditFor("krankmeldung", id)).map((a) => a.action)
    ).not.toContain("durch_admin_korrigiert");
  });

  it("verlangt auch bei der Korrektur den ersten Tag", async () => {
    const id = await reportAsEmployee();
    await actAs(seed.admin);
    await expect(
      correctSickLeave(id, formData({ startDate: "" }))
    ).rejects.toThrow("Bitte ersten Tag der Arbeitsunfähigkeit angeben.");
  });

  it("verweigert die Korrektur durch Mitarbeitende — auch für die eigene Meldung", async () => {
    const id = await reportAsEmployee();
    await expect(
      correctSickLeave(id, formData({ startDate: "2026-10-01", endDate: "2026-10-02" }))
    ).rejects.toThrow("Nur für den Admin zulässig.");
    expect((await load(id)).startDate).toBe("2026-10-05");
  });

  it("verweigert die Korrektur durch eine aktive Vertretung", async () => {
    const id = await reportAsEmployee();
    const deputy = await createUser();
    await makeDeputy(deputy);
    await actAs(deputy);
    await expect(
      correctSickLeave(id, formData({ startDate: "2026-10-01" }))
    ).rejects.toThrow("Nur für den Admin zulässig.");
  });

  it("meldet unbekannte Krankmeldungen als nicht gefunden", async () => {
    await actAs(seed.admin);
    await expect(
      correctSickLeave(UNKNOWN_ID, formData({ startDate: "2026-10-05" }))
    ).rejects.toThrow("Krankmeldung nicht gefunden.");
  });
});
