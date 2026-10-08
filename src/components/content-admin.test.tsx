import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { describe, expect, it, vi } from "vitest";
import {
  createHelpfulLink,
  createNewsItem,
  createSalesNews,
  createTeamEvent,
  deleteHelpfulLink,
  deleteNewsItem,
  deleteSalesNews,
  deleteTeamEvent,
  toggleHelpfulLink,
  toggleNewsItem,
  toggleSalesNews,
  toggleTeamEvent,
  updateHelpfulLink,
  updateNewsItem,
  updateSalesNews,
  updateTeamEvent,
} from "@/app/(app)/inhalte/actions";
import {
  ContentTabs,
  type HelpfulLinkView,
  type NewsItemView,
  type SalesEmployeeOption,
  type SalesNewsView,
  type TeamEventView,
} from "./content-admin";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/(app)/inhalte/actions", () => ({
  createHelpfulLink: vi.fn(async () => {}),
  createNewsItem: vi.fn(async () => {}),
  createSalesNews: vi.fn(async () => {}),
  createTeamEvent: vi.fn(async () => {}),
  deleteHelpfulLink: vi.fn(async () => {}),
  deleteNewsItem: vi.fn(async () => {}),
  deleteSalesNews: vi.fn(async () => {}),
  deleteTeamEvent: vi.fn(async () => {}),
  toggleHelpfulLink: vi.fn(async () => {}),
  toggleNewsItem: vi.fn(async () => {}),
  toggleSalesNews: vi.fn(async () => {}),
  toggleTeamEvent: vi.fn(async () => {}),
  updateHelpfulLink: vi.fn(async () => {}),
  updateNewsItem: vi.fn(async () => {}),
  updateSalesNews: vi.fn(async () => {}),
  updateTeamEvent: vi.fn(async () => {}),
}));

const links: HelpfulLinkView[] = [
  {
    id: "l1",
    title: "Wiki",
    url: "https://wiki.example.com",
    description: "Internes Wissen",
    sortOrder: 1,
    active: true,
  },
  {
    id: "l2",
    title: "Altes Portal",
    url: "https://alt.example.com",
    description: null,
    sortOrder: 2,
    active: false,
  },
];

const news: NewsItemView[] = [
  { id: "n1", title: "Büro zu", body: "Am Freitag geschlossen.", active: true, createdLabel: "01.10.2026" },
];

const events: TeamEventView[] = [
  {
    id: "e1",
    title: "Sommerfest",
    startDate: "2026-07-01",
    endDate: "2026-07-02",
    active: false,
    rangeLabel: "01.07.–02.07.2026",
  },
];

const sales: SalesNewsView[] = [
  {
    id: "s1",
    customerName: "Musterfirma GmbH",
    volumeEuro: "12500.5",
    volumeLabel: "12.500,50 €",
    soldById: "ex",
    soldByName: "Ehemalige Person",
    deliveryStart: "2026-11-01",
    deliveryEnd: "",
    deliveryLabel: "ab 01.11.2026",
    active: true,
    dashboardUntilLabel: null,
  },
];

const employees: SalesEmployeeOption[] = [
  { id: "a", name: "Anna Vertrieb", selectable: true },
  { id: "ex", name: "Ehemalige Person", selectable: false },
];

function renderTabs() {
  return render(
    <ContentTabs links={links} news={news} events={events} sales={sales} employees={employees} />
  );
}

function row(text: string) {
  return screen.getByText(text).closest("tr") as HTMLElement;
}

function formDataOf(fn: unknown, call = 0): FormData {
  return vi.mocked(fn as (fd: FormData) => unknown).mock.calls[call][0] as FormData;
}

/**
 * happy-dom rechnet die step-Prüfung bei step="0.01" mit Gleitkommafehlern und
 * hält dadurch jeden Betrag für ungültig (Browser runden korrekt). Für die
 * Sales-Formulare die native Validierung deshalb abschalten.
 */
function disableNativeValidation(dialog: HTMLElement) {
  const form = dialog.querySelector("form");
  if (!form) throw new Error("Kein Formular im Dialog");
  form.noValidate = true;
}

async function openTab(name: RegExp) {
  await userEvent.click(screen.getByRole("tab", { name }));
}

describe("ContentTabs", () => {
  it("zeigt die Reiter mit Zählern und startet bei „Hilfreiche Links“", () => {
    renderTabs();
    expect(screen.getByRole("tab", { name: /^Hilfreiche Links/ })).toHaveTextContent("2");
    expect(screen.getByRole("tab", { name: /^Neuigkeiten/ })).toHaveTextContent("1");
    expect(screen.getByText("Wiki")).toBeInTheDocument();
    expect(screen.queryByText("Büro zu")).not.toBeInTheDocument();
  });

  describe("Hilfreiche Links", () => {
    it("zeigt Link, Beschreibung und Sichtbarkeit", () => {
      renderTabs();
      expect(within(row("Wiki")).getByRole("link", { name: "https://wiki.example.com" })).toHaveAttribute(
        "href",
        "https://wiki.example.com"
      );
      expect(within(row("Wiki")).getByText("sichtbar")).toBeInTheDocument();
      expect(within(row("Altes Portal")).getByText("—")).toBeInTheDocument();
      expect(within(row("Altes Portal")).getByText("ausgeblendet")).toBeInTheDocument();
    });

    it("legt einen Link über den Dialog an", async () => {
      renderTabs();
      await userEvent.click(screen.getByRole("button", { name: /Neuer Link/ }));
      const dialog = screen.getByRole("dialog");
      await userEvent.type(within(dialog).getByLabelText("Titel"), "Zeiterfassung");
      await userEvent.type(within(dialog).getByLabelText("URL"), "https://zeit.example.com");
      await userEvent.type(within(dialog).getByLabelText("Beschreibung (optional)"), "Stunden");
      const sort = within(dialog).getByLabelText("Reihenfolge");
      await userEvent.clear(sort);
      await userEvent.type(sort, "5");
      await userEvent.click(within(dialog).getByRole("button", { name: "Link hinzufügen" }));

      await waitFor(() => expect(createHelpfulLink).toHaveBeenCalledTimes(1));
      const fd = formDataOf(createHelpfulLink);
      expect(fd.get("id")).toBeNull();
      expect(fd.get("title")).toBe("Zeiterfassung");
      expect(fd.get("url")).toBe("https://zeit.example.com");
      expect(fd.get("description")).toBe("Stunden");
      expect(fd.get("sortOrder")).toBe("5");
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Link angelegt."));
    });

    it("bearbeitet einen Link mit vorbelegten Werten und ID", async () => {
      renderTabs();
      await userEvent.click(within(row("Wiki")).getByRole("button", { name: "Bearbeiten" }));
      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveTextContent("Link bearbeiten");
      const titel = within(dialog).getByLabelText("Titel");
      expect(titel).toHaveValue("Wiki");
      expect(within(dialog).getByLabelText("Beschreibung (optional)")).toHaveValue("Internes Wissen");
      await userEvent.clear(titel);
      await userEvent.type(titel, "Wiki neu");
      await userEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));

      await waitFor(() => expect(updateHelpfulLink).toHaveBeenCalledTimes(1));
      const fd = formDataOf(updateHelpfulLink);
      expect(fd.get("id")).toBe("l1");
      expect(fd.get("title")).toBe("Wiki neu");
      expect(fd.get("url")).toBe("https://wiki.example.com");
      expect(fd.get("sortOrder")).toBe("1");
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Link aktualisiert."));
    });

    it("blendet einen sichtbaren Link aus und einen ausgeblendeten ein", async () => {
      renderTabs();
      await userEvent.click(within(row("Wiki")).getByRole("button", { name: "Ausblenden" }));
      await waitFor(() => expect(toggleHelpfulLink).toHaveBeenCalledWith("l1"));
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Link ausgeblendet."));

      await userEvent.click(within(row("Altes Portal")).getByRole("button", { name: "Einblenden" }));
      await waitFor(() => expect(toggleHelpfulLink).toHaveBeenCalledWith("l2"));
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Link eingeblendet."));
    });

    it("löscht einen Link erst nach Bestätigung", async () => {
      renderTabs();
      await userEvent.click(within(row("Wiki")).getByRole("button", { name: "Löschen" }));
      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveTextContent("Link löschen?");
      expect(dialog).toHaveTextContent("„Wiki“ wird endgültig entfernt.");
      expect(deleteHelpfulLink).not.toHaveBeenCalled();

      await userEvent.click(within(dialog).getByRole("button", { name: "Endgültig löschen" }));
      await waitFor(() => expect(deleteHelpfulLink).toHaveBeenCalledWith("l1"));
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Link gelöscht."));
    });

    it("zeigt Fehler beim Anlegen als Toast und lässt den Dialog offen", async () => {
      vi.mocked(createHelpfulLink).mockRejectedValueOnce(new Error("Ungültige URL."));
      renderTabs();
      await userEvent.click(screen.getByRole("button", { name: /Neuer Link/ }));
      const dialog = screen.getByRole("dialog");
      await userEvent.type(within(dialog).getByLabelText("Titel"), "X");
      await userEvent.type(within(dialog).getByLabelText("URL"), "https://x.example.com");
      await userEvent.click(within(dialog).getByRole("button", { name: "Link hinzufügen" }));
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Ungültige URL."));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });

  describe("Neuigkeiten", () => {
    it("veröffentlicht eine Neuigkeit", async () => {
      renderTabs();
      await openTab(/^Neuigkeiten/);
      await userEvent.click(screen.getByRole("button", { name: /Neue Neuigkeit/ }));
      const dialog = screen.getByRole("dialog");
      await userEvent.type(within(dialog).getByLabelText("Titel"), "Neue Kaffeemaschine");
      await userEvent.type(within(dialog).getByLabelText("Nachricht"), "Steht in der Küche.");
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Neuigkeit veröffentlichen" })
      );

      await waitFor(() => expect(createNewsItem).toHaveBeenCalledTimes(1));
      const fd = formDataOf(createNewsItem);
      expect(fd.get("title")).toBe("Neue Kaffeemaschine");
      expect(fd.get("body")).toBe("Steht in der Küche.");
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Neuigkeit veröffentlicht."));
    });

    it("bearbeitet, blendet aus und löscht eine Neuigkeit", async () => {
      renderTabs();
      await openTab(/^Neuigkeiten/);

      await userEvent.click(within(row("Büro zu")).getByRole("button", { name: "Bearbeiten" }));
      let dialog = screen.getByRole("dialog");
      expect(within(dialog).getByLabelText("Nachricht")).toHaveValue("Am Freitag geschlossen.");
      await userEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));
      await waitFor(() => expect(updateNewsItem).toHaveBeenCalledTimes(1));
      expect(formDataOf(updateNewsItem).get("id")).toBe("n1");
      expect(formDataOf(updateNewsItem).get("title")).toBe("Büro zu");
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

      await userEvent.click(within(row("Büro zu")).getByRole("button", { name: "Ausblenden" }));
      await waitFor(() => expect(toggleNewsItem).toHaveBeenCalledWith("n1"));
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Neuigkeit ausgeblendet."));

      await userEvent.click(within(row("Büro zu")).getByRole("button", { name: "Löschen" }));
      dialog = screen.getByRole("dialog");
      expect(dialog).toHaveTextContent("Neuigkeit löschen?");
      await userEvent.click(within(dialog).getByRole("button", { name: "Endgültig löschen" }));
      await waitFor(() => expect(deleteNewsItem).toHaveBeenCalledWith("n1"));
    });
  });

  describe("Teamevents", () => {
    it("legt ein Teamevent an", async () => {
      renderTabs();
      await openTab(/^Teamevents/);
      await userEvent.click(screen.getByRole("button", { name: /Neues Teamevent/ }));
      const dialog = screen.getByRole("dialog");
      await userEvent.type(within(dialog).getByLabelText("Titel"), "Weihnachtsfeier");
      await userEvent.type(within(dialog).getByLabelText("Startdatum"), "2026-12-18");
      await userEvent.click(within(dialog).getByRole("button", { name: "Teamevent hinzufügen" }));

      await waitFor(() => expect(createTeamEvent).toHaveBeenCalledTimes(1));
      const fd = formDataOf(createTeamEvent);
      expect(fd.get("title")).toBe("Weihnachtsfeier");
      expect(fd.get("startDate")).toBe("2026-12-18");
      expect(fd.get("endDate")).toBe("");
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Teamevent angelegt."));
    });

    it("bearbeitet, blendet ein und löscht ein Teamevent", async () => {
      renderTabs();
      await openTab(/^Teamevents/);
      expect(within(row("Sommerfest")).getByText("01.07.–02.07.2026")).toBeInTheDocument();

      await userEvent.click(within(row("Sommerfest")).getByRole("button", { name: "Bearbeiten" }));
      let dialog = screen.getByRole("dialog");
      expect(within(dialog).getByLabelText("Startdatum")).toHaveValue("2026-07-01");
      expect(within(dialog).getByLabelText("Enddatum (optional)")).toHaveValue("2026-07-02");
      await userEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));
      await waitFor(() => expect(updateTeamEvent).toHaveBeenCalledTimes(1));
      const fd = formDataOf(updateTeamEvent);
      expect(fd.get("id")).toBe("e1");
      expect(fd.get("endDate")).toBe("2026-07-02");
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

      await userEvent.click(within(row("Sommerfest")).getByRole("button", { name: "Einblenden" }));
      await waitFor(() => expect(toggleTeamEvent).toHaveBeenCalledWith("e1"));
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Teamevent eingeblendet."));

      await userEvent.click(within(row("Sommerfest")).getByRole("button", { name: "Löschen" }));
      dialog = screen.getByRole("dialog");
      await userEvent.click(within(dialog).getByRole("button", { name: "Endgültig löschen" }));
      await waitFor(() => expect(deleteTeamEvent).toHaveBeenCalledWith("e1"));
    });
  });

  describe("Sales-Nachrichten", () => {
    it("kennzeichnet abgelaufene Nachrichten", async () => {
      renderTabs();
      await openTab(/^Sales-Nachrichten/);
      expect(within(row("Musterfirma GmbH")).getByText("abgelaufen")).toBeInTheDocument();
      expect(within(row("Musterfirma GmbH")).getByText("12.500,50 €")).toBeInTheDocument();
    });

    it("bietet beim Anlegen nur auswählbare Mitarbeitende an und sendet die Felder", async () => {
      renderTabs();
      await openTab(/^Sales-Nachrichten/);
      await userEvent.click(screen.getByRole("button", { name: /Neue Sales-Nachricht/ }));
      const dialog = screen.getByRole("dialog");
      const soldBy = within(dialog).getByLabelText("Ursächliche/r Mitarbeiter/in");
      expect(within(soldBy).queryByRole("option", { name: "Ehemalige Person" })).not.toBeInTheDocument();

      await userEvent.type(within(dialog).getByLabelText("Kundenname"), "Neukunde AG");
      await userEvent.type(within(dialog).getByLabelText("Volumen (€)"), "25000");
      await userEvent.selectOptions(soldBy, "a");
      await userEvent.type(within(dialog).getByLabelText("Leistungsbeginn (vsl.)"), "2027-01-01");
      disableNativeValidation(dialog);
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Sales-Nachricht veröffentlichen" })
      );

      await waitFor(() => expect(createSalesNews).toHaveBeenCalledTimes(1));
      const fd = formDataOf(createSalesNews);
      expect(fd.get("customerName")).toBe("Neukunde AG");
      expect(fd.get("volume")).toBe("25000");
      expect(fd.get("soldById")).toBe("a");
      expect(fd.get("deliveryStart")).toBe("2027-01-01");
      expect(fd.get("deliveryEnd")).toBe("");
      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith("Sales-Nachricht veröffentlicht.")
      );
    });

    it("behält beim Bearbeiten die bereits zugeordnete, nicht mehr auswählbare Person", async () => {
      renderTabs();
      await openTab(/^Sales-Nachrichten/);
      await userEvent.click(
        within(row("Musterfirma GmbH")).getByRole("button", { name: "Bearbeiten" })
      );
      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getByLabelText("Ursächliche/r Mitarbeiter/in")).toHaveValue("ex");
      expect(within(dialog).getByLabelText("Volumen (€)")).toHaveValue(12500.5);
      disableNativeValidation(dialog);
      await userEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));

      await waitFor(() => expect(updateSalesNews).toHaveBeenCalledTimes(1));
      const fd = formDataOf(updateSalesNews);
      expect(fd.get("id")).toBe("s1");
      expect(fd.get("soldById")).toBe("ex");
      expect(fd.get("volume")).toBe("12500.5");
      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith("Sales-Nachricht aktualisiert.")
      );
    });

    it("blendet aus und löscht eine Sales-Nachricht", async () => {
      renderTabs();
      await openTab(/^Sales-Nachrichten/);
      await userEvent.click(
        within(row("Musterfirma GmbH")).getByRole("button", { name: "Ausblenden" })
      );
      await waitFor(() => expect(toggleSalesNews).toHaveBeenCalledWith("s1"));
      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith("Sales-Nachricht ausgeblendet.")
      );

      await userEvent.click(within(row("Musterfirma GmbH")).getByRole("button", { name: "Löschen" }));
      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveTextContent("Sales-Nachricht löschen?");
      await userEvent.click(within(dialog).getByRole("button", { name: "Abbrechen" }));
      expect(deleteSalesNews).not.toHaveBeenCalled();

      await userEvent.click(within(row("Musterfirma GmbH")).getByRole("button", { name: "Löschen" }));
      await userEvent.click(
        within(screen.getByRole("dialog")).getByRole("button", { name: "Endgültig löschen" })
      );
      await waitFor(() => expect(deleteSalesNews).toHaveBeenCalledWith("s1"));
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Sales-Nachricht gelöscht."));
    });
  });

  it("zeigt Leerzustände je Reiter", async () => {
    render(<ContentTabs links={[]} news={[]} events={[]} sales={[]} employees={[]} />);
    expect(screen.getByText("Noch keine Links angelegt.")).toBeInTheDocument();
    await openTab(/^Neuigkeiten/);
    expect(screen.getByText("Noch keine Neuigkeiten veröffentlicht.")).toBeInTheDocument();
    await openTab(/^Teamevents/);
    expect(screen.getByText("Keine anstehenden Teamevents.")).toBeInTheDocument();
    await openTab(/^Sales-Nachrichten/);
    expect(screen.getByText("Noch keine Sales-Nachrichten angelegt.")).toBeInTheDocument();
  });
});
