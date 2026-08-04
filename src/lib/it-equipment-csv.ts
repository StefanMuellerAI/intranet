/**
 * CSV-Austausch der IT-Ausstattungsliste: Der Export dient gleichzeitig als
 * Import-Vorlage, der Import gleicht über die Geräte-ID ab. Bewusst ohne
 * Drizzle-Import, damit die reinen Funktionen ohne Datenbank testbar sind.
 *
 * Format wie beim Faktura-Rohdaten-Export: Semikolon als Trennzeichen,
 * UTF-8 mit BOM und CRLF — so öffnet Excel die Datei per Doppelklick korrekt.
 */

import { formatDateDE } from "@/lib/dates";
import {
  EQUIPMENT_STATUS_LABELS,
  equipmentStatus,
  parseDeviceId,
} from "@/lib/it-equipment";

export const SERIAL_NUMBER_MAX_LENGTH = 120;
export const NOTES_MAX_LENGTH = 2000;

/** Spaltenüberschriften — sie sind die Schnittstelle zur Tabellenkalkulation. */
export const CSV_COLUMNS = {
  deviceId: "Geräte-ID",
  newDeviceId: "Geräte-ID neu (optional)",
  email: "Mitarbeiter-E-Mail",
  userName: "Mitarbeiter/in (nur Info)",
  typeName: "Ausstattungsart",
  serialNumber: "Seriennummer",
  handoverDate: "Übernahme am",
  returnDate: "Rückgabe am",
  notes: "Zusatzinformationen",
  status: "Status (nur Info)",
} as const;

const COLUMN_ORDER = [
  CSV_COLUMNS.deviceId,
  CSV_COLUMNS.newDeviceId,
  CSV_COLUMNS.email,
  CSV_COLUMNS.userName,
  CSV_COLUMNS.typeName,
  CSV_COLUMNS.serialNumber,
  CSV_COLUMNS.handoverDate,
  CSV_COLUMNS.returnDate,
  CSV_COLUMNS.notes,
  CSV_COLUMNS.status,
];

/** Ohne diese Spalten lässt sich eine Zeile nicht zuordnen. */
const REQUIRED_COLUMNS = [
  CSV_COLUMNS.deviceId,
  CSV_COLUMNS.email,
  CSV_COLUMNS.typeName,
  CSV_COLUMNS.handoverDate,
];

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export interface EquipmentExportRow {
  deviceId: string;
  email: string;
  userName: string;
  typeName: string;
  serialNumber: string | null;
  handoverDate: string;
  returnDate: string | null;
  notes: string | null;
}

function csvField(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function buildEquipmentCsv(rows: EquipmentExportRow[]): string {
  const lines = [
    COLUMN_ORDER.join(";"),
    ...rows.map((row) =>
      [
        row.deviceId,
        // Leer lassen: gefüllt benennt diese Spalte beim Import das Gerät um
        "",
        row.email,
        row.userName,
        row.typeName,
        row.serialNumber ?? "",
        formatDateDE(row.handoverDate),
        row.returnDate ? formatDateDE(row.returnDate) : "",
        row.notes ?? "",
        EQUIPMENT_STATUS_LABELS[equipmentStatus(row.returnDate)],
      ]
        .map(csvField)
        .join(";")
    ),
  ];
  return "\uFEFF" + lines.join("\r\n");
}

// ---------------------------------------------------------------------------
// Einlesen
// ---------------------------------------------------------------------------

/**
 * Hochgeladene Datei in Text wandeln. Excel schreibt CSV je nach Version und
 * Menüpunkt als UTF-8 oder als Windows-1252 — bei Ersatzzeichen wird deshalb
 * ein zweiter Versuch mit Windows-1252 unternommen, sonst zerfallen Umlaute.
 */
export function decodeCsvUpload(bytes: ArrayBuffer | Uint8Array): string {
  const buffer = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const utf8 = new TextDecoder("utf-8").decode(buffer);
  if (!utf8.includes("\uFFFD")) return utf8;
  return new TextDecoder("windows-1252").decode(buffer);
}

/**
 * Semikolon-getrennte Tabelle einlesen. Felder in Anführungszeichen dürfen
 * Trennzeichen, Zeilenumbrüche und verdoppelte Anführungszeichen enthalten.
 */
export function parseCsvTable(text: string): string[][] {
  const input = text.startsWith("\uFEFF") ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ";") {
      row.push(field);
      field = "";
    } else if (char === "\r") {
      // Zeilenende erst beim \n verarbeiten (CRLF)
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/**
 * Datum aus der Tabelle. Excel formatiert Datumszellen beim Speichern gerne
 * um, deshalb sind sowohl TT.MM.JJJJ als auch JJJJ-MM-TT zulässig.
 * Zweistellige Jahre werden abgelehnt, weil sie mehrdeutig sind.
 */
export function parseTableDate(raw: string, label: string): string {
  const text = raw.trim();
  if (!text) throw new Error(`${label} fehlt.`);

  const german = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);

  let year: number;
  let month: number;
  let day: number;
  if (german) {
    day = Number(german[1]);
    month = Number(german[2]);
    year = Number(german[3]);
  } else if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else {
    throw new Error(
      `${label} „${text}“ ist kein Datum im Format TT.MM.JJJJ oder JJJJ-MM-TT.`
    );
  }

  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  )
    throw new Error(`${label} „${text}“ ist kein gültiger Kalendertag.`);

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Abgleich
// ---------------------------------------------------------------------------

export interface ImportContextUser {
  id: string;
  email: string;
  /** Deaktivierte Zugänge bekommen keine neue Ausstattung zugeordnet */
  active: boolean;
}

export interface ImportContextType {
  id: string;
  name: string;
  /** Ausgeblendete Arten stehen für neue Zuordnungen nicht zur Verfügung */
  active: boolean;
}

export interface ImportContextEquipment {
  id: string;
  deviceId: string;
  userId: string;
  typeId: string;
  serialNumber: string | null;
  notes: string | null;
  handoverDate: string;
  returnDate: string | null;
}

export interface ImportContext {
  users: ImportContextUser[];
  types: ImportContextType[];
  equipment: ImportContextEquipment[];
}

/** Werte eines Geräts, wie sie nach dem Import gelten sollen. */
export interface ImportValues {
  deviceId: string;
  userId: string;
  typeId: string;
  serialNumber: string | null;
  notes: string | null;
  handoverDate: string;
  returnDate: string | null;
}

export interface EquipmentImportPlan {
  create: ImportValues[];
  update: { id: string; previousDeviceId: string; values: ImportValues }[];
  /** Geräte-IDs, deren Zeilen unverändert geblieben sind */
  unchanged: string[];
  remove: { id: string; deviceId: string }[];
}

export type EquipmentImportResult =
  | { ok: true; plan: EquipmentImportPlan }
  | { ok: false; errors: string[] };

function normalizeOptional(
  raw: string,
  label: string,
  maxLength: number
): string | null {
  const text = raw.trim();
  if (!text) return null;
  if (text.length > maxLength)
    throw new Error(`${label} ist zu lang (max. ${maxLength} Zeichen).`);
  return text;
}

function sameValues(existing: ImportContextEquipment, next: ImportValues) {
  return (
    existing.deviceId === next.deviceId &&
    existing.userId === next.userId &&
    existing.typeId === next.typeId &&
    existing.serialNumber === next.serialNumber &&
    existing.notes === next.notes &&
    existing.handoverDate === next.handoverDate &&
    existing.returnDate === next.returnDate
  );
}

/**
 * Prüft die hochgeladene Tabelle vollständig und leitet daraus ab, was
 * angelegt, aktualisiert und entfernt werden muss. Rein funktional, damit
 * Vorschau und Anwendung garantiert dasselbe Ergebnis berechnen.
 */
export function planEquipmentImport(
  text: string,
  context: ImportContext
): EquipmentImportResult {
  const table = parseCsvTable(text).filter((row) =>
    row.some((cell) => cell.trim() !== "")
  );
  if (table.length === 0) return { ok: false, errors: ["Die Datei ist leer."] };

  const header = table[0].map((cell) => cell.trim());
  const missing = REQUIRED_COLUMNS.filter((name) => !header.includes(name));
  if (missing.length > 0)
    return {
      ok: false,
      errors: [
        `Die Kopfzeile ist unvollständig. Fehlende Spalte(n): ${missing.join(", ")}. Am einfachsten gelingt der Import mit der exportierten Datei als Vorlage.`,
      ],
    };

  const dataRows = table.slice(1);
  if (dataRows.length === 0)
    return {
      ok: false,
      errors: [
        "Die Datei enthält keine Datenzeilen. Zur Sicherheit wird kein Import ausgeführt — zum Leeren der Liste bitte die Geräte einzeln löschen.",
      ],
    };

  const column = (row: string[], name: string): string => {
    const index = header.indexOf(name);
    return index === -1 ? "" : (row[index] ?? "");
  };

  const userByEmail = new Map(
    context.users.map((u) => [u.email.trim().toLowerCase(), u])
  );
  const typeByName = new Map(
    context.types.map((t) => [t.name.trim().toLowerCase(), t])
  );
  const existingByDeviceId = new Map(
    context.equipment.map((e) => [e.deviceId, e])
  );

  const errors: string[] = [];
  const seenSourceIds = new Map<string, number>();
  const resultingIds = new Map<string, number>();
  const matched: { existing: ImportContextEquipment; values: ImportValues }[] =
    [];
  const create: ImportValues[] = [];

  dataRows.forEach((row, index) => {
    // Kopfzeile ist Zeile 1, die erste Datenzeile also Zeile 2
    const line = index + 2;
    const fail = (message: string) => errors.push(`Zeile ${line}: ${message}`);

    let deviceId: string;
    try {
      deviceId = parseDeviceId(column(row, CSV_COLUMNS.deviceId));
    } catch (err) {
      fail(err instanceof Error ? err.message : "Geräte-ID ist ungültig.");
      return;
    }

    const previousLine = seenSourceIds.get(deviceId);
    if (previousLine !== undefined) {
      fail(
        `Die Geräte-ID „${deviceId}“ kommt schon in Zeile ${previousLine} vor.`
      );
      return;
    }
    seenSourceIds.set(deviceId, line);

    const existing = existingByDeviceId.get(deviceId);

    let targetDeviceId = deviceId;
    const renameRaw = column(row, CSV_COLUMNS.newDeviceId).trim();
    if (renameRaw) {
      if (!existing) {
        fail(
          `Die Geräte-ID „${deviceId}“ ist unbekannt, deshalb lässt sie sich nicht umbenennen. Für ein neues Gerät bitte nur die Spalte „${CSV_COLUMNS.deviceId}“ füllen.`
        );
        return;
      }
      try {
        targetDeviceId = parseDeviceId(renameRaw);
      } catch (err) {
        fail(err instanceof Error ? err.message : "Geräte-ID ist ungültig.");
        return;
      }
    }

    const claimedLine = resultingIds.get(targetDeviceId);
    if (claimedLine !== undefined) {
      fail(
        `Die Geräte-ID „${targetDeviceId}“ wird schon in Zeile ${claimedLine} verwendet.`
      );
      return;
    }
    resultingIds.set(targetDeviceId, line);

    const emailRaw = column(row, CSV_COLUMNS.email).trim();
    const user = userByEmail.get(emailRaw.toLowerCase());
    if (!user) {
      fail(`Zu der E-Mail-Adresse „${emailRaw}“ gibt es keine/n Mitarbeiter/in.`);
      return;
    }
    if (!user.active && existing?.userId !== user.id) {
      fail(
        `„${user.email}“ ist deaktiviert und kann keine weitere Ausstattung übernehmen.`
      );
      return;
    }

    const typeName = column(row, CSV_COLUMNS.typeName).trim();
    const type = typeByName.get(typeName.toLowerCase());
    if (!type) {
      fail(
        `Die Ausstattungsart „${typeName}“ ist unbekannt. Bitte zuerst im Reiter „Ausstattungsarten“ anlegen.`
      );
      return;
    }
    if (!type.active && existing?.typeId !== type.id) {
      fail(
        `Die Ausstattungsart „${type.name}“ ist ausgeblendet und für neue Zuordnungen nicht verfügbar.`
      );
      return;
    }

    let handoverDate: string;
    let returnDate: string | null;
    let serialNumber: string | null;
    let notes: string | null;
    try {
      handoverDate = parseTableDate(
        column(row, CSV_COLUMNS.handoverDate),
        CSV_COLUMNS.handoverDate
      );
      const returnRaw = column(row, CSV_COLUMNS.returnDate).trim();
      returnDate = returnRaw
        ? parseTableDate(returnRaw, CSV_COLUMNS.returnDate)
        : null;
      if (returnDate !== null && returnDate < handoverDate)
        throw new Error(
          "Das Rückgabedatum darf nicht vor dem Übernahmedatum liegen."
        );
      serialNumber = normalizeOptional(
        column(row, CSV_COLUMNS.serialNumber),
        "Die Seriennummer",
        SERIAL_NUMBER_MAX_LENGTH
      );
      notes = normalizeOptional(
        column(row, CSV_COLUMNS.notes),
        "Die Zusatzinformationen",
        NOTES_MAX_LENGTH
      );
    } catch (err) {
      fail(err instanceof Error ? err.message : "Die Zeile ist ungültig.");
      return;
    }

    const values: ImportValues = {
      deviceId: targetDeviceId,
      userId: user.id,
      typeId: type.id,
      serialNumber,
      notes,
      handoverDate,
      returnDate,
    };

    if (existing) matched.push({ existing, values });
    else create.push(values);
  });

  // Eine Umbenennung darf keine ID beanspruchen, die ein anderes Gerät behält
  for (const { existing, values } of matched) {
    if (values.deviceId === existing.deviceId) continue;
    const holder = existingByDeviceId.get(values.deviceId);
    if (holder && matched.some((m) => m.existing.id === holder.id))
      errors.push(
        `Die Geräte-ID „${values.deviceId}“ ist bereits vergeben. Ein Tausch von Geräte-IDs ist in einem Durchgang nicht möglich — bitte in zwei Schritten importieren.`
      );
  }
  for (const values of create) {
    if (existingByDeviceId.has(values.deviceId))
      errors.push(
        `Die Geräte-ID „${values.deviceId}“ ist bereits vergeben und lässt sich nicht doppelt anlegen.`
      );
  }

  if (errors.length > 0) return { ok: false, errors };

  const keptIds = new Set(matched.map((m) => m.existing.id));
  const plan: EquipmentImportPlan = {
    create,
    update: matched
      .filter(({ existing, values }) => !sameValues(existing, values))
      .map(({ existing, values }) => ({
        id: existing.id,
        previousDeviceId: existing.deviceId,
        values,
      })),
    unchanged: matched
      .filter(({ existing, values }) => sameValues(existing, values))
      .map(({ existing }) => existing.deviceId),
    remove: context.equipment
      .filter((e) => !keptIds.has(e.id))
      .map((e) => ({ id: e.id, deviceId: e.deviceId })),
  };

  return { ok: true, plan };
}
