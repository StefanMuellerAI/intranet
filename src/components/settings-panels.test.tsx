import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { describe, expect, it, vi } from "vitest";
import {
  clearDeputy,
  createApiKey,
  deleteWebhook,
  revokeApiKey,
  setDeputy,
  toggleWebhook,
} from "@/app/(app)/einstellungen/actions";
import {
  ActionForm,
  ApiKeyPanel,
  DeputyPanel,
  WebhookRowActions,
} from "./settings-panels";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/(app)/einstellungen/actions", () => ({
  createApiKey: vi.fn(async () => "sk_live_geheim123"),
  revokeApiKey: vi.fn(async () => {}),
  deleteWebhook: vi.fn(async () => {}),
  toggleWebhook: vi.fn(async () => {}),
  setDeputy: vi.fn(async () => {}),
  clearDeputy: vi.fn(async () => {}),
}));

/** FormData des n-ten Aufrufs einer gemockten Action. */
function formDataOf(fn: unknown, call = 0): FormData {
  return vi.mocked(fn as (fd: FormData) => unknown).mock.calls[call][0];
}

describe("ActionForm", () => {
  it("ruft die Action mit den Formulardaten auf und meldet Erfolg", async () => {
    const action = vi.fn(async (fd: FormData) => {
      void fd;
    });
    render(
      <ActionForm action={action} successMessage="Gespeichert.">
        <input name="satz" aria-label="Satz" defaultValue="42" />
        <button type="submit">Speichern</button>
      </ActionForm>
    );

    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Gespeichert."));
    expect(action.mock.calls[0][0].get("satz")).toBe("42");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("zeigt die Fehlermeldung als Toast, wenn die Action wirft", async () => {
    const action = vi.fn(async () => {
      throw new Error("Ungültiger Satz");
    });
    render(
      <ActionForm action={action} successMessage="Gespeichert.">
        <button type="submit">Speichern</button>
      </ActionForm>
    );

    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Ungültiger Satz"));
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe("DeputyPanel", () => {
  const users = [
    { id: "u1", name: "Anna Admin" },
    { id: "u2", name: "Bernd Beispiel" },
  ];

  it("zeigt ohne aktive Vertretung einen Hinweis und keinen Entziehen-Button", () => {
    render(<DeputyPanel users={users} current={null} />);
    expect(screen.getByText("Aktuell ist keine Vertretung aktiv.")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Vertretung entziehen" })
    ).not.toBeInTheDocument();
  });

  it("aktiviert die Vertretung mit Auswahl und optionalem Zeitraum", async () => {
    render(<DeputyPanel users={users} current={null} />);

    await userEvent.selectOptions(screen.getByLabelText("Mitarbeiter/in"), "u2");
    await userEvent.type(screen.getByLabelText("Von (optional)"), "2026-10-01");
    await userEvent.type(screen.getByLabelText("Bis (optional, autom. Ende)"), "2026-10-31");
    await userEvent.click(screen.getByRole("button", { name: "Vertretung aktivieren" }));

    await waitFor(() => expect(setDeputy).toHaveBeenCalledTimes(1));
    const fd = formDataOf(setDeputy);
    expect(fd.get("userId")).toBe("u2");
    expect(fd.get("startsOn")).toBe("2026-10-01");
    expect(fd.get("endsOn")).toBe("2026-10-31");
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Vertretung aktiviert."));
  });

  it("aktiviert die Vertretung auch ohne Zeitraum (leere Datumsfelder)", async () => {
    render(<DeputyPanel users={users} current={null} />);

    await userEvent.selectOptions(screen.getByLabelText("Mitarbeiter/in"), "u1");
    await userEvent.click(screen.getByRole("button", { name: "Vertretung aktivieren" }));

    await waitFor(() => expect(setDeputy).toHaveBeenCalledTimes(1));
    const fd = formDataOf(setDeputy);
    expect(fd.get("userId")).toBe("u1");
    expect(fd.get("startsOn")).toBe("");
    expect(fd.get("endsOn")).toBe("");
  });

  it("zeigt die aktive Vertretung mit Zeitraum und kann sie entziehen", async () => {
    render(
      <DeputyPanel
        users={users}
        current={{ userId: "u1", name: "Anna Admin", startsOn: "2026-10-01", endsOn: null }}
      />
    );

    expect(screen.getByText("Anna Admin", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText(/\(2026-10-01 bis auf Widerruf\)/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Vertretung entziehen" }));
    await waitFor(() => expect(clearDeputy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Vertretung entzogen."));
  });

  it("kennzeichnet eine Vertretung ohne Zeitraum", () => {
    render(
      <DeputyPanel
        users={users}
        current={{ userId: "u1", name: "Anna Admin", startsOn: null, endsOn: null }}
      />
    );
    expect(screen.getByText(/\(ohne Zeitraum\)/)).toBeInTheDocument();
  });

  it("meldet Fehler beim Entziehen als Toast", async () => {
    vi.mocked(clearDeputy).mockRejectedValueOnce(new Error("Keine Berechtigung"));
    render(
      <DeputyPanel
        users={users}
        current={{ userId: "u1", name: "Anna Admin", startsOn: null, endsOn: "2026-12-31" }}
      />
    );
    expect(screen.getByText(/\(sofort bis 2026-12-31\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Vertretung entziehen" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Keine Berechtigung"));
  });
});

describe("WebhookRowActions", () => {
  it("deaktiviert einen aktiven Webhook", async () => {
    render(<WebhookRowActions id="wh1" active />);
    await userEvent.click(screen.getByRole("button", { name: "Deaktivieren" }));
    await waitFor(() => expect(toggleWebhook).toHaveBeenCalledWith("wh1", false));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Webhook deaktiviert."));
  });

  it("aktiviert einen inaktiven Webhook", async () => {
    render(<WebhookRowActions id="wh2" active={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Aktivieren" }));
    await waitFor(() => expect(toggleWebhook).toHaveBeenCalledWith("wh2", true));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Webhook aktiviert."));
  });

  it("„Löschen“ öffnet erst eine Bestätigung, gelöscht wird nur über „Endgültig löschen“", async () => {
    render(<WebhookRowActions id="wh1" active />);

    await userEvent.click(screen.getByRole("button", { name: "Löschen" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Webhook löschen?");
    expect(deleteWebhook).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole("button", { name: "Endgültig löschen" }));
    await waitFor(() => expect(deleteWebhook).toHaveBeenCalledWith("wh1"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Webhook gelöscht."));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("„Abbrechen“ im Lösch-Dialog löscht nichts", async () => {
    render(<WebhookRowActions id="wh1" active />);
    await userEvent.click(screen.getByRole("button", { name: "Löschen" }));
    await userEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(deleteWebhook).not.toHaveBeenCalled();
  });
});

describe("ApiKeyPanel", () => {
  const keys = [
    {
      id: "k1",
      name: "n8n Freigaben",
      keyPrefix: "sk_ab",
      scope: "full" as const,
      createdAt: "01.09.2026",
      revokedAt: null,
      lastUsedAt: "05.10.2026",
    },
    {
      id: "k2",
      name: "Alter Key",
      keyPrefix: "sk_cd",
      scope: "readonly" as const,
      createdAt: "01.01.2026",
      revokedAt: "01.02.2026",
      lastUsedAt: null,
    },
  ];

  it("zeigt zur gewählten Berechtigung den passenden Hinweis", async () => {
    render(<ApiKeyPanel keys={[]} />);
    expect(screen.getByText("Anträge, Abwesenheiten und Faktura lesen")).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Berechtigung"), "website");
    expect(
      screen.getByText("Nur freigegebene Zitate — kein Zugriff auf HR- oder Faktura-Daten")
    ).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Berechtigung"), "full");
    expect(screen.getByText("Zusätzlich Freigaben auslösen")).toBeInTheDocument();
  });

  it("zeigt ohne Keys einen Leerhinweis", () => {
    render(<ApiKeyPanel keys={[]} />);
    expect(screen.getByText("Noch keine API-Keys.")).toBeInTheDocument();
  });

  it("„Key erzeugen“ übergibt Name und Berechtigung und zeigt den Key einmalig an", async () => {
    render(<ApiKeyPanel keys={[]} />);
    expect(screen.queryByText(/wird nur dieses eine Mal angezeigt/)).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Name / Verwendungszweck"), "Website");
    await userEvent.selectOptions(screen.getByLabelText("Berechtigung"), "website");
    await userEvent.click(screen.getByRole("button", { name: "Key erzeugen" }));

    await waitFor(() => expect(createApiKey).toHaveBeenCalledTimes(1));
    const fd = formDataOf(createApiKey);
    expect(fd.get("name")).toBe("Website");
    expect(fd.get("scope")).toBe("website");

    expect(await screen.findByText("sk_live_geheim123")).toBeInTheDocument();
    expect(screen.getByText(/wird nur dieses eine Mal angezeigt/)).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith("API-Key erstellt.");
  });

  it("„Kopieren“ schreibt den neuen Key in die Zwischenablage", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    render(<ApiKeyPanel keys={[]} />);

    await user.type(screen.getByLabelText("Name / Verwendungszweck"), "Website");
    await user.click(screen.getByRole("button", { name: "Key erzeugen" }));
    await user.click(await screen.findByRole("button", { name: "Kopieren" }));

    expect(writeText).toHaveBeenCalledWith("sk_live_geheim123");
    expect(toast.success).toHaveBeenCalledWith("In die Zwischenablage kopiert.");
  });

  it("zeigt keinen Key an, wenn das Erzeugen fehlschlägt", async () => {
    vi.mocked(createApiKey).mockRejectedValueOnce(new Error("Name fehlt"));
    render(<ApiKeyPanel keys={[]} />);

    await userEvent.type(screen.getByLabelText("Name / Verwendungszweck"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Key erzeugen" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Name fehlt"));
    expect(screen.queryByRole("button", { name: "Kopieren" })).not.toBeInTheDocument();
  });

  it("listet Keys mit Berechtigung, Nutzung und Widerrufsstatus", () => {
    render(<ApiKeyPanel keys={keys} />);
    const [aktiv, widerrufen] = screen.getAllByRole("listitem");
    expect(aktiv).toHaveTextContent("n8n Freigaben");
    expect(aktiv).toHaveTextContent("Lesen + Freigeben");
    expect(aktiv).toHaveTextContent("zuletzt genutzt 05.10.2026");
    expect(aktiv).not.toHaveTextContent("widerrufen");
    expect(widerrufen).toHaveTextContent("Nur lesen");
    expect(widerrufen).toHaveTextContent("· widerrufen");
  });

  it("widerrufene Keys haben keinen Widerrufen-Button", () => {
    render(<ApiKeyPanel keys={keys} />);
    const [aktiv, widerrufen] = screen.getAllByRole("listitem");
    expect(within(aktiv).getByRole("button", { name: "Widerrufen" })).toBeInTheDocument();
    expect(within(widerrufen).queryByRole("button")).not.toBeInTheDocument();
  });

  it("„Widerrufen“ fragt nach, widerrufen wird erst mit „Endgültig widerrufen“", async () => {
    render(<ApiKeyPanel keys={keys} />);

    await userEvent.click(screen.getByRole("button", { name: "Widerrufen" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("API-Key widerrufen?");
    expect(dialog).toHaveTextContent("„n8n Freigaben“ funktioniert danach nicht mehr.");
    expect(revokeApiKey).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole("button", { name: "Endgültig widerrufen" }));
    await waitFor(() => expect(revokeApiKey).toHaveBeenCalledWith("k1"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("API-Key widerrufen."));
  });

  it("„Abbrechen“ im Widerrufen-Dialog widerruft nichts", async () => {
    render(<ApiKeyPanel keys={keys} />);
    await userEvent.click(screen.getByRole("button", { name: "Widerrufen" }));
    await userEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(revokeApiKey).not.toHaveBeenCalled();
  });
});
