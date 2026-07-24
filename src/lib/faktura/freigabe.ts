import "server-only";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import {
  db,
  fakturaCustomers,
  fakturaProjects,
  fakturaTimeEntries,
  fakturaWeekApprovals,
  users,
  type FakturaTimeEntry,
  type FakturaWeekApproval,
  type User,
} from "@/db";
import { writeAudit } from "@/lib/audit";
import { fullName } from "@/lib/auth";
import { type FakturaSource } from "@/lib/faktura/stammdaten";
import { UserError } from "@/lib/faktura/user-error";
import { markTimesheetsStaleForRange } from "@/lib/faktura/stundenzettel";
import {
  addDaysISO,
  berlinTodayISO,
  currentNow,
  isWeekClosed,
  isoWeekOf,
  mondayOfIsoWeek,
} from "@/lib/faktura/zeitfenster";

// ---------------------------------------------------------------------------
// Freigabeübersicht (FA-5.1)
// ---------------------------------------------------------------------------

export interface OverviewEntry extends FakturaTimeEntry {
  userName: string;
}

export interface OverviewProject {
  projectId: string;
  projectName: string;
  monthlyLimitMinutes: number | null;
  totalMinutes: number;
  entries: OverviewEntry[];
}

export interface OverviewCustomer {
  customerId: string;
  customerName: string;
  totalMinutes: number;
  projects: OverviewProject[];
}

export interface WeekOverview {
  isoYear: number;
  isoWeek: number;
  mondayISO: string;
  fridayISO: string;
  /** Woche abgeschlossen (ab Samstag 00:00 Berlin) und damit freigebbar (E-6) */
  closed: boolean;
  approval: FakturaWeekApproval | null;
  /** Keine Buchungen — keine Freigabe erforderlich (FA-5.7) */
  empty: boolean;
  totalMinutes: number;
  overbookedCount: number;
  customers: OverviewCustomer[];
}

async function getWeekEntries(
  isoYear: number,
  isoWeek: number
): Promise<FakturaTimeEntry[]> {
  const monday = mondayOfIsoWeek(isoYear, isoWeek);
  const sunday = addDaysISO(monday, 6);
  return db
    .select()
    .from(fakturaTimeEntries)
    .where(
      and(
        eq(fakturaTimeEntries.deleted, false),
        gte(fakturaTimeEntries.entryDate, monday),
        lte(fakturaTimeEntries.entryDate, sunday)
      )
    )
    .orderBy(asc(fakturaTimeEntries.entryDate), asc(fakturaTimeEntries.createdAt));
}

export async function getWeekApproval(
  isoYear: number,
  isoWeek: number
): Promise<FakturaWeekApproval | null> {
  const approval = await db.query.fakturaWeekApprovals.findFirst({
    where: and(
      eq(fakturaWeekApprovals.isoYear, isoYear),
      eq(fakturaWeekApprovals.isoWeek, isoWeek)
    ),
  });
  return approval ?? null;
}

/**
 * Freigabeübersicht einer KW: alle Buchungen aller Mitarbeitenden, gruppiert
 * nach Kunde → Projekt → Mitarbeiter:in/Tag, inkl. Summen und Überbuchungen.
 * Namen kommen aus den gespeicherten Stammdaten — auch für in Clerk
 * deaktivierte Accounts (Edge Case 10).
 */
export async function getWeekOverview(
  isoYear: number,
  isoWeek: number
): Promise<WeekOverview> {
  const [entries, approval, allUsers, allProjects, allCustomers] =
    await Promise.all([
      getWeekEntries(isoYear, isoWeek),
      getWeekApproval(isoYear, isoWeek),
      db.select().from(users),
      db.select().from(fakturaProjects),
      db.select().from(fakturaCustomers),
    ]);

  const userName = (id: string) => {
    const u = allUsers.find((x) => x.id === id);
    return u ? fullName(u) : "Unbekannt";
  };

  const customers: OverviewCustomer[] = [];
  for (const entry of entries) {
    const project = allProjects.find((p) => p.id === entry.projectId);
    if (!project) continue;
    const customer = allCustomers.find((c) => c.id === project.customerId);
    if (!customer) continue;

    let customerGroup = customers.find((c) => c.customerId === customer.id);
    if (!customerGroup) {
      customerGroup = {
        customerId: customer.id,
        customerName: customer.name,
        totalMinutes: 0,
        projects: [],
      };
      customers.push(customerGroup);
    }
    let projectGroup = customerGroup.projects.find(
      (p) => p.projectId === project.id
    );
    if (!projectGroup) {
      projectGroup = {
        projectId: project.id,
        projectName: project.name,
        monthlyLimitMinutes: project.monthlyLimitMinutes,
        totalMinutes: 0,
        entries: [],
      };
      customerGroup.projects.push(projectGroup);
    }
    projectGroup.entries.push({ ...entry, userName: userName(entry.userId) });
    projectGroup.totalMinutes += entry.durationMinutes;
    customerGroup.totalMinutes += entry.durationMinutes;
  }
  customers.sort((a, b) => a.customerName.localeCompare(b.customerName, "de"));
  for (const c of customers)
    c.projects.sort((a, b) => a.projectName.localeCompare(b.projectName, "de"));

  const monday = mondayOfIsoWeek(isoYear, isoWeek);
  return {
    isoYear,
    isoWeek,
    mondayISO: monday,
    fridayISO: addDaysISO(monday, 4),
    closed: isWeekClosed(isoYear, isoWeek, currentNow()),
    approval,
    empty: entries.length === 0,
    totalMinutes: entries.reduce((s, e) => s + e.durationMinutes, 0),
    overbookedCount: entries.filter((e) => e.overbooked).length,
    customers,
  };
}

/** Kompakte Wochenliste für die Navigation der Freigabeübersicht. */
export interface WeekListItem {
  isoYear: number;
  isoWeek: number;
  mondayISO: string;
  fridayISO: string;
  closed: boolean;
  status: "offen" | "freigegeben" | "widerrufen" | "leer";
  entryCount: number;
  totalMinutes: number;
  overbookedCount: number;
}

export async function listRecentWeeks(count = 8): Promise<WeekListItem[]> {
  const todayISO = berlinTodayISO(currentNow());
  const items: WeekListItem[] = [];
  for (let i = 0; i < count; i++) {
    const week = isoWeekOf(addDaysISO(todayISO, -7 * i));
    const monday = mondayOfIsoWeek(week.isoYear, week.isoWeek);
    const sunday = addDaysISO(monday, 6);
    const [entries, approval] = await Promise.all([
      db
        .select({
          durationMinutes: fakturaTimeEntries.durationMinutes,
          overbooked: fakturaTimeEntries.overbooked,
        })
        .from(fakturaTimeEntries)
        .where(
          and(
            eq(fakturaTimeEntries.deleted, false),
            gte(fakturaTimeEntries.entryDate, monday),
            lte(fakturaTimeEntries.entryDate, sunday)
          )
        ),
      getWeekApproval(week.isoYear, week.isoWeek),
    ]);
    items.push({
      isoYear: week.isoYear,
      isoWeek: week.isoWeek,
      mondayISO: monday,
      fridayISO: addDaysISO(monday, 4),
      closed: isWeekClosed(week.isoYear, week.isoWeek, currentNow()),
      status:
        entries.length === 0
          ? "leer"
          : approval?.status === "freigegeben"
            ? "freigegeben"
            : approval?.status === "widerrufen"
              ? "widerrufen"
              : "offen",
      entryCount: entries.length,
      totalMinutes: entries.reduce((s, e) => s + e.durationMinutes, 0),
      overbookedCount: entries.filter((e) => e.overbooked).length,
    });
  }
  return items;
}

// ---------------------------------------------------------------------------
// Wochenfreigabe und Widerruf (FA-5.2, FA-5.4, FA-5.6)
// ---------------------------------------------------------------------------

/**
 * Freigabe einer abgeschlossenen KW: Zuerst wird die Freigabezeile gesetzt,
 * dann alle Buchungen der Woche per Bulk-Update auf `freigegeben` gestellt.
 * Kollidierende Mitarbeiter-Änderungen scheitern ab dem ersten Schritt an der
 * Statusprüfung im Schreib-Statement (transaktionale Wirkung, Edge Case 9).
 */
export async function approveWeek(
  admin: User,
  isoYear: number,
  isoWeek: number,
  source: FakturaSource = "web",
  apiKeyId?: string
): Promise<void> {
  if (!isWeekClosed(isoYear, isoWeek, currentNow()))
    throw new UserError(
      "Nur abgeschlossene Wochen können freigegeben werden (ab Samstag 00:00 Uhr)."
    );

  const existing = await getWeekApproval(isoYear, isoWeek);
  if (existing?.status === "freigegeben")
    throw new UserError("Diese Woche ist bereits freigegeben.");

  const entries = await getWeekEntries(isoYear, isoWeek);
  if (entries.length === 0)
    throw new UserError(
      "Diese Woche enthält keine Buchungen — eine Freigabe ist nicht erforderlich (FA-5.7)."
    );

  await db
    .insert(fakturaWeekApprovals)
    .values({
      isoYear,
      isoWeek,
      status: "freigegeben",
      approvedAt: new Date(),
      approvedById: admin.id,
    })
    .onConflictDoUpdate({
      target: [fakturaWeekApprovals.isoYear, fakturaWeekApprovals.isoWeek],
      set: {
        status: "freigegeben",
        approvedAt: new Date(),
        approvedById: admin.id,
        updatedAt: new Date(),
      },
    });

  await db
    .update(fakturaTimeEntries)
    .set({ status: "freigegeben", updatedAt: new Date() })
    .where(
      inArray(
        fakturaTimeEntries.id,
        entries.map((e) => e.id)
      )
    );

  await writeAudit({
    objectType: "faktura_freigabe",
    action: "woche_freigegeben",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source,
    apiKeyId,
    details: {
      isoYear,
      isoWeek,
      anzahlBuchungen: entries.length,
      summeMinuten: entries.reduce((s, e) => s + e.durationMinutes, 0),
      erneuteFreigabe: existing?.status === "widerrufen",
    },
  });
}

/**
 * Widerruf einer Freigabe mit Pflichtbegründung (FA-5.6). Buchungen der Woche
 * gehen zurück auf `offen`; bereits erzeugte Stundenzettel der betroffenen
 * Kunden werden als veraltet markiert (Edge Case 14).
 */
export async function revokeWeekApproval(
  admin: User,
  isoYear: number,
  isoWeek: number,
  reason: string,
  source: FakturaSource = "web"
): Promise<void> {
  if (!reason.trim())
    throw new UserError("Bitte eine Begründung für den Widerruf angeben.");

  const existing = await getWeekApproval(isoYear, isoWeek);
  if (!existing || existing.status !== "freigegeben")
    throw new UserError("Diese Woche ist nicht freigegeben.");

  await db
    .update(fakturaWeekApprovals)
    .set({
      status: "widerrufen",
      revokeReason: reason.trim(),
      updatedAt: new Date(),
    })
    .where(eq(fakturaWeekApprovals.id, existing.id));

  const entries = await getWeekEntries(isoYear, isoWeek);
  if (entries.length > 0) {
    await db
      .update(fakturaTimeEntries)
      .set({ status: "offen", updatedAt: new Date() })
      .where(
        inArray(
          fakturaTimeEntries.id,
          entries.map((e) => e.id)
        )
      );

    // Stundenzettel aller betroffenen Kunden als veraltet markieren
    const monday = mondayOfIsoWeek(isoYear, isoWeek);
    const sunday = addDaysISO(monday, 6);
    const projectIds = [...new Set(entries.map((e) => e.projectId))];
    const projects = await db
      .select()
      .from(fakturaProjects)
      .where(inArray(fakturaProjects.id, projectIds));
    const customerIds = [...new Set(projects.map((p) => p.customerId))];
    for (const customerId of customerIds)
      await markTimesheetsStaleForRange(customerId, monday, sunday);
  }

  await writeAudit({
    objectType: "faktura_freigabe",
    action: "freigabe_widerrufen",
    actorUserId: admin.id,
    actorLabel: fullName(admin),
    source,
    details: { isoYear, isoWeek, begruendung: reason.trim() },
  });
}
