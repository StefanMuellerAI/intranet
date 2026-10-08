import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { describe, expect, it, vi } from "vitest";
import {
  createCustomerAction,
  createProjectAction,
  toggleCustomerActiveAction,
  toggleProjectActiveAction,
  updateCustomerAction,
  updateProjectAction,
} from "@/app/(app)/faktura/kunden/actions";
import { CustomerCard, CustomerCreateForm, type CustomerView, type ProjectView } from "./kunden-admin";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/(app)/faktura/kunden/actions", () => ({
  createCustomerAction: vi.fn(async () => ({ ok: true, data: null })),
  createProjectAction: vi.fn(async () => ({ ok: true, data: null })),
  toggleCustomerActiveAction: vi.fn(async () => ({ ok: true, data: null })),
  toggleProjectActiveAction: vi.fn(async () => ({ ok: true, data: null })),
  updateCustomerAction: vi.fn(async () => ({ ok: true, data: null })),
  updateProjectAction: vi.fn(async () => ({ ok: true, data: null })),
}));

function formDataOf(fn: unknown, call = 0): FormData {
  return vi.mocked(fn as (fd: FormData) => unknown).mock.calls[call][0] as FormData;
}

const website: ProjectView = {
  id: "p1",
  name: "Website",
  validFrom: "2026-01-01",
  validTo: null,
  monthlyLimitHours: "40",
  active: true,
  bookedHours: "42,5",
  overLimit: true,
};

const support: ProjectView = {
  id: "p2",
  name: "Support",
  validFrom: null,
  validTo: null,
  monthlyLimitHours: null,
  active: false,
  bookedHours: "3",
  overLimit: false,
};

const acme: CustomerView = {
  id: "c1",
  name: "ACME GmbH",
  address: "Hauptstr. 1, Berlin",
  contactPerson: null,
  active: true,
  projects: [website, support],
};

function projectItem(name: string) {
  return screen.getByText(name, { selector: "p" }).closest("li") as HTMLElement;
}

function customerForm() {
  return screen.getByLabelText("Anschrift").closest("form") as HTMLElement;
}

function newProjectForm() {
  return screen.getByLabelText("Neues Projekt").closest("form") as HTMLElement;
}

describe("CustomerCreateForm", () => {
  it("legt einen Kunden mit allen Feldern an", async () => {
    render(<CustomerCreateForm />);
    await userEvent.type(screen.getByLabelText("Name (Pflicht, eindeutig)"), "Neukunde AG");
    await userEvent.type(screen.getByLabelText("Anschrift (optional)"), "Ring 5, Köln");
    await userEvent.type(screen.getByLabelText("Ansprechpartner/in (optional)"), "Frau Muster");
    await userEvent.click(screen.getByRole("button", { name: "Kunde anlegen" }));

    await waitFor(() => expect(createCustomerAction).toHaveBeenCalledTimes(1));
    const fd = formDataOf(createCustomerAction);
    expect(fd.get("name")).toBe("Neukunde AG");
    expect(fd.get("address")).toBe("Ring 5, Köln");
    expect(fd.get("contactPerson")).toBe("Frau Muster");
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Kunde angelegt."));
  });

  it("schickt ohne Namen nichts ab", async () => {
    render(<CustomerCreateForm />);
    await userEvent.click(screen.getByRole("button", { name: "Kunde anlegen" }));
    expect(createCustomerAction).not.toHaveBeenCalled();
  });

  it("meldet Fehler (z. B. doppelter Name) als Toast", async () => {
    vi.mocked(createCustomerAction).mockResolvedValueOnce({
      ok: false,
      error: "Kunde existiert bereits.",
    });
    render(<CustomerCreateForm />);
    await userEvent.type(screen.getByLabelText("Name (Pflicht, eindeutig)"), "ACME GmbH");
    await userEvent.click(screen.getByRole("button", { name: "Kunde anlegen" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Kunde existiert bereits."));
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe("CustomerCard", () => {
  describe("Kunde", () => {
    it("zeigt Name, Status und vorbelegte Stammdaten", () => {
      render(<CustomerCard customer={acme} />);
      expect(screen.getByText("ACME GmbH", { selector: "div" })).toHaveTextContent("aktiv");
      const form = within(customerForm());
      expect(form.getByLabelText("Name")).toHaveValue("ACME GmbH");
      expect(form.getByLabelText("Anschrift")).toHaveValue("Hauptstr. 1, Berlin");
      expect(form.getByLabelText("Ansprechpartner/in")).toHaveValue("");
    });

    it("speichert geänderte Stammdaten mit der Kunden-ID", async () => {
      render(<CustomerCard customer={acme} />);
      const form = within(customerForm());
      await userEvent.type(form.getByLabelText("Ansprechpartner/in"), "Herr Beispiel");
      const name = form.getByLabelText("Name");
      await userEvent.clear(name);
      await userEvent.type(name, "ACME SE");
      await userEvent.click(form.getByRole("button", { name: "Speichern" }));

      await waitFor(() => expect(updateCustomerAction).toHaveBeenCalledTimes(1));
      const fd = formDataOf(updateCustomerAction);
      expect(fd.get("id")).toBe("c1");
      expect(fd.get("name")).toBe("ACME SE");
      expect(fd.get("address")).toBe("Hauptstr. 1, Berlin");
      expect(fd.get("contactPerson")).toBe("Herr Beispiel");
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Kunde aktualisiert."));
      expect(updateProjectAction).not.toHaveBeenCalled();
    });

    it("meldet Fehler beim Speichern als Toast", async () => {
      vi.mocked(updateCustomerAction).mockResolvedValueOnce({ ok: false, error: "Name vergeben." });
      render(<CustomerCard customer={acme} />);
      await userEvent.click(within(customerForm()).getByRole("button", { name: "Speichern" }));
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Name vergeben."));
    });

    it("setzt einen aktiven Kunden inaktiv, ohne das Formular abzuschicken", async () => {
      render(<CustomerCard customer={acme} />);
      await userEvent.click(within(customerForm()).getByRole("button", { name: "Inaktiv setzen" }));
      await waitFor(() => expect(toggleCustomerActiveAction).toHaveBeenCalledWith("c1", false));
      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith(
          "Kunde inaktiv gesetzt — Bestandsbuchungen bleiben erhalten."
        )
      );
      expect(updateCustomerAction).not.toHaveBeenCalled();
    });

    it("aktiviert einen inaktiven Kunden", async () => {
      render(<CustomerCard customer={{ ...acme, active: false, projects: [] }} />);
      expect(screen.getByText("inaktiv")).toBeInTheDocument();
      await userEvent.click(within(customerForm()).getByRole("button", { name: "Aktivieren" }));
      await waitFor(() => expect(toggleCustomerActiveAction).toHaveBeenCalledWith("c1", true));
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Kunde aktiviert."));
    });

    it("meldet Fehler beim Umschalten als Toast", async () => {
      vi.mocked(toggleCustomerActiveAction).mockResolvedValueOnce({
        ok: false,
        error: "Offene Buchungen vorhanden.",
      });
      render(<CustomerCard customer={acme} />);
      await userEvent.click(within(customerForm()).getByRole("button", { name: "Inaktiv setzen" }));
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Offene Buchungen vorhanden."));
    });
  });

  describe("Projekte", () => {
    it("zeigt Projekte mit Status und Monatsauslastung", () => {
      render(<CustomerCard customer={acme} />);
      expect(screen.getByText("Projekte (2)")).toBeInTheDocument();

      const w = projectItem("Website");
      expect(within(w).getByText("aktiv")).toBeInTheDocument();
      expect(within(w).getByText(/Monat: 42,5 \/ 40 h · Überbuchung/)).toBeInTheDocument();
      expect(within(w).getByLabelText("Laufzeit von")).toHaveValue("2026-01-01");
      expect(within(w).getByLabelText("Monatslimit (h, 0,25er)")).toHaveValue("40");

      const s = projectItem("Support");
      expect(within(s).getByText("inaktiv")).toBeInTheDocument();
      expect(within(s).getByText("Monat: 3 h · kein Limit")).toBeInTheDocument();
    });

    it("zeigt ohne Projekte einen Hinweis", () => {
      render(<CustomerCard customer={{ ...acme, projects: [] }} />);
      expect(screen.getByText("Projekte (0)")).toBeInTheDocument();
      expect(screen.getByText("Noch keine Projekte.")).toBeInTheDocument();
    });

    it("speichert Projektänderungen mit der Projekt-ID", async () => {
      render(<CustomerCard customer={acme} />);
      const w = within(projectItem("Website"));
      await userEvent.type(w.getByLabelText("Laufzeit bis"), "2026-12-31");
      const limit = w.getByLabelText("Monatslimit (h, 0,25er)");
      await userEvent.clear(limit);
      await userEvent.type(limit, "45,5");
      await userEvent.click(w.getByRole("button", { name: "Speichern" }));

      await waitFor(() => expect(updateProjectAction).toHaveBeenCalledTimes(1));
      const fd = formDataOf(updateProjectAction);
      expect(fd.get("id")).toBe("p1");
      expect(fd.get("name")).toBe("Website");
      expect(fd.get("validFrom")).toBe("2026-01-01");
      expect(fd.get("validTo")).toBe("2026-12-31");
      expect(fd.get("monthlyLimitHours")).toBe("45,5");
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Projekt aktualisiert."));
      expect(updateCustomerAction).not.toHaveBeenCalled();
    });

    it("blockiert ein Monatslimit außerhalb des Viertelstunden-Rasters", async () => {
      render(<CustomerCard customer={acme} />);
      const w = within(projectItem("Website"));
      const limit = w.getByLabelText("Monatslimit (h, 0,25er)");
      await userEvent.clear(limit);
      await userEvent.type(limit, "40,1");
      await userEvent.click(w.getByRole("button", { name: "Speichern" }));
      expect(updateProjectAction).not.toHaveBeenCalled();
    });

    it("schaltet Projekte mit passender Beschriftung um", async () => {
      render(<CustomerCard customer={acme} />);
      await userEvent.click(
        within(projectItem("Website")).getByRole("button", { name: "Inaktiv setzen" })
      );
      await waitFor(() => expect(toggleProjectActiveAction).toHaveBeenCalledWith("p1", false));
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Projekt inaktiv gesetzt."));

      await userEvent.click(within(projectItem("Support")).getByRole("button", { name: "Aktivieren" }));
      await waitFor(() => expect(toggleProjectActiveAction).toHaveBeenCalledWith("p2", true));
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Projekt aktiviert."));
      expect(updateProjectAction).not.toHaveBeenCalled();
    });

    it("legt ein Projekt für den Kunden an", async () => {
      render(<CustomerCard customer={acme} />);
      const form = within(newProjectForm());
      await userEvent.type(form.getByLabelText("Neues Projekt"), "Relaunch");
      await userEvent.type(form.getByLabelText("Laufzeit von (optional)"), "2026-11-01");
      await userEvent.type(form.getByLabelText("Monatslimit (h, optional)"), "20,25");
      await userEvent.click(form.getByRole("button", { name: "Projekt anlegen" }));

      await waitFor(() => expect(createProjectAction).toHaveBeenCalledTimes(1));
      const fd = formDataOf(createProjectAction);
      expect(fd.get("customerId")).toBe("c1");
      expect(fd.get("name")).toBe("Relaunch");
      expect(fd.get("validFrom")).toBe("2026-11-01");
      expect(fd.get("validTo")).toBe("");
      expect(fd.get("monthlyLimitHours")).toBe("20,25");
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Projekt angelegt."));
    });

    it("meldet Fehler beim Anlegen eines Projekts als Toast", async () => {
      vi.mocked(createProjectAction).mockResolvedValueOnce({
        ok: false,
        error: "Laufzeit-Ende vor Beginn.",
      });
      render(<CustomerCard customer={acme} />);
      const form = within(newProjectForm());
      await userEvent.type(form.getByLabelText("Neues Projekt"), "X");
      await userEvent.click(form.getByRole("button", { name: "Projekt anlegen" }));
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Laufzeit-Ende vor Beginn."));
    });
  });
});
