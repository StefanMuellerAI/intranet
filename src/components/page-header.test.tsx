import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageHeader } from "./page-header";

describe("PageHeader", () => {
  it("zeigt nur den Titel als Hauptüberschrift, wenn sonst nichts übergeben wird", () => {
    const { container } = render(<PageHeader title="Urlaub" />);

    expect(screen.getByRole("heading", { level: 1, name: "Urlaub" })).toBeInTheDocument();
    expect(container.querySelector("p")).toBeNull();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("zeigt die Beschreibung unter dem Titel", () => {
    render(
      <PageHeader
        title="Urlaub beantragen"
        description="Resturlaub 2026: 12 Tage (Stand 2026-10-08)"
      />
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Urlaub beantragen" })
    ).toBeInTheDocument();
    expect(
      screen.getByText("Resturlaub 2026: 12 Tage (Stand 2026-10-08)")
    ).toBeInTheDocument();
  });

  it("rendert die Aktion als Anker mit Ziel-URL (kein natives Button-Element)", () => {
    render(
      <PageHeader
        title="Urlaub"
        action={{ href: "/urlaub/neu", label: "Neuer Antrag" }}
      />
    );

    // Base UI vergibt dem gerenderten <a> role="button" (nativeButton=false)
    const action = screen.getByRole("button", { name: "Neuer Antrag" });
    expect(action.tagName).toBe("A");
    expect(action).toHaveAttribute("href", "/urlaub/neu");
    expect(action).toHaveAttribute("data-slot", "button");
  });
});
