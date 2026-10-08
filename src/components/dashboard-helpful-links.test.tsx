import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DashboardHelpfulLinks } from "./dashboard-helpful-links";

const LINKS = [
  {
    id: "link-1",
    title: "Reisekostenrichtlinie",
    url: "https://wiki.stefanai.de/reisekosten",
    description: "Sätze und Regeln für Dienstreisen",
  },
  {
    id: "link-2",
    title: "Zeiterfassung",
    url: "https://zeit.stefanai.de",
    description: null,
  },
];

describe("DashboardHelpfulLinks", () => {
  it("zeigt ohne Links einen Hinweis statt einer Liste", () => {
    render(<DashboardHelpfulLinks links={[]} />);

    expect(screen.getByText("Hilfreiche Links")).toBeInTheDocument();
    expect(screen.getByText("Aktuell keine Links hinterlegt.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("öffnet jeden Link sicher in einem neuen Tab", () => {
    render(<DashboardHelpfulLinks links={LINKS} />);

    expect(screen.queryByText("Aktuell keine Links hinterlegt.")).not.toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);

    LINKS.forEach((link, i) => {
      const anchor = within(items[i]).getByRole("link");
      expect(anchor).toHaveAttribute("href", link.url);
      expect(anchor).toHaveAttribute("target", "_blank");
      expect(anchor).toHaveAttribute("rel", "noopener noreferrer");
      expect(anchor).toHaveTextContent(link.title);
    });
  });

  it("zeigt die Beschreibung nur, wenn eine hinterlegt ist", () => {
    render(<DashboardHelpfulLinks links={LINKS} />);

    const [withDescription, withoutDescription] = screen.getAllByRole("link");
    expect(withDescription).toHaveTextContent(
      /^Reisekostenrichtlinie\s*Sätze und Regeln für Dienstreisen$/
    );
    expect(withoutDescription).toHaveTextContent(/^Zeiterfassung$/);
  });
});
