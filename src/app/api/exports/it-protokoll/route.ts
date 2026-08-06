import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import {
  HANDOVER_PROTOCOL_KINDS,
  db,
  itEquipment,
  itEquipmentTypes,
  users,
  type HandoverProtocolKind,
} from "@/db";
import { writeAudit } from "@/lib/audit";
import { fullName, getCurrentUser } from "@/lib/auth";
import { formatDateDE, toISODate } from "@/lib/dates";
import {
  handoverProtocolFilename,
  renderHandoverProtocolPdf,
} from "@/lib/it-equipment-pdf";

export const preferredRegion = "fra1";

/** Früh prüfen — sonst quittiert Postgres eine Nicht-UUID mit einem Fehler. */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Ausgefüllte Protokoll-Vorlage als PDF mit Briefkopf — Übergabe mit der
 * Ausstattung im Einsatz, Rücknahme mit allen erfassten Geräten samt
 * Rückgabedaten. Zum Ausdrucken und Unterschreiben; das unterschriebene
 * Protokoll wird anschließend im Reiter "Mitarbeitende" hochgeladen. Nur für
 * den Admin; da die Vorlage personenbezogen ist, wird jeder Abruf auditiert.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin")
    return NextResponse.json({ fehler: "Nur für den Admin." }, { status: 403 });

  const url = new URL(req.url);
  const kindParam = url.searchParams.get("art") ?? "";
  const employeeId = url.searchParams.get("mitarbeiter") ?? "";

  if (!(HANDOVER_PROTOCOL_KINDS as readonly string[]).includes(kindParam))
    return NextResponse.json(
      { fehler: "Unbekannte Protokollart." },
      { status: 400 }
    );
  const kind = kindParam as HandoverProtocolKind;

  const employee = UUID_PATTERN.test(employeeId)
    ? await db.query.users.findFirst({ where: eq(users.id, employeeId) })
    : undefined;
  if (!employee)
    return NextResponse.json(
      { fehler: "Mitarbeiter/in nicht gefunden." },
      { status: 404 }
    );

  const [equipment, types] = await Promise.all([
    db.select().from(itEquipment).where(eq(itEquipment.userId, employee.id)),
    db.select().from(itEquipmentTypes),
  ]);

  // Übergeben wird, was im Einsatz ist; zurückgenommen wird alles Erfasste —
  // bereits erfasste Rückgaben erscheinen mit Datum, offene als Leerfeld.
  const relevant = (
    kind === "uebergabe"
      ? equipment.filter((item) => item.returnDate === null)
      : equipment
  ).sort((a, b) => a.deviceId.localeCompare(b.deviceId, "de", { numeric: true }));

  if (relevant.length === 0)
    return NextResponse.json(
      {
        fehler:
          kind === "uebergabe"
            ? `Für ${fullName(employee)} ist keine Ausstattung im Einsatz.`
            : `Für ${fullName(employee)} ist keine Ausstattung erfasst.`,
      },
      { status: 400 }
    );

  const typeById = new Map(types.map((t) => [t.id, t.name]));
  const now = new Date();
  const pdf = await renderHandoverProtocolPdf({
    kind,
    employeeName: fullName(employee),
    createdAtLabel: formatDateDE(toISODate(now)),
    devices: relevant.map((item) => ({
      typeName: typeById.get(item.typeId) ?? "Unbekannt",
      deviceId: item.deviceId,
      serialNumber: item.serialNumber,
      handoverLabel: formatDateDE(item.handoverDate),
      returnLabel: item.returnDate ? formatDateDE(item.returnDate) : null,
      notes: item.notes,
    })),
  });

  await writeAudit({
    objectType: "it_ausstattung",
    action: "protokoll_erstellt",
    actorUserId: user.id,
    actorLabel: fullName(user),
    source: "web",
    details: { userId: employee.id, art: kind, geraete: relevant.length },
  });

  const filename = handoverProtocolFilename(kind, fullName(employee), now);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${filename}"`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}
