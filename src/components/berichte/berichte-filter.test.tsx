import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { routerMock } from "../../../tests/component/setup";
import { BerichteFilter, type BerichteFilterValues } from "./berichte-filter";

const EMPLOYEES = [
  { id: "u-anna", name: "Anna Muster" },
  { id: "u-ben", name: "Ben Beispiel" },
];

const EMPTY: BerichteFilterValues = {
  mitarbeiter: "",
  art: "",
  von: "",
  bis: "",
  sortierung: "datum_desc",
};

// Reihenfolge der Auswahlfelder: Mitarbeiter/in, Art
const MITARBEITER = 0;
const ART = 1;

function renderFilter(values: Partial<BerichteFilterValues> = {}) {
  const view = render(
    <BerichteFilter employees={EMPLOYEES} values={{ ...EMPTY, ...values }} />
  );
  const form = view.container.querySelector("form")!;
  return { ...view, form };
}

async function choose(index: number, option: string) {
  await userEvent.click(screen.getAllByRole("combobox")[index]);
  await userEvent.click(await screen.findByRole("option", { name: option }));
}

/** Query-String, den das GET-Formular beim Absenden erzeugen würde */
function queryOf(form: HTMLFormElement) {
  return new URLSearchParams(
    new FormData(form) as unknown as Record<string, string>
  ).toString();
}

describe("BerichteFilter", () => {
  it("zeigt in den Auswahlfeldern Beschriftungen statt interner Werte", () => {
    renderFilter();
    const [mitarbeiter, art] = screen.getAllByRole("combobox");
    expect(mitarbeiter).toHaveTextContent("Alle");
    expect(art).toHaveTextContent("Alle");
  });

  it("ist ein GET-Formular auf /berichte/alle — die Auswahl landet in der URL", () => {
    const { form } = renderFilter();
    expect(form).toHaveAttribute("method", "get");
    expect(form).toHaveAttribute("action", "/berichte/alle");
  });

  it("sendet ohne Auswahl leere Filter und behält die Sortierung", () => {
    const { form } = renderFilter();
    expect(queryOf(form)).toBe(
      "mitarbeiter=&art=&von=&bis=&sortierung=datum_desc"
    );
  });

  it("überträgt Mitarbeiter/in, Art und Zeitraum in die Query", async () => {
    const { form } = renderFilter();

    await choose(MITARBEITER, "Ben Beispiel");
    await choose(ART, "Seminar");
    fireEvent.change(screen.getByLabelText("Von"), {
      target: { value: "2026-01-01" },
    });
    fireEvent.change(screen.getByLabelText("Bis"), {
      target: { value: "2026-06-30" },
    });

    expect(queryOf(form)).toBe(
      "mitarbeiter=u-ben&art=seminar&von=2026-01-01&bis=2026-06-30&sortierung=datum_desc"
    );
  });

  it("„Alle“ setzt eine Auswahl wieder auf einen leeren Filter zurück", async () => {
    const { form } = renderFilter({ mitarbeiter: "u-anna", art: "beratung" });
    expect(queryOf(form)).toContain("mitarbeiter=u-anna&art=beratung");

    await choose(MITARBEITER, "Alle");
    await choose(ART, "Alle");

    expect(queryOf(form)).toContain("mitarbeiter=&art=&");
  });

  it("übernimmt die aktuellen Filterwerte aus der URL", () => {
    const { form } = renderFilter({
      mitarbeiter: "u-anna",
      art: "seminar",
      von: "2026-03-01",
      bis: "2026-03-31",
      sortierung: "bewertung_desc",
    });

    expect(screen.getByLabelText("Von")).toHaveValue("2026-03-01");
    expect(screen.getByLabelText("Bis")).toHaveValue("2026-03-31");
    expect(queryOf(form)).toBe(
      "mitarbeiter=u-anna&art=seminar&von=2026-03-01&bis=2026-03-31&sortierung=bewertung_desc"
    );
  });

  it("„Filtern“ schickt das Formular ab, ohne den Client-Router zu benutzen", async () => {
    const { form } = renderFilter();
    const onSubmit = vi.fn((e: SubmitEvent) => e.preventDefault());
    form.addEventListener("submit", onSubmit);

    await userEvent.click(screen.getByRole("button", { name: "Filtern" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(routerMock.push).not.toHaveBeenCalled();
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it("„Zurücksetzen“ verlinkt auf die ungefilterte Übersicht", () => {
    renderFilter({ mitarbeiter: "u-anna", von: "2026-03-01" });

    const reset = screen.getByText("Zurücksetzen").closest("a");
    expect(reset).toHaveAttribute("href", "/berichte/alle");
  });
});
