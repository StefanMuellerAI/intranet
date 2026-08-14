import { describe, expect, it } from "vitest";
import {
  MAX_RECEIPTS_TOTAL_BYTES,
  formatMB,
  receiptsTooLargeMessage,
  scaleToFit,
} from "./receipt-upload";

const MB = 1024 * 1024;

describe("scaleToFit", () => {
  it("lässt Bilder unterhalb der Maximalkante unverändert", () => {
    expect(scaleToFit(1000, 800, 2000)).toEqual({ width: 1000, height: 800 });
    expect(scaleToFit(2000, 500, 2000)).toEqual({ width: 2000, height: 500 });
  });

  it("skaliert die lange Kante auf das Maximum und hält das Seitenverhältnis", () => {
    expect(scaleToFit(4000, 3000, 2000)).toEqual({ width: 2000, height: 1500 });
    expect(scaleToFit(3000, 4000, 2000)).toEqual({ width: 1500, height: 2000 });
  });

  it("rundet und unterschreitet nie 1 Pixel", () => {
    expect(scaleToFit(10000, 1, 2000)).toEqual({ width: 2000, height: 1 });
  });
});

describe("formatMB", () => {
  it("formatiert Megabytes deutsch mit maximal einer Nachkommastelle", () => {
    expect(formatMB(4 * MB)).toBe("4 MB");
    expect(formatMB(2.5 * MB)).toBe("2,5 MB");
    expect(formatMB(5_242_880)).toBe("5 MB");
  });
});

describe("receiptsTooLargeMessage", () => {
  const files = [
    { name: "parkschein.jpg", size: 0.5 * MB },
    { name: "hotelrechnung.pdf", size: 5 * MB },
    { name: "bahnticket.pdf", size: 2 * MB },
    { name: "taxi.png", size: 1 * MB },
  ];

  it("nennt Gesamtgröße und Limit", () => {
    const message = receiptsTooLargeMessage(files);
    expect(message).toContain("8,5 MB");
    expect(message).toContain(formatMB(MAX_RECEIPTS_TOTAL_BYTES));
  });

  it("listet die drei größten Dateien absteigend, kleinere nicht", () => {
    const message = receiptsTooLargeMessage(files);
    expect(message).toContain("hotelrechnung.pdf (5 MB)");
    expect(message.indexOf("hotelrechnung.pdf")).toBeLessThan(
      message.indexOf("bahnticket.pdf")
    );
    expect(message.indexOf("bahnticket.pdf")).toBeLessThan(
      message.indexOf("taxi.png")
    );
    expect(message).not.toContain("parkschein.jpg");
  });
});
