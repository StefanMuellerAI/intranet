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

/** Viertelstunden-Raster, z. B. "1,25" / "0,5" / "8" */
export const QUARTER_HOURS_PATTERN = "[0-9]+([.,](0|00|25|5|50|75))?";

export const QUARTER_HOURS_TITLE =
  "Bitte Stunden im 0,25er-Raster eingeben, z. B. 1,25 oder 0,5";
