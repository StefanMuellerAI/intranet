import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import {
  resubmitCommissionClaim,
  submitCommissionClaim,
} from "@/app/(app)/provision/actions";
import type { CommissionRates } from "@/lib/commissions/calc";
import { formatEuro } from "@/lib/expenses/calc";
import { CommissionForm } from "./commission-form";

vi.mock("@/app/(app)/provision/actions", () => ({
  submitCommissionClaim: vi.fn(async () => {}),
  resubmitCommissionClaim: vi.fn(async () => {}),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const RATES: CommissionRates = {
  halfDayCents: 5000,
  fullDayCents: 7500,
  twoDayCents: 10000,
  consultingPercent: 4,
};

/** Betrag wie angezeigt — Testing Library normalisiert das geschützte Leerzeichen */
const euro = (cents: number) => formatEuro(cents).replace(/\s/g, " ");

// Reihenfolge der Auswahlfelder im Formular (Labels sind nicht verknüpft)
const ART = 0;
const KUNDENART = 1;
const EINHEIT = 2;
const FORMAT = 3;

function renderForm(
  props: Partial<React.ComponentProps<typeof CommissionForm>> = {}
) {
  return render(
    <CommissionForm
      action={submitCommissionClaim}
      rates={RATES}
      submitLabel="Provision beantragen"
      {...props}
    />
  );
}

async function choose(index: number, option: string | RegExp) {
  await userEvent.click(screen.getAllByRole("combobox")[index]);
  await userEvent.click(await screen.findByRole("option", { name: option }));
}

function submitButton() {
  return screen.getByRole("button", { name: "Provision beantragen" });
}

describe("CommissionForm", () => {
  it("zeigt in den Auswahlfeldern Beschriftungen statt interner Werte", () => {
    renderForm();
    const [art, kundenart, einheit] = screen.getAllByRole("combobox");
    expect(art).toHaveTextContent("Schulung (Folge-Training)");
    expect(kundenart).toHaveTextContent("Bestandskunde / über Partner");
    expect(einheit).toHaveTextContent("Tage");
  });

  it("wechselt das Trainingsformat ohne Warnung zu kontrollierten Feldern", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderForm();
    await choose(FORMAT, /^ganztägig/);
    const output = spy.mock.calls.flat().join(" ");
    spy.mockRestore();
    expect(output).not.toMatch(/uncontrolled value state of Select/);
  });

  it("zeigt bei Schulung Format und Anzahl, bei Beratung den Nettoauftragswert", async () => {
    renderForm();
    expect(screen.getAllByRole("combobox")).toHaveLength(4);
    expect(
      screen.getByLabelText("Anzahl zusätzlich bestellter Trainings")
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/Nettoauftragswert/)).not.toBeInTheDocument();

    await choose(ART, "Beratung (Folgeberatung)");

    expect(screen.getAllByRole("combobox")).toHaveLength(3);
    expect(screen.getByLabelText(/Nettoauftragswert/)).toBeRequired();
    expect(
      screen.queryByLabelText("Anzahl zusätzlich bestellter Trainings")
    ).not.toBeInTheDocument();

    await choose(ART, "Schulung (Folge-Training)");
    expect(
      screen.getByLabelText("Anzahl zusätzlich bestellter Trainings")
    ).toBeInTheDocument();
  });

  it("blendet den Neukunden-Hinweis nur für komplett neue Kunden ein", async () => {
    renderForm();
    expect(screen.queryByText("Neukunden-Vermittlung")).not.toBeInTheDocument();

    await choose(KUNDENART, "Komplett neuer Kunde");
    expect(screen.getByText("Neukunden-Vermittlung")).toBeInTheDocument();

    await choose(KUNDENART, "Bestandskunde / über Partner");
    expect(screen.queryByText("Neukunden-Vermittlung")).not.toBeInTheDocument();
  });

  it("berechnet die Vorschau live je Trainingsformat und Anzahl", async () => {
    renderForm();
    expect(
      screen.queryByText(/Berechneter Provisionsanspruch/)
    ).not.toBeInTheDocument();

    await choose(FORMAT, /^ganztägig/);
    expect(
      screen.getByText(`Berechneter Provisionsanspruch: ${euro(7500)}`)
    ).toBeInTheDocument();

    fireEvent.change(
      screen.getByLabelText("Anzahl zusätzlich bestellter Trainings"),
      { target: { value: "3" } }
    );
    expect(
      screen.getByText(`Berechneter Provisionsanspruch: ${euro(22500)}`)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Je zusätzlich bestelltem Training gemäß Format/)
    ).toBeInTheDocument();

    await choose(FORMAT, /^halbtägig/);
    expect(
      screen.getByText(`Berechneter Provisionsanspruch: ${euro(15000)}`)
    ).toBeInTheDocument();

    await choose(FORMAT, /^zweitägig/);
    expect(
      screen.getByText(`Berechneter Provisionsanspruch: ${euro(30000)}`)
    ).toBeInTheDocument();
  });

  it("abweichendes Format: kein Autobetrag, stattdessen Pauschalen-Hinweis", async () => {
    renderForm();
    await choose(FORMAT, "abweichendes Format (Pauschale)");

    expect(
      screen.queryByText(/Berechneter Provisionsanspruch/)
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Abweichendes Trainingsformat")
    ).toBeInTheDocument();
    expect(submitButton()).toBeEnabled();
  });

  it("berechnet bei Beratung den Prozentsatz vom Nettoauftragswert", async () => {
    renderForm();
    await choose(ART, "Beratung (Folgeberatung)");
    const net = screen.getByLabelText(/Nettoauftragswert/);

    fireEvent.change(net, { target: { value: "5.000,00" } });
    expect(
      screen.getByText(`Berechneter Provisionsanspruch: ${euro(20000)}`)
    ).toBeInTheDocument();
    expect(screen.getByText(/4 % vom Nettoauftragswert\./)).toBeInTheDocument();

    // Punkt als Dezimaltrenner ist laut Eingabemuster erlaubt
    fireEvent.change(net, { target: { value: "5000.50" } });
    expect(
      screen.getByText(`Berechneter Provisionsanspruch: ${euro(20002)}`)
    ).toBeInTheDocument();

    fireEvent.change(net, { target: { value: "" } });
    expect(
      screen.queryByText(/Berechneter Provisionsanspruch/)
    ).not.toBeInTheDocument();
  });

  it("sperrt das Absenden bei Schulung, solange kein Format gewählt ist", async () => {
    renderForm();
    expect(submitButton()).toBeDisabled();

    await choose(FORMAT, /^halbtägig/);
    expect(submitButton()).toBeEnabled();
  });

  it("Beratung lässt sich ohne Trainingsformat absenden", () => {
    renderForm({ defaults: { businessType: "beratung" } });
    expect(submitButton()).toBeEnabled();
  });

  it("passt die Umfang-Beschriftung an die Einheit an", async () => {
    renderForm();
    expect(screen.getByLabelText("Umfang (Tage)")).toBeInTheDocument();

    await choose(EINHEIT, "Liefergegenstände");
    expect(
      screen.getByLabelText("Umfang (Anzahl Liefergegenstände)")
    ).toBeInTheDocument();
  });

  it("übergibt bei Schulung alle Felder als FormData", async () => {
    const user = userEvent.setup();
    renderForm();
    await choose(KUNDENART, "Komplett neuer Kunde");
    await choose(EINHEIT, "Liefergegenstände");
    await choose(FORMAT, /^zweitägig/);
    await user.type(screen.getByLabelText("Kunde / Organisation"), "Haufe Akademie");
    fireEvent.change(screen.getByLabelText("Datum der Bestellung"), {
      target: { value: "2026-10-01" },
    });
    fireEvent.change(screen.getByLabelText("Umfang (Anzahl Liefergegenstände)"), {
      target: { value: "2" },
    });
    fireEvent.change(
      screen.getByLabelText("Anzahl zusätzlich bestellter Trainings"),
      { target: { value: "4" } }
    );
    await user.type(screen.getByLabelText("Bemerkung (optional)"), "Projekt X");

    await user.click(submitButton());

    await waitFor(() => expect(submitCommissionClaim).toHaveBeenCalledTimes(1));
    const fd = vi.mocked(submitCommissionClaim).mock.calls[0][0];
    expect(Object.fromEntries(fd.entries())).toEqual({
      businessType: "schulung",
      customerType: "neukunde",
      customerName: "Haufe Akademie",
      orderDate: "2026-10-01",
      unit: "liefergegenstaende",
      quantity: "2",
      trainingFormat: "zweitaegig",
      trainingCount: "4",
      note: "Projekt X",
    });
  });

  it("übergibt bei Beratung den Nettoauftragswert statt Trainingsangaben", async () => {
    const user = userEvent.setup();
    renderForm();
    await choose(ART, "Beratung (Folgeberatung)");
    await user.type(screen.getByLabelText("Kunde / Organisation"), "dbb");
    fireEvent.change(screen.getByLabelText("Datum der Bestellung"), {
      target: { value: "2026-10-01" },
    });
    fireEvent.change(screen.getByLabelText("Umfang (Tage)"), {
      target: { value: "1.5" },
    });
    fireEvent.change(screen.getByLabelText(/Nettoauftragswert/), {
      target: { value: "1234,50" },
    });

    await user.click(submitButton());

    await waitFor(() => expect(submitCommissionClaim).toHaveBeenCalledTimes(1));
    const fd = vi.mocked(submitCommissionClaim).mock.calls[0][0];
    expect(fd.get("businessType")).toBe("beratung");
    expect(fd.get("netOrderValue")).toBe("1234,50");
    expect(fd.get("quantity")).toBe("1.5");
    expect(fd.has("trainingFormat")).toBe(false);
    expect(fd.has("trainingCount")).toBe(false);
  });

  it("Korrekturmodus: übernimmt Vorgaben und reicht erneut ein", async () => {
    const user = userEvent.setup();
    renderForm({
      action: resubmitCommissionClaim.bind(null, "p-1"),
      submitLabel: "Korrigiert erneut einreichen",
      defaults: {
        businessType: "schulung",
        customerType: "bestandskunde",
        customerName: "VHS Köln",
        orderDate: "2026-09-15",
        unit: "tage",
        quantity: 1,
        trainingFormat: "halbtaegig",
        trainingCount: 2,
        note: "Nachtrag",
      },
    });

    expect(
      screen.getByText(`Berechneter Provisionsanspruch: ${euro(10000)}`)
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Korrigiert erneut einreichen" })
    );

    await waitFor(() =>
      expect(resubmitCommissionClaim).toHaveBeenCalledTimes(1)
    );
    const [id, fd] = vi.mocked(resubmitCommissionClaim).mock.calls[0];
    expect(id).toBe("p-1");
    expect(fd.get("customerName")).toBe("VHS Köln");
    expect(fd.get("trainingFormat")).toBe("halbtaegig");
    expect(fd.get("trainingCount")).toBe("2");
    expect(fd.get("note")).toBe("Nachtrag");
  });

  it("zeigt einen Fehler-Toast, wenn die Action fehlschlägt", async () => {
    vi.mocked(submitCommissionClaim).mockRejectedValueOnce(
      new Error("Bestelldatum liegt in der Zukunft.")
    );
    const user = userEvent.setup();
    renderForm({
      defaults: {
        customerName: "dbb",
        orderDate: "2026-10-01",
        quantity: 1,
        trainingFormat: "ganztaegig",
      },
    });

    await user.click(submitButton());

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Bestelldatum liegt in der Zukunft."
      )
    );
  });
});
