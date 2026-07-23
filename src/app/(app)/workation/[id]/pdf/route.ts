import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, users, workationRequests } from "@/db";
import { fullName, getCurrentUser } from "@/lib/auth";
import { renderWorkationPdf } from "@/lib/workation/pdf";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const request = await db.query.workationRequests.findFirst({
    where: eq(workationRequests.id, id),
  });
  // PDF nur für Admin und die betroffene Person
  if (!request || (request.userId !== user.id && user.role !== "admin"))
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  if (request.status !== "genehmigt")
    return NextResponse.json(
      { error: "Das PDF ist erst nach Genehmigung verfügbar." },
      { status: 400 }
    );

  const applicant = await db.query.users.findFirst({
    where: eq(users.id, request.userId),
  });
  const approver = request.decidedById
    ? await db.query.users.findFirst({
        where: eq(users.id, request.decidedById),
      })
    : null;
  if (!applicant)
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });

  const pdf = await renderWorkationPdf(
    request,
    applicant,
    approver ? fullName(approver) : "Geschäftsführung"
  );

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="Workation-Genehmigung-${id}.pdf"`,
    },
  });
}
