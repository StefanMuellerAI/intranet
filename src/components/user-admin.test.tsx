import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { describe, expect, it, vi } from "vitest";
import {
  deleteEmployeeDocument,
  inviteUser,
  resendInvitation,
  setUserStatus,
  updateUserBirthday,
  updateUserEntry,
  updateUserSupervisors,
  updateUserVacation,
  uploadEmployeeDocuments,
} from "@/app/(app)/mitarbeitende/actions";
import { UserAdminTabs, type EmployeeRow } from "./user-admin";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/(app)/mitarbeitende/actions", () => ({
  deleteEmployeeDocument: vi.fn(async () => {}),
  inviteUser: vi.fn(async () => {}),
  resendInvitation: vi.fn(async () => {}),
  setUserStatus: vi.fn(async () => {}),
  updateUserBirthday: vi.fn(async () => {}),
  updateUserEntry: vi.fn(async () => {}),
  updateUserSupervisors: vi.fn(async () => {}),
  updateUserVacation: vi.fn(async () => {}),
  uploadEmployeeDocuments: vi.fn(async () => {}),
}));

function employee(overrides: Partial<EmployeeRow> = {}): EmployeeRow {
  return {
    id: "u1",
    name: "Anna Aktiv",
    email: "anna@stefanai.de",
    status: "aktiv",
    isAdmin: false,
    isSelf: false,
    isManagingDirector: false,
    annualVacationDays: 30,
    vacationCarryoverDays: 0,
    entryDate: "2024-01-01",
    entryYearVacationDays: 10,
    entryLabel: "01.01.2024",
    entryPending: false,
    birthDate: null,
    birthdayLabel: "—",
    technicalSupervisorId: null,
    disciplinarySupervisorId: null,
    supervisorsLabel: "—",
    documents: [],
    ...overrides,
  };
}

const anna = employee({
  id: "u1",
  name: "Anna Aktiv",
  isAdmin: true,
  technicalSupervisorId: "u4",
  disciplinarySupervisorId: null,
  documents: [
    {
      id: "d1",
      category: "arbeitsvertrag",
      categoryLabel: "Arbeitsvertrag",
      title: "Vertrag 2024",
      filename: "vertrag.pdf",
      createdAtLabel: "02.01.2024",
    },
    {
      id: "d2",
      category: "sonstiges",
      categoryLabel: "Sonstiges",
      title: null,
      filename: "scan.png",
      createdAtLabel: "03.01.2024",
    },
  ],
});
const emil = employee({
  id: "u2",
  name: "Emil Eingeladen",
  email: "emil@stefanai.de",
  status: "eingeladen",
  entryPending: true,
  entryLabel: "01.11.2026",
});
const dora = employee({
  id: "u3",
  name: "Dora Deaktiviert",
  email: "dora@stefanai.de",
  status: "deaktiviert",
});
const selbst = employee({
  id: "u4",
  name: "Sven Selbst",
  email: "sven@stefanai.de",
  isSelf: true,
  isManagingDirector: true,
});

const supervisorOptions = [
  { id: "u1", name: "Anna Aktiv" },
  { id: "u4", name: "Sven Selbst" },
];

function renderTabs(users: EmployeeRow[] = [anna, emil, dora, selbst]) {
  return render(
    <UserAdminTabs
      users={users}
      supervisorOptions={supervisorOptions}
      defaultVacationDays={28}
      emailDomain="stefanai.de"
    />
  );
}

/** Tabellenzeile, in der der Name steht. */
function row(name: string) {
  const cell = screen.getByText(name);
  const tr = cell.closest("tr");
  if (!tr) throw new Error(`Keine Zeile für ${name}`);
  return tr as HTMLElement;
}

/** Abschnitt im Bearbeiten-Dialog anhand seiner Überschrift. */
function section(title: string) {
  const heading = within(screen.getByRole("dialog")).getByRole("heading", { name: title });
  return heading.closest("section") as HTMLElement;
}

/**
 * Wählt Dateien in einem <input type="file"> aus. happy-dom liest Dateien für
 * FormData aus seinem internen Feld, das `userEvent.upload` nicht befüllt —
 * daher über den nativen Setter setzen.
 */
function selectFiles(input: HTMLElement, files: File[]) {
  const list = new FileList() as unknown as File[];
  list.push(...files);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "files")?.set?.call(input, list);
  fireEvent.change(input);
}

function formDataOf(fn: unknown, call = 0, argIndex = 0): FormData {
  return vi.mocked(fn as (...args: unknown[]) => unknown).mock.calls[call][argIndex] as FormData;
}

async function openEdit(name: string) {
  await userEvent.click(within(row(name)).getByRole("button", { name: "Bearbeiten" }));
  return screen.getByRole("dialog");
}

describe("UserAdminTabs", () => {
  describe("Status-Reiter", () => {
    it("zeigt unter „Alle“ alle Mitarbeitenden mit Zählern je Reiter", () => {
      renderTabs();
      expect(screen.getByRole("tab", { name: /^Alle/ })).toHaveTextContent("4");
      expect(screen.getByRole("tab", { name: /^Aktiv/ })).toHaveTextContent("2");
      expect(screen.getByRole("tab", { name: /^Eingeladen/ })).toHaveTextContent("1");
      expect(screen.getByRole("tab", { name: /^Deaktiviert/ })).toHaveTextContent("1");

      for (const name of ["Anna Aktiv", "Emil Eingeladen", "Dora Deaktiviert", "Sven Selbst"]) {
        expect(screen.getByText(name)).toBeInTheDocument();
      }
    });

    it("filtert die Zeilen nach Status", async () => {
      renderTabs();

      await userEvent.click(screen.getByRole("tab", { name: /^Aktiv/ }));
      expect(screen.getByText("Anna Aktiv")).toBeInTheDocument();
      expect(screen.getByText("Sven Selbst")).toBeInTheDocument();
      expect(screen.queryByText("Emil Eingeladen")).not.toBeInTheDocument();
      expect(screen.queryByText("Dora Deaktiviert")).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole("tab", { name: /^Eingeladen/ }));
      expect(screen.getByText("Emil Eingeladen")).toBeInTheDocument();
      expect(screen.queryByText("Anna Aktiv")).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole("tab", { name: /^Deaktiviert/ }));
      expect(screen.getByText("Dora Deaktiviert")).toBeInTheDocument();
      expect(screen.queryByText("Emil Eingeladen")).not.toBeInTheDocument();
    });

    it("zeigt in leeren Reitern den Leerhinweis", async () => {
      renderTabs([anna]);
      await userEvent.click(screen.getByRole("tab", { name: /^Eingeladen/ }));
      expect(screen.getByText("Keine offenen Einladungen.")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("tab", { name: /^Deaktiviert/ }));
      expect(screen.getByText("Keine deaktivierten Zugänge.")).toBeInTheDocument();
    });

    it("kennzeichnet Admin, Geschäftsführung, künftigen Eintritt und Dokumentenzahl", () => {
      renderTabs();
      expect(within(row("Anna Aktiv")).getByText("Admin")).toBeInTheDocument();
      expect(within(row("Anna Aktiv")).getByText("2", { selector: "td" })).toBeInTheDocument();
      expect(within(row("Sven Selbst")).getByText("GF")).toBeInTheDocument();
      expect(within(row("Emil Eingeladen")).getByText("ab 01.11.2026")).toBeInTheDocument();
    });
  });

  describe("Einladen-Dialog", () => {
    it("sendet alle Felder samt Dateien und Kategorie an inviteUser", async () => {
      renderTabs();
      await userEvent.click(screen.getByRole("button", { name: /Mitarbeiter\/in einladen/ }));
      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveTextContent("Neue/n Mitarbeiter/in einladen");
      expect(screen.getByLabelText("Jahresurlaubsanspruch (Pflichtfeld)")).toHaveValue(28);

      await userEvent.type(screen.getByLabelText("Vorname"), "Nina");
      await userEvent.type(screen.getByLabelText("Nachname"), "Neu");
      await userEvent.type(
        screen.getByLabelText("E-Mail-Adresse (@stefanai.de)"),
        "nina.neu@stefanai.de"
      );
      await userEvent.type(screen.getByLabelText("Eintrittsdatum (Pflichtfeld)"), "2026-11-01");
      const rest = screen.getByLabelText("Resturlaub im Eintrittsjahr (Pflichtfeld)");
      await userEvent.clear(rest);
      await userEvent.type(rest, "5");
      await userEvent.type(screen.getByLabelText("Geburtsdatum (optional)"), "1990-05-17");
      const vertrag = new File(["%PDF"], "vertrag.pdf", { type: "application/pdf" });
      const zusatz = new File(["%PDF"], "zusatz.pdf", { type: "application/pdf" });
      selectFiles(
        screen.getByLabelText("Arbeitsvertrag & weitere Dokumente (optional)"),
        [vertrag, zusatz]
      );
      await userEvent.selectOptions(screen.getByLabelText("Dokument-Kategorie"), "zusatzvereinbarung");

      await userEvent.click(within(dialog).getByRole("button", { name: "Einladen" }));

      await waitFor(() => expect(inviteUser).toHaveBeenCalledTimes(1));
      const fd = formDataOf(inviteUser);
      expect(fd.get("firstName")).toBe("Nina");
      expect(fd.get("lastName")).toBe("Neu");
      expect(fd.get("email")).toBe("nina.neu@stefanai.de");
      expect(fd.get("annualVacationDays")).toBe("28");
      expect(fd.get("entryDate")).toBe("2026-11-01");
      expect(fd.get("entryYearVacationDays")).toBe("5");
      expect(fd.get("birthDate")).toBe("1990-05-17");
      expect(fd.get("documentCategory")).toBe("zusatzvereinbarung");
      const files = fd.getAll("documents") as File[];
      expect(files.map((f) => f.name)).toEqual(["vertrag.pdf", "zusatz.pdf"]);

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Einladung versendet."));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it("bleibt bei einem Fehler offen", async () => {
      vi.mocked(inviteUser).mockRejectedValueOnce(new Error("E-Mail bereits vergeben"));
      renderTabs();
      await userEvent.click(screen.getByRole("button", { name: /Mitarbeiter\/in einladen/ }));
      await userEvent.type(screen.getByLabelText("Vorname"), "Nina");
      await userEvent.type(screen.getByLabelText("Nachname"), "Neu");
      await userEvent.type(
        screen.getByLabelText("E-Mail-Adresse (@stefanai.de)"),
        "anna@stefanai.de"
      );
      await userEvent.type(screen.getByLabelText("Eintrittsdatum (Pflichtfeld)"), "2026-11-01");
      await userEvent.click(screen.getByRole("button", { name: "Einladen" }));

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith("E-Mail bereits vergeben"));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });

  describe("Bearbeiten-Dialog", () => {
    it("enthält die Abschnitte Urlaubskonto, Eintritt, Geburtsdatum und Vorgesetzte", async () => {
      renderTabs();
      const dialog = await openEdit("Anna Aktiv");
      expect(dialog).toHaveTextContent("Anna Aktiv bearbeiten");
      for (const title of ["Urlaubskonto", "Eintritt", "Geburtsdatum", "Vorgesetzte"]) {
        expect(within(dialog).getByRole("heading", { name: title })).toBeInTheDocument();
      }
    });

    it("speichert das Urlaubskonto mit der User-ID", async () => {
      renderTabs();
      await openEdit("Anna Aktiv");
      const s = section("Urlaubskonto");
      const jahr = within(s).getByLabelText("Jahresanspruch (Tage)");
      expect(jahr).toHaveValue(30);
      await userEvent.clear(jahr);
      await userEvent.type(jahr, "27.5");
      const uebertrag = within(s).getByLabelText("Übertrag Vorjahr (Tage)");
      await userEvent.clear(uebertrag);
      await userEvent.type(uebertrag, "3");
      await userEvent.click(within(s).getByRole("button", { name: "Speichern" }));

      await waitFor(() => expect(updateUserVacation).toHaveBeenCalledTimes(1));
      expect(vi.mocked(updateUserVacation).mock.calls[0][0]).toBe("u1");
      const fd = formDataOf(updateUserVacation, 0, 1);
      expect(fd.get("annualVacationDays")).toBe("27.5");
      expect(fd.get("vacationCarryoverDays")).toBe("3");
      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith("Urlaubskonto aktualisiert.")
      );
      // Panel-Dialog bleibt offen, jeder Abschnitt speichert für sich
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("meldet Fehler beim Urlaubskonto als Toast", async () => {
      vi.mocked(updateUserVacation).mockRejectedValueOnce(new Error("Ungültig"));
      renderTabs();
      await openEdit("Anna Aktiv");
      await userEvent.click(
        within(section("Urlaubskonto")).getByRole("button", { name: "Speichern" })
      );
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Ungültig"));
    });

    it("speichert den Eintritt", async () => {
      renderTabs();
      await openEdit("Anna Aktiv");
      const s = section("Eintritt");
      expect(within(s).getByLabelText("Eintrittsdatum")).toHaveValue("2024-01-01");
      expect(within(s).getByLabelText("Resturlaub im Eintrittsjahr (Tage)")).toHaveValue(10);
      await userEvent.click(within(s).getByRole("button", { name: "Speichern" }));

      await waitFor(() => expect(updateUserEntry).toHaveBeenCalledTimes(1));
      expect(vi.mocked(updateUserEntry).mock.calls[0][0]).toBe("u1");
      const fd = formDataOf(updateUserEntry, 0, 1);
      expect(fd.get("entryDate")).toBe("2024-01-01");
      expect(fd.get("entryYearVacationDays")).toBe("10");
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Eintritt gespeichert."));
    });

    it("meldet Fehler beim Eintritt als Toast", async () => {
      vi.mocked(updateUserEntry).mockRejectedValueOnce(new Error("Datum fehlt"));
      renderTabs();
      await openEdit("Anna Aktiv");
      await userEvent.click(within(section("Eintritt")).getByRole("button", { name: "Speichern" }));
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Datum fehlt"));
    });

    it("speichert das Geburtsdatum", async () => {
      renderTabs();
      await openEdit("Anna Aktiv");
      const s = section("Geburtsdatum");
      await userEvent.type(
        within(s).getByLabelText("Geburtsdatum (wird im Kalender ohne Jahr angezeigt)"),
        "1988-02-29"
      );
      await userEvent.click(within(s).getByRole("button", { name: "Speichern" }));

      await waitFor(() => expect(updateUserBirthday).toHaveBeenCalledTimes(1));
      expect(vi.mocked(updateUserBirthday).mock.calls[0][0]).toBe("u1");
      expect(formDataOf(updateUserBirthday, 0, 1).get("birthDate")).toBe("1988-02-29");
      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith("Geburtsdatum gespeichert.")
      );
    });

    it("meldet Fehler beim Geburtsdatum als Toast", async () => {
      vi.mocked(updateUserBirthday).mockRejectedValueOnce(new Error("Zu jung"));
      renderTabs();
      await openEdit("Anna Aktiv");
      await userEvent.click(
        within(section("Geburtsdatum")).getByRole("button", { name: "Speichern" })
      );
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Zu jung"));
    });

    it("bietet als Vorgesetzte nur andere Personen an und speichert die Auswahl", async () => {
      renderTabs();
      await openEdit("Anna Aktiv");
      const s = section("Vorgesetzte");
      const fachlich = within(s).getByLabelText("Fachliche/r Vorgesetzte/r");
      const disziplinarisch = within(s).getByLabelText("Disziplinarische/r Vorgesetzte/r");
      // Anna kann nicht ihre eigene Vorgesetzte sein
      expect(within(fachlich).queryByRole("option", { name: "Anna Aktiv" })).not.toBeInTheDocument();
      expect(fachlich).toHaveValue("u4");
      expect(disziplinarisch).toHaveValue("");

      await userEvent.selectOptions(disziplinarisch, "u4");
      await userEvent.click(within(s).getByRole("button", { name: "Speichern" }));

      await waitFor(() => expect(updateUserSupervisors).toHaveBeenCalledTimes(1));
      expect(vi.mocked(updateUserSupervisors).mock.calls[0][0]).toBe("u1");
      const fd = formDataOf(updateUserSupervisors, 0, 1);
      expect(fd.get("technicalSupervisorId")).toBe("u4");
      expect(fd.get("disciplinarySupervisorId")).toBe("u4");
      expect(fd.get("isManagingDirector")).toBeNull();
      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith("Vorgesetzte gespeichert.")
      );
    });

    it("„Geschäftsführung“ blendet die Vorgesetzten-Auswahl aus und wird mitgesendet", async () => {
      renderTabs();
      await openEdit("Anna Aktiv");
      const s = section("Vorgesetzte");
      const gf = within(s).getByRole("checkbox", { name: "Geschäftsführung" });
      expect(gf).not.toBeChecked();

      await userEvent.click(gf);

      expect(gf).toBeChecked();
      expect(within(s).queryByLabelText("Fachliche/r Vorgesetzte/r")).not.toBeInTheDocument();
      expect(
        within(s).queryByLabelText("Disziplinarische/r Vorgesetzte/r")
      ).not.toBeInTheDocument();
      expect(s).toHaveTextContent("Geschäftsführung — keine Vorgesetzten-Zuordnung.");

      await userEvent.click(within(s).getByRole("button", { name: "Speichern" }));
      await waitFor(() => expect(updateUserSupervisors).toHaveBeenCalledTimes(1));
      const fd = formDataOf(updateUserSupervisors, 0, 1);
      expect(fd.get("isManagingDirector")).not.toBeNull();
      expect(fd.get("technicalSupervisorId")).toBeNull();
    });

    it("zeigt bei bestehender Geschäftsführung die Auswahl erst nach Abwählen", async () => {
      renderTabs();
      await openEdit("Sven Selbst");
      const s = section("Vorgesetzte");
      expect(within(s).queryByLabelText("Fachliche/r Vorgesetzte/r")).not.toBeInTheDocument();
      await userEvent.click(within(s).getByRole("checkbox", { name: "Geschäftsführung" }));
      expect(within(s).getByLabelText("Fachliche/r Vorgesetzte/r")).toBeInTheDocument();
    });

    it("meldet Fehler bei den Vorgesetzten als Toast", async () => {
      vi.mocked(updateUserSupervisors).mockRejectedValueOnce(new Error("Zirkelbezug"));
      renderTabs();
      await openEdit("Anna Aktiv");
      await userEvent.click(
        within(section("Vorgesetzte")).getByRole("button", { name: "Speichern" })
      );
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Zirkelbezug"));
    });

    it("„Schließen“ schließt den Dialog", async () => {
      renderTabs();
      await openEdit("Anna Aktiv");
      await userEvent.click(screen.getByRole("button", { name: "Schließen" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });
  });

  describe("Dokumente-Dialog", () => {
    async function openDocs(name: string) {
      await userEvent.click(within(row(name)).getByRole("button", { name: "Dokumente" }));
      return screen.getByRole("dialog");
    }

    it("verlinkt jedes Dokument zum Download (Titel oder Dateiname)", async () => {
      renderTabs();
      const dialog = await openDocs("Anna Aktiv");
      expect(dialog).toHaveTextContent("Dokumente — Anna Aktiv");

      const vertrag = within(dialog).getByRole("link", { name: "Vertrag 2024" });
      expect(vertrag).toHaveAttribute("href", "/api/dokumente/d1");
      expect(vertrag).toHaveAttribute("target", "_blank");
      expect(within(dialog).getByRole("link", { name: "scan.png" })).toHaveAttribute(
        "href",
        "/api/dokumente/d2"
      );
      expect(dialog).toHaveTextContent("Arbeitsvertrag · 02.01.2024");
    });

    it("zeigt ohne Dokumente einen Hinweis", async () => {
      renderTabs();
      const dialog = await openDocs("Emil Eingeladen");
      expect(dialog).toHaveTextContent("Noch keine Dokumente hinterlegt.");
    });

    it("löscht ein Dokument erst nach Bestätigung", async () => {
      renderTabs();
      const dialog = await openDocs("Anna Aktiv");
      const [ersterLoeschen] = within(dialog).getAllByRole("button", { name: "Löschen" });
      await userEvent.click(ersterLoeschen);

      const confirm = screen
        .getAllByRole("dialog")
        .find((d) => d.textContent?.includes("Dokument löschen?"));
      expect(confirm).toBeDefined();
      expect(confirm).toHaveTextContent("„vertrag.pdf“ wird endgültig entfernt.");
      expect(deleteEmployeeDocument).not.toHaveBeenCalled();

      await userEvent.click(within(confirm!).getByRole("button", { name: "Endgültig löschen" }));
      await waitFor(() => expect(deleteEmployeeDocument).toHaveBeenCalledWith("d1"));
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Dokument gelöscht."));
    });

    it("„Abbrechen“ beim Löschen behält das Dokument", async () => {
      renderTabs();
      const dialog = await openDocs("Anna Aktiv");
      await userEvent.click(within(dialog).getAllByRole("button", { name: "Löschen" })[1]);
      const confirm = screen
        .getAllByRole("dialog")
        .find((d) => d.textContent?.includes("Dokument löschen?"))!;
      await userEvent.click(within(confirm).getByRole("button", { name: "Abbrechen" }));
      expect(deleteEmployeeDocument).not.toHaveBeenCalled();
    });

    it("lädt Dateien mit Kategorie und Titel hoch", async () => {
      renderTabs();
      const dialog = await openDocs("Anna Aktiv");
      const file = new File(["%PDF"], "bescheinigung.pdf", { type: "application/pdf" });
      selectFiles(within(dialog).getByLabelText("Datei(en) — PDF/JPG/PNG, max. 10 MB"), [file]);
      const kategorie = within(dialog).getByLabelText("Kategorie");
      expect(kategorie).toHaveValue("arbeitsvertrag");
      await userEvent.selectOptions(kategorie, "bescheinigung");
      await userEvent.type(within(dialog).getByLabelText("Titel (optional)"), "AU 2026");
      await userEvent.click(within(dialog).getByRole("button", { name: "Hochladen" }));

      await waitFor(() => expect(uploadEmployeeDocuments).toHaveBeenCalledTimes(1));
      expect(vi.mocked(uploadEmployeeDocuments).mock.calls[0][0]).toBe("u1");
      const fd = formDataOf(uploadEmployeeDocuments, 0, 1);
      expect((fd.get("documents") as File).name).toBe("bescheinigung.pdf");
      expect(fd.get("category")).toBe("bescheinigung");
      expect(fd.get("title")).toBe("AU 2026");
      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith("Dokument(e) verschlüsselt gespeichert.")
      );
      // Formular wird nach Erfolg zurückgesetzt
      await waitFor(() => expect(within(dialog).getByLabelText("Titel (optional)")).toHaveValue(""));
    });

    it("meldet Upload-Fehler als Toast", async () => {
      vi.mocked(uploadEmployeeDocuments).mockRejectedValueOnce(new Error("Datei zu groß"));
      renderTabs();
      const dialog = await openDocs("Anna Aktiv");
      selectFiles(within(dialog).getByLabelText("Datei(en) — PDF/JPG/PNG, max. 10 MB"), [
        new File(["x"], "gross.pdf", { type: "application/pdf" }),
      ]);
      await userEvent.click(within(dialog).getByRole("button", { name: "Hochladen" }));
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Datei zu groß"));
      expect(toast.success).not.toHaveBeenCalled();
    });
  });

  describe("Zugang", () => {
    it("bietet „Einladung erneut senden“ nur für eingeladene Personen an", async () => {
      renderTabs();
      expect(
        within(row("Anna Aktiv")).queryByRole("button", { name: "Einladung erneut senden" })
      ).not.toBeInTheDocument();
      expect(
        within(row("Dora Deaktiviert")).queryByRole("button", { name: "Einladung erneut senden" })
      ).not.toBeInTheDocument();

      await userEvent.click(
        within(row("Emil Eingeladen")).getByRole("button", { name: "Einladung erneut senden" })
      );
      await waitFor(() => expect(resendInvitation).toHaveBeenCalledWith("u2"));
      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith("Einladung erneut versendet.")
      );
    });

    it("deaktiviert erst nach Bestätigung", async () => {
      renderTabs();
      await userEvent.click(within(row("Anna Aktiv")).getByRole("button", { name: "Deaktivieren" }));
      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveTextContent("Zugang deaktivieren?");
      expect(dialog).toHaveTextContent("Der Login von „Anna Aktiv“ wird gesperrt.");
      expect(setUserStatus).not.toHaveBeenCalled();

      await userEvent.click(within(dialog).getByRole("button", { name: "Deaktivieren" }));
      await waitFor(() => expect(setUserStatus).toHaveBeenCalledWith("u1", "deaktiviert"));
      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith(
          "User deaktiviert — Login gesperrt, Antragsdaten bleiben erhalten."
        )
      );
    });

    it("„Abbrechen“ beim Deaktivieren ändert nichts", async () => {
      renderTabs();
      await userEvent.click(within(row("Emil Eingeladen")).getByRole("button", { name: "Deaktivieren" }));
      await userEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
      expect(setUserStatus).not.toHaveBeenCalled();
    });

    it("reaktiviert deaktivierte Zugänge direkt", async () => {
      renderTabs();
      expect(
        within(row("Dora Deaktiviert")).queryByRole("button", { name: "Deaktivieren" })
      ).not.toBeInTheDocument();
      await userEvent.click(
        within(row("Dora Deaktiviert")).getByRole("button", { name: "Reaktivieren" })
      );
      await waitFor(() => expect(setUserStatus).toHaveBeenCalledWith("u3", "aktiv"));
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("User reaktiviert."));
    });

    it("bietet für das eigene Konto weder Deaktivieren noch Reaktivieren an", () => {
      renderTabs([selbst, employee({ id: "u5", name: "Selbst Deaktiviert", status: "deaktiviert", isSelf: true })]);
      for (const name of ["Sven Selbst", "Selbst Deaktiviert"]) {
        expect(within(row(name)).queryByRole("button", { name: "Deaktivieren" })).not.toBeInTheDocument();
        expect(within(row(name)).queryByRole("button", { name: "Reaktivieren" })).not.toBeInTheDocument();
      }
    });
  });
});
