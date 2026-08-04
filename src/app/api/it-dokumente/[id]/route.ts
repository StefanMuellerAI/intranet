import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, itEquipmentDocuments } from "@/db";
import { writeAudit } from "@/lib/audit";
import { fullName, getCurrentUser } from "@/lib/auth";
import { decryptDocument } from "@/lib/document-crypto";

export const preferredRegion = "fra1";

/**
 * Download eines Übergabe- oder Rücknahmeprotokolls — der Blob-Store enthält
 * nur Ciphertext, entschlüsselt wird ausschließlich hier. Das IT-Management
 * ist reine Admin-Verwaltung, deshalb gibt es bewusst keinen Zugriff für die
 * betroffenen Mitarbeitenden und keine HMAC-Links.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const doc = await db.query.itEquipmentDocuments.findFirst({
    where: eq(itEquipmentDocuments.id, id),
  });
  if (!doc)
    return NextResponse.json(
      { fehler: "Protokoll nicht gefunden." },
      { status: 404 }
    );

  const user = await getCurrentUser();
  if (user === null || user.role !== "admin")
    return NextResponse.json({ fehler: "Kein Zugriff." }, { status: 403 });

  const upstream = await fetch(doc.blobUrl);
  if (!upstream.ok)
    return NextResponse.json(
      { fehler: "Protokoll konnte nicht geladen werden." },
      { status: 502 }
    );

  let plain: Buffer;
  try {
    plain = decryptDocument(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    console.error("Protokoll-Entschlüsselung fehlgeschlagen:", err);
    return NextResponse.json(
      { fehler: "Protokoll konnte nicht entschlüsselt werden." },
      { status: 500 }
    );
  }

  // Jeden Abruf protokollieren — DSGVO-Rechenschaftspflicht (Art. 5 Abs. 2)
  await writeAudit({
    objectType: "it_dokument",
    objectId: doc.id,
    action: "abgerufen",
    actorUserId: user.id,
    actorLabel: fullName(user),
    source: "web",
    details: { userId: doc.userId, kind: doc.kind, filename: doc.filename },
  });

  return new NextResponse(new Uint8Array(plain), {
    headers: {
      "content-type": doc.contentType,
      "content-disposition": `inline; filename="${doc.filename.replaceAll('"', "")}"`,
      "cache-control": "private, no-store",
    },
  });
}
