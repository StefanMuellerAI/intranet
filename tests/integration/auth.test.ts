import { eq, notInArray } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  getActiveDeputy,
  getCurrentUser,
  isApprover,
  requireAdmin,
  requireApprover,
  requireUser,
  resolveAccess,
} from "@/lib/auth";
import { toISODate } from "@/lib/dates";
import * as schema from "../../src/db/schema";
import { actAs, createUser, makeDeputy } from "../helpers/actions";
import { resetDb, seedTestData, testDb, type SeedResult } from "../helpers/db";
import { clerkServerModule, session } from "../helpers/framework-fakes";

let seed: SeedResult;

const NOT_SIGNED_IN =
  "Nicht angemeldet, Konto deaktiviert oder Eintrittsdatum noch nicht erreicht.";

function dayOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

const TODAY = toISODate(new Date());
const YESTERDAY = dayOffset(-1);
const TOMORROW = dayOffset(1);

/** Clerk-Session eines noch nicht verknüpften Clerk-Accounts simulieren. */
function signInWithClerk(
  email: string,
  verification: string | null = "verified",
  clerkId = "user_clerk_neu"
) {
  session.clerkId = clerkId;
  session.clerkUser = {
    primaryEmailAddress: {
      emailAddress: email,
      verification: verification ? { status: verification } : null,
    },
  };
}

async function loadUser(id: string) {
  const row = await testDb().query.users.findFirst({ where: eq(schema.users.id, id) });
  if (!row) throw new Error("User fehlt");
  return row;
}

beforeAll(async () => {
  await resetDb();
  seed = await seedTestData();
});

beforeEach(async () => {
  const db = testDb();
  await db.delete(schema.deputyAssignments);
  await db
    .delete(schema.users)
    .where(notInArray(schema.users.id, [seed.admin.id, seed.employee.id]));
});

describe("resolveAccess", () => {
  it("liefert ohne Session „kein_konto“", async () => {
    await actAs(null);
    expect(await resolveAccess()).toEqual({ user: null, reason: "kein_konto" });
    expect(clerkServerModule.currentUser).not.toHaveBeenCalled();
  });

  it("liefert den verknüpften aktiven User, ohne Clerk-Profil nachzuladen", async () => {
    await actAs(seed.employee);
    const access = await resolveAccess();
    expect(access.user?.id).toBe(seed.employee.id);
    expect(clerkServerModule.currentUser).not.toHaveBeenCalled();
  });

  it("gewährt Zugang am Eintrittstag selbst", async () => {
    const user = await createUser({ entryDate: TODAY });
    await actAs(user);
    expect((await resolveAccess()).user?.id).toBe(user.id);
  });

  it("sperrt deaktivierte Konten", async () => {
    const user = await createUser({ status: "deaktiviert" });
    await actAs(user);
    expect(await resolveAccess()).toEqual({ user: null, reason: "deaktiviert" });
  });

  it("sperrt vor dem Eintrittsdatum und nennt es", async () => {
    const user = await createUser({ entryDate: TOMORROW });
    await actAs(user);
    expect(await resolveAccess()).toEqual({
      user: null,
      reason: "vor_eintritt",
      entryDate: TOMORROW,
    });
  });

  it("meldet bei deaktiviertem Konto vor Eintritt „deaktiviert“", async () => {
    const user = await createUser({ status: "deaktiviert", entryDate: TOMORROW });
    await actAs(user);
    expect((await resolveAccess()) as { reason?: string }).toMatchObject({
      reason: "deaktiviert",
    });
  });

  it("verknüpft beim ersten Login den eingeladenen User über die verifizierte E-Mail", async () => {
    const invited = await createUser({ status: "eingeladen", entryDate: YESTERDAY });
    signInWithClerk(invited.email.toUpperCase(), "verified", "user_clerk_erstlogin");

    const access = await resolveAccess();

    expect(access.user).toMatchObject({
      id: invited.id,
      clerkId: "user_clerk_erstlogin",
      status: "aktiv",
    });
    expect(await loadUser(invited.id)).toMatchObject({
      clerkId: "user_clerk_erstlogin",
      status: "aktiv",
    });

    // Danach greift der direkte Weg über die Clerk-ID
    session.clerkUser = null;
    expect((await resolveAccess()).user?.id).toBe(invited.id);
  });

  it.each([
    ["unverifiziert", "unverified"],
    ["Verifizierung fehlt", null],
  ])("verknüpft nicht bei unbestätigter E-Mail (%s)", async (_label, verification) => {
    const invited = await createUser({ status: "eingeladen" });
    signInWithClerk(invited.email, verification);

    expect(await resolveAccess()).toEqual({ user: null, reason: "kein_konto" });
    expect(await loadUser(invited.id)).toMatchObject({ clerkId: null, status: "eingeladen" });
  });

  it("verknüpft keine Adressen fremder Domains", async () => {
    const outsider = await createUser({ status: "eingeladen", email: "max@example.com" });
    signInWithClerk("max@example.com");

    expect(await resolveAccess()).toEqual({ user: null, reason: "kein_konto" });
    expect((await loadUser(outsider.id)).clerkId).toBeNull();
  });

  it("liefert „kein_konto“ ohne Einladung", async () => {
    signInWithClerk("nicht.eingeladen@stefanai.de");
    expect(await resolveAccess()).toEqual({ user: null, reason: "kein_konto" });
  });

  it("liefert „kein_konto“, wenn Clerk kein Profil liefert", async () => {
    session.clerkId = "user_clerk_ohne_profil";
    session.clerkUser = null;
    expect(await resolveAccess()).toEqual({ user: null, reason: "kein_konto" });
  });

  it("verknüpft vor dem Eintrittsdatum nicht — der Status bleibt „eingeladen“", async () => {
    const invited = await createUser({ status: "eingeladen", entryDate: TOMORROW });
    signInWithClerk(invited.email);

    expect(await resolveAccess()).toEqual({
      user: null,
      reason: "vor_eintritt",
      entryDate: TOMORROW,
    });
    expect(await loadUser(invited.id)).toMatchObject({ clerkId: null, status: "eingeladen" });
  });

  it("verknüpft kein deaktiviertes Konto", async () => {
    const offboarded = await createUser({ status: "deaktiviert" });
    signInWithClerk(offboarded.email);

    expect(await resolveAccess()).toEqual({ user: null, reason: "deaktiviert" });
    expect((await loadUser(offboarded.id)).clerkId).toBeNull();
  });

  it("verknüpft einen bereits verknüpften User bei verifizierter Adresse neu (aktuelles Verhalten)", async () => {
    const user = await createUser({ clerkId: "user_clerk_alt" });
    signInWithClerk(user.email, "verified", "user_clerk_neu_angelegt");

    expect((await resolveAccess()).user?.id).toBe(user.id);
    expect((await loadUser(user.id)).clerkId).toBe("user_clerk_neu_angelegt");
  });
});

describe("getCurrentUser", () => {
  it("liefert den User oder null", async () => {
    await actAs(seed.employee);
    expect((await getCurrentUser())?.id).toBe(seed.employee.id);
    await actAs(null);
    expect(await getCurrentUser()).toBeNull();
  });
});

describe("requireUser", () => {
  it("liefert den angemeldeten User", async () => {
    await actAs(seed.employee);
    expect((await requireUser()).id).toBe(seed.employee.id);
  });

  it("lehnt ohne Session, deaktiviert und vor Eintritt mit derselben Meldung ab", async () => {
    await actAs(null);
    await expect(requireUser()).rejects.toThrow(NOT_SIGNED_IN);

    await actAs(await createUser({ status: "deaktiviert" }));
    await expect(requireUser()).rejects.toThrow(NOT_SIGNED_IN);

    await actAs(await createUser({ entryDate: TOMORROW }));
    await expect(requireUser()).rejects.toThrow(NOT_SIGNED_IN);
  });
});

describe("requireAdmin", () => {
  it("liefert den Admin", async () => {
    await actAs(seed.admin);
    expect((await requireAdmin()).id).toBe(seed.admin.id);
  });

  it("lehnt Mitarbeitende ab — auch die aktive Vertretung", async () => {
    await makeDeputy(seed.employee);
    await actAs(seed.employee);
    await expect(requireAdmin()).rejects.toThrow("Nur für den Admin zulässig.");
  });

  it("lehnt ohne Session mit der Anmelde-Meldung ab", async () => {
    await actAs(null);
    await expect(requireAdmin()).rejects.toThrow(NOT_SIGNED_IN);
  });

  it("lehnt einen deaktivierten Admin ab", async () => {
    const formerAdmin = await createUser({ role: "admin", status: "deaktiviert" });
    await actAs(formerAdmin);
    await expect(requireAdmin()).rejects.toThrow(NOT_SIGNED_IN);
  });
});

describe("getActiveDeputy", () => {
  it("liefert null ohne Vertretung", async () => {
    expect(await getActiveDeputy()).toBeNull();
  });

  it("liefert die aktive Vertretung ohne Zeitraum", async () => {
    await makeDeputy(seed.employee);
    expect((await getActiveDeputy())?.id).toBe(seed.employee.id);
  });

  it.each([
    ["mitten im Zeitraum", { startsOn: YESTERDAY, endsOn: TOMORROW }],
    ["am ersten Tag", { startsOn: TODAY, endsOn: TOMORROW }],
    ["am letzten Tag", { startsOn: YESTERDAY, endsOn: TODAY }],
    ["nur Beginn in der Vergangenheit", { startsOn: YESTERDAY }],
    ["nur Ende in der Zukunft", { endsOn: TOMORROW }],
  ])("liefert die Vertretung %s", async (_label, range) => {
    await makeDeputy(seed.employee, range);
    expect((await getActiveDeputy())?.id).toBe(seed.employee.id);
  });

  it.each([
    ["vor Beginn", { startsOn: TOMORROW }],
    ["nach Ende", { endsOn: YESTERDAY }],
    ["Ende vor Beginn", { startsOn: TOMORROW, endsOn: YESTERDAY }],
  ])("liefert null %s", async (_label, range) => {
    await makeDeputy(seed.employee, range);
    expect(await getActiveDeputy()).toBeNull();
  });

  it("ignoriert beendete (inaktive) Vertretungen", async () => {
    await testDb()
      .insert(schema.deputyAssignments)
      .values({ userId: seed.employee.id, active: false });
    expect(await getActiveDeputy()).toBeNull();
  });

  it("liefert null, wenn die Vertretung inzwischen deaktiviert ist", async () => {
    const deputy = await createUser({ status: "deaktiviert" });
    await makeDeputy(deputy);
    expect(await getActiveDeputy()).toBeNull();
  });

  it("liefert null, wenn die Vertretung noch eingeladen ist", async () => {
    const deputy = await createUser({ status: "eingeladen" });
    await makeDeputy(deputy);
    expect(await getActiveDeputy()).toBeNull();
  });
});

describe("isApprover", () => {
  it("Admin ist immer freigabeberechtigt", async () => {
    expect(await isApprover(seed.admin)).toBe(true);
  });

  it("Mitarbeitende ohne Vertretung sind es nicht", async () => {
    expect(await isApprover(seed.employee)).toBe(false);
  });

  it("die aktive Vertretung ist freigabeberechtigt, andere Mitarbeitende nicht", async () => {
    const colleague = await createUser();
    await makeDeputy(seed.employee);
    expect(await isApprover(seed.employee)).toBe(true);
    expect(await isApprover(colleague)).toBe(false);
  });

  it("eine abgelaufene Vertretung ist nicht mehr freigabeberechtigt", async () => {
    await makeDeputy(seed.employee, { endsOn: YESTERDAY });
    expect(await isApprover(seed.employee)).toBe(false);
  });
});

describe("requireApprover", () => {
  it("liefert den Admin", async () => {
    await actAs(seed.admin);
    expect((await requireApprover()).id).toBe(seed.admin.id);
  });

  it("liefert die aktive Vertretung", async () => {
    await makeDeputy(seed.employee);
    await actAs(seed.employee);
    expect((await requireApprover()).id).toBe(seed.employee.id);
  });

  it("lehnt Mitarbeitende ohne Vertretung ab", async () => {
    await actAs(seed.employee);
    await expect(requireApprover()).rejects.toThrow("Keine Berechtigung für Freigaben.");
  });

  it("lehnt ohne Session mit der Anmelde-Meldung ab", async () => {
    await actAs(null);
    await expect(requireApprover()).rejects.toThrow(NOT_SIGNED_IN);
  });
});
