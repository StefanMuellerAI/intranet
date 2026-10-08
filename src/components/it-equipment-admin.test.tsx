import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  analyzeEquipmentImport,
  applyEquipmentImport,
  createEquipment,
  createEquipmentType,
  deleteEquipment,
  deleteEquipmentType,
  deleteHandoverProtocol,
  markEquipmentReturned,
  toggleEquipmentType,
  undoEquipmentReturn,
  updateEquipment,
  updateEquipmentType,
  uploadHandoverProtocol,
  type ImportOutcome,
} from "@/app/(app)/it-management/actions";
import {
  ITEquipmentTabs,
  type EmployeeOption,
  type EmployeeProtocolRow,
  type EquipmentRow,
  type EquipmentTypeOption,
  type EquipmentTypeRow,
} from "./it-equipment-admin";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/(app)/it-management/actions", () => ({
  analyzeEquipmentImport: vi.fn(),
  applyEquipmentImport: vi.fn(),
  createEquipment: vi.fn(async () => {}),
  createEquipmentType: vi.fn(async () => {}),
  deleteEquipment: vi.fn(async () => {}),
  deleteEquipmentType: vi.fn(async () => {}),
  deleteHandoverProtocol: vi.fn(async () => {}),
  markEquipmentReturned: vi.fn(async () => {}),
  toggleEquipmentType: vi.fn(async () => {}),
  undoEquipmentReturn: vi.fn(async () => {}),
  updateEquipment: vi.fn(async () => {}),
  updateEquipmentType: vi.fn(async () => {}),
  uploadHandoverProtocol: vi.fn(async () => {}),
}));

const employees: EmployeeOption[] = [
  { id: "u1", name: "Anna Admin", selectable: true },
  { id: "u2", name: "Bernd Beispiel", selectable: true },
  { id: "u3", name: "Dora Deaktiviert", selectable: false },
];

const types: EquipmentTypeOption[] = [
  { id: "t1", name: "Laptop", selectable: true },
  { id: "t2", name: "Monitor", selectable: true },
  { id: "t3", name: "Faxgerät", selectable: false },
];

const laptop: EquipmentRow = {
  id: "eq1",
  userId: "u1",
  userName: "Anna Admin",
  typeId: "t1",
  typeName: "Laptop",
  deviceId: "SA-IT-2026-01",
  serialNumber: "C02XL0",
  notes: "mit Netzteil",
  handoverDate: "2026-01-15",
  handoverLabel: "15.01.2026",
  returnDate: null,
  returnLabel: "—",
};

const fax: EquipmentRow = {
  id: "eq2",
  userId: "u3",
  userName: "Dora Deaktiviert",
  typeId: "t3",
  typeName: "Faxgerät",
  deviceId: "SA-IT-2020-07",
  serialNumber: null,
  notes: null,
  handoverDate: "2020-03-01",
  handoverLabel: "01.03.2020",
  returnDate: "2025-12-31",
  returnLabel: "31.12.2025",
};

const typeRows: EquipmentTypeRow[] = [
  { id: "t1", name: "Laptop", sortOrder: 1, active: true, usageCount: 3 },
  { id: "t4", name: "Headset", sortOrder: 2, active: false, usageCount: 0 },
];

const protocolRows: EmployeeProtocolRow[] = [
  {
    userId: "u1",
    userName: "Anna Admin",
    active: true,
    activeDevices: 1,
    totalDevices: 1,
    uebergabe: { id: "p1", filename: "uebergabe-anna.pdf", createdAtLabel: "16.01.2026" },
    ruecknahme: null,
  },
  {
    userId: "u3",
    userName: "Dora Deaktiviert",
    active: false,
    activeDevices: 0,
    totalDevices: 1,
    uebergabe: null,
    ruecknahme: null,
  },
  {
    userId: "u2",
    userName: "Bernd Beispiel",
    active: true,
    activeDevices: 0,
    totalDevices: 0,
    uebergabe: null,
    ruecknahme: null,
  },
];

function renderTabs(overrides: Partial<React.ComponentProps<typeof ITEquipmentTabs>> = {}) {
  return render(
    <ITEquipmentTabs
      active={[laptop]}
      returned={[fax]}
      employees={employees}
      types={types}
      typeRows={typeRows}
      protocolRows={protocolRows}
      nextDeviceId="SA-IT-2026-02"
      {...overrides}
    />
  );
}

function row(text: string) {
  return screen.getByText(text).closest("tr") as HTMLElement;
}

function formDataOf(fn: unknown, call = 0, argIndex = 0): FormData {
  return vi.mocked(fn as (...args: unknown[]) => unknown).mock.calls[call][argIndex] as FormData;
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

async function openTab(name: RegExp) {
  await userEvent.click(screen.getByRole("tab", { name }));
}

/** window.location durch ein beschreibbares Objekt ersetzen (Downloads). */
let originalLocation: Location;
let fakeLocation: { href: string };
beforeEach(() => {
  originalLocation = window.location;
  fakeLocation = { href: "http://localhost/it-management" };
  Object.defineProperty(window, "location", { configurable: true, value: fakeLocation });
});
afterEach(() => {
  Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
});

describe("ITEquipmentTabs", () => {
  describe("Reiter", () => {
    it("zeigt Zähler und startet mit der Ausstattung im Einsatz", () => {
      renderTabs();
      expect(screen.getByRole("tab", { name: /^Im Einsatz/ })).toHaveTextContent("1");
      expect(screen.getByRole("tab", { name: /^Zurückgegeben/ })).toHaveTextContent("1");
      expect(screen.getByRole("tab", { name: /^Mitarbeitende/ })).toHaveTextContent("3");
      expect(screen.getByRole("tab", { name: /^Ausstattungsarten/ })).toHaveTextContent("2");
      expect(screen.getByRole("tab", { name: "Export & Import" })).toBeInTheDocument();

      expect(within(row("SA-IT-2026-01")).getByText("im Einsatz")).toBeInTheDocument();
      expect(screen.queryByText("SA-IT-2020-07")).not.toBeInTheDocument();
    });

    it("zeigt zurückgegebene Ausstattung ohne Anlegen-Button", async () => {
      renderTabs();
      await openTab(/^Zurückgegeben/);
      const r = row("SA-IT-2020-07");
      expect(within(r).getByText("zurückgegeben")).toBeInTheDocument();
      expect(within(r).getByText("31.12.2025")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Ausstattung erfassen/ })).not.toBeInTheDocument();
      expect(screen.queryByText("SA-IT-2026-01")).not.toBeInTheDocument();
    });
  });

  describe("Ausstattung im Einsatz", () => {
    it("belegt beim Anlegen die vorgeschlagene Geräte-ID vor und sendet das Formular", async () => {
      renderTabs();
      await userEvent.click(screen.getByRole("button", { name: /Ausstattung erfassen/ }));
      const dialog = screen.getByRole("dialog");
      const deviceId = within(dialog).getByLabelText("Geräte-ID");
      expect(deviceId).toHaveValue("SA-IT-2026-02");

      const user = within(dialog).getByLabelText("Mitarbeiter/in");
      // Deaktivierte Personen und ausgeblendete Arten stehen nicht zur Auswahl
      expect(within(user).queryByRole("option", { name: "Dora Deaktiviert" })).not.toBeInTheDocument();
      const type = within(dialog).getByLabelText("Ausstattung");
      expect(within(type).queryByRole("option", { name: "Faxgerät" })).not.toBeInTheDocument();

      await userEvent.selectOptions(user, "u2");
      await userEvent.selectOptions(type, "t2");
      await userEvent.type(within(dialog).getByLabelText("Seriennummer (optional)"), "MON-1");
      await userEvent.type(within(dialog).getByLabelText("Übernahme am"), "2026-10-01");
      await userEvent.type(
        within(dialog).getByLabelText("Zusatzinformationen (optional)"),
        "27 Zoll"
      );
      await userEvent.click(within(dialog).getByRole("button", { name: "Ausstattung speichern" }));

      await waitFor(() => expect(createEquipment).toHaveBeenCalledTimes(1));
      const fd = formDataOf(createEquipment);
      expect(fd.get("id")).toBeNull();
      expect(fd.get("userId")).toBe("u2");
      expect(fd.get("typeId")).toBe("t2");
      expect(fd.get("deviceId")).toBe("SA-IT-2026-02");
      expect(fd.get("serialNumber")).toBe("MON-1");
      expect(fd.get("handoverDate")).toBe("2026-10-01");
      expect(fd.get("returnDate")).toBe("");
      expect(fd.get("notes")).toBe("27 Zoll");
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Ausstattung erfasst."));
    });

    it("verlangt zuerst eine Ausstattungsart, wenn keine auswählbar ist", () => {
      renderTabs({ types: [{ id: "t3", name: "Faxgerät", selectable: false }] });
      expect(screen.queryByRole("button", { name: /Ausstattung erfassen/ })).not.toBeInTheDocument();
      expect(
        screen.getByText("Bitte zuerst im Reiter „Ausstattungsarten“ eine Art anlegen.")
      ).toBeInTheDocument();
    });

    it("bearbeitet einen Eintrag mit vorbelegten Werten", async () => {
      renderTabs();
      await userEvent.click(within(row("SA-IT-2026-01")).getByRole("button", { name: "Bearbeiten" }));
      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveTextContent("Laptop — Anna Admin");
      expect(within(dialog).getByLabelText("Geräte-ID")).toHaveValue("SA-IT-2026-01");
      expect(within(dialog).getByLabelText("Mitarbeiter/in")).toHaveValue("u1");
      expect(within(dialog).getByLabelText("Ausstattung")).toHaveValue("t1");
      const notes = within(dialog).getByLabelText("Zusatzinformationen (optional)");
      await userEvent.clear(notes);
      await userEvent.type(notes, "ohne Netzteil");
      await userEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));

      await waitFor(() => expect(updateEquipment).toHaveBeenCalledTimes(1));
      const fd = formDataOf(updateEquipment);
      expect(fd.get("id")).toBe("eq1");
      expect(fd.get("deviceId")).toBe("SA-IT-2026-01");
      expect(fd.get("notes")).toBe("ohne Netzteil");
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Ausstattung aktualisiert."));
    });

    it("behält beim Bearbeiten eine nicht mehr auswählbare Zuordnung", async () => {
      renderTabs();
      await openTab(/^Zurückgegeben/);
      await userEvent.click(within(row("SA-IT-2020-07")).getByRole("button", { name: "Bearbeiten" }));
      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getByLabelText("Mitarbeiter/in")).toHaveValue("u3");
      expect(within(dialog).getByLabelText("Ausstattung")).toHaveValue("t3");
      expect(within(dialog).getByLabelText("Rückgabe am (optional)")).toHaveValue("2025-12-31");
    });

    it("erfasst eine Rückgabe über den Dialog", async () => {
      renderTabs();
      await userEvent.click(
        within(row("SA-IT-2026-01")).getByRole("button", { name: "Rückgabe erfassen" })
      );
      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveTextContent("„Laptop“ von Anna Admin — übernommen am 15.01.2026.");
      const datum = within(dialog).getByLabelText("Rückgabe am");
      expect(datum).toHaveAttribute("min", "2026-01-15");
      await userEvent.type(datum, "2026-10-08");
      await userEvent.click(within(dialog).getByRole("button", { name: "Rückgabe speichern" }));

      await waitFor(() => expect(markEquipmentReturned).toHaveBeenCalledTimes(1));
      expect(vi.mocked(markEquipmentReturned).mock.calls[0][0]).toBe("eq1");
      expect(formDataOf(markEquipmentReturned, 0, 1).get("returnDate")).toBe("2026-10-08");
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Rückgabe erfasst."));
    });

    it("bietet „Rückgabe zurücknehmen“ nur für zurückgegebene Geräte an", async () => {
      renderTabs();
      expect(
        within(row("SA-IT-2026-01")).queryByRole("button", { name: "Rückgabe zurücknehmen" })
      ).not.toBeInTheDocument();

      await openTab(/^Zurückgegeben/);
      const r = row("SA-IT-2020-07");
      expect(within(r).queryByRole("button", { name: "Rückgabe erfassen" })).not.toBeInTheDocument();
      await userEvent.click(within(r).getByRole("button", { name: "Rückgabe zurücknehmen" }));
      await waitFor(() => expect(undoEquipmentReturn).toHaveBeenCalledWith("eq2"));
      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith("Ausstattung gilt wieder als im Einsatz.")
      );
    });

    it("löscht einen Eintrag erst nach Bestätigung", async () => {
      renderTabs();
      await userEvent.click(within(row("SA-IT-2026-01")).getByRole("button", { name: "Löschen" }));
      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveTextContent("Ausstattung löschen?");
      expect(dialog).toHaveTextContent("„Laptop — Anna Admin“ wird endgültig entfernt.");
      expect(deleteEquipment).not.toHaveBeenCalled();
      await userEvent.click(within(dialog).getByRole("button", { name: "Endgültig löschen" }));
      await waitFor(() => expect(deleteEquipment).toHaveBeenCalledWith("eq1"));
    });
  });

  describe("Mitarbeitende & Protokolle", () => {
    it("deaktiviert die Vorlagen-Buttons ohne passende Ausstattung", async () => {
      renderTabs();
      await openTab(/^Mitarbeitende/);

      const anna = row("Anna Admin");
      expect(within(anna).getByRole("button", { name: "Übergabe" })).toBeEnabled();
      expect(within(anna).getByRole("button", { name: "Rücknahme" })).toBeEnabled();

      // Keine Geräte im Einsatz, aber früher welche → nur Rücknahme möglich
      const dora = row("Dora Deaktiviert");
      expect(within(dora).getByText("deaktiviert")).toBeInTheDocument();
      const doraUebergabe = within(dora).getByRole("button", { name: "Übergabe" });
      expect(doraUebergabe).toBeDisabled();
      expect(doraUebergabe).toHaveAttribute("title", "Keine Ausstattung im Einsatz.");
      expect(within(dora).getByRole("button", { name: "Rücknahme" })).toBeEnabled();

      // Nie Ausstattung erfasst → beide Vorlagen leer
      const bernd = row("Bernd Beispiel");
      expect(within(bernd).getByRole("button", { name: "Übergabe" })).toBeDisabled();
      const berndRuecknahme = within(bernd).getByRole("button", { name: "Rücknahme" });
      expect(berndRuecknahme).toBeDisabled();
      expect(berndRuecknahme).toHaveAttribute("title", "Keine Ausstattung erfasst.");
    });

    it("lädt die Vorlage über die Export-URL herunter", async () => {
      renderTabs();
      await openTab(/^Mitarbeitende/);
      await userEvent.click(within(row("Anna Admin")).getByRole("button", { name: "Übergabe" }));
      expect(fakeLocation.href).toBe("/api/exports/it-protokoll?mitarbeiter=u1&art=uebergabe");
      await userEvent.click(within(row("Dora Deaktiviert")).getByRole("button", { name: "Rücknahme" }));
      expect(fakeLocation.href).toBe("/api/exports/it-protokoll?mitarbeiter=u3&art=ruecknahme");
    });

    it("verlinkt ein hinterlegtes Protokoll zum Download", async () => {
      renderTabs();
      await openTab(/^Mitarbeitende/);
      const link = screen.getByRole("link", { name: "uebergabe-anna.pdf" });
      expect(link).toHaveAttribute("href", "/api/it-dokumente/p1");
      expect(link).toHaveAttribute("target", "_blank");
    });

    it("lädt ein fehlendes Protokoll hoch", async () => {
      renderTabs();
      await openTab(/^Mitarbeitende/);
      await userEvent.click(
        within(row("Anna Admin")).getByRole("button", { name: "Rücknahmeprotokoll hochladen" })
      );
      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveTextContent("für Anna Admin");
      const file = new File(["%PDF"], "ruecknahme.pdf", { type: "application/pdf" });
      selectFiles(within(dialog).getByLabelText("Datei"), [file]);
      await userEvent.click(within(dialog).getByRole("button", { name: "Hochladen" }));

      await waitFor(() => expect(uploadHandoverProtocol).toHaveBeenCalledTimes(1));
      const [userId, kind, fd] = vi.mocked(uploadHandoverProtocol).mock.calls[0] as unknown as [
        string,
        string,
        FormData,
      ];
      expect(userId).toBe("u1");
      expect(kind).toBe("ruecknahme");
      expect((fd.get("document") as File).name).toBe("ruecknahme.pdf");
      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith("Rücknahmeprotokoll gespeichert.")
      );
    });

    it("ersetzt ein vorhandenes Protokoll mit Hinweis auf die alte Datei", async () => {
      renderTabs();
      await openTab(/^Mitarbeitende/);
      const anna = row("Anna Admin");
      expect(
        within(anna).queryByRole("button", { name: "Übergabeprotokoll hochladen" })
      ).not.toBeInTheDocument();
      await userEvent.click(within(anna).getByRole("button", { name: "Übergabeprotokoll ersetzen" }));
      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveTextContent(
        "Für Anna Admin ist „uebergabe-anna.pdf“ hinterlegt. Beim Speichern wird diese Datei endgültig gelöscht"
      );
      selectFiles(within(dialog).getByLabelText("Datei"), [
        new File(["%PDF"], "neu.pdf", { type: "application/pdf" }),
      ]);
      await userEvent.click(within(dialog).getByRole("button", { name: "Ersetzen" }));

      await waitFor(() => expect(uploadHandoverProtocol).toHaveBeenCalledTimes(1));
      const call = vi.mocked(uploadHandoverProtocol).mock.calls[0] as unknown as [string, string, FormData];
      expect(call[0]).toBe("u1");
      expect(call[1]).toBe("uebergabe");
      expect((call[2].get("document") as File).name).toBe("neu.pdf");
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Übergabeprotokoll ersetzt."));
    });

    it("löscht ein Protokoll erst nach Bestätigung", async () => {
      renderTabs();
      await openTab(/^Mitarbeitende/);
      await userEvent.click(within(row("Anna Admin")).getByRole("button", { name: "Löschen" }));
      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveTextContent("Übergabeprotokoll löschen?");
      expect(dialog).toHaveTextContent("„uebergabe-anna.pdf“ wird endgültig entfernt.");
      await userEvent.click(within(dialog).getByRole("button", { name: "Endgültig löschen" }));
      await waitFor(() => expect(deleteHandoverProtocol).toHaveBeenCalledWith("p1"));
      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith("Übergabeprotokoll gelöscht.")
      );
    });
  });

  describe("Ausstattungsarten", () => {
    it("legt eine Art an", async () => {
      renderTabs();
      await openTab(/^Ausstattungsarten/);
      await userEvent.click(screen.getByRole("button", { name: /Neue Ausstattungsart/ }));
      const dialog = screen.getByRole("dialog");
      await userEvent.type(within(dialog).getByLabelText("Bezeichnung"), "Dockingstation");
      await userEvent.click(within(dialog).getByRole("button", { name: "Art hinzufügen" }));

      await waitFor(() => expect(createEquipmentType).toHaveBeenCalledTimes(1));
      const fd = formDataOf(createEquipmentType);
      expect(fd.get("name")).toBe("Dockingstation");
      expect(fd.get("sortOrder")).toBe("0");
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Ausstattungsart angelegt."));
    });

    it("bearbeitet eine Art", async () => {
      renderTabs();
      await openTab(/^Ausstattungsarten/);
      await userEvent.click(within(row("Laptop")).getByRole("button", { name: "Bearbeiten" }));
      const dialog = screen.getByRole("dialog");
      const name = within(dialog).getByLabelText("Bezeichnung");
      expect(name).toHaveValue("Laptop");
      await userEvent.clear(name);
      await userEvent.type(name, "Notebook");
      await userEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));
      await waitFor(() => expect(updateEquipmentType).toHaveBeenCalledTimes(1));
      const fd = formDataOf(updateEquipmentType);
      expect(fd.get("id")).toBe("t1");
      expect(fd.get("name")).toBe("Notebook");
      expect(fd.get("sortOrder")).toBe("1");
    });

    it("blendet Arten aus bzw. ein", async () => {
      renderTabs();
      await openTab(/^Ausstattungsarten/);
      await userEvent.click(within(row("Laptop")).getByRole("button", { name: "Ausblenden" }));
      await waitFor(() => expect(toggleEquipmentType).toHaveBeenCalledWith("t1"));
      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith("Ausstattungsart ausgeblendet.")
      );
      await userEvent.click(within(row("Headset")).getByRole("button", { name: "Einblenden" }));
      await waitFor(() => expect(toggleEquipmentType).toHaveBeenCalledWith("t4"));
    });

    it("erlaubt das Löschen nur für unbenutzte Arten", async () => {
      renderTabs();
      await openTab(/^Ausstattungsarten/);
      expect(within(row("Laptop")).queryByRole("button", { name: "Löschen" })).not.toBeInTheDocument();
      await userEvent.click(within(row("Headset")).getByRole("button", { name: "Löschen" }));
      await userEvent.click(
        within(screen.getByRole("dialog")).getByRole("button", { name: "Endgültig löschen" })
      );
      await waitFor(() => expect(deleteEquipmentType).toHaveBeenCalledWith("t4"));
    });
  });

  describe("Export & Import", () => {
    const csv = () => new File(["Geräte-ID;Mitarbeiter\n"], "geraete.csv", { type: "text/csv" });
    const okSummary = (
      summary: Partial<{ create: string[]; update: string[]; unchanged: string[]; remove: string[] }>
    ): ImportOutcome => ({
      ok: true,
      summary: { create: [], update: [], unchanged: [], remove: [], ...summary },
    });

    async function openImport() {
      renderTabs();
      await openTab(/^Export & Import/);
    }

    it("lädt die Liste als CSV herunter", async () => {
      await openImport();
      await userEvent.click(screen.getByRole("button", { name: "Liste als CSV herunterladen" }));
      expect(fakeLocation.href).toBe("/api/exports/it-ausstattung");
    });

    it("„Datei prüfen“ ist ohne Datei deaktiviert und kein Anwenden-Button sichtbar", async () => {
      await openImport();
      expect(screen.getByRole("button", { name: "Datei prüfen" })).toBeDisabled();
      expect(screen.queryByRole("button", { name: "Import jetzt anwenden" })).not.toBeInTheDocument();
    });

    it("zeigt nach erfolgreicher Prüfung die Vorschau und erst dann „Import jetzt anwenden“", async () => {
      vi.mocked(analyzeEquipmentImport).mockResolvedValueOnce(
        okSummary({
          create: ["SA-IT-2026-03"],
          update: ["SA-IT-2026-01", "SA-IT-1 → SA-IT-2026-04"],
          unchanged: ["a", "b", "c"],
          remove: ["SA-IT-2020-07"],
        })
      );
      await openImport();
      const file = csv();
      await userEvent.upload(screen.getByLabelText("CSV-Datei (max. 1 MB)"), file);
      const pruefen = screen.getByRole("button", { name: "Datei prüfen" });
      expect(pruefen).toBeEnabled();
      await userEvent.click(pruefen);

      await waitFor(() => expect(analyzeEquipmentImport).toHaveBeenCalledTimes(1));
      expect(formDataOf(analyzeEquipmentImport).get("file")).toBe(file);
      expect(await screen.findByText(/Neu angelegt:/)).toHaveTextContent("Neu angelegt: 1");
      expect(screen.getByText(/Aktualisiert:/)).toHaveTextContent("Aktualisiert: 2");
      expect(screen.getByText("SA-IT-2026-01, SA-IT-1 → SA-IT-2026-04")).toBeInTheDocument();
      expect(screen.getByText(/Gelöscht:/)).toHaveTextContent("Gelöscht: 1");
      expect(screen.getByText(/Unverändert:/)).toHaveTextContent("Unverändert: 3");
      expect(
        screen.getByText(/Ein Gerät fehlt in der Datei und wird endgültig gelöscht\./)
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Import jetzt anwenden" })).toBeEnabled();
      expect(applyEquipmentImport).not.toHaveBeenCalled();
    });

    it("kürzt lange Listen in der Vorschau und nennt die Zahl mehrerer Löschungen", async () => {
      const many = Array.from({ length: 23 }, (_, i) => `ID-${i + 1}`);
      vi.mocked(analyzeEquipmentImport).mockResolvedValueOnce(okSummary({ remove: many }));
      await openImport();
      await userEvent.upload(screen.getByLabelText("CSV-Datei (max. 1 MB)"), csv());
      await userEvent.click(screen.getByRole("button", { name: "Datei prüfen" }));

      expect(await screen.findByText(/… und 3 weitere/)).toBeInTheDocument();
      expect(screen.queryByText(/ID-21/)).not.toBeInTheDocument();
      expect(
        screen.getByText(/23 Geräte fehlen in der Datei und werden endgültig gelöscht\./)
      ).toBeInTheDocument();
    });

    it("zeigt Prüffehler und bietet dann kein Anwenden an", async () => {
      vi.mocked(analyzeEquipmentImport).mockResolvedValueOnce({
        ok: false,
        errors: ["Zeile 2: Mitarbeiter unbekannt.", "Zeile 5: Datum ungültig."],
      });
      await openImport();
      await userEvent.upload(screen.getByLabelText("CSV-Datei (max. 1 MB)"), csv());
      await userEvent.click(screen.getByRole("button", { name: "Datei prüfen" }));

      expect(
        await screen.findByText(/Die Datei wurde nicht übernommen \(2 Hinweise\)/)
      ).toBeInTheDocument();
      expect(screen.getByText("Zeile 2: Mitarbeiter unbekannt.")).toBeInTheDocument();
      expect(screen.getByText("Zeile 5: Datum ungültig.")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Import jetzt anwenden" })).not.toBeInTheDocument();
    });

    it("wendet den Import an, meldet das Ergebnis und setzt die Auswahl zurück", async () => {
      vi.mocked(analyzeEquipmentImport).mockResolvedValueOnce(okSummary({ create: ["X-1"] }));
      vi.mocked(applyEquipmentImport).mockResolvedValueOnce(
        okSummary({ create: ["X-1"], update: ["X-2", "X-3"], remove: ["X-4"] })
      );
      await openImport();
      const file = csv();
      await userEvent.upload(screen.getByLabelText("CSV-Datei (max. 1 MB)"), file);
      await userEvent.click(screen.getByRole("button", { name: "Datei prüfen" }));
      await userEvent.click(await screen.findByRole("button", { name: "Import jetzt anwenden" }));

      await waitFor(() => expect(applyEquipmentImport).toHaveBeenCalledTimes(1));
      expect(formDataOf(applyEquipmentImport).get("file")).toBe(file);
      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith(
          "Import übernommen: 1 neu, 2 aktualisiert, 1 gelöscht."
        )
      );
      expect(screen.queryByText(/Neu angelegt:/)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Import jetzt anwenden" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Datei prüfen" })).toBeDisabled();
    });

    it("zeigt Fehler beim Anwenden und blendet die Vorschau aus", async () => {
      vi.mocked(analyzeEquipmentImport).mockResolvedValueOnce(okSummary({ create: ["X-1"] }));
      vi.mocked(applyEquipmentImport).mockResolvedValueOnce({
        ok: false,
        errors: ["Geräte-ID doppelt."],
      });
      await openImport();
      await userEvent.upload(screen.getByLabelText("CSV-Datei (max. 1 MB)"), csv());
      await userEvent.click(screen.getByRole("button", { name: "Datei prüfen" }));
      await userEvent.click(await screen.findByRole("button", { name: "Import jetzt anwenden" }));

      expect(await screen.findByText("Geräte-ID doppelt.")).toBeInTheDocument();
      expect(screen.getByText(/Die Datei wurde nicht übernommen:/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Import jetzt anwenden" })).not.toBeInTheDocument();
      expect(toast.success).not.toHaveBeenCalled();
    });

    it("verwirft Vorschau und Fehler, sobald eine andere Datei gewählt wird", async () => {
      vi.mocked(analyzeEquipmentImport).mockResolvedValueOnce(okSummary({ create: ["X-1"] }));
      await openImport();
      const input = screen.getByLabelText("CSV-Datei (max. 1 MB)");
      await userEvent.upload(input, csv());
      await userEvent.click(screen.getByRole("button", { name: "Datei prüfen" }));
      await screen.findByRole("button", { name: "Import jetzt anwenden" });

      await userEvent.upload(input, new File(["x"], "andere.csv", { type: "text/csv" }));
      expect(screen.queryByRole("button", { name: "Import jetzt anwenden" })).not.toBeInTheDocument();
    });

    it("zeigt während der Prüfung „Wird geprüft …“", async () => {
      let resolve!: (v: ImportOutcome) => void;
      vi.mocked(analyzeEquipmentImport).mockReturnValueOnce(
        new Promise<ImportOutcome>((r) => {
          resolve = r;
        })
      );
      await openImport();
      await userEvent.upload(screen.getByLabelText("CSV-Datei (max. 1 MB)"), csv());
      await userEvent.click(screen.getByRole("button", { name: "Datei prüfen" }));
      expect(await screen.findByRole("button", { name: "Wird geprüft …" })).toBeDisabled();
      await act(async () => resolve(okSummary({})));
      expect(await screen.findByRole("button", { name: "Import jetzt anwenden" })).toBeInTheDocument();
    });
  });
});
