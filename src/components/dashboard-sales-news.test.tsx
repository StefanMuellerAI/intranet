import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { dismissSalesNews } from "@/app/(app)/dashboard/actions";
import {
  DashboardSalesNews,
  type DashboardSalesNewsItem,
} from "./dashboard-sales-news";

vi.mock("@/app/(app)/dashboard/actions", () => ({
  dismissSalesNews: vi.fn(async () => {}),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const ITEMS: DashboardSalesNewsItem[] = [
  {
    id: "news-1",
    customerName: "Haufe Akademie",
    volumeLabel: "12.000 €",
    soldByName: "Anna Muster",
    deliveryLabel: "Q1 2027",
    wonLabel: "01.10.2026",
  },
  {
    id: "news-2",
    customerName: "dbb akademie",
    volumeLabel: "4.500 €",
    soldByName: "Ben Beispiel",
    deliveryLabel: "November 2026",
    wonLabel: "05.10.2026",
  },
];

function itemOf(customer: string) {
  return screen.getByText(customer).closest("li") as HTMLElement;
}

describe("DashboardSalesNews", () => {
  it("rendert ohne aktuelle Meldungen gar nichts", () => {
    const { container } = render(<DashboardSalesNews items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("zeigt jede gewonnene Meldung mit Kunde, Volumen, Verkäufer/in und Zeitraum", () => {
    render(<DashboardSalesNews items={ITEMS} />);

    expect(screen.getByText("Gewonnene Aufträge")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    const first = itemOf("Haufe Akademie");
    expect(first).toHaveTextContent("12.000 €");
    expect(first).toHaveTextContent("Gewonnen von Anna Muster");
    expect(first).toHaveTextContent("Leistung vsl. Q1 2027");
    expect(first).toHaveTextContent("Gewonnen am 01.10.2026");
  });

  it("Schließen ruft dismissSalesNews mit der Id genau dieser Meldung auf", async () => {
    render(<DashboardSalesNews items={ITEMS} />);

    await userEvent.click(
      within(itemOf("dbb akademie")).getByRole("button", {
        name: "Meldung schließen",
      })
    );

    await waitFor(() => expect(dismissSalesNews).toHaveBeenCalledTimes(1));
    expect(dismissSalesNews).toHaveBeenCalledWith("news-2");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("blendet geschlossene Meldungen nach der Aktualisierung aus — die letzte entfernt die ganze Karte", async () => {
    // Das Ausblenden übernimmt die Server-Revalidierung (revalidatePath):
    // die Seite liefert die Liste ohne die geschlossene Meldung neu.
    const { rerender, container } = render(<DashboardSalesNews items={ITEMS} />);

    await userEvent.click(
      within(itemOf("Haufe Akademie")).getByRole("button", {
        name: "Meldung schließen",
      })
    );
    await waitFor(() => expect(dismissSalesNews).toHaveBeenCalledWith("news-1"));

    rerender(<DashboardSalesNews items={ITEMS.filter((i) => i.id !== "news-1")} />);
    expect(screen.queryByText("Haufe Akademie")).not.toBeInTheDocument();
    expect(screen.getByText("dbb akademie")).toBeInTheDocument();

    rerender(<DashboardSalesNews items={[]} />);
    expect(screen.queryByTestId("sales-nachrichten")).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it("sperrt den Schließen-Button, solange die Action läuft", async () => {
    let finish: () => void = () => {};
    vi.mocked(dismissSalesNews).mockImplementationOnce(
      () => new Promise<void>((resolve) => (finish = resolve))
    );
    render(<DashboardSalesNews items={ITEMS} />);
    const button = within(itemOf("Haufe Akademie")).getByRole("button", {
      name: "Meldung schließen",
    });

    await userEvent.click(button);
    expect(button).toBeDisabled();
    // Die andere Meldung bleibt bedienbar
    expect(
      within(itemOf("dbb akademie")).getByRole("button", {
        name: "Meldung schließen",
      })
    ).toBeEnabled();

    finish();
    await waitFor(() => expect(button).toBeEnabled());
  });

  it("zeigt einen Fehler-Toast, wenn das Schließen fehlschlägt", async () => {
    vi.mocked(dismissSalesNews).mockRejectedValueOnce(
      new Error("Sales-Nachricht nicht gefunden.")
    );
    render(<DashboardSalesNews items={ITEMS} />);

    await userEvent.click(
      within(itemOf("Haufe Akademie")).getByRole("button", {
        name: "Meldung schließen",
      })
    );

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Sales-Nachricht nicht gefunden.")
    );
    expect(screen.getByText("Haufe Akademie")).toBeInTheDocument();
  });

  it("meldet „Fehler“, wenn kein Error-Objekt geworfen wird", async () => {
    vi.mocked(dismissSalesNews).mockRejectedValueOnce("offline");
    render(<DashboardSalesNews items={ITEMS.slice(0, 1)} />);

    await userEvent.click(
      screen.getByRole("button", { name: "Meldung schließen" })
    );

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Fehler"));
  });
});
