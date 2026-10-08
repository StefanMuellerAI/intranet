import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { describe, expect, it, vi } from "vitest";
import {
  createEntryAction,
  deleteEntryAction,
  updateEntryAction,
} from "@/app/(app)/faktura/actions";
import { Zeiterfassung, type DayView, type EntryView, type ProjectOption } from "./zeiterfassung";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/(app)/faktura/actions", () => ({
  createEntryAction: vi.fn(),
  updateEntryAction: vi.fn(),
  deleteEntryAction: vi.fn(),
}));

const projects: ProjectOption[] = [
  { id: "p1", label: "ACME – Website", validFrom: null, validTo: null, hasLimit: false },
  { id: "p2", label: "Globex – Beratung", validFrom: null, validTo: null, hasLimit: true },
];

const offen: EntryView = {
  id: "e1",
  projectId: "p2",
  projectLabel: "Globex – Beratung",
  entryDate: "2026-10-06",
  durationHours: "1,5",
  description: "Workshop vorbereitet",
  status: "offen",
  visibleOnTimesheet: true,
  overbooked: true,
  editable: true,
};

const freigegeben: EntryView = {
  id: "e2",
  projectId: "p1",
  projectLabel: "ACME – Website",
  entryDate: "2026-10-05",
  durationHours: "2",
  description: "Landingpage gebaut",
  status: "freigegeben",
  visibleOnTimesheet: false,
  overbooked: false,
  editable: false,
};

const days: DayView[] = [
  { dateISO: "2026-10-05", label: "Montag, 05.10.", entries: [freigegeben], totalHours: "2" },
  { dateISO: "2026-10-06", label: "Dienstag, 06.10.", entries: [offen], totalHours: "1,5" },
  { dateISO: "2026-10-07", label: "Mittwoch, 07.10.", entries: [], totalHours: "0" },
];

function renderView(props: Partial<React.ComponentProps<typeof Zeiterfassung>> = {}) {
  return render(
    <Zeiterfassung
      days={days}
      weekTotalHours="3,5"
      weekApproved={false}
      bookingOpen
      defaultDate="2026-10-08"
      projects={projects}
      {...props}
    />
  );
}

function entryItem(description: string) {
  return screen.getByText(description).closest("li") as HTMLElement;
}

/** Wählt ein Projekt im Base-UI-Select des offenen Dialogs. */
async function chooseProject(label: string) {
  await userEvent.click(screen.getByTestId("projekt-auswahl"));
  await userEvent.click(await screen.findByRole("option", { name: label }));
}

function lastFormData(fn: unknown, argIndex = 0): FormData {
  const calls = vi.mocked(fn as (...args: unknown[]) => unknown).mock.calls;
  return calls[calls.length - 1][argIndex] as FormData;
}

async function openCreateDialog() {
  await userEvent.click(screen.getByRole("button", { name: "Zeit buchen" }));
  return screen.getByRole("dialog");
}

describe("Zeiterfassung", () => {
  describe("Übersicht", () => {
    it("zeigt Wochenstatus, Summen und Einträge je Tag", () => {
      renderView();
      expect(screen.getByText("Woche offen")).toBeInTheDocument();
      expect(screen.getByText("3,5 h")).toBeInTheDocument();
      expect(screen.getByText("Tagessumme: 1,5 h")).toBeInTheDocument();
      expect(screen.getByText("Keine Buchungen.")).toBeInTheDocument();

      const e1 = entryItem("Workshop vorbereitet");
      expect(within(e1).getByText("Überbuchung")).toBeInTheDocument();
      expect(within(e1).getByText("offen")).toBeInTheDocument();

      const e2 = entryItem("Landingpage gebaut");
      expect(within(e2).getByText("nicht im Stundenzettel")).toBeInTheDocument();
      expect(within(e2).getByText("freigegeben")).toBeInTheDocument();
    });

    it("bietet Bearbeiten/Löschen nur für bearbeitbare Einträge an", () => {
      renderView();
      expect(within(entryItem("Workshop vorbereitet")).getByRole("button", { name: "Bearbeiten" })).toBeInTheDocument();
      expect(within(entryItem("Workshop vorbereitet")).getByRole("button", { name: "Löschen" })).toBeInTheDocument();
      expect(within(entryItem("Landingpage gebaut")).queryByRole("button")).not.toBeInTheDocument();
    });

    it("kennzeichnet freigegebene Wochen und geschlossene Buchungsfenster", () => {
      renderView({ weekApproved: true, bookingOpen: false });
      expect(screen.getByText("Woche freigegeben — Buchungen schreibgeschützt")).toBeInTheDocument();
      expect(
        screen.getByText("Das Buchungsfenster für diese Woche ist geschlossen.")
      ).toBeInTheDocument();
    });

    it("zeigt ohne buchbare Projekte keinen „Zeit buchen“-Button", () => {
      renderView({ projects: [] });
      expect(screen.queryByRole("button", { name: "Zeit buchen" })).not.toBeInTheDocument();
    });
  });

  describe("Zeit buchen", () => {
    it("sendet Projekt, Datum, Dauer und Beschreibung und schließt bei Erfolg", async () => {
      vi.mocked(createEntryAction).mockResolvedValueOnce({ ok: true, entryId: "neu" });
      renderView();
      const dialog = await openCreateDialog();
      expect(dialog).toHaveTextContent("Neue Zeitbuchung");
      expect(within(dialog).getByLabelText("Buchungsdatum")).toHaveValue("2026-10-08");

      await chooseProject("Globex – Beratung");
      await userEvent.type(within(dialog).getByLabelText("Dauer in Stunden (0,25er-Raster)"), "1,25");
      await userEvent.type(
        within(dialog).getByLabelText(/Tätigkeitsbeschreibung/),
        "Angebot geschrieben"
      );
      await userEvent.click(within(dialog).getByRole("button", { name: "Buchung speichern" }));

      await waitFor(() => expect(createEntryAction).toHaveBeenCalledTimes(1));
      const fd = lastFormData(createEntryAction);
      expect(fd.get("projectId")).toBe("p2");
      expect(fd.get("entryDate")).toBe("2026-10-08");
      expect(fd.get("durationHours")).toBe("1,25");
      expect(fd.get("description")).toBe("Angebot geschrieben");
      expect(fd.get("confirmWarnings")).toBe("false");
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Buchung gespeichert."));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it("zeigt Warnungen und bucht nach „Trotzdem buchen“ mit confirmWarnings=true", async () => {
      vi.mocked(createEntryAction)
        .mockResolvedValueOnce({ ok: false, warnings: ["Monatslimit überschritten.", "Mehr als 10 h am Tag."] })
        .mockResolvedValueOnce({ ok: true, entryId: "neu" });
      renderView();
      const dialog = await openCreateDialog();
      await chooseProject("ACME – Website");
      await userEvent.type(within(dialog).getByLabelText("Dauer in Stunden (0,25er-Raster)"), "11");
      await userEvent.type(within(dialog).getByLabelText(/Tätigkeitsbeschreibung/), "Launch");
      await userEvent.click(within(dialog).getByRole("button", { name: "Buchung speichern" }));

      expect(await within(dialog).findByText("Hinweis vor dem Speichern")).toBeInTheDocument();
      expect(within(dialog).getByText("Monatslimit überschritten.")).toBeInTheDocument();
      expect(within(dialog).getByText("Mehr als 10 h am Tag.")).toBeInTheDocument();
      expect(toast.success).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      // Eingaben bleiben erhalten, der Button wechselt zu „Trotzdem buchen“
      expect(within(dialog).getByLabelText("Dauer in Stunden (0,25er-Raster)")).toHaveValue("11");
      await userEvent.click(within(dialog).getByRole("button", { name: "Trotzdem buchen" }));

      await waitFor(() => expect(createEntryAction).toHaveBeenCalledTimes(2));
      const fd = lastFormData(createEntryAction);
      expect(fd.get("confirmWarnings")).toBe("true");
      expect(fd.get("projectId")).toBe("p1");
      expect(fd.get("durationHours")).toBe("11");
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Buchung gespeichert."));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it("zeigt einen Fehler als Toast und lässt den Dialog offen", async () => {
      vi.mocked(createEntryAction).mockResolvedValueOnce({
        ok: false,
        error: "Buchungen sind nur für die laufende Woche möglich.",
      });
      renderView();
      const dialog = await openCreateDialog();
      await chooseProject("ACME – Website");
      await userEvent.type(within(dialog).getByLabelText("Dauer in Stunden (0,25er-Raster)"), "1");
      await userEvent.type(within(dialog).getByLabelText(/Tätigkeitsbeschreibung/), "X");
      await userEvent.click(within(dialog).getByRole("button", { name: "Buchung speichern" }));

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith("Buchungen sind nur für die laufende Woche möglich.")
      );
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(within(dialog).queryByText("Hinweis vor dem Speichern")).not.toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: "Buchung speichern" })).toBeInTheDocument();
    });

    it("blockiert Dauern außerhalb des Viertelstunden-Rasters vor dem Absenden", async () => {
      renderView();
      const dialog = await openCreateDialog();
      await chooseProject("ACME – Website");
      await userEvent.type(within(dialog).getByLabelText("Dauer in Stunden (0,25er-Raster)"), "1,3");
      await userEvent.type(within(dialog).getByLabelText(/Tätigkeitsbeschreibung/), "X");
      await userEvent.click(within(dialog).getByRole("button", { name: "Buchung speichern" }));
      expect(createEntryAction).not.toHaveBeenCalled();
    });
  });

  describe("Bearbeiten", () => {
    it("belegt die Werte vor und speichert über updateEntryAction", async () => {
      vi.mocked(updateEntryAction).mockResolvedValueOnce({ ok: true, entryId: "e1" });
      renderView();
      await userEvent.click(
        within(entryItem("Workshop vorbereitet")).getByRole("button", { name: "Bearbeiten" })
      );
      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveTextContent("Buchung bearbeiten");
      expect(within(dialog).getByTestId("projekt-auswahl")).toHaveTextContent("Globex – Beratung");
      expect(within(dialog).getByLabelText("Buchungsdatum")).toHaveValue("2026-10-06");
      const dauer = within(dialog).getByLabelText("Dauer in Stunden (0,25er-Raster)");
      expect(dauer).toHaveValue("1,5");
      await userEvent.clear(dauer);
      await userEvent.type(dauer, "2,75");
      await userEvent.click(within(dialog).getByRole("button", { name: "Änderungen speichern" }));

      await waitFor(() => expect(updateEntryAction).toHaveBeenCalledTimes(1));
      expect(vi.mocked(updateEntryAction).mock.calls[0][0]).toBe("e1");
      const fd = lastFormData(updateEntryAction, 1);
      expect(fd.get("projectId")).toBe("p2");
      expect(fd.get("durationHours")).toBe("2,75");
      expect(fd.get("description")).toBe("Workshop vorbereitet");
      expect(fd.get("confirmWarnings")).toBe("false");
      expect(createEntryAction).not.toHaveBeenCalled();
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Buchung aktualisiert."));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it("bestätigt Warnungen auch beim Bearbeiten mit confirmWarnings=true", async () => {
      vi.mocked(updateEntryAction)
        .mockResolvedValueOnce({ ok: false, warnings: ["Projektlimit erreicht."] })
        .mockResolvedValueOnce({ ok: true, entryId: "e1" });
      renderView();
      await userEvent.click(
        within(entryItem("Workshop vorbereitet")).getByRole("button", { name: "Bearbeiten" })
      );
      const dialog = screen.getByRole("dialog");
      await userEvent.click(within(dialog).getByRole("button", { name: "Änderungen speichern" }));

      expect(await within(dialog).findByText("Projektlimit erreicht.")).toBeInTheDocument();
      await userEvent.click(within(dialog).getByRole("button", { name: "Trotzdem buchen" }));

      await waitFor(() => expect(updateEntryAction).toHaveBeenCalledTimes(2));
      expect(vi.mocked(updateEntryAction).mock.calls[1][0]).toBe("e1");
      expect(lastFormData(updateEntryAction, 1).get("confirmWarnings")).toBe("true");
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Buchung aktualisiert."));
    });

    it("meldet Fehler beim Bearbeiten als Toast", async () => {
      vi.mocked(updateEntryAction).mockResolvedValueOnce({ ok: false, error: "Woche bereits freigegeben." });
      renderView();
      await userEvent.click(
        within(entryItem("Workshop vorbereitet")).getByRole("button", { name: "Bearbeiten" })
      );
      await userEvent.click(screen.getByRole("button", { name: "Änderungen speichern" }));
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Woche bereits freigegeben."));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });

  describe("Löschen", () => {
    it("fragt per window.confirm nach — Abbruch löscht nichts", async () => {
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
      renderView();
      await userEvent.click(within(entryItem("Workshop vorbereitet")).getByRole("button", { name: "Löschen" }));
      expect(confirmSpy).toHaveBeenCalledWith("Buchung wirklich löschen?");
      expect(deleteEntryAction).not.toHaveBeenCalled();
      confirmSpy.mockRestore();
    });

    it("löscht nach Bestätigung und meldet Erfolg", async () => {
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
      vi.mocked(deleteEntryAction).mockResolvedValueOnce({ ok: true, data: null });
      renderView();
      await userEvent.click(within(entryItem("Workshop vorbereitet")).getByRole("button", { name: "Löschen" }));
      await waitFor(() => expect(deleteEntryAction).toHaveBeenCalledWith("e1"));
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Buchung gelöscht."));
      confirmSpy.mockRestore();
    });

    it("meldet Fehler beim Löschen als Toast", async () => {
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
      vi.mocked(deleteEntryAction).mockResolvedValueOnce({ ok: false, error: "Nicht erlaubt." });
      renderView();
      await userEvent.click(within(entryItem("Workshop vorbereitet")).getByRole("button", { name: "Löschen" }));
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Nicht erlaubt."));
      expect(toast.success).not.toHaveBeenCalled();
      confirmSpy.mockRestore();
    });
  });
});
