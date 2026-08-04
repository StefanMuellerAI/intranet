/**
 * Validierung und Anzeige-Helfer für das IT-Management (Ausstattung der
 * Mitarbeitenden). Bewusst ohne Drizzle-Import, damit die Labels auch in
 * Client-Komponenten verwendet werden können.
 */

import { z } from "zod";
import { parseISODateInput, requireNonEmpty } from "@/lib/content";

export const EQUIPMENT_STATUSES = ["im_einsatz", "zurueckgegeben"] as const;
export type EquipmentStatus = (typeof EQUIPMENT_STATUSES)[number];

export const EQUIPMENT_STATUS_LABELS: Record<EquipmentStatus, string> = {
  im_einsatz: "im Einsatz",
  zurueckgegeben: "zurückgegeben",
};

/**
 * Der Status wird nie gespeichert, sondern ausschließlich aus dem
 * Rückgabedatum abgeleitet — so können Status und Datum nicht abweichen.
 */
export function equipmentStatus(returnDate: string | null): EquipmentStatus {
  return returnDate === null ? "im_einsatz" : "zurueckgegeben";
}

/**
 * Erlaubte Zeichen der Geräte-ID — dient auch als HTML-pattern im Formular,
 * damit der Browser abweichende Eingaben schon vor dem Absenden blockiert.
 */
export const DEVICE_ID_PATTERN = "[A-Za-z0-9-]+";

export const DEVICE_ID_MAX_LENGTH = 40;

/**
 * Vom Admin vergebene Geräte-ID. Sie ist der Schlüssel des CSV-Imports, über
 * den bestehende Geräte wiedererkannt werden, und daher Pflichtfeld.
 */
export function parseDeviceId(raw: string): string {
  const value = requireNonEmpty(raw, "Geräte-ID");
  if (!new RegExp(`^${DEVICE_ID_PATTERN}$`).test(value))
    throw new Error(
      "Die Geräte-ID darf nur Ziffern, Buchstaben und Bindestriche enthalten."
    );
  if (value.length > DEVICE_ID_MAX_LENGTH)
    throw new Error(
      `Die Geräte-ID ist zu lang (max. ${DEVICE_ID_MAX_LENGTH} Zeichen).`
    );
  return value;
}

export const equipmentInputSchema = z.object({
  userId: z.string().uuid("Bitte eine/n Mitarbeiter/in auswählen."),
  typeId: z.string().uuid("Bitte eine Ausstattungsart auswählen."),
  serialNumber: z
    .string()
    .trim()
    .max(120, "Die Seriennummer ist zu lang (max. 120 Zeichen).")
    .transform((v) => v || null),
  notes: z
    .string()
    .trim()
    .max(2000, "Die Zusatzinformationen sind zu lang (max. 2000 Zeichen).")
    .transform((v) => v || null),
});

export type EquipmentInput = z.infer<typeof equipmentInputSchema> & {
  deviceId: string;
  handoverDate: string;
  returnDate: string | null;
};

/**
 * Übernahme- und Rückgabedatum aus dem Formular. Die Rückgabe ist optional,
 * darf aber nicht vor der Übernahme liegen.
 */
export function parseEquipmentDates(
  handoverRaw: string,
  returnRaw: string
): { handoverDate: string; returnDate: string | null } {
  const handoverDate = parseISODateInput(handoverRaw, "Übernahmedatum");
  const returnDate = returnRaw.trim()
    ? parseISODateInput(returnRaw, "Rückgabedatum")
    : null;
  if (returnDate !== null && returnDate < handoverDate) {
    throw new Error(
      "Das Rückgabedatum darf nicht vor dem Übernahmedatum liegen."
    );
  }
  return { handoverDate, returnDate };
}

/** Vollständige Eingabe eines Ausstattungsgegenstands aus dem Formular. */
export function parseEquipmentInput(raw: {
  userId: string;
  typeId: string;
  deviceId: string;
  serialNumber: string;
  notes: string;
  handoverDate: string;
  returnDate: string;
}): EquipmentInput {
  const base = equipmentInputSchema.parse({
    userId: raw.userId,
    typeId: raw.typeId,
    serialNumber: raw.serialNumber,
    notes: raw.notes,
  });
  return {
    ...base,
    deviceId: parseDeviceId(raw.deviceId),
    ...parseEquipmentDates(raw.handoverDate, raw.returnDate),
  };
}

/** Name einer Ausstattungsart — Pflichtfeld, auf 80 Zeichen begrenzt. */
export function parseEquipmentTypeName(raw: string): string {
  const name = requireNonEmpty(raw, "Bezeichnung");
  if (name.length > 80)
    throw new Error("Die Bezeichnung ist zu lang (max. 80 Zeichen).");
  return name;
}
