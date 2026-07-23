import "server-only";
import { lt } from "drizzle-orm";
import {
  db,
  expenseReports,
  sickLeaves,
  vacationRequests,
  workationRequests,
  type Settings,
} from "@/db";

export interface RetentionReport {
  cutoffExpenses: string;
  cutoffSickLeaves: string;
  cutoffRequests: string;
  deletableExpenses: number;
  deletableSickLeaves: number;
  deletableVacations: number;
  deletableWorkations: number;
}

/**
 * Admin-Bericht "löschbare Datensätze": Fristbeginn ist das Ende des
 * Kalenderjahres des Vorgangs; ein Datensatz ist löschbar, wenn das
 * Vorgangsjahr + Frist vor dem laufenden Jahr liegt. Es wird nichts
 * automatisch gelöscht.
 */
export async function getRetentionReport(
  settings: Settings
): Promise<RetentionReport> {
  const currentYear = new Date().getFullYear();
  const cutoffYear = (years: number) => currentYear - years;
  const cutoffDate = (years: number) => `${cutoffYear(years)}-01-01`;

  const [expenses, sick, vacations, workations] = await Promise.all([
    db
      .select({ id: expenseReports.id })
      .from(expenseReports)
      .where(
        lt(expenseReports.returnDate, cutoffDate(settings.retentionExpenseYears))
      ),
    db
      .select({ id: sickLeaves.id })
      .from(sickLeaves)
      .where(
        lt(sickLeaves.startDate, cutoffDate(settings.retentionSickLeaveYears))
      ),
    db
      .select({ id: vacationRequests.id })
      .from(vacationRequests)
      .where(
        lt(
          vacationRequests.endDate,
          cutoffDate(settings.retentionRequestYears)
        )
      ),
    db
      .select({ id: workationRequests.id })
      .from(workationRequests)
      .where(
        lt(
          workationRequests.endDate,
          cutoffDate(settings.retentionRequestYears)
        )
      ),
  ]);

  return {
    cutoffExpenses: cutoffDate(settings.retentionExpenseYears),
    cutoffSickLeaves: cutoffDate(settings.retentionSickLeaveYears),
    cutoffRequests: cutoffDate(settings.retentionRequestYears),
    deletableExpenses: expenses.length,
    deletableSickLeaves: sick.length,
    deletableVacations: vacations.length,
    deletableWorkations: workations.length,
  };
}
