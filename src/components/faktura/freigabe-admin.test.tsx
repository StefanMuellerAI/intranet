import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  adminCreateEntryAction,
  adminDeleteEntryAction,
  adminUpdateEntryAction,
  approveWeekAction,
  getEntryHistoryAction,
  revokeWeekAction,
  setEntryVisibilityAction,
  type EntryHistoryItem,
} from "@/app/(app)/faktura/freigabe/actions";
import {
  FreigabeAdmin,
  WeekNav,
  type FreigabeCustomerView,
  type FreigabeEntryView,
  type FreigabeWeekView,
} from "./freigabe-admin";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/(app)/faktura/freigabe/actions", () => ({
  adminCreateEntryAction: vi.fn(async () => ({ ok: true, data: null })),
  adminDeleteEntryAction: vi.fn(async () => ({ ok: true, data: null })),
  adminUpdateEntryAction: vi.fn(async () => ({ ok: true, data: null })),
  approveWeekAction: vi.fn(async () => ({ ok: true, data: null })),
  getEntryHistoryAction: vi.fn(async () => []),
  revokeWeekAction: vi.fn(async () => ({ ok: true, data: null })),
  setEntryVisibilityAction: vi.fn(async () => ({ ok: true, data: null })),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

const projects = [
  { id: "p1", label: "ACME – Website" },
  { id: "p2", label: "Globex – Beratung" },
];
const employees = [
  { id: "u1", name: "Anna Admin" },
  { id: "u2", name: "Bernd Beispiel" },
];

function week(overrides: Partial<FreigabeWeekView> = {}): FreigabeWeekView {
  return {
    isoYear: 2026,
    isoWeek: 40,
    weekLabel: "KW 40/2026",
    rangeLabel: "28.09.–04.10.2026",
    closed: true,
    empty: false,
    approvalStatus: "offen",
    approvedInfo: null,
    totalHours: "12,5",
    overbookedCount: 0,
    ...overrides,
  };
}

const offen: FreigabeEntryView = {
  id: "e1",
  userId: "u1",
  userName: "Anna Admin",
  projectId: "p1",
  entryDate: "2026-09-29",
  dateLabel: "Di 29.09.",
  durationHours: "2,5",
  description: "Design-Review",
  status: "offen",
  visibleOnTimesheet: true,
  overbooked: false,
};

const freigegeben: FreigabeEntryView = {
  id: "e2",
  userId: "u2",
  userName: "Bernd Beispiel",
  projectId: "p2",
  entryDate: "2026-09-30",
  dateLabel: "Mi 30.09.",
  durationHours: "10",
  description: "Strategieworkshop",
  status: "freigegeben",
  visibleOnTimesheet: false,
  overbooked: true,
};

const customers: FreigabeCustomerView[] = [
  {
    customerId: "c1",
    customerName: "ACME",
    totalHours: "2,5",
    projects: [
      { projectId: "p1", label: "Website", totalHours: "2,5", limitHours: null, entries: [offen] },
    ],
  },
  {
    customerId: "c2",
    customerName: "Globex",
    totalHours: "10",
    projects: [
      { projectId: "p2", label: "Beratung", totalHours: "10", limitHours: "8", entries: [freigegeben] },
    ],
  },
];

function renderAdmin(w: FreigabeWeekView = week()) {
  return render(
    <FreigabeAdmin week={w} customers={customers} projects={projects} employees={employees} />
  );
}

function entryItem(description: string) {
  return screen.getByText(description).closest("li") as HTMLElement;
}

/** Wählt in einem Base-UI-Select (role=combobox) eine Option. */
async function choose(combobox: HTMLElement, label: string) {
  await userEvent.click(combobox);
  await userEvent.click(await screen.findByRole("option", { name: label }));
}

function lastFormData(fn: unknown, argIndex = 0): FormData {
  const calls = vi.mocked(fn as (...args: unknown[]) => unknown).mock.calls;
  return calls[calls.length - 1][argIndex] as FormData;
}

async function openEdit(description: string) {
  await userEvent.click(within(entryItem(description)).getByRole("button", { name: "Bearbeiten" }));
  return screen.getByRole("dialog");
}

describe("FreigabeAdmin", () => {
  describe("Wochenkopf", () => {
    it("zeigt Woche, Status, Summe und Überbuchungen", () => {
      renderAdmin(week({ overbookedCount: 2, approvedInfo: "freigegeben von Anna am 05.10." }));
      expect(screen.getByText(/KW 40\/2026 \(28\.09\.–04\.10\.2026\)/)).toBeInTheDocument();
      expect(screen.getByText("2 Überbuchung(en)")).toBeInTheDocument();
      expect(screen.getByText(/· freigegeben von Anna am 05\.10\./)).toBeInTheDocument();
      expect(screen.getByText("(Monatslimit: 8 h)", { exact: false })).toBeInTheDocument();
    });

    it("zeigt eine leere Woche ohne Freigabe-Button", () => {
      renderAdmin(week({ empty: true }));
      expect(screen.getByText("leer — keine Buchungen")).toBeInTheDocument();
      expect(
        screen.getByText("Keine Buchungen in dieser Woche — keine Freigabe erforderlich.")
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Woche freigeben" })).not.toBeInTheDocument();
      expect(screen.queryByText("Design-Review")).not.toBeInTheDocument();
    });

    it("kennzeichnet eine widerrufene Freigabe", () => {
      renderAdmin(week({ approvalStatus: "widerrufen" }));
      expect(screen.getByText("Freigabe widerrufen")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Woche freigeben" })).toBeEnabled();
    });
  });

  describe("Woche freigeben", () => {
    it("ist deaktiviert, solange die Woche nicht abgeschlossen ist", () => {
      renderAdmin(week({ closed: false }));
      expect(screen.getByText("Woche noch nicht abgeschlossen")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Woche freigeben" })).toBeDisabled();
    });

    it("gibt eine abgeschlossene Woche frei", async () => {
      renderAdmin();
      expect(screen.queryByText("Woche noch nicht abgeschlossen")).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Woche freigeben" }));
      await waitFor(() => expect(approveWeekAction).toHaveBeenCalledWith(2026, 40));
      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith(
          "Woche freigegeben — alle Buchungen sind jetzt schreibgeschützt."
        )
      );
    });

    it("meldet Fehler der Freigabe als Toast", async () => {
      vi.mocked(approveWeekAction).mockResolvedValueOnce({ ok: false, error: "Überbuchungen offen." });
      renderAdmin();
      await userEvent.click(screen.getByRole("button", { name: "Woche freigeben" }));
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Überbuchungen offen."));
      expect(toast.success).not.toHaveBeenCalled();
    });
  });

  describe("Freigabe widerrufen", () => {
    it("ersetzt bei freigegebener Woche den Freigabe-Button", () => {
      renderAdmin(week({ approvalStatus: "freigegeben" }));
      expect(screen.queryByRole("button", { name: "Woche freigeben" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Freigabe widerrufen" })).toBeInTheDocument();
    });

    it("verlangt eine Begründung", async () => {
      renderAdmin(week({ approvalStatus: "freigegeben" }));
      await userEvent.click(screen.getByRole("button", { name: "Freigabe widerrufen" }));
      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getByLabelText("Begründung (Pflicht)")).toBeRequired();

      await userEvent.click(within(dialog).getByRole("button", { name: "Widerrufen" }));
      expect(revokeWeekAction).not.toHaveBeenCalled();
    });

    it("widerruft mit Jahr, Woche und Begründung", async () => {
      renderAdmin(week({ approvalStatus: "freigegeben" }));
      await userEvent.click(screen.getByRole("button", { name: "Freigabe widerrufen" }));
      const dialog = screen.getByRole("dialog");
      await userEvent.type(within(dialog).getByLabelText("Begründung (Pflicht)"), "Falsches Projekt");
      await userEvent.click(within(dialog).getByRole("button", { name: "Widerrufen" }));

      await waitFor(() => expect(revokeWeekAction).toHaveBeenCalledTimes(1));
      const fd = lastFormData(revokeWeekAction);
      expect(fd.get("isoYear")).toBe("2026");
      expect(fd.get("isoWeek")).toBe("40");
      expect(fd.get("reason")).toBe("Falsches Projekt");
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Freigabe widerrufen."));
    });

    it("meldet Fehler beim Widerruf als Toast", async () => {
      vi.mocked(revokeWeekAction).mockResolvedValueOnce({ ok: false, error: "Bereits abgerechnet." });
      renderAdmin(week({ approvalStatus: "freigegeben" }));
      await userEvent.click(screen.getByRole("button", { name: "Freigabe widerrufen" }));
      await userEvent.type(screen.getByLabelText("Begründung (Pflicht)"), "x");
      await userEvent.click(screen.getByRole("button", { name: "Widerrufen" }));
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Bereits abgerechnet."));
    });
  });

  describe("Buchung anlegen", () => {
    async function fillCreateDialog() {
      await userEvent.click(screen.getByRole("button", { name: "Buchung anlegen" }));
      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveTextContent("Buchung für Mitarbeiter/in anlegen");
      const [mitarbeiter, projekt] = within(dialog).getAllByRole("combobox");
      await choose(mitarbeiter, "Bernd Beispiel");
      await choose(projekt, "Globex – Beratung");
      await userEvent.type(within(dialog).getByLabelText("Buchungsdatum (Werktag)"), "2026-10-01");
      await userEvent.type(within(dialog).getByLabelText("Dauer in Stunden (0,25er-Raster)"), "3,75");
      await userEvent.type(within(dialog).getByLabelText("Tätigkeitsbeschreibung"), "Nachgetragen");
      return dialog;
    }

    it("legt eine Buchung an und schließt den Dialog bei Erfolg", async () => {
      renderAdmin();
      const dialog = await fillCreateDialog();
      expect(within(dialog).getByText("Begründung (optional)")).toBeInTheDocument();
      await userEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));

      await waitFor(() => expect(adminCreateEntryAction).toHaveBeenCalledTimes(1));
      const fd = lastFormData(adminCreateEntryAction);
      expect(fd.get("userId")).toBe("u2");
      expect(fd.get("projectId")).toBe("p2");
      expect(fd.get("entryDate")).toBe("2026-10-01");
      expect(fd.get("durationHours")).toBe("3,75");
      expect(fd.get("description")).toBe("Nachgetragen");
      expect(fd.get("reason")).toBe("");
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Buchung angelegt."));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it("bleibt bei einem Fehler offen und behält die Eingaben", async () => {
      vi.mocked(adminCreateEntryAction).mockResolvedValueOnce({
        ok: false,
        error: "Kein Werktag.",
      });
      renderAdmin();
      const dialog = await fillCreateDialog();
      await userEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Kein Werktag."));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(within(dialog).getByLabelText("Dauer in Stunden (0,25er-Raster)")).toHaveValue("3,75");
      expect(within(dialog).getByLabelText("Tätigkeitsbeschreibung")).toHaveValue("Nachgetragen");
      expect(toast.success).not.toHaveBeenCalled();
    });

    it("verlangt in einer freigegebenen Woche eine Begründung", async () => {
      renderAdmin(week({ approvalStatus: "freigegeben" }));
      const dialog = await fillCreateDialog();
      const reason = within(dialog).getByLabelText(
        "Begründung (Pflicht — Woche/Buchung bereits freigegeben)"
      );
      expect(reason).toBeRequired();
      await userEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));
      expect(adminCreateEntryAction).not.toHaveBeenCalled();

      await userEvent.type(reason, "Nachtrag nach Rücksprache");
      await userEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));
      await waitFor(() => expect(adminCreateEntryAction).toHaveBeenCalledTimes(1));
      expect(lastFormData(adminCreateEntryAction).get("reason")).toBe("Nachtrag nach Rücksprache");
    });

    it("setzt die Auswahl beim erneuten Öffnen zurück", async () => {
      renderAdmin();
      await userEvent.click(screen.getByRole("button", { name: "Buchung anlegen" }));
      const [mitarbeiter] = within(screen.getByRole("dialog")).getAllByRole("combobox");
      await choose(mitarbeiter, "Anna Admin");
      expect(mitarbeiter).toHaveTextContent("Anna Admin");
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

      await userEvent.click(screen.getByRole("button", { name: "Buchung anlegen" }));
      const [erneut] = within(screen.getByRole("dialog")).getAllByRole("combobox");
      expect(erneut).toHaveTextContent("Mitarbeiter/in wählen");
    });
  });

  describe("Buchung bearbeiten", () => {
    it("hat keine Mitarbeiter-Auswahl und speichert über adminUpdateEntryAction", async () => {
      renderAdmin();
      const dialog = await openEdit("Design-Review");
      expect(dialog).toHaveTextContent("Buchung anpassen");
      const comboboxes = within(dialog).getAllByRole("combobox");
      expect(comboboxes).toHaveLength(1);
      expect(comboboxes[0]).toHaveTextContent("ACME – Website");
      expect(within(dialog).getByLabelText("Buchungsdatum (Werktag)")).toHaveValue("2026-09-29");
      expect(within(dialog).getByText("Begründung (optional)")).toBeInTheDocument();

      await choose(comboboxes[0], "Globex – Beratung");
      await userEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));

      await waitFor(() => expect(adminUpdateEntryAction).toHaveBeenCalledTimes(1));
      expect(vi.mocked(adminUpdateEntryAction).mock.calls[0][0]).toBe("e1");
      const fd = lastFormData(adminUpdateEntryAction, 1);
      expect(fd.get("projectId")).toBe("p2");
      expect(fd.get("userId")).toBeNull();
      expect(fd.get("durationHours")).toBe("2,5");
      expect(fd.get("description")).toBe("Design-Review");
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Buchung angepasst."));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it("verlangt bei freigegebener Buchung eine Begründung, auch in offener Woche", async () => {
      renderAdmin();
      const dialog = await openEdit("Strategieworkshop");
      const reason = within(dialog).getByLabelText(
        "Begründung (Pflicht — Woche/Buchung bereits freigegeben)"
      );
      await userEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));
      expect(adminUpdateEntryAction).not.toHaveBeenCalled();

      await userEvent.type(reason, "Korrektur Kunde");
      await userEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));
      await waitFor(() => expect(adminUpdateEntryAction).toHaveBeenCalledTimes(1));
      expect(vi.mocked(adminUpdateEntryAction).mock.calls[0][0]).toBe("e2");
      expect(lastFormData(adminUpdateEntryAction, 1).get("reason")).toBe("Korrektur Kunde");
    });

    it("bleibt bei einem Fehler offen", async () => {
      vi.mocked(adminUpdateEntryAction).mockResolvedValueOnce({
        ok: false,
        error: "Monatslimit überschritten.",
      });
      renderAdmin();
      const dialog = await openEdit("Design-Review");
      const dauer = within(dialog).getByLabelText("Dauer in Stunden (0,25er-Raster)");
      await userEvent.clear(dauer);
      await userEvent.type(dauer, "12");
      await userEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Monatslimit überschritten."));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(dauer).toHaveValue("12");
    });
  });

  describe("Sichtbarkeit", () => {
    it("blendet eine sichtbare Buchung aus", async () => {
      renderAdmin();
      await userEvent.click(within(entryItem("Design-Review")).getByRole("button", { name: "Ausblenden" }));
      await waitFor(() => expect(setEntryVisibilityAction).toHaveBeenCalledWith("e1", false));
      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith("Buchung für den Stundenzettel ausgeblendet.")
      );
    });

    it("blendet eine ausgeblendete Buchung wieder ein", async () => {
      renderAdmin();
      const item = entryItem("Strategieworkshop");
      expect(within(item).getByText("ausgeblendet")).toBeInTheDocument();
      expect(within(item).getByText("Überbuchung")).toBeInTheDocument();
      await userEvent.click(within(item).getByRole("button", { name: "Einblenden" }));
      await waitFor(() => expect(setEntryVisibilityAction).toHaveBeenCalledWith("e2", true));
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Buchung wieder eingeblendet."));
    });
  });

  describe("Löschen", () => {
    it("bricht bei offener Buchung ab, wenn der Prompt abgebrochen wird", async () => {
      vi.spyOn(window, "prompt").mockReturnValue(null);
      renderAdmin();
      await userEvent.click(
        within(entryItem("Design-Review")).getByRole("button", { name: "Löschen" })
      );
      expect(adminDeleteEntryAction).not.toHaveBeenCalled();
    });

    it("löscht eine offene Buchung mit optionaler Begründung", async () => {
      const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("Doppelt gebucht");
      renderAdmin();
      await userEvent.click(within(entryItem("Design-Review")).getByRole("button", { name: "Löschen" }));
      expect(promptSpy).toHaveBeenCalledWith("Begründung (optional):");
      await waitFor(() => expect(adminDeleteEntryAction).toHaveBeenCalledWith("e1", "Doppelt gebucht"));
      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith("Buchung gelöscht (Soft-Delete).")
      );
    });

    it("löscht eine offene Buchung auch mit leerer Begründung", async () => {
      vi.spyOn(window, "prompt").mockReturnValue("");
      renderAdmin();
      await userEvent.click(within(entryItem("Design-Review")).getByRole("button", { name: "Löschen" }));
      await waitFor(() => expect(adminDeleteEntryAction).toHaveBeenCalledWith("e1", ""));
    });

    it("bricht bei freigegebener Buchung ab, wenn der Prompt abgebrochen wird", async () => {
      const promptSpy = vi.spyOn(window, "prompt").mockReturnValue(null);
      renderAdmin();
      await userEvent.click(
        within(entryItem("Strategieworkshop")).getByRole("button", { name: "Löschen" })
      );
      expect(promptSpy).toHaveBeenCalledWith(
        "Begründung für die Löschung (Pflicht, Buchung ist freigegeben):"
      );
      expect(adminDeleteEntryAction).not.toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
    });

    it("verlangt bei freigegebener Buchung eine nicht-leere Begründung", async () => {
      vi.spyOn(window, "prompt").mockReturnValue("   ");
      renderAdmin();
      await userEvent.click(
        within(entryItem("Strategieworkshop")).getByRole("button", { name: "Löschen" })
      );
      expect(adminDeleteEntryAction).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith("Begründung erforderlich.");
    });

    it("löscht eine freigegebene Buchung mit Begründung", async () => {
      vi.spyOn(window, "prompt").mockReturnValue("Kunde storniert");
      renderAdmin();
      await userEvent.click(
        within(entryItem("Strategieworkshop")).getByRole("button", { name: "Löschen" })
      );
      await waitFor(() =>
        expect(adminDeleteEntryAction).toHaveBeenCalledWith("e2", "Kunde storniert")
      );
    });

    it("meldet Fehler beim Löschen als Toast", async () => {
      vi.spyOn(window, "prompt").mockReturnValue("x");
      vi.mocked(adminDeleteEntryAction).mockResolvedValueOnce({ ok: false, error: "Gesperrt." });
      renderAdmin();
      await userEvent.click(within(entryItem("Design-Review")).getByRole("button", { name: "Löschen" }));
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Gesperrt."));
    });
  });

  describe("Historie", () => {
    it("lädt die Historie beim Öffnen und zeigt die Einträge", async () => {
      let resolve!: (items: EntryHistoryItem[]) => void;
      vi.mocked(getEntryHistoryAction).mockReturnValueOnce(
        new Promise<EntryHistoryItem[]>((r) => {
          resolve = r;
        })
      );
      renderAdmin();
      await userEvent.click(within(entryItem("Design-Review")).getByRole("button", { name: "Historie" }));
      expect(getEntryHistoryAction).toHaveBeenCalledWith("e1");
      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveTextContent("Historie der Buchung");
      expect(dialog).toHaveTextContent("Lädt…");

      await act(async () =>
        resolve([
          {
            createdAt: "2026-09-29T08:15:00Z",
            action: "angelegt",
            actorLabel: "Anna Admin",
            details: "Dauer: 2,5 h",
          },
          { createdAt: "2026-09-30T10:00:00Z", action: "geändert", actorLabel: "Admin", details: "" },
        ])
      );

      expect(within(dialog).getByText("angelegt — Anna Admin")).toBeInTheDocument();
      expect(within(dialog).getByText("Dauer: 2,5 h")).toBeInTheDocument();
      expect(within(dialog).getByText("geändert — Admin")).toBeInTheDocument();
      // Zeitstempel in deutscher Zeit (UTC+2 im September)
      expect(dialog).toHaveTextContent("29.9.2026, 10:15:00");
      expect(dialog).not.toHaveTextContent("Lädt…");
    });

    it("zeigt einen Hinweis, wenn es keine Einträge gibt", async () => {
      vi.mocked(getEntryHistoryAction).mockResolvedValueOnce([]);
      renderAdmin();
      await userEvent.click(within(entryItem("Design-Review")).getByRole("button", { name: "Historie" }));
      expect(await screen.findByText("Keine Einträge.")).toBeInTheDocument();
    });

    it("meldet Ladefehler als Toast", async () => {
      vi.mocked(getEntryHistoryAction).mockRejectedValueOnce(new Error("boom"));
      renderAdmin();
      await userEvent.click(within(entryItem("Design-Review")).getByRole("button", { name: "Historie" }));
      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith("Historie konnte nicht geladen werden.")
      );
    });
  });
});

describe("WeekNav", () => {
  it("verlinkt jede Woche und hebt die aktive hervor", () => {
    render(
      <WeekNav
        weeks={[
          { isoYear: 2026, isoWeek: 39, label: "KW 39", status: "freigegeben", overbookedCount: 0 },
          { isoYear: 2026, isoWeek: 40, label: "KW 40", status: "offen", overbookedCount: 2 },
        ]}
        activeYear={2026}
        activeWeek={40}
      />
    );
    // Base UI vergibt dem <a> mit Button-Optik role="button"
    const kw39 = screen.getByRole("button", { name: /KW 39/ });
    const kw40 = screen.getByRole("button", { name: /KW 40/ });
    expect(kw39.tagName).toBe("A");
    expect(kw39).toHaveAttribute("href", "/faktura/freigabe?jahr=2026&kw=39");
    expect(kw40).toHaveAttribute("href", "/faktura/freigabe?jahr=2026&kw=40");
    expect(kw39).toHaveTextContent("(freigegeben)");
    expect(within(kw40).getByText("2")).toBeInTheDocument();
    // aktive Woche: Standard-Variante, übrige: outline
    expect(kw40).toHaveClass("bg-primary");
    expect(kw39).not.toHaveClass("bg-primary");
    expect(kw39).toHaveClass("border-border");
  });
});
