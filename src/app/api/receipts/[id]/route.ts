import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, expenseReports, receipts, type User } from "@/db";
import { writeAudit } from "@/lib/audit";
import { fullName, getCurrentUser, isApprover } from "@/lib/auth";
import { decryptDocument } from "@/lib/document-crypto";
import { verifyReceiptSignature } from "@/lib/signed-url";

export const preferredRegion = "fra1";

/** Berichtsstatus, bei denen eine Vertretung den Vorgang entscheiden darf. */
const OPEN_STATUSES: readonly string[] = ["eingereicht", "storno_beantragt"];

/**
 * Beleg-Download — nie direkt aus dem Blob-Store, sondern:
 * a) mit gültiger, zeitlich begrenzter HMAC-Signatur (n8n-Webhook-Links) oder
 * b) mit App-Session (Eigentümer/in, Admin oder — nur für offene, zu
 *    entscheidende Berichte — eine aktive Vertretung).
 * Belege liegen verschlüsselt im Blob-Store; entschlüsselt wird ausschließlich
 * hier. Session-Zugriffe werden protokolliert (DSGVO-Rechenschaftspflicht).
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const receipt = await db.query.receipts.findFirst({
    where: eq(receipts.id, id),
  });
  if (!receipt)
    return NextResponse.json({ fehler: "Beleg nicht gefunden." }, { status: 404 });

  const url = new URL(req.url);
  const sig = url.searchParams.get("sig");
  const expires = url.searchParams.get("expires");

  let authorized = false;
  let actor: User | null = null;
  if (sig && expires) {
    authorized = verifyReceiptSignature(id, expires, sig);
  } else {
    const user = await getCurrentUser();
    if (user) {
      actor = user;
      if (user.id === receipt.userId || user.role === "admin") {
        authorized = true;
      } else if (await isApprover(user)) {
        // Vertretung: kein pauschaler Zugriff auf alle Belege. Nur solange der
        // zugehörige Bericht offen und damit von ihr zu entscheiden ist.
        const report = await db.query.expenseReports.findFirst({
          where: eq(expenseReports.id, receipt.reportId),
        });
        authorized = !!report && OPEN_STATUSES.includes(report.status);
      }
    }
  }
  if (!authorized)
    return NextResponse.json({ fehler: "Kein Zugriff." }, { status: 403 });

  const upstream = await fetch(receipt.blobUrl);
  if (!upstream.ok)
    return NextResponse.json(
      { fehler: "Beleg konnte nicht geladen werden." },
      { status: 502 }
    );

  let plain: Buffer;
  try {
    plain = decryptDocument(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    console.error("Beleg-Entschlüsselung fehlgeschlagen:", err);
    return NextResponse.json(
      { fehler: "Beleg konnte nicht entschlüsselt werden." },
      { status: 500 }
    );
  }

  // Session-Zugriffe protokollieren. Signierte n8n-Links bleiben unauditiert
  // (keine handelnde Person; der auslösende Vorgang ist bereits protokolliert).
  if (actor) {
    await writeAudit({
      objectType: "beleg",
      objectId: receipt.id,
      action: "abgerufen",
      actorUserId: actor.id,
      actorLabel: fullName(actor),
      source: "web",
      details: {
        userId: receipt.userId,
        reportId: receipt.reportId,
        filename: receipt.filename,
      },
    });
  }

  return new NextResponse(new Uint8Array(plain), {
    headers: {
      "content-type": receipt.contentType,
      // attachment + nosniff: hochgeladene Inhalte nie inline im App-Origin
      // rendern lassen (verhindert Stored-XSS über getarnte Uploads).
      "content-disposition": `attachment; filename="${receipt.filename.replaceAll('"', "")}"`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}
