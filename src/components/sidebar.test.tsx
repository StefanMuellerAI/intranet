import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { usePathname } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "./sidebar";

const { signOut } = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock("@clerk/nextjs", () => ({ useClerk: () => ({ signOut }) }));

const EMPLOYEE_LINKS = [
  "Dashboard",
  "Urlaub",
  "Workation",
  "Reisekosten",
  "Provisionen",
  "Krankmeldung",
  "Faktura",
  "Berichte",
  "Kalender",
  "Organigramm",
  "Dokumente",
  "Mein Konto",
];
const ADMIN_LINKS = ["Mitarbeitende", "IT-Management", "Inhalte", "Einstellungen"];

function renderSidebar(props: Partial<React.ComponentProps<typeof Sidebar>> = {}) {
  return render(
    <Sidebar
      userName="Erika Muster"
      roleLabel="Mitarbeiterin"
      isAdmin={false}
      canApprove={false}
      openApprovals={0}
      {...props}
    />
  );
}

/** Desktop-Navigation (immer gerendert, Sichtbarkeit nur per CSS). */
function desktopNav() {
  return within(screen.getByRole("complementary"));
}

/** Der Menü-Button im mobilen Header (Icon-Button ohne Text). */
function menuButton() {
  const header = screen.getByText("StefanAI Intranet", { selector: "span" });
  return within(header.parentElement as HTMLElement).getByRole("button");
}

describe("Sidebar", () => {
  beforeEach(() => {
    // clearAllMocks setzt Rückgabewerte nicht zurück
    vi.mocked(usePathname).mockReturnValue("/");
  });

  it("zeigt Mitarbeitenden nur die allgemeinen Links", () => {
    renderSidebar();
    const nav = desktopNav();
    for (const label of EMPLOYEE_LINKS) {
      expect(nav.getByRole("link", { name: label })).toBeInTheDocument();
    }
    for (const label of [...ADMIN_LINKS, "Freigaben"]) {
      expect(nav.queryByRole("link", { name: label })).not.toBeInTheDocument();
    }
    expect(nav.getByRole("link", { name: "Urlaub" })).toHaveAttribute("href", "/urlaub");
  });

  it("zeigt Admins zusätzlich die Verwaltungslinks", () => {
    renderSidebar({ isAdmin: true });
    const nav = desktopNav();
    for (const label of [...EMPLOYEE_LINKS, ...ADMIN_LINKS]) {
      expect(nav.getByRole("link", { name: label })).toBeInTheDocument();
    }
    expect(nav.getByRole("link", { name: "IT-Management" })).toHaveAttribute(
      "href",
      "/it-management"
    );
    // Freigaben hängen an canApprove, nicht an der Admin-Rolle
    expect(nav.queryByRole("link", { name: /Freigaben/ })).not.toBeInTheDocument();
  });

  it("zeigt Freigaben mit der Zahl offener Vorgänge als Badge", () => {
    renderSidebar({ canApprove: true, openApprovals: 3 });
    const link = desktopNav().getByRole("link", { name: /Freigaben/ });
    expect(link).toHaveAttribute("href", "/freigaben");
    expect(within(link).getByText("3")).toBeInTheDocument();
  });

  it("zeigt ohne offene Freigaben kein Badge (auch keine „0“)", () => {
    renderSidebar({ canApprove: true, openApprovals: 0 });
    const link = desktopNav().getByRole("link", { name: "Freigaben" });
    expect(link).toHaveTextContent(/^Freigaben$/);
  });

  it("hebt den Link der aktuellen Seite hervor — auch auf Unterseiten", () => {
    vi.mocked(usePathname).mockReturnValue("/urlaub/neu");
    renderSidebar();
    const nav = desktopNav();
    expect(nav.getByRole("link", { name: "Urlaub" })).toHaveClass("bg-primary");
    expect(nav.getByRole("link", { name: "Dashboard" })).not.toHaveClass("bg-primary");
    expect(nav.getByRole("link", { name: "Dashboard" })).toHaveClass("text-muted-foreground");
  });

  it("markiert keinen Link, dessen Pfad nur ein Präfix ist", () => {
    // „/dokumente-archiv“ darf „/dokumente“ nicht aktiv schalten
    vi.mocked(usePathname).mockReturnValue("/dokumente-archiv");
    renderSidebar();
    expect(desktopNav().getByRole("link", { name: "Dokumente" })).not.toHaveClass("bg-primary");
  });

  it("zeigt Name und Rolle im Fußbereich", () => {
    renderSidebar({ userName: "Max Admin", roleLabel: "Administrator" });
    const nav = desktopNav();
    expect(nav.getByText("Max Admin")).toBeInTheDocument();
    expect(nav.getByText("Administrator")).toBeInTheDocument();
  });

  it("beschriftet den Menü-Button und markiert den aktiven Link für Screenreader", async () => {
    vi.mocked(usePathname).mockReturnValue("/kalender");
    renderSidebar();
    const button = screen.getByRole("button", { name: "Menü öffnen" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(button);
    expect(screen.getByRole("button", { name: "Menü schließen" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
    expect(desktopNav().getByRole("link", { name: "Kalender" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(desktopNav().getByRole("link", { name: "Urlaub" })).not.toHaveAttribute(
      "aria-current"
    );
  });

  it("öffnet und schließt das mobile Menü über den Menü-Button", async () => {
    renderSidebar();
    // Geschlossen: nur die Desktop-Navigation ist gerendert
    expect(screen.getAllByRole("link", { name: "Urlaub" })).toHaveLength(1);

    await userEvent.click(menuButton());
    expect(screen.getAllByRole("link", { name: "Urlaub" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Abmelden" })).toHaveLength(2);

    await userEvent.click(menuButton());
    expect(screen.getAllByRole("link", { name: "Urlaub" })).toHaveLength(1);
  });

  it("schließt das mobile Menü, sobald ein Link angeklickt wird", async () => {
    renderSidebar();
    await userEvent.click(menuButton());
    const [mobileLink] = screen.getAllByRole("link", { name: "Kalender" });
    expect(screen.getByRole("complementary")).not.toContainElement(mobileLink);

    await userEvent.click(mobileLink);
    expect(screen.getAllByRole("link", { name: "Kalender" })).toHaveLength(1);
  });

  it("„Abmelden“ meldet über Clerk ab und leitet zur Anmeldung", async () => {
    renderSidebar();
    await userEvent.click(desktopNav().getByRole("button", { name: "Abmelden" }));
    expect(signOut).toHaveBeenCalledWith({ redirectUrl: "/anmelden" });
  });

  it("„Abmelden“ funktioniert auch im mobilen Menü", async () => {
    renderSidebar();
    await userEvent.click(menuButton());
    const [mobileSignOut] = screen.getAllByRole("button", { name: "Abmelden" });
    await userEvent.click(mobileSignOut);
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
