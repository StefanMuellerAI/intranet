import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "./status-badge";

describe("StatusBadge", () => {
  it.each([
    ["eingereicht", "Eingereicht", "bg-blue-100"],
    ["genehmigt", "Genehmigt", "bg-green-100"],
    ["beanstandet", "Beanstandet", "bg-amber-100"],
    ["storno_beantragt", "Storno beantragt", "bg-purple-100"],
    ["storniert", "Storniert", "bg-gray-100"],
    ["zurueckgezogen", "Zurückgezogen", "bg-gray-100"],
    ["gemeldet", "Gemeldet", "bg-blue-100"],
    ["abgeschlossen", "Abgeschlossen", "bg-gray-100"],
  ])("Status „%s“ wird als „%s“ angezeigt", (status, label, colorClass) => {
    render(<StatusBadge status={status} />);

    const badge = screen.getByText(label);
    expect(badge).toHaveClass(colorClass);
    expect(badge).toHaveClass("font-medium");
  });

  it("zeigt unbekannte Status unverändert und ohne Farbklasse an", () => {
    render(<StatusBadge status="entwurf" />);

    const badge = screen.getByText("entwurf");
    expect(badge.className).not.toMatch(/bg-(blue|green|amber|purple|gray)-100/);
  });
});
