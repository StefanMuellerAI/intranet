/**
 * HTML-pattern-Attribute für Dezimal-Textfelder mit deutschem Komma.
 *
 * Bewusst Textfelder statt type="number": Browser behandeln das Komma bei
 * type="number" uneinheitlich. Die Constraint-Validierung über pattern
 * blockiert ungültige Eingaben (z. B. "2h") bereits vor dem Submit,
 * Komma und Punkt bleiben als Dezimaltrenner erlaubt.
 */

/** Dezimalzahl mit Komma oder Punkt, max. 2 Nachkommastellen, z. B. "5000,00" */
export const DECIMAL_PATTERN = "[0-9]+([.,][0-9]{1,2})?";

export const DECIMAL_TITLE =
  "Bitte eine Zahl mit maximal zwei Nachkommastellen eingeben, z. B. 5000,00";

/**
 * Eurobetrag aus einem Textfeld in Cent. Komma und Punkt gelten wie bei
 * DECIMAL_PATTERN als Dezimaltrenner ("5000,50" = "5000.50"). Zusätzlich
 * werden Tausenderpunkte verstanden, wenn ein Komma folgt ("12.345,67") oder
 * nur Dreiergruppen stehen ("1.500"). Leere Eingabe → null, Unlesbares → NaN.
 */
export function parseEuroToCents(value: string): number | null {
  const raw = value.trim();
  if (!raw) return null;
  let normalized: string;
  if (raw.includes(",")) normalized = raw.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(raw)) normalized = raw.replace(/\./g, "");
  else normalized = raw;
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return NaN;
  return Math.round(Number(normalized) * 100);
}

/** Viertelstunden-Raster, z. B. "1,25" / "0,5" / "8" */
export const QUARTER_HOURS_PATTERN = "[0-9]+([.,](0|00|25|5|50|75))?";

export const QUARTER_HOURS_TITLE =
  "Bitte Stunden im 0,25er-Raster eingeben, z. B. 1,25 oder 0,5";
