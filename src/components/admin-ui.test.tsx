import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";
import {
  ConfirmDialog,
  DeleteDialog,
  FormDialog,
  PanelDialog,
  VisibilityBadge,
  VisibilityToggle,
  useAction,
} from "./admin-ui";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/** Promise, die erst auf Zuruf erfüllt wird — für Pending-Zustände. */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("useAction", () => {
  it("liefert true und meldet die Erfolgsnachricht, wenn die Action durchläuft", async () => {
    const { result } = renderHook(() => useAction());
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.run(async () => {}, "Gespeichert");
    });
    expect(ok).toBe(true);
    expect(toast.success).toHaveBeenCalledWith("Gespeichert");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("zeigt ohne Nachricht keinen Erfolgs-Toast", async () => {
    const { result } = renderHook(() => useAction());
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.run(async () => {});
    });
    expect(ok).toBe(true);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("liefert false und zeigt die Fehlermeldung, wenn die Action wirft", async () => {
    const { result } = renderHook(() => useAction());
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.run(async () => {
        throw new Error("Kaputt");
      }, "Gespeichert");
    });
    expect(ok).toBe(false);
    expect(toast.error).toHaveBeenCalledWith("Kaputt");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("nutzt „Fehler“ als Meldung, wenn kein Error-Objekt geworfen wird", async () => {
    const { result } = renderHook(() => useAction());
    await act(async () => {
      await result.current.run(async () => {
        throw "unbekannt";
      });
    });
    expect(toast.error).toHaveBeenCalledWith("Fehler");
  });

  it("ist pending, solange die Action läuft", async () => {
    const { result } = renderHook(() => useAction());
    const d = deferred();
    let runPromise!: Promise<boolean>;
    act(() => {
      runPromise = result.current.run(() => d.promise);
    });
    await waitFor(() => expect(result.current.pending).toBe(true));
    await act(async () => {
      d.resolve();
      await runPromise;
    });
    expect(result.current.pending).toBe(false);
  });
});

describe("FormDialog", () => {
  function renderForm(action: (fd: FormData) => Promise<void>) {
    return render(
      <FormDialog
        trigger={<Button />}
        triggerLabel="Neuer Eintrag"
        title="Eintrag anlegen"
        description="Bitte ausfüllen."
        action={action}
        successMessage="Eintrag angelegt"
        submitLabel="Anlegen"
      >
        <input name="titel" aria-label="Titel" />
      </FormDialog>
    );
  }

  it("behält die Eingaben bei einem Fehler", async () => {
    renderForm(
      vi.fn(async () => {
        throw new Error("Titel fehlt");
      })
    );
    await userEvent.click(screen.getByRole("button", { name: "Neuer Eintrag" }));
    await userEvent.type(screen.getByLabelText("Titel"), "Hallo Welt");
    await userEvent.click(screen.getByRole("button", { name: "Anlegen" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Titel fehlt"));
    expect(screen.getByLabelText("Titel")).toHaveValue("Hallo Welt");
  });

  it("übergibt die Formulardaten an die Action und schließt sich bei Erfolg", async () => {
    const action = vi.fn(async (fd: FormData) => {
      void fd;
    });
    renderForm(action);

    await userEvent.click(screen.getByRole("button", { name: "Neuer Eintrag" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Eintrag anlegen");
    expect(dialog).toHaveTextContent("Bitte ausfüllen.");

    await userEvent.type(screen.getByLabelText("Titel"), "Hallo Welt");
    await userEvent.click(screen.getByRole("button", { name: "Anlegen" }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const fd = action.mock.calls[0][0];
    expect(fd.get("titel")).toBe("Hallo Welt");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(toast.success).toHaveBeenCalledWith("Eintrag angelegt");
  });

  it("bleibt bei einem Fehler offen und zeigt die Fehlermeldung", async () => {
    const action = vi.fn(async () => {
      throw new Error("Titel fehlt");
    });
    renderForm(action);

    await userEvent.click(screen.getByRole("button", { name: "Neuer Eintrag" }));
    await userEvent.click(screen.getByRole("button", { name: "Anlegen" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Titel fehlt"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("zeigt während des Speicherns „Wird gespeichert …“ und sperrt den Button", async () => {
    const d = deferred();
    const action = vi.fn(() => d.promise);
    renderForm(action);

    await userEvent.click(screen.getByRole("button", { name: "Neuer Eintrag" }));
    await userEvent.click(screen.getByRole("button", { name: "Anlegen" }));

    const busy = await screen.findByRole("button", { name: "Wird gespeichert …" });
    expect(busy).toBeDisabled();
    await act(async () => d.resolve());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("„Abbrechen“ schließt den Dialog ohne Aufruf der Action", async () => {
    const action = vi.fn(async () => {});
    renderForm(action);

    await userEvent.click(screen.getByRole("button", { name: "Neuer Eintrag" }));
    await userEvent.click(screen.getByRole("button", { name: "Abbrechen" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(action).not.toHaveBeenCalled();
  });
});

describe("PanelDialog", () => {
  it("zeigt Titel und Inhalt und schließt sich über „Schließen“", async () => {
    render(
      <PanelDialog
        trigger={<Button />}
        triggerLabel="Dokumente"
        title="Dokumente verwalten"
        description="Alle Unterlagen"
      >
        <p>Inhalt des Panels</p>
      </PanelDialog>
    );

    await userEvent.click(screen.getByRole("button", { name: "Dokumente" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Dokumente verwalten");
    expect(dialog).toHaveTextContent("Alle Unterlagen");
    expect(dialog).toHaveTextContent("Inhalt des Panels");

    await userEvent.click(screen.getByRole("button", { name: "Schließen" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("DeleteDialog", () => {
  it("löscht erst nach Bestätigung und schließt sich danach", async () => {
    const action = vi.fn(async () => {});
    render(
      <DeleteDialog
        entityLabel="Link"
        itemTitle="Wiki"
        action={action}
        successMessage="Link gelöscht"
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "Löschen" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Link löschen?");
    expect(dialog).toHaveTextContent("„Wiki“ wird endgültig entfernt.");
    expect(action).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Endgültig löschen" }));
    expect(action).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(toast.success).toHaveBeenCalledWith("Link gelöscht");
  });

  it("„Abbrechen“ löscht nichts", async () => {
    const action = vi.fn(async () => {});
    render(
      <DeleteDialog
        entityLabel="Link"
        itemTitle="Wiki"
        action={action}
        successMessage="Link gelöscht"
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "Löschen" }));
    await userEvent.click(screen.getByRole("button", { name: "Abbrechen" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(action).not.toHaveBeenCalled();
  });

  it("bleibt bei einem Fehler offen", async () => {
    const action = vi.fn(async () => {
      throw new Error("Wird noch verwendet");
    });
    render(
      <DeleteDialog
        entityLabel="Link"
        itemTitle="Wiki"
        action={action}
        successMessage="Link gelöscht"
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "Löschen" }));
    await userEvent.click(screen.getByRole("button", { name: "Endgültig löschen" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Wird noch verwendet"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("nutzt einen eigenen Trigger, wenn einer übergeben wird", async () => {
    render(
      <DeleteDialog
        entityLabel="Datei"
        itemTitle="a.pdf"
        action={vi.fn(async () => {})}
        successMessage="weg"
        trigger={<Button aria-label="Datei entfernen" />}
      />
    );
    expect(screen.queryByRole("button", { name: "Löschen" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Datei entfernen" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Datei löschen?");
  });
});

describe("ConfirmDialog", () => {
  function renderConfirm(
    action: () => Promise<unknown>,
    variant?: "default" | "destructive"
  ) {
    return render(
      <ConfirmDialog
        trigger={<Button />}
        triggerLabel="Login sperren"
        title="Login wirklich sperren?"
        description="Die Person kann sich danach nicht mehr anmelden."
        confirmLabel="Jetzt sperren"
        pendingLabel="Wird gesperrt …"
        action={action}
        successMessage="Login gesperrt"
        variant={variant}
      />
    );
  }

  it("zeigt Titel, Beschreibung und führt nach Bestätigung die Action aus", async () => {
    const action = vi.fn(async () => {});
    renderConfirm(action);

    await userEvent.click(screen.getByRole("button", { name: "Login sperren" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Login wirklich sperren?");
    expect(dialog).toHaveTextContent("Die Person kann sich danach nicht mehr anmelden.");

    await userEvent.click(screen.getByRole("button", { name: "Jetzt sperren" }));
    expect(action).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(toast.success).toHaveBeenCalledWith("Login gesperrt");
  });

  it("zeigt während der Ausführung das Pending-Label", async () => {
    const d = deferred();
    renderConfirm(() => d.promise);

    await userEvent.click(screen.getByRole("button", { name: "Login sperren" }));
    await userEvent.click(screen.getByRole("button", { name: "Jetzt sperren" }));

    expect(await screen.findByRole("button", { name: "Wird gesperrt …" })).toBeDisabled();
    await act(async () => d.resolve());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("färbt den Bestätigungs-Button bei variant=destructive rot", async () => {
    renderConfirm(vi.fn(async () => {}), "destructive");
    await userEvent.click(screen.getByRole("button", { name: "Login sperren" }));
    expect(screen.getByRole("button", { name: "Jetzt sperren" }).className).toMatch(
      /destructive/
    );
  });

  it("nutzt standardmäßig keine destruktive Optik", async () => {
    renderConfirm(vi.fn(async () => {}));
    await userEvent.click(screen.getByRole("button", { name: "Login sperren" }));
    expect(screen.getByRole("button", { name: "Jetzt sperren" }).className).not.toMatch(
      /bg-destructive/
    );
  });

  it("„Abbrechen“ führt die Action nicht aus", async () => {
    const action = vi.fn(async () => {});
    renderConfirm(action);
    await userEvent.click(screen.getByRole("button", { name: "Login sperren" }));
    await userEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(action).not.toHaveBeenCalled();
  });
});

describe("VisibilityToggle", () => {
  it("heißt „Ausblenden“, wenn der Eintrag sichtbar ist, und meldet hiddenMessage", async () => {
    const action = vi.fn(async () => {});
    render(
      <VisibilityToggle
        active
        action={action}
        hiddenMessage="Ausgeblendet"
        shownMessage="Eingeblendet"
      />
    );
    await userEvent.click(screen.getByRole("button", { name: "Ausblenden" }));
    expect(action).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Ausgeblendet"));
  });

  it("heißt „Einblenden“, wenn der Eintrag ausgeblendet ist, und meldet shownMessage", async () => {
    const action = vi.fn(async () => {});
    render(
      <VisibilityToggle
        active={false}
        action={action}
        hiddenMessage="Ausgeblendet"
        shownMessage="Eingeblendet"
      />
    );
    await userEvent.click(screen.getByRole("button", { name: "Einblenden" }));
    expect(action).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Eingeblendet"));
  });

  it("meldet Fehler der Action als Toast", async () => {
    render(
      <VisibilityToggle
        active
        action={async () => {
          throw new Error("Nicht erlaubt");
        }}
        hiddenMessage="Ausgeblendet"
        shownMessage="Eingeblendet"
      />
    );
    await userEvent.click(screen.getByRole("button", { name: "Ausblenden" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Nicht erlaubt"));
  });
});

describe("VisibilityBadge", () => {
  it("zeigt „sichtbar“ bzw. „ausgeblendet“", () => {
    const { rerender } = render(<VisibilityBadge active />);
    expect(screen.getByText("sichtbar")).toBeInTheDocument();
    rerender(<VisibilityBadge active={false} />);
    expect(screen.getByText("ausgeblendet")).toBeInTheDocument();
    expect(screen.queryByText("sichtbar")).not.toBeInTheDocument();
  });
});
