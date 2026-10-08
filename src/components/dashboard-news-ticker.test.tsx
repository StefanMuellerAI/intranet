import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DashboardNewsTicker } from "./dashboard-news-ticker";

const ITEMS = [
  { id: "n1", title: "Sommerfest", body: "Am 12.09. ab 16 Uhr\n  im Büro Köln." },
  { id: "n2", title: "Neue Kollegin", body: "Willkommen, Anna!" },
];

describe("DashboardNewsTicker", () => {
  it("zeigt ohne Nachrichten einen Hinweis und keinen Ticker", () => {
    const { container } = render(<DashboardNewsTicker items={[]} />);

    expect(screen.getByText("Neuigkeiten")).toBeInTheDocument();
    expect(screen.getByText("Keine aktuellen Nachrichten.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(container.querySelector(".news-ticker")).toBeNull();
  });

  it("listet die Nachrichten zugänglich mit Titel und Text", () => {
    render(<DashboardNewsTicker items={ITEMS} />);

    expect(screen.queryByText("Keine aktuellen Nachrichten.")).not.toBeInTheDocument();
    // Nur die statische Liste ist für Screenreader sichtbar, nicht der Ticker
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Sommerfest — Am 12.09. ab 16 Uhr im Büro Köln.");
    expect(items[1]).toHaveTextContent("Neue Kollegin — Willkommen, Anna!");
  });

  it("führt die Nachrichten doppelt im Laufband (nahtlose Schleife) mit bereinigten Leerzeichen", () => {
    const { container } = render(<DashboardNewsTicker items={ITEMS} />);

    const ticker = container.querySelector(".news-ticker") as HTMLElement;
    expect(ticker).toHaveAttribute("aria-hidden", "true");

    const track = ticker.querySelector(".news-ticker-track") as HTMLElement;
    const segments = Array.from(track.children).map(
      (segment) => segment.firstElementChild?.textContent
    );
    expect(segments).toEqual([
      "Sommerfest: Am 12.09. ab 16 Uhr im Büro Köln.",
      "Neue Kollegin: Willkommen, Anna!",
      "Sommerfest: Am 12.09. ab 16 Uhr im Büro Köln.",
      "Neue Kollegin: Willkommen, Anna!",
    ]);
  });
});
