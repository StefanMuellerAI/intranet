import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z, ZodError } from "zod";
import { runAction, UserError } from "./user-error";

const GENERISCH = "Unerwarteter Fehler. Bitte versuchen Sie es später erneut.";

let fehlerLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fehlerLog = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  fehlerLog.mockRestore();
});

describe("UserError", () => {
  it("ist ein Error mit eigenem Namen und unveränderter Meldung", () => {
    const err = new UserError("Bitte Startdatum angeben.");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("UserError");
    expect(err.message).toBe("Bitte Startdatum angeben.");
  });
});

describe("runAction", () => {
  it("liefert das Ergebnis der Logik als ok-Objekt", async () => {
    await expect(runAction(async () => ({ id: "abc" }))).resolves.toEqual({
      ok: true,
      data: { id: "abc" },
    });
    expect(fehlerLog).not.toHaveBeenCalled();
  });

  it("transportiert die Meldung eines UserError ohne Server-Log", async () => {
    const result = await runAction(async () => {
      throw new UserError("Nur zurückgezogene Anträge können gelöscht werden.");
    });
    expect(result).toEqual({
      ok: false,
      error: "Nur zurückgezogene Anträge können gelöscht werden.",
    });
    expect(fehlerLog).not.toHaveBeenCalled();
  });

  it("meldet bei Zod-Validierung nur die erste Fehlermeldung", async () => {
    const schema = z.object({
      startDate: z.string().min(1, "Bitte Startdatum angeben."),
      endDate: z.string().min(1, "Bitte Enddatum angeben."),
    });
    const result = await runAction(async () =>
      schema.parse({ startDate: "", endDate: "" })
    );
    expect(result).toEqual({ ok: false, error: "Bitte Startdatum angeben." });
    expect(fehlerLog).not.toHaveBeenCalled();
  });

  it("behandelt einen ZodError ohne Issues wie einen unerwarteten Fehler", async () => {
    const result = await runAction(async () => {
      throw new ZodError([]);
    });
    expect(result).toEqual({ ok: false, error: GENERISCH });
    expect(fehlerLog).toHaveBeenCalledTimes(1);
  });

  it("meldet unerwartete Fehler nur generisch und loggt sie serverseitig", async () => {
    const intern = new Error("relation \"users\" does not exist");
    const result = await runAction(async () => {
      throw intern;
    });
    expect(result).toEqual({ ok: false, error: GENERISCH });
    expect(fehlerLog).toHaveBeenCalledWith("Server-Action fehlgeschlagen:", intern);
  });

  it("fängt auch geworfene Nicht-Error-Werte ab", async () => {
    const result = await runAction(async () => {
      throw "kaputt";
    });
    expect(result).toEqual({ ok: false, error: GENERISCH });
    expect(fehlerLog).toHaveBeenCalledWith("Server-Action fehlgeschlagen:", "kaputt");
  });
});
