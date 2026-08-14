import "client-only";

/**
 * Belege werden als Dateien im Body der Server Action mitgeschickt. Vercel
 * nimmt Function-Requests aber nur bis 4,5 MB an und weist größere Bodies
 * schon am Proxy ab (413 FUNCTION_PAYLOAD_TOO_LARGE) — ohne Function-Aufruf
 * und damit ohne Runtime-Log; im Client erscheint nur "An unexpected
 * response was received from the server." Das bodySizeLimit aus
 * next.config.ts greift erst dahinter und ist auf Vercel nie erreichbar.
 * 4 MB Budget lassen Luft für Multipart-Overhead und das JSON-Payload-Feld.
 */
export const MAX_RECEIPTS_TOTAL_BYTES = 4 * 1024 * 1024;

// Unterhalb dieser Größe wird in der ersten Stufe nicht neu komprimiert —
// Qualitätsverlust ohne nennenswerten Größengewinn.
const IMAGE_COMPRESS_MIN_BYTES = 1024 * 1024;

const COMPRESSIBLE_TYPES = ["image/jpeg", "image/png"];

// 2000 px langer Kante reichen für gut lesbare Belege (A4 ≈ 170 dpi); die
// zweite Stufe greift nur, wenn die Summe sonst über dem Limit bliebe.
const NORMAL = { maxEdge: 2000, quality: 0.8 };
const STRONG = { maxEdge: 1400, quality: 0.7 };

export function scaleToFit(
  width: number,
  height: number,
  maxEdge: number
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const factor = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * factor)),
    height: Math.max(1, Math.round(height * factor)),
  };
}

export function formatMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toLocaleString("de-DE", {
    maximumFractionDigits: 1,
  })} MB`;
}

export function receiptsTooLargeMessage(
  files: { name: string; size: number }[]
): string {
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  const biggest = [...files]
    .sort((a, b) => b.size - a.size)
    .slice(0, 3)
    .map((f) => `${f.name} (${formatMB(f.size)})`)
    .join(", ");
  return (
    `Die Belege sind zusammen zu groß für den Upload ` +
    `(${formatMB(totalBytes)}, möglich sind ${formatMB(MAX_RECEIPTS_TOTAL_BYTES)}). ` +
    `Bitte verkleinern Sie insbesondere: ${biggest}. Fotos werden automatisch ` +
    `komprimiert; PDFs bitte mit geringerer Auflösung neu erstellen.`
  );
}

/**
 * Verkleinert Bild-Belege (JPG/PNG) clientseitig per Canvas zu JPEG. Gibt in
 * jedem Zweifelsfall das Original zurück (PDF, nicht dekodierbar, Ergebnis
 * nicht kleiner) — die Größenprüfung im Formular fängt den Rest ab.
 */
export async function prepareReceiptFile(
  file: File,
  strong = false
): Promise<File> {
  if (!COMPRESSIBLE_TYPES.includes(file.type)) return file;
  if (!strong && file.size <= IMAGE_COMPRESS_MIN_BYTES) return file;
  const { maxEdge, quality } = strong ? STRONG : NORMAL;
  try {
    // from-image übernimmt die EXIF-Ausrichtung von Handyfotos in die Pixel,
    // sonst kämen quer gedrehte Belege heraus.
    const bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    });
    try {
      const { width, height } = scaleToFit(
        bitmap.width,
        bitmap.height,
        maxEdge
      );
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return file;
      // PNG-Transparenz würde im JPEG schwarz — Belege auf weißen Grund legen.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(bitmap, 0, 0, width, height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", quality)
      );
      if (!blob || blob.size >= file.size) return file;
      return new File(
        [blob],
        `${file.name.replace(/\.(jpe?g|png)$/i, "")}.jpg`,
        { type: "image/jpeg" }
      );
    } finally {
      bitmap.close();
    }
  } catch {
    return file;
  }
}
