import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { CopyMcpUrlButton } from "./copy-mcp-url-button";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const MCP_URL = "https://intranet.example.de/api/mcp";

// Eigene Zwischenablage statt der von user-event — direkt per fireEvent klicken
const writeText = vi.fn<(text: string) => Promise<void>>(async () => {});
let originalClipboard: PropertyDescriptor | undefined;

beforeEach(() => {
  originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

afterEach(() => {
  if (originalClipboard) {
    Object.defineProperty(navigator, "clipboard", originalClipboard);
  } else {
    delete (navigator as { clipboard?: unknown }).clipboard;
  }
});

describe("CopyMcpUrlButton", () => {
  it("meldet einen Fehler, wenn die Zwischenablage nicht verfügbar ist", async () => {
    writeText.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
    render(<CopyMcpUrlButton url={MCP_URL} />);
    fireEvent.click(screen.getByRole("button", { name: "URL kopieren" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("kopiert die URL in die Zwischenablage und bestätigt per Toast", async () => {
    render(<CopyMcpUrlButton url={MCP_URL} />);

    fireEvent.click(screen.getByRole("button", { name: "URL kopieren" }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "MCP-URL in die Zwischenablage kopiert."
      )
    );
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(MCP_URL);
  });

  it("meldet erst Erfolg, wenn das Schreiben abgeschlossen ist", async () => {
    let finish: () => void = () => {};
    writeText.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finish = resolve))
    );
    render(<CopyMcpUrlButton url={MCP_URL} />);

    fireEvent.click(screen.getByRole("button", { name: "URL kopieren" }));
    await Promise.resolve();
    expect(toast.success).not.toHaveBeenCalled();

    finish();
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
  });

  it("ist ein reiner Button, der kein umgebendes Formular absendet", () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <CopyMcpUrlButton url={MCP_URL} />
      </form>
    );

    const button = screen.getByRole("button", { name: "URL kopieren" });
    expect(button).toHaveAttribute("type", "button");
    fireEvent.click(button);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
