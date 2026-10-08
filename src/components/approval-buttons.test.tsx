import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { approveAction, rejectAction } from "@/app/(app)/freigaben/actions";
import { routerMock } from "../../tests/component/setup";
import { ApprovalButtons } from "./approval-buttons";

vi.mock("@/app/(app)/freigaben/actions", () => ({
  approveAction: vi.fn(async () => {}),
  rejectAction: vi.fn(async () => {}),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function renderButtons(
  props: Partial<React.ComponentProps<typeof ApprovalButtons>> = {}
) {
  return render(
    <ApprovalButtons type="urlaub" id="antrag-1" isOwn={false} {...props} />
  );
}

describe("ApprovalButtons", () => {
  it("„Genehmigen“ ruft die Action auf, meldet Erfolg und lädt die Seite neu", async () => {
    renderButtons({ type: "reisekosten", id: "rk-7" });

    await userEvent.click(screen.getByRole("button", { name: "Genehmigen" }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Antrag genehmigt.")
    );
    expect(approveAction).toHaveBeenCalledWith("reisekosten", "rk-7");
    expect(rejectAction).not.toHaveBeenCalled();
    expect(routerMock.refresh).toHaveBeenCalledTimes(1);
  });

  it("sperrt beide Buttons, solange die Genehmigung läuft", async () => {
    let finish: () => void = () => {};
    vi.mocked(approveAction).mockImplementationOnce(
      () => new Promise<void>((resolve) => (finish = resolve))
    );
    renderButtons();

    await userEvent.click(screen.getByRole("button", { name: "Genehmigen" }));

    expect(screen.getByRole("button", { name: "Genehmigen" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Beanstanden" })).toBeDisabled();

    finish();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Genehmigen" })).toBeEnabled()
    );
  });

  it("„Beanstanden“ öffnet den Dialog; Senden erst mit Begründung möglich", async () => {
    const user = userEvent.setup();
    renderButtons();

    await user.click(screen.getByRole("button", { name: "Beanstanden" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Antrag beanstanden");
    const send = screen.getByRole("button", { name: "Beanstandung senden" });
    expect(send).toBeDisabled();

    // Nur Leerzeichen reichen nicht
    await user.type(screen.getByLabelText("Grund (Pflichtfeld)"), "   ");
    expect(send).toBeDisabled();

    await user.type(
      screen.getByLabelText("Grund (Pflichtfeld)"),
      "Vertretung fehlt"
    );
    expect(send).toBeEnabled();
    expect(rejectAction).not.toHaveBeenCalled();
  });

  it("sendet die Beanstandung mit Kommentar, schließt den Dialog und lädt neu", async () => {
    const user = userEvent.setup();
    renderButtons({ type: "workation", id: "w-3" });

    await user.click(screen.getByRole("button", { name: "Beanstanden" }));
    await user.type(
      screen.getByLabelText("Grund (Pflichtfeld)"),
      "Versicherungsnachweis fehlt"
    );
    await user.click(screen.getByRole("button", { name: "Beanstandung senden" }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Beanstandung gesendet.")
    );
    expect(rejectAction).toHaveBeenCalledTimes(1);
    const [type, id, fd] = vi.mocked(rejectAction).mock.calls[0];
    expect(type).toBe("workation");
    expect(id).toBe("w-3");
    expect(fd.get("comment")).toBe("Versicherungsnachweis fehlt");
    expect(approveAction).not.toHaveBeenCalled();
    expect(routerMock.refresh).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    );

    // Beim erneuten Öffnen ist das Feld wieder leer
    await user.click(screen.getByRole("button", { name: "Beanstanden" }));
    expect(screen.getByLabelText("Grund (Pflichtfeld)")).toHaveValue("");
  });

  it("verwendet bei Storno-Anträgen die Storno-Beschriftungen", async () => {
    const user = userEvent.setup();
    renderButtons({ isCancellation: true });

    expect(
      screen.queryByRole("button", { name: "Genehmigen" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Beanstanden" })
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Storno ablehnen" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Storno ablehnen");
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    );

    await user.click(screen.getByRole("button", { name: "Storno bestätigen" }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Storno bestätigt.")
    );
    expect(approveAction).toHaveBeenCalledWith("urlaub", "antrag-1");
  });

  it("zeigt bei eigenen Anträgen den Vier-Augen-Hinweis statt der Buttons", () => {
    renderButtons({ isOwn: true });

    expect(
      screen.getByText(/Eigene Anträge dürfen nicht selbst genehmigt werden/)
    ).toHaveTextContent("Vier-Augen-Prinzip");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("zeigt einen Fehler-Toast, wenn die Genehmigung fehlschlägt", async () => {
    vi.mocked(approveAction).mockRejectedValueOnce(
      new Error("Antrag wurde bereits bearbeitet.")
    );
    renderButtons();

    await userEvent.click(screen.getByRole("button", { name: "Genehmigen" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Antrag wurde bereits bearbeitet.")
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(routerMock.refresh).not.toHaveBeenCalled();
  });

  it("meldet „Fehler“, wenn die Action keinen Error wirft", async () => {
    vi.mocked(approveAction).mockRejectedValueOnce("kaputt");
    renderButtons();

    await userEvent.click(screen.getByRole("button", { name: "Genehmigen" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Fehler"));
  });

  it("lässt den Dialog samt Kommentar offen, wenn die Beanstandung fehlschlägt", async () => {
    vi.mocked(rejectAction).mockRejectedValueOnce(
      new Error("Keine Berechtigung.")
    );
    const user = userEvent.setup();
    renderButtons();

    await user.click(screen.getByRole("button", { name: "Beanstanden" }));
    await user.type(screen.getByLabelText("Grund (Pflichtfeld)"), "Unklar");
    await user.click(screen.getByRole("button", { name: "Beanstandung senden" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Keine Berechtigung.")
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Grund (Pflichtfeld)")).toHaveValue("Unklar");
    expect(routerMock.refresh).not.toHaveBeenCalled();
  });
});
