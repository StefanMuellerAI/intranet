import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { describe, expect, it, vi } from "vitest";
import type { AdminQuoteRow } from "@/lib/seminar-reports-store";
import type { ActionResult } from "@/lib/user-error";
import { ZitateAdmin } from "./zitate-admin";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const freigegeben: AdminQuoteRow = {
  id: "q1",
  quote: "Bester Workshop des Jahres!",
  quoteQuestion: "Was hat Ihnen gefallen?",
  websiteApproved: true,
  reportId: "r1",
  kind: "seminar",
  title: "KI im Vertrieb",
  customerName: "ACME GmbH",
  eventDate: "2026-09-15",
  userId: "u1",
  userName: "Anna Admin",
};

const offen: AdminQuoteRow = {
  id: "q2",
  quote: "5 – sehr praxisnah",
  quoteQuestion: null,
  websiteApproved: false,
  reportId: "r2",
  kind: "beratung",
  title: "Prozessanalyse",
  customerName: "Globex",
  eventDate: "2026-10-01",
  userId: "u2",
  userName: "Bernd Beispiel",
};

function setup(quotes: AdminQuoteRow[] = [freigegeben, offen]) {
  const action = vi.fn(
    async (quoteId: string, approved: boolean): Promise<ActionResult<null>> => {
      void quoteId;
      void approved;
      return { ok: true, data: null };
    }
  );
  const editAction = vi.fn(
    async (quoteId: string, formData: FormData): Promise<ActionResult<null>> => {
      void quoteId;
      void formData;
      return { ok: true, data: null };
    }
  );
  render(<ZitateAdmin quotes={quotes} action={action} editAction={editAction} />);
  return { action, editAction };
}

function row(quoteText: string) {
  return screen.getByText(`„${quoteText}“`).closest("tr") as HTMLElement;
}

describe("ZitateAdmin", () => {
  describe("Reiter", () => {
    it("zeigt unter „Alle“ alle Zitate mit Zählern je Reiter", () => {
      setup();
      expect(screen.getByRole("tab", { name: /^Alle/ })).toHaveTextContent("2");
      expect(screen.getByRole("tab", { name: /^Freigegeben/ })).toHaveTextContent("1");
      expect(screen.getByRole("tab", { name: /^Offen/ })).toHaveTextContent("1");
      expect(row("Bester Workshop des Jahres!")).toBeInTheDocument();
      expect(row("5 – sehr praxisnah")).toBeInTheDocument();
    });

    it("filtert nach freigegebenen und offenen Zitaten", async () => {
      setup();
      await userEvent.click(screen.getByRole("tab", { name: /^Freigegeben/ }));
      expect(screen.getByText("„Bester Workshop des Jahres!“")).toBeInTheDocument();
      expect(screen.queryByText("„5 – sehr praxisnah“")).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole("tab", { name: /^Offen/ }));
      expect(screen.getByText("„5 – sehr praxisnah“")).toBeInTheDocument();
      expect(screen.queryByText("„Bester Workshop des Jahres!“")).not.toBeInTheDocument();
    });

    it("zeigt Leerhinweise in leeren Reitern", async () => {
      setup([offen]);
      await userEvent.click(screen.getByRole("tab", { name: /^Freigegeben/ }));
      expect(screen.getByText("Noch kein Zitat für die Website freigegeben.")).toBeInTheDocument();
    });

    it("zeigt Frage, Veranstaltung mit Link, Art, Kunde, Datum und Mitarbeiter/in", () => {
      setup();
      const r = within(row("Bester Workshop des Jahres!"));
      expect(r.getByText("Frage: Was hat Ihnen gefallen?")).toBeInTheDocument();
      expect(r.getByRole("link", { name: "KI im Vertrieb" })).toHaveAttribute("href", "/berichte/r1");
      expect(r.getByText("Seminar")).toBeInTheDocument();
      expect(r.getByText("ACME GmbH")).toBeInTheDocument();
      expect(r.getByText("15.09.2026")).toBeInTheDocument();
      expect(r.getByText("Anna Admin")).toBeInTheDocument();
      expect(within(row("5 – sehr praxisnah")).getByText("Beratung")).toBeInTheDocument();
      expect(within(row("5 – sehr praxisnah")).queryByText(/^Frage:/)).not.toBeInTheDocument();
    });
  });

  describe("Website-Freigabe", () => {
    it("gibt ein offenes Zitat frei", async () => {
      const { action } = setup();
      const toggle = within(row("5 – sehr praxisnah")).getByRole("switch", {
        name: "Für die Website freigeben",
      });
      expect(toggle).not.toBeChecked();

      await userEvent.click(toggle);

      await waitFor(() => expect(action).toHaveBeenCalledWith("q2", true));
      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith("Zitat für die Website freigegeben.")
      );
      expect(
        within(row("5 – sehr praxisnah")).getByRole("switch", {
          name: "Freigabe für die Website zurückziehen",
        })
      ).toBeChecked();
    });

    it("zieht eine Freigabe zurück", async () => {
      const { action } = setup();
      const toggle = within(row("Bester Workshop des Jahres!")).getByRole("switch", {
        name: "Freigabe für die Website zurückziehen",
      });
      expect(toggle).toBeChecked();
      await userEvent.click(toggle);
      await waitFor(() => expect(action).toHaveBeenCalledWith("q1", false));
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Freigabe zurückgezogen."));
    });

    it("springt bei einem Fehler zurück und meldet ihn", async () => {
      const { action } = setup();
      action.mockResolvedValueOnce({ ok: false, error: "Nur Admins dürfen freigeben." });
      const toggle = within(row("5 – sehr praxisnah")).getByRole("switch");

      await userEvent.click(toggle);

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith("Nur Admins dürfen freigeben.")
      );
      await waitFor(() =>
        expect(
          within(row("5 – sehr praxisnah")).getByRole("switch", { name: "Für die Website freigeben" })
        ).not.toBeChecked()
      );
      expect(toast.success).not.toHaveBeenCalled();
    });
  });

  describe("Zitat bearbeiten", () => {
    it("speichert den neuen Wortlaut und schließt den Dialog", async () => {
      const { editAction } = setup();
      await userEvent.click(within(row("5 – sehr praxisnah")).getByRole("button", { name: "Bearbeiten" }));
      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveTextContent("Zitat bearbeiten");
      expect(dialog).toHaveTextContent("Prozessanalyse — Globex, 01.10.2026");

      const wortlaut = within(dialog).getByLabelText("Wortlaut");
      expect(wortlaut).toHaveValue("5 – sehr praxisnah");
      expect(wortlaut).toHaveAttribute("maxlength", "1000");
      await userEvent.clear(wortlaut);
      await userEvent.type(wortlaut, "Sehr praxisnah");
      await userEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));

      await waitFor(() => expect(editAction).toHaveBeenCalledTimes(1));
      expect(editAction.mock.calls[0][0]).toBe("q2");
      expect(editAction.mock.calls[0][1].get("quote")).toBe("Sehr praxisnah");
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Zitat aktualisiert."));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it("bleibt bei einem Fehler offen und zeigt die Meldung", async () => {
      const { editAction } = setup();
      editAction.mockResolvedValueOnce({ ok: false, error: "Zitat darf nicht leer sein." });
      await userEvent.click(within(row("5 – sehr praxisnah")).getByRole("button", { name: "Bearbeiten" }));
      await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Speichern" }));

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Zitat darf nicht leer sein."));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(toast.success).not.toHaveBeenCalled();
    });

    it("vergibt je Reiter eigene Feld-IDs", async () => {
      setup();
      await userEvent.click(within(row("5 – sehr praxisnah")).getByRole("button", { name: "Bearbeiten" }));
      expect(screen.getByLabelText("Wortlaut")).toHaveAttribute("id", "zitat-alle-q2");
    });
  });

  describe("Zitat kopieren", () => {
    it("schreibt den Wortlaut in die Zwischenablage", async () => {
      const user = userEvent.setup();
      const writeText = vi.spyOn(navigator.clipboard, "writeText");
      setup();
      await user.click(within(row("Bester Workshop des Jahres!")).getByRole("button", { name: "Zitat kopieren" }));
      expect(writeText).toHaveBeenCalledWith("Bester Workshop des Jahres!");
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Zitat kopiert."));
    });

    it("meldet, wenn die Zwischenablage nicht verfügbar ist", async () => {
      const user = userEvent.setup();
      vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new Error("denied"));
      setup();
      await user.click(within(row("5 – sehr praxisnah")).getByRole("button", { name: "Zitat kopieren" }));
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Kopieren nicht möglich."));
      expect(toast.success).not.toHaveBeenCalled();
    });
  });
});
