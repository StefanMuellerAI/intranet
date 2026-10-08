import { render, screen } from "@testing-library/react";
import { usePathname } from "next/navigation";
import { describe, expect, it, vi } from "vitest";
import { FakturaNav } from "./faktura-nav";

const ITEMS = [
  { label: "Zeiterfassung", href: "/faktura" },
  { label: "Freigabe", href: "/faktura/freigabe" },
  { label: "Kunden & Projekte", href: "/faktura/kunden" },
  { label: "Export & Stundenzettel", href: "/faktura/export" },
];

function renderAt(pathname: string) {
  vi.mocked(usePathname).mockReturnValue(pathname);
  return render(<FakturaNav />);
}

/** Labels der hervorgehobenen Einträge */
function activeLabels(): string[] {
  return screen
    .getAllByRole("link")
    .filter((l) => l.classList.contains("bg-background"))
    .map((l) => l.textContent ?? "");
}

describe("FakturaNav", () => {
  it("verlinkt alle Unterbereiche in fester Reihenfolge", () => {
    renderAt("/faktura");

    const links = screen.getAllByRole("link");
    expect(links.map((l) => [l.textContent, l.getAttribute("href")])).toEqual(
      ITEMS.map((i) => [i.label, i.href])
    );
  });

  it("markiert „Zeiterfassung“ nur auf exakt /faktura", () => {
    renderAt("/faktura");
    expect(activeLabels()).toEqual(["Zeiterfassung"]);
    for (const label of ["Freigabe", "Kunden & Projekte", "Export & Stundenzettel"]) {
      expect(screen.getByRole("link", { name: label })).toHaveClass(
        "text-muted-foreground"
      );
    }
  });

  it.each([
    ["/faktura/freigabe", "Freigabe"],
    ["/faktura/freigabe/2026-W41", "Freigabe"],
    ["/faktura/kunden", "Kunden & Projekte"],
    ["/faktura/kunden/kunde-1", "Kunden & Projekte"],
    ["/faktura/export", "Export & Stundenzettel"],
  ])("unter %s ist nur „%s“ aktiv", (pathname, label) => {
    renderAt(pathname);
    expect(activeLabels()).toEqual([label]);
  });

  it("markiert außerhalb des Moduls keinen Eintrag", () => {
    renderAt("/dashboard");
    expect(activeLabels()).toEqual([]);
  });
});
