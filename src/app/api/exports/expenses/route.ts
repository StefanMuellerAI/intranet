import { NextResponse } from "next/server";
import { and, eq, gte, lte } from "drizzle-orm";
import { db, expenseReports, users } from "@/db";
import { fullName, getCurrentUser } from "@/lib/auth";
import { buildExpensesCsv, buildExpensesPdf } from "@/lib/expenses/export";

export const preferredRegion = "fra1";

/**
 * Monatlicher Export genehmigter Reisekostenabrechnungen (CSV/PDF)
 * für die Lohnabrechnung/Steuerberaterin — nur für den Admin.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin")
    return NextResponse.json({ fehler: "Nur für den Admin." }, { status: 403 });

  const url = new URL(req.url);
  const month = url.searchParams.get("monat"); // YYYY-MM
  const format = url.searchParams.get("format") ?? "csv";
  if (!month || !/^\d{4}-\d{2}$/.test(month))
    return NextResponse.json(
      { fehler: "Parameter 'monat' im Format YYYY-MM erforderlich." },
      { status: 400 }
    );

  const [y, m] = month.split("-").map(Number);
  const from = `${month}-01`;
  const to = `${y}-${String(m).padStart(2, "0")}-${String(
    new Date(y, m, 0).getDate()
  ).padStart(2, "0")}`;

  // Zuordnung über das Rückkehrdatum der Reise
  const reports = await db
    .select()
    .from(expenseReports)
    .where(
      and(
        eq(expenseReports.status, "genehmigt"),
        gte(expenseReports.returnDate, from),
        lte(expenseReports.returnDate, to)
      )
    );
  const allUsers = await db.select().from(users);
  const rows = reports.map((report) => ({
    report,
    userName: (() => {
      const u = allUsers.find((x) => x.id === report.userId);
      return u ? fullName(u) : "Unbekannt";
    })(),
  }));

  if (format === "pdf") {
    const pdf = await buildExpensesPdf(rows, month);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="Reisekosten-${month}.pdf"`,
      },
    });
  }

  const csv = buildExpensesCsv(rows);
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="Reisekosten-${month}.csv"`,
    },
  });
}
