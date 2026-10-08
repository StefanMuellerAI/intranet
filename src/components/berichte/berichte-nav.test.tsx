import { render, screen } from "@testing-library/react";
import { usePathname } from "next/navigation";
import { describe, expect, it, vi } from "vitest";
import { BerichteNav } from "./berichte-nav";

function renderAt(pathname: string, isAdmin = false) {
  vi.mocked(usePathname).mockReturnValue(pathname);
  return render(<BerichteNav isAdmin={isAdmin} />);
}

function link(name: string) {
  return screen.getByRole("link", { name });
}

/** Aktiver Eintrag ist hervorgehoben, inaktive sind gedimmt. */
function expectActive(name: string) {
  expect(link(name)).toHaveClass("bg-background");
  expect(link(name)).not.toHaveClass("text-muted-foreground");
}

function expectInactive(name: string) {
  expect(link(name)).not.toHaveClass("bg-background");
  expect(link(name)).toHaveClass("text-muted-foreground");
}

describe("BerichteNav", () => {
  it("zeigt Mitarbeitenden „Meine Berichte“ und „Alle Berichte“, aber keine Zitate", () => {
    renderAt("/berichte");

    expect(screen.getAllByRole("link").map((l) => l.textContent)).toEqual([
      "Meine Berichte",
      "Alle Berichte",
    ]);
    expect(link("Meine Berichte")).toHaveAttribute("href", "/berichte");
    expect(link("Alle Berichte")).toHaveAttribute("href", "/berichte/alle");
  });

  it("zeigt dem Admin zusätzlich die Zitatverwaltung", () => {
    renderAt("/berichte", true);

    expect(screen.getAllByRole("link").map((l) => l.textContent)).toEqual([
      "Meine Berichte",
      "Alle Berichte",
      "Zitate",
    ]);
    expect(link("Zitate")).toHaveAttribute("href", "/berichte/zitate");
  });

  it.each(["/berichte", "/berichte/neu", "/berichte/3f2a9c1e-0000-4000-8000-000000000001"])(
    "markiert „Meine Berichte“ als aktiv unter %s",
    (pathname) => {
      renderAt(pathname, true);
      expectActive("Meine Berichte");
      expectInactive("Alle Berichte");
      expectInactive("Zitate");
    }
  );

  it.each(["/berichte/alle", "/berichte/alle/3f2a9c1e"])(
    "markiert „Alle Berichte“ als aktiv unter %s",
    (pathname) => {
      renderAt(pathname, true);
      expectActive("Alle Berichte");
      expectInactive("Meine Berichte");
      expectInactive("Zitate");
    }
  );

  it("markiert „Zitate“ als aktiv und nicht zugleich „Meine Berichte“", () => {
    renderAt("/berichte/zitate", true);
    expectActive("Zitate");
    expectInactive("Meine Berichte");
    expectInactive("Alle Berichte");
  });

  it("markiert auf der Zitatseite auch ohne Admin-Eintrag nicht „Meine Berichte“", () => {
    renderAt("/berichte/zitate", false);
    expectInactive("Meine Berichte");
    expectInactive("Alle Berichte");
  });

  it("markiert außerhalb des Bereichs keinen Eintrag", () => {
    renderAt("/dashboard", true);
    expectInactive("Meine Berichte");
    expectInactive("Alle Berichte");
    expectInactive("Zitate");
  });
});
