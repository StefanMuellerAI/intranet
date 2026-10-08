import { describe, expect, it } from "vitest";
import { attachmentDisposition, isUuid } from "./http";

describe("isUuid", () => {
  it("erkennt UUIDs unabhängig von der Schreibweise", () => {
    expect(isUuid("3f2b8c1e-9a4d-4e5f-8a6b-1c2d3e4f5a6b")).toBe(true);
    expect(isUuid("3F2B8C1E-9A4D-4E5F-8A6B-1C2D3E4F5A6B")).toBe(true);
  });

  it("lehnt alles andere ab", () => {
    for (const value of ["", "keine-uuid", "123", "3f2b8c1e9a4d4e5f8a6b1c2d3e4f5a6b", "3f2b8c1e-9a4d-4e5f-8a6b-1c2d3e4f5a6b'--"])
      expect(isUuid(value), value).toBe(false);
  });
});

describe("attachmentDisposition", () => {
  it("lässt reine ASCII-Namen unverändert", () => {
    expect(attachmentDisposition("rechnung.pdf")).toBe(
      `attachment; filename="rechnung.pdf"; filename*=UTF-8''rechnung.pdf`
    );
  });

  it("ersetzt Umlaute und Sonderzeichen im Ersatznamen und kodiert den Originalnamen", () => {
    const header = attachmentDisposition("Übergabe – Max €.pdf");
    expect(header).toContain(`filename="Ubergabe _ Max _.pdf"`);
    expect(header).toContain(
      `filename*=UTF-8''${encodeURIComponent("Übergabe – Max €.pdf")}`
    );
    // Header müssen Latin-1 sein, sonst wirft new Response()
    expect(() => new Headers({ "content-disposition": header })).not.toThrow();
  });

  it("entfernt Anführungszeichen und Zeilenumbrüche (Header-Injection)", () => {
    const header = attachmentDisposition('a"b\r\nSet-Cookie: x.pdf');
    expect(header).not.toMatch(/[\r\n]/);
    expect(header.split(";")[1]).toBe(' filename="ab  Set-Cookie: x.pdf"');
  });
});
