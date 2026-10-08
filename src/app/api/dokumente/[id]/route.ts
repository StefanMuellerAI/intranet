import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, employeeDocuments } from "@/db";
import { writeAudit } from "@/lib/audit";
import { fullName, getCurrentUser } from "@/lib/auth";
import { decryptDocument } from "@/lib/document-crypto";
import { attachmentDisposition, isUuid } from "@/lib/http";

export const preferredRegion = "fra1";

/**
 * Mitarbeiterdokument-Download — der Blob-Store enthält nur Ciphertext,
 * entschlüsselt wird ausschließlich hier. Zugriff strikt auf Eigentümer/in
 * oder Admin beschränkt (bewusst keine Vertretungs- oder HMAC-Zugriffe,
 * Arbeitsverträge sind sensibler als Reisekostenbelege).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (user === null)
    return NextResponse.json({ fehler: "Kein Zugriff." }, { status: 403 });

  const doc = isUuid(id)
    ? await db.query.employeeDocuments.findFirst({
        where: eq(employeeDocuments.id, id),
      })
    : undefined;
  // Fremde Dokumente wie nicht vorhandene behandeln — verrät keine IDs
  if (!doc || (user.id !== doc.userId && user.role !== "admin"))
    return NextResponse.json(
      { fehler: "Dokument nicht gefunden." },
      { status: 404 }
    );

  const upstream = await fetch(doc.blobUrl);
  if (!upstream.ok)
    return NextResponse.json(
      { fehler: "Dokument konnte nicht geladen werden." },
      { status: 502 }
    );

  let plain: Buffer;
  try {
    plain = decryptDocument(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    console.error("Dokument-Entschlüsselung fehlgeschlagen:", err);
    return NextResponse.json(
      { fehler: "Dokument konnte nicht entschlüsselt werden." },
      { status: 500 }
    );
  }

  // Jeden Abruf protokollieren — DSGVO-Rechenschaftspflicht (Art. 5 Abs. 2)
  await writeAudit({
    objectType: "dokument",
    objectId: doc.id,
    action: "abgerufen",
    actorUserId: user.id,
    actorLabel: fullName(user),
    source: "web",
    details: { userId: doc.userId, filename: doc.filename },
  });

  return new NextResponse(new Uint8Array(plain), {
    headers: {
      "content-type": doc.contentType,
      // attachment + nosniff: hochgeladene Inhalte nie inline im App-Origin
      // rendern lassen (verhindert Stored-XSS über getarnte Uploads).
      "content-disposition": attachmentDisposition(doc.filename),
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}
