import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import {
  resubmitExpenseReport,
  submitExpenseReport,
} from "@/app/(app)/reisekosten/actions";
import { formatEuro, type MealRates } from "@/lib/expenses/calc";
import {
  MAX_RECEIPTS_TOTAL_BYTES,
  prepareReceiptFile,
  receiptsTooLargeMessage,
} from "@/lib/expenses/receipt-upload";
import { ExpenseForm, type ExpenseFormDefaults } from "./expense-form";

vi.mock("@/app/(app)/reisekosten/actions", () => ({
  submitExpenseReport: vi.fn(async () => {}),
  resubmitExpenseReport: vi.fn(async () => {}),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Canvas-Komprimierung gibt es in happy-dom nicht: standardmäßig die echte
// Funktion (PDF → unverändert), einzelne Tests simulieren die Komprimierung.
vi.mock("@/lib/expenses/receipt-upload", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/expenses/receipt-upload")>();
  return { ...actual, prepareReceiptFile: vi.fn(actual.prepareReceiptFile) };
});

const RATES: MealRates = {
  fullDayCents: 2800,
  partialDayCents: 1400,
  breakfastCents: 560,
  lunchCents: 1120,
  dinnerCents: 1120,
  kmCents: 30,
  passengerKmCents: 2,
  employerDailySupplementCents: 0,
};

/** Betrag wie angezeigt — Testing Library normalisiert das geschützte Leerzeichen */
const euro = (cents: number) => formatEuro(cents).replace(/\s/g, " ");

const TRANSPORT = "3. Fahrtkosten (Beleg beifügen)";
const LODGING = "4. Übernachtung (Rechnung auf die GmbH)";
const INCIDENTALS = "5. Reisenebenkosten (Beleg beifügen)";

function renderForm(
  props: Partial<React.ComponentProps<typeof ExpenseForm>> = {}
) {
  return render(
    <ExpenseForm
      action={submitExpenseReport}
      rates={RATES}
      submitLabel="Abrechnung einreichen"
      {...props}
    />
  );
}

/** Die Labels sind nicht per htmlFor verknüpft — Feld über den Container finden */
function field(label: string, container: HTMLElement = document.body) {
  const labelEl = within(container).getByText(label, { selector: "label" });
  const input = labelEl.parentElement?.querySelector("input");
  if (!input) throw new Error(`Kein Eingabefeld zu „${label}“`);
  return input;
}

function setField(label: string, value: string) {
  fireEvent.change(field(label), { target: { value } });
}

/** Mo 09.11.2026 08:00 bis Mi 11.11.2026 18:00 → drei Verpflegungstage */
function setTripDates() {
  setField("Abreise: Datum", "2026-11-09");
  setField("Abreise: Uhrzeit", "08:00");
  setField("Rückkehr: Datum", "2026-11-11");
  setField("Rückkehr: Uhrzeit", "18:00");
}

function card(title: string): HTMLElement {
  const el = screen.getByText(title).closest<HTMLElement>('[data-slot="card"]');
  if (!el) throw new Error(`Karte „${title}“ nicht gefunden`);
  return el;
}

function totalRow(label: string) {
  const dt = screen.getByText(label, { selector: "dt" });
  return dt.nextElementSibling as HTMLElement;
}

function lastPayload() {
  const calls = vi.mocked(submitExpenseReport).mock.calls;
  const fd = calls[calls.length - 1][0];
  return { fd, payload: JSON.parse(String(fd.get("payload"))) };
}

describe("ExpenseForm", () => {
  it("„Zeilen aus Reisezeitraum erzeugen“ ist erst mit vollständigem Zeitraum aktiv und erzeugt die Verpflegungszeilen", async () => {
    renderForm();
    const generate = screen.getByRole("button", {
      name: "Zeilen aus Reisezeitraum erzeugen",
    });
    expect(generate).toBeDisabled();

    setField("Abreise: Datum", "2026-11-09");
    setField("Abreise: Uhrzeit", "08:00");
    setField("Rückkehr: Datum", "2026-11-11");
    expect(generate).toBeDisabled();

    setField("Rückkehr: Uhrzeit", "18:00");
    expect(generate).toBeEnabled();
    expect(screen.getByText("58 Std.")).toBeInTheDocument();

    await userEvent.click(generate);

    const rows = within(card("2. Verpflegungspauschale (keine Belege erforderlich)"))
      .getAllByRole("row")
      .slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("9.11.2026");
    expect(rows[0]).toHaveTextContent(euro(1400));
    expect(rows[1]).toHaveTextContent(euro(2800));
    expect(rows[2]).toHaveTextContent("11.11.2026");
    expect(
      screen.getByText(`Summe Verpflegung: ${euro(5600)}`)
    ).toBeInTheDocument();
    expect(totalRow("Verpflegungspauschale (steuerfrei)")).toHaveTextContent(
      euro(5600)
    );
  });

  it("Rückkehr vor Abreise gilt nicht als vollständiger Zeitraum", () => {
    renderForm();
    setField("Abreise: Datum", "2026-11-11");
    setField("Abreise: Uhrzeit", "08:00");
    setField("Rückkehr: Datum", "2026-11-09");
    setField("Rückkehr: Uhrzeit", "18:00");

    expect(
      screen.getByRole("button", { name: "Zeilen aus Reisezeitraum erzeugen" })
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Abrechnung einreichen" })
    ).toBeDisabled();
    expect(screen.queryByText(/Dauer gesamt/)).not.toBeInTheDocument();
  });

  it("gestellte Mahlzeiten kürzen die Pauschale live", async () => {
    renderForm();
    setTripDates();
    await userEvent.click(
      screen.getByRole("button", { name: "Zeilen aus Reisezeitraum erzeugen" })
    );
    const rows = within(card("2. Verpflegungspauschale (keine Belege erforderlich)"))
      .getAllByRole("row")
      .slice(1);

    // Mitteltag (ganzer Tag): Frühstück gestellt → 28,00 − 5,60
    await userEvent.click(within(rows[1]).getAllByRole("checkbox")[0]);
    expect(rows[1]).toHaveTextContent(`−${euro(560)}`);
    expect(rows[1]).toHaveTextContent(euro(2240));
    expect(
      screen.getByText(`Summe Verpflegung: ${euro(5040)}`)
    ).toBeInTheDocument();

    // Anreisetag: Mittag + Abend gestellt → Kürzung gekappt beim Grundsatz
    await userEvent.click(within(rows[0]).getAllByRole("checkbox")[1]);
    await userEvent.click(within(rows[0]).getAllByRole("checkbox")[2]);
    expect(rows[0]).toHaveTextContent(`−${euro(1400)}`);
    expect(
      screen.getByText(`Summe Verpflegung: ${euro(3640)}`)
    ).toBeInTheDocument();
    expect(totalRow("Gesamterstattung")).toHaveTextContent(euro(3640));
  });

  it("ändert die Abwesenheitsart einer Zeile über die Auswahl", async () => {
    const user = userEvent.setup();
    renderForm();
    setTripDates();
    await user.click(
      screen.getByRole("button", { name: "Zeilen aus Reisezeitraum erzeugen" })
    );
    const rows = within(card("2. Verpflegungspauschale (keine Belege erforderlich)"))
      .getAllByRole("row")
      .slice(1);

    await user.click(within(rows[1]).getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "unter 8 Std." }));

    expect(
      screen.getByText(`Summe Verpflegung: ${euro(2800)}`)
    ).toBeInTheDocument();
  });

  it.each([TRANSPORT, LODGING, INCIDENTALS])(
    "„Position hinzufügen“ und „Entfernen“ funktionieren in Block %s",
    async (title) => {
      renderForm();
      const block = card(title);
      expect(within(block).queryByText("Entfernen")).not.toBeInTheDocument();

      await userEvent.click(
        within(block).getByRole("button", { name: "Position hinzufügen" })
      );
      await userEvent.click(
        within(block).getByRole("button", { name: "Position hinzufügen" })
      );
      expect(within(block).getAllByRole("button", { name: "Entfernen" })).toHaveLength(2);

      // Erste Zeile befüllen, zweite entfernen → die befüllte bleibt stehen
      const amounts = within(block).getAllByPlaceholderText("0,00");
      fireEvent.change(amounts[0], { target: { value: "12,50" } });
      await userEvent.click(
        within(block).getAllByRole("button", { name: "Entfernen" })[1]
      );
      expect(within(block).getAllByRole("button", { name: "Entfernen" })).toHaveLength(1);
      expect(within(block).getByPlaceholderText("0,00")).toHaveValue("12,50");

      await userEvent.click(
        within(block).getByRole("button", { name: "Entfernen" })
      );
      expect(within(block).queryByText("Entfernen")).not.toBeInTheDocument();
    }
  );

  it("Belegbeträge fließen in die Erstattungssumme ein", async () => {
    renderForm();
    await userEvent.click(
      within(card(TRANSPORT)).getByRole("button", { name: "Position hinzufügen" })
    );
    await userEvent.click(
      within(card(LODGING)).getByRole("button", { name: "Position hinzufügen" })
    );
    fireEvent.change(within(card(TRANSPORT)).getByPlaceholderText("0,00"), {
      target: { value: "12,50" },
    });
    fireEvent.change(within(card(LODGING)).getByPlaceholderText("0,00"), {
      target: { value: "1.089,90" },
    });

    expect(totalRow("Fahrtkosten (Belege)")).toHaveTextContent(euro(1250));
    expect(totalRow("Übernachtung")).toHaveTextContent(euro(108990));
    expect(totalRow("Gesamterstattung")).toHaveTextContent(euro(110240));
  });

  it("versteht Punkt und Komma als Dezimaltrenner (wie das Eingabemuster erlaubt)", async () => {
    renderForm();
    await userEvent.click(
      within(card(INCIDENTALS)).getByRole("button", { name: "Position hinzufügen" })
    );
    const amount = within(card(INCIDENTALS)).getByPlaceholderText("0,00");

    fireEvent.change(amount, { target: { value: "12.50" } });
    expect(totalRow("Reisenebenkosten")).toHaveTextContent(euro(1250));

    fireEvent.change(amount, { target: { value: "12,5" } });
    expect(totalRow("Reisenebenkosten")).toHaveTextContent(euro(1250));

    // Unlesbares zählt als 0 statt NaN
    fireEvent.change(amount, { target: { value: "2h" } });
    expect(totalRow("Reisenebenkosten")).toHaveTextContent(euro(0));
  });

  it("Privat-Pkw: Kilometer und Mitfahrende aktualisieren Betrag und Summe", () => {
    renderForm();
    const privatPkw = card("Privat-Pkw");
    expect(within(privatPkw).getByText(/Betrag:/)).toHaveTextContent(
      euro(0)
    );

    fireEvent.change(field("Gefahrene km", privatPkw), {
      target: { value: "100" },
    });
    expect(within(privatPkw).getByText(/Betrag:/)).toHaveTextContent(
      euro(3000)
    );

    fireEvent.change(field("Mitgenommene Personen", privatPkw), {
      target: { value: "2" },
    });
    // 100 km × 0,30 € + 100 km × 2 × 0,02 €
    expect(within(privatPkw).getByText(/Betrag:/)).toHaveTextContent(
      euro(3400)
    );
    expect(totalRow("Fahrtkosten Privat-Pkw")).toHaveTextContent(euro(3400));
    expect(totalRow("Gesamterstattung")).toHaveTextContent(euro(3400));
  });

  it("Auslandsreise blendet den Hinweis zu den BMF-Pauschalen ein", async () => {
    renderForm();
    expect(screen.queryByText("Auslandsreise")).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("checkbox", { name: "Reiseziel im Ausland" })
    );

    expect(screen.getByText("Auslandsreise")).toBeInTheDocument();
    expect(
      screen.getByText(/länderspezifische Pauschalen des\s+Bundesministeriums der Finanzen/)
    ).toBeInTheDocument();
  });

  it("zeigt die Abgabefrist (5. des Folgemonats) zum Rückkehrdatum", () => {
    renderForm();
    setField("Rückkehr: Datum", "2026-11-11");
    expect(screen.getByText(/hier:\s*5\.12\.2026/)).toBeInTheDocument();
  });

  it("sendet das JSON-Payload mit Reise, Verpflegung, Pkw und Belegen (leere Zeilen verworfen)", async () => {
    const user = userEvent.setup();
    renderForm();
    setField("Reiseziel (Ort)", "München");
    setField("Kunde / Anlass", "Haufe Workshop");
    setTripDates();
    await user.click(
      screen.getByRole("checkbox", { name: "Reiseziel im Ausland" })
    );
    await user.click(
      screen.getByRole("button", { name: "Zeilen aus Reisezeitraum erzeugen" })
    );
    fireEvent.change(field("Gefahrene km"), { target: { value: "120" } });
    fireEvent.change(field("Mitgenommene Personen"), { target: { value: "1" } });

    // Fahrtkosten: eine vollständige Zeile ohne Beleg
    const transport = card(TRANSPORT);
    await user.click(
      within(transport).getByRole("button", { name: "Position hinzufügen" })
    );
    fireEvent.change(field("Datum", transport), { target: { value: "2026-11-09" } });
    fireEvent.change(field("Verkehrsmittel / Strecke", transport), {
      target: { value: "Taxi Hbf" },
    });
    fireEvent.change(within(transport).getByPlaceholderText("0,00"), {
      target: { value: "23,40" },
    });

    // Übernachtung: mit PDF-Beleg
    const lodging = card(LODGING);
    await user.click(
      within(lodging).getByRole("button", { name: "Position hinzufügen" })
    );
    fireEvent.change(field("Datum", lodging), { target: { value: "2026-11-10" } });
    fireEvent.change(field("Hotel / Ort", lodging), {
      target: { value: "Hotel Isar" },
    });
    fireEvent.change(within(lodging).getByPlaceholderText("0,00"), {
      target: { value: "189,00" },
    });
    const pdf = new File(["%PDF-1.4"], "hotel.pdf", { type: "application/pdf" });
    await user.upload(field("Beleg (PDF/JPG/PNG)", lodging), pdf);

    // Nebenkosten: unvollständige Zeile wird nicht übertragen
    await user.click(
      within(card(INCIDENTALS)).getByRole("button", { name: "Position hinzufügen" })
    );

    await user.click(
      screen.getByRole("button", { name: "Abrechnung einreichen" })
    );

    await waitFor(() => expect(submitExpenseReport).toHaveBeenCalledTimes(1));
    const { fd, payload } = lastPayload();
    expect(payload).toEqual({
      destination: "München",
      customerPurpose: "Haufe Workshop",
      departureDate: "2026-11-09",
      departureTime: "08:00",
      returnDate: "2026-11-11",
      returnTime: "18:00",
      isAbroad: true,
      mealDays: [
        {
          date: "2026-11-09",
          absenceType: "an_abreisetag",
          breakfastProvided: false,
          lunchProvided: false,
          dinnerProvided: false,
        },
        {
          date: "2026-11-10",
          absenceType: "ganzer_tag",
          breakfastProvided: false,
          lunchProvided: false,
          dinnerProvided: false,
        },
        {
          date: "2026-11-11",
          absenceType: "an_abreisetag",
          breakfastProvided: false,
          lunchProvided: false,
          dinnerProvided: false,
        },
      ],
      transport: [
        { date: "2026-11-09", description: "Taxi Hbf", amountCents: 2340 },
      ],
      carKilometers: 120,
      carPassengers: 1,
      lodging: [
        {
          date: "2026-11-10",
          description: "Hotel Isar",
          amountCents: 18900,
          fileIndex: 0,
        },
      ],
      incidentals: [],
    });
    const receipt = fd.get("receipt_0");
    expect(receipt).toBeInstanceOf(File);
    expect((receipt as File).name).toBe("hotel.pdf");
    expect(fd.get("receipt_1")).toBeNull();
  });

  it("bricht bei zu großen Belegen mit der Größenmeldung ab, ohne die Action aufzurufen", async () => {
    const user = userEvent.setup();
    renderForm();
    setField("Reiseziel (Ort)", "Berlin");
    setField("Kunde / Anlass", "dbb");
    setTripDates();

    const lodging = card(LODGING);
    await user.click(
      within(lodging).getByRole("button", { name: "Position hinzufügen" })
    );
    fireEvent.change(field("Datum", lodging), { target: { value: "2026-11-10" } });
    fireEvent.change(field("Hotel / Ort", lodging), {
      target: { value: "Hotel Spree" },
    });
    // PDFs werden nicht komprimiert → bleiben über dem Limit
    const big = new File(
      [new Uint8Array(MAX_RECEIPTS_TOTAL_BYTES + 1024)],
      "rechnung-scan.pdf",
      { type: "application/pdf" }
    );
    await user.upload(field("Beleg (PDF/JPG/PNG)", lodging), big);

    await user.click(
      screen.getByRole("button", { name: "Abrechnung einreichen" })
    );

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        receiptsTooLargeMessage([{ name: "rechnung-scan.pdf", size: big.size }])
      )
    );
    expect(vi.mocked(toast.error).mock.calls[0][0]).toMatch(
      /Die Belege sind zusammen zu groß für den Upload/
    );
    expect(submitExpenseReport).not.toHaveBeenCalled();
  });

  it("komprimiert Fotos in einer zweiten, stärkeren Stufe, wenn die Summe sonst zu groß bliebe", async () => {
    // Stufe 1 (normal) bringt nichts, Stufe 2 (stark) verkleinert auf 1 MB
    vi.mocked(prepareReceiptFile)
      .mockImplementationOnce(async (file) => file)
      .mockImplementationOnce(
        async () =>
          new File([new Uint8Array(1024 * 1024)], "foto.jpg", {
            type: "image/jpeg",
          })
      );
    const user = userEvent.setup();
    renderForm();
    setField("Reiseziel (Ort)", "Berlin");
    setField("Kunde / Anlass", "dbb");
    setTripDates();

    const incidentals = card(INCIDENTALS);
    await user.click(
      within(incidentals).getByRole("button", { name: "Position hinzufügen" })
    );
    fireEvent.change(field("Datum", incidentals), {
      target: { value: "2026-11-10" },
    });
    fireEvent.change(field("Art (Parken, ÖPNV, Maut …)", incidentals), {
      target: { value: "Parkhaus" },
    });
    const photo = new File(
      [new Uint8Array(MAX_RECEIPTS_TOTAL_BYTES + 1024)],
      "foto.png",
      { type: "image/png" }
    );
    await user.upload(field("Beleg (PDF/JPG/PNG)", incidentals), photo);

    await user.click(
      screen.getByRole("button", { name: "Abrechnung einreichen" })
    );

    await waitFor(() => expect(submitExpenseReport).toHaveBeenCalledTimes(1));
    expect(vi.mocked(prepareReceiptFile).mock.calls.map((c) => c[1])).toEqual([
      false,
      true,
    ]);
    expect(toast.error).not.toHaveBeenCalled();
    const { fd, payload } = lastPayload();
    expect(payload.incidentals[0]).toMatchObject({
      description: "Parkhaus",
      fileIndex: 0,
    });
    expect((fd.get("receipt_0") as File).name).toBe("foto.jpg");
    expect((fd.get("receipt_0") as File).size).toBe(1024 * 1024);
  });

  it("Belege ohne Datum/Beschreibung zählen nicht zur Größenprüfung", async () => {
    const user = userEvent.setup();
    renderForm();
    setField("Reiseziel (Ort)", "Berlin");
    setField("Kunde / Anlass", "dbb");
    setTripDates();

    const lodging = card(LODGING);
    await user.click(
      within(lodging).getByRole("button", { name: "Position hinzufügen" })
    );
    const big = new File(
      [new Uint8Array(MAX_RECEIPTS_TOTAL_BYTES + 1024)],
      "entwurf.pdf",
      { type: "application/pdf" }
    );
    await user.upload(field("Beleg (PDF/JPG/PNG)", lodging), big);

    await user.click(
      screen.getByRole("button", { name: "Abrechnung einreichen" })
    );

    await waitFor(() => expect(submitExpenseReport).toHaveBeenCalledTimes(1));
    expect(toast.error).not.toHaveBeenCalled();
    const { fd, payload } = lastPayload();
    expect(payload.lodging).toEqual([]);
    expect(fd.get("receipt_0")).toBeNull();
  });

  it("verhindert das Absenden ohne vollständigen Zeitraum mit Hinweis-Toast", () => {
    const { container } = renderForm();
    expect(
      screen.getByRole("button", { name: "Abrechnung einreichen" })
    ).toBeDisabled();

    fireEvent.submit(container.querySelector("form")!);

    expect(toast.error).toHaveBeenCalledWith(
      "Bitte Abreise und Rückkehr vollständig angeben."
    );
    expect(submitExpenseReport).not.toHaveBeenCalled();
  });

  it("Korrekturmodus: übernimmt Vorgaben inkl. vorhandener Belege", async () => {
    const user = userEvent.setup();
    const defaults: ExpenseFormDefaults = {
      destination: "Köln",
      customerPurpose: "Workshop",
      departureDate: "2026-11-09",
      departureTime: "07:00",
      returnDate: "2026-11-09",
      returnTime: "19:00",
      isAbroad: false,
      mealDays: [
        {
          date: "2026-11-09",
          absenceType: "ueber_8_std",
          breakfastProvided: false,
          lunchProvided: true,
          dinnerProvided: false,
        },
      ],
      transport: [
        {
          date: "2026-11-09",
          description: "Bahn",
          amountCents: 4990,
          receiptId: "beleg-1",
          receiptName: "bahn.pdf",
        },
      ],
      carKilometers: 0,
      carPassengers: 0,
      lodging: [],
      incidentals: [],
    };
    renderForm({
      action: resubmitExpenseReport.bind(null, "rk-1"),
      submitLabel: "Korrigiert erneut einreichen",
      defaults,
    });

    expect(screen.getByText("Vorhandener Beleg: bahn.pdf")).toBeInTheDocument();
    expect(within(card(TRANSPORT)).getByPlaceholderText("0,00")).toHaveValue(
      "49,90"
    );
    // 14,00 − 11,20 Mittag
    expect(
      screen.getByText(`Summe Verpflegung: ${euro(280)}`)
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Korrigiert erneut einreichen" })
    );

    await waitFor(() => expect(resubmitExpenseReport).toHaveBeenCalledTimes(1));
    const [id, fd] = vi.mocked(resubmitExpenseReport).mock.calls[0];
    expect(id).toBe("rk-1");
    const payload = JSON.parse(String(fd.get("payload")));
    expect(payload.transport).toEqual([
      {
        date: "2026-11-09",
        description: "Bahn",
        amountCents: 4990,
        existingReceiptId: "beleg-1",
      },
    ]);
  });

  it("zeigt einen Fehler-Toast, wenn die Action fehlschlägt", async () => {
    vi.mocked(submitExpenseReport).mockRejectedValueOnce(
      new Error("Abrechnung bereits eingereicht.")
    );
    const user = userEvent.setup();
    renderForm();
    setField("Reiseziel (Ort)", "Berlin");
    setField("Kunde / Anlass", "dbb");
    setTripDates();

    await user.click(
      screen.getByRole("button", { name: "Abrechnung einreichen" })
    );

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Abrechnung bereits eingereicht.")
    );
  });
});
