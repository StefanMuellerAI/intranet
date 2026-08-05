import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, employeeDocuments } from "@/db";
import { writeAudit } from "@/lib/audit";
import { fullName, getCurrentUser } from "@/lib/auth";
import { decryptDocument } from "@/lib/document-crypto";

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
  const doc = await db.query.employeeDocuments.findFirst({
    where: eq(employeeDocuments.id, id),
  });
  if (!doc)
    return NextResponse.json(
      { fehler: "Dokument nicht gefunden." },
      { status: 404 }
    );

  const user = await getCurrentUser();
  const authorized =
    user !== null && (user.id === doc.userId || user.role === "admin");
  if (!authorized)
    return NextResponse.json({ fehler: "Kein Zugriff." }, { status: 403 });

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
      "content-disposition": `attachment; filename="${doc.filename.replaceAll('"', "")}"`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}
