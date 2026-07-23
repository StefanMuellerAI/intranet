import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, receipts } from "@/db";
import { getCurrentUser, isApprover } from "@/lib/auth";
import { verifyReceiptSignature } from "@/lib/signed-url";

export const preferredRegion = "fra1";

/**
 * Beleg-Download — nie direkt aus dem Blob-Store, sondern:
 * a) mit gültiger, zeitlich begrenzter HMAC-Signatur (n8n-Webhook-Links) oder
 * b) mit App-Session (Eigentümer/in, Admin oder aktive Vertretung).
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
  if (sig && expires) {
    authorized = verifyReceiptSignature(id, expires, sig);
  } else {
    const user = await getCurrentUser();
    if (user) {
      authorized =
        user.id === receipt.userId ||
        user.role === "admin" ||
        (await isApprover(user));
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

  return new NextResponse(upstream.body, {
    headers: {
      "content-type": receipt.contentType,
      "content-disposition": `inline; filename="${receipt.filename.replaceAll('"', "")}"`,
      "cache-control": "private, no-store",
    },
  });
}
