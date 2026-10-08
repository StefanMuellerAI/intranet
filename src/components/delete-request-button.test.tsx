import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DeleteRequestButton } from "./delete-request-button";

describe("DeleteRequestButton", () => {
  it("fragt vor dem Löschen nach und führt die Action erst nach Bestätigung aus", async () => {
    const action = vi.fn(async () => {});
    render(
      <DeleteRequestButton action={action} description="Antrag wird gelöscht." />
    );

    await userEvent.click(screen.getByRole("button", { name: "Endgültig löschen" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Antrag wird gelöscht.");
    expect(action).not.toHaveBeenCalled();

    const buttons = screen.getAllByRole("button", { name: "Endgültig löschen" });
    await userEvent.click(buttons[buttons.length - 1]);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("„Abbrechen“ schließt den Dialog, ohne zu löschen", async () => {
    const action = vi.fn(async () => {});
    render(<DeleteRequestButton action={action} description="Weg damit?" />);

    await userEvent.click(screen.getByRole("button", { name: "Endgültig löschen" }));
    await userEvent.click(screen.getByRole("button", { name: "Abbrechen" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(action).not.toHaveBeenCalled();
  });
});
