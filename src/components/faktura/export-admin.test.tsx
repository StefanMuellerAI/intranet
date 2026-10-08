import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateTimesheetAction } from "@/app/(app)/faktura/export/actions";
import { ExportForm, TimesheetList, type TimesheetView } from "./export-admin";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/(app)/faktura/export/actions", () => ({
  generateTimesheetAction: vi.fn(),
}));

const customers = [
  { id: "c1", name: "ACME GmbH", active: true },
  { id: "c2", name: "Altkunde AG", active: false },
];

/** window.location durch ein beschreibbares Objekt ersetzen (CSV-Download). */
let originalLocation: Location;
let fakeLocation: { href: string };
beforeEach(() => {
  originalLocation = window.location;
  fakeLocation = { href: "http://localhost/faktura/export" };
  Object.defineProperty(window, "location", { configurable: true, value: fakeLocation });
});
afterEach(() => {
  Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
});

function renderForm() {
  return render(<ExportForm customers={customers} defaultMonth="2026-09" />);
}

function comboboxes() {
  const [kunde, zeitraum] = screen.getAllByRole("combobox");
  return { kunde, zeitraum };
}

async function choose(combobox: HTMLElement, label: string) {
  await userEvent.click(combobox);
  await userEvent.click(await screen.findByRole("option", { name: label }));
}

function csvButton() {
  return screen.getByRole("button", { name: "Rohdaten-Export (CSV)" });
}

function pdfButton() {
  return screen.getByRole("button", { name: "Stundenzettel (PDF) erzeugen" });
}

describe("ExportForm", () => {
  it("startet mit Kalendermonat und deaktivierten Buttons ohne Kunde", () => {
    renderForm();
    expect(comboboxes().zeitraum).toHaveTextContent("Kalendermonat (Standard)");
    expect(screen.getByLabelText("Monat")).toHaveValue("2026-09");
    expect(screen.queryByLabelText("KW")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Von")).not.toBeInTheDocument();
    expect(csvButton()).toBeDisabled();
    expect(pdfButton()).toBeDisabled();
  });

  it("kennzeichnet inaktive Kunden in der Auswahl", async () => {
    renderForm();
    await userEvent.click(comboboxes().kunde);
    expect(await screen.findByRole("option", { name: "Altkunde AG (inaktiv)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "ACME GmbH" })).toBeInTheDocument();
  });

  it("CSV-Export im Monatsmodus navigiert zur Export-URL mit Monatsgrenzen", async () => {
    renderForm();
    await choose(comboboxes().kunde, "ACME GmbH");
    expect(csvButton()).toBeEnabled();
    expect(pdfButton()).toBeEnabled();

    await userEvent.click(csvButton());
    expect(fakeLocation.href).toBe("/api/exports/faktura?kunde=c1&von=2026-09-01&bis=2026-09-30");
  });

  it("berechnet das Monatsende korrekt (Schaltjahr-Februar)", async () => {
    renderForm();
    await choose(comboboxes().kunde, "ACME GmbH");
    fireEvent.change(screen.getByLabelText("Monat"), { target: { value: "2028-02" } });
    await userEvent.click(csvButton());
    expect(fakeLocation.href).toBe("/api/exports/faktura?kunde=c1&von=2028-02-01&bis=2028-02-29");
  });

  it("deaktiviert die Buttons ohne gültigen Monat", async () => {
    renderForm();
    await choose(comboboxes().kunde, "ACME GmbH");
    fireEvent.change(screen.getByLabelText("Monat"), { target: { value: "" } });
    expect(csvButton()).toBeDisabled();
    expect(pdfButton()).toBeDisabled();
  });

  it("zeigt im Modus Kalenderwoche Jahr und KW und exportiert Mo–So", async () => {
    renderForm();
    await choose(comboboxes().kunde, "ACME GmbH");
    await choose(comboboxes().zeitraum, "Kalenderwoche");

    expect(screen.queryByLabelText("Monat")).not.toBeInTheDocument();
    const jahr = screen.getByLabelText("Jahr");
    const kw = screen.getByLabelText("KW");
    await userEvent.clear(jahr);
    await userEvent.type(jahr, "2026");
    await userEvent.clear(kw);
    await userEvent.type(kw, "41");

    await userEvent.click(csvButton());
    expect(fakeLocation.href).toBe("/api/exports/faktura?kunde=c1&von=2026-10-05&bis=2026-10-11");
  });

  it("deaktiviert die Buttons bei ungültiger Kalenderwoche", async () => {
    renderForm();
    await choose(comboboxes().kunde, "ACME GmbH");
    await choose(comboboxes().zeitraum, "Kalenderwoche");
    const kw = screen.getByLabelText("KW");

    await userEvent.clear(kw);
    expect(csvButton()).toBeDisabled();
    await userEvent.type(kw, "54");
    expect(csvButton()).toBeDisabled();
    await userEvent.clear(kw);
    await userEvent.type(kw, "0");
    expect(pdfButton()).toBeDisabled();
  });

  it("akzeptiert KW 53 nur in Jahren mit 53 Kalenderwochen", async () => {
    renderForm();
    await choose(comboboxes().kunde, "ACME GmbH");
    await choose(comboboxes().zeitraum, "Kalenderwoche");
    const jahr = screen.getByLabelText("Jahr");
    const kw = screen.getByLabelText("KW");

    await userEvent.clear(jahr);
    await userEvent.type(jahr, "2025"); // 52 Kalenderwochen
    await userEvent.clear(kw);
    await userEvent.type(kw, "53");
    expect(csvButton()).toBeDisabled();

    await userEvent.clear(jahr);
    await userEvent.type(jahr, "2026"); // 53 Kalenderwochen
    expect(csvButton()).toBeEnabled();
  });

  it("zeigt im freien Zeitraum Von/Bis und verlangt Bis ≥ Von", async () => {
    renderForm();
    await choose(comboboxes().kunde, "ACME GmbH");
    await choose(comboboxes().zeitraum, "Freier Zeitraum");

    expect(screen.queryByLabelText("Monat")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("KW")).not.toBeInTheDocument();
    // Ohne Datumsangaben kein gültiger Zeitraum
    expect(csvButton()).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Von"), "2026-10-15");
    await userEvent.type(screen.getByLabelText("Bis"), "2026-10-01");
    expect(csvButton()).toBeDisabled();
    expect(pdfButton()).toBeDisabled();

    await userEvent.clear(screen.getByLabelText("Bis"));
    await userEvent.type(screen.getByLabelText("Bis"), "2026-10-20");
    expect(csvButton()).toBeEnabled();
    await userEvent.click(csvButton());
    expect(fakeLocation.href).toBe("/api/exports/faktura?kunde=c1&von=2026-10-15&bis=2026-10-20");
  });

  it("erzeugt einen Stundenzettel mit Kunde und Zeitraum", async () => {
    vi.mocked(generateTimesheetAction).mockResolvedValueOnce({
      ok: true,
      data: { docNumber: "SZ-2026-0042", version: 2, isDraft: false },
    } as Awaited<ReturnType<typeof generateTimesheetAction>>);
    renderForm();
    await choose(comboboxes().kunde, "Altkunde AG (inaktiv)");
    await userEvent.click(pdfButton());

    await waitFor(() => expect(generateTimesheetAction).toHaveBeenCalledTimes(1));
    const fd = vi.mocked(generateTimesheetAction).mock.calls[0][0];
    expect(fd.get("customerId")).toBe("c2");
    expect(fd.get("fromISO")).toBe("2026-09-01");
    expect(fd.get("toISO")).toBe("2026-09-30");
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Stundenzettel SZ-2026-0042 v2 erzeugt.")
    );
    expect(fakeLocation.href).toBe("http://localhost/faktura/export");
  });

  it("weist bei einem Entwurf auf das Wasserzeichen hin", async () => {
    vi.mocked(generateTimesheetAction).mockResolvedValueOnce({
      ok: true,
      data: { docNumber: "SZ-2026-0043", version: 1, isDraft: true },
    } as Awaited<ReturnType<typeof generateTimesheetAction>>);
    renderForm();
    await choose(comboboxes().kunde, "ACME GmbH");
    await userEvent.click(pdfButton());
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Entwurf SZ-2026-0043 v1 erzeugt — Zeitraum enthält nicht freigegebene Buchungen (Wasserzeichen)."
      )
    );
  });

  it("meldet Fehler beim Erzeugen als Toast", async () => {
    vi.mocked(generateTimesheetAction).mockResolvedValueOnce({
      ok: false,
      error: "Keine Buchungen im Zeitraum.",
    });
    renderForm();
    await choose(comboboxes().kunde, "ACME GmbH");
    await userEvent.click(pdfButton());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Keine Buchungen im Zeitraum."));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("sperrt den PDF-Button, solange der Stundenzettel erzeugt wird", async () => {
    let resolve!: (v: Awaited<ReturnType<typeof generateTimesheetAction>>) => void;
    vi.mocked(generateTimesheetAction).mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      })
    );
    renderForm();
    await choose(comboboxes().kunde, "ACME GmbH");
    await userEvent.click(pdfButton());
    await waitFor(() => expect(pdfButton()).toBeDisabled());
    // Der CSV-Export bleibt davon unberührt
    expect(csvButton()).toBeEnabled();
    await act(async () => resolve({ ok: false, error: "x" }));
    await waitFor(() => expect(pdfButton()).toBeEnabled());
  });
});

describe("TimesheetList", () => {
  const sheets: TimesheetView[] = [
    {
      id: "t1",
      docNumber: "SZ-2026-0040",
      version: 1,
      customerName: "ACME GmbH",
      periodLabel: "September 2026",
      isDraft: false,
      stale: false,
      sha256Short: "ab12cd34",
      createdLabel: "01.10.2026",
      filename: "sz-40.pdf",
    },
    {
      id: "t2",
      docNumber: "SZ-2026-0041",
      version: 3,
      customerName: "Globex",
      periodLabel: "KW 40/2026",
      isDraft: true,
      stale: true,
      sha256Short: "ef56ab78",
      createdLabel: "05.10.2026",
      filename: "sz-41.pdf",
    },
  ];

  it("zeigt ohne Stundenzettel einen Hinweis", () => {
    render(<TimesheetList timesheets={[]} />);
    expect(screen.getByText("Archivierte Stundenzettel (0)")).toBeInTheDocument();
    expect(screen.getByText("Noch keine Stundenzettel erzeugt.")).toBeInTheDocument();
  });

  it("listet Stundenzettel mit Status und Download-Link je Dokument", () => {
    render(<TimesheetList timesheets={sheets} />);
    expect(screen.getByText("Archivierte Stundenzettel (2)")).toBeInTheDocument();

    const aktuell = screen.getByText("SZ-2026-0040 · v1").closest("tr") as HTMLElement;
    expect(within(aktuell).getByText("aktuell")).toBeInTheDocument();
    expect(within(aktuell).getByText("ab12cd34")).toBeInTheDocument();
    // Base UI vergibt dem <a> mit Button-Optik role="button"
    expect(within(aktuell).getByRole("button", { name: "PDF herunterladen" })).toHaveAttribute(
      "href",
      "/api/faktura/stundenzettel/t1"
    );

    const entwurf = screen.getByText("SZ-2026-0041 · v3").closest("tr") as HTMLElement;
    expect(within(entwurf).getByText("Entwurf")).toBeInTheDocument();
    expect(within(entwurf).getByText("veraltet")).toBeInTheDocument();
    expect(within(entwurf).queryByText("aktuell")).not.toBeInTheDocument();
    expect(within(entwurf).getByRole("button", { name: "PDF herunterladen" })).toHaveAttribute(
      "href",
      "/api/faktura/stundenzettel/t2"
    );
  });
});
