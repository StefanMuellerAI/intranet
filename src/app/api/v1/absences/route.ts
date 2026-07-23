import { NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  sickLeaves,
  users,
  vacationRequests,
  workationRequests,
} from "@/db";
import { authenticateApiRequest } from "@/lib/api-auth";
import { fullName } from "@/lib/auth";

export const preferredRegion = "fra1";

/**
 * GET /api/v1/absences — Krankmeldungen und genehmigte Abwesenheiten
 * (nur lesend; keine Freigabeaktionen auf Krankmeldungen).
 */
export async function GET(req: Request) {
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) return auth.response;

  const [vacations, workations, sick, allUsers] = await Promise.all([
    db
      .select()
      .from(vacationRequests)
      .where(
        inArray(vacationRequests.status, ["genehmigt", "storno_beantragt"])
      ),
    db
      .select()
      .from(workationRequests)
      .where(eq(workationRequests.status, "genehmigt")),
    db.select().from(sickLeaves),
    db.select().from(users),
  ]);

  const userInfo = (id: string) => {
    const u = allUsers.find((x) => x.id === id);
    return u ? { id: u.id, name: fullName(u), email: u.email } : null;
  };

  return NextResponse.json({
    absences: [
      ...vacations.map((v) => ({
        type: "vacation",
        user: userInfo(v.userId),
        von: v.startDate,
        bis: v.endDate,
        tage: v.days,
        status: v.status,
      })),
      ...workations.map((w) => ({
        type: "workation",
        user: userInfo(w.userId),
        von: w.startDate,
        bis: w.endDate,
        land: w.country,
        arbeitstage: w.workDays,
        status: w.status,
      })),
      ...sick.map((s) => ({
        type: "sick_leave",
        user: userInfo(s.userId),
        von: s.startDate,
        bis: s.endDate,
        typ: s.type,
        status: s.status,
      })),
    ],
  });
}
