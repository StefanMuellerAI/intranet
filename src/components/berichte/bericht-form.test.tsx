import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import {
  submitSeminarReport,
  updateSeminarReportAction,
} from "@/app/(app)/berichte/actions";
import { QUOTES_MAX_COUNT } from "@/lib/seminar-reports";
import { BerichtForm, type BerichtFormDefaults } from "./bericht-form";

vi.mock("@/app/(app)/berichte/actions", () => ({
  submitSeminarReport: vi.fn(async () => ({ ok: true, data: null })),
  updateSeminarReportAction: vi.fn(async () => ({ ok: true, data: null })),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Reihenfolge der Auswahlfelder: Art, Feedback (das Kundenfeld mit
// Vorschlagsliste ist ebenfalls eine Combobox, aber ein <input>)
const ART = 0;
const FEEDBACK = 1;

function selectTriggers() {
  return screen
    .getAllByRole("combobox")
    .filter((el) => el.tagName === "BUTTON");
}

const EDIT_DEFAULTS: BerichtFormDefaults = {
  kind: "beratung",
  customerName: "dbb akademie",
  title: "KI-Strategie",
  eventDate: "2026-09-30",
  durationDays: "1,5",
  whatWentWell: "Gute Diskussion",
  whatWentBadly: "Technik hakte",
  improvements: "Früher testen",
  feedbackRating: 4,
  quoteQuestion: "Was nehmen Sie mit?",
  quotes: [
    { id: "11111111-1111-4111-8111-111111111111", quote: "Sehr praxisnah." },
    { id: "22222222-2222-4222-8222-222222222222", quote: "Zu kurz." },
  ],
};

function renderCreate(
  props: Partial<React.ComponentProps<typeof BerichtForm>> = {}
) {
  return render(
    <BerichtForm
      action={submitSeminarReport}
      customerSuggestions={["Haufe Akademie", "dbb akademie"]}
      submitLabel="Bericht speichern"
      {...props}
    />
  );
}

function renderEdit() {
  return render(
    <BerichtForm
      action={updateSeminarReportAction.bind(null, "bericht-1")}
      customerSuggestions={[]}
      submitLabel="Änderungen speichern"
      successMessage="Bericht aktualisiert."
      defaults={EDIT_DEFAULTS}
    />
  );
}

async function choose(index: number, option: string) {
  await userEvent.click(selectTriggers()[index]);
  await userEvent.click(await screen.findByRole("option", { name: option }));
}

function addQuoteButton() {
  return screen.getByRole("button", { name: "Zitat hinzufügen" });
}

function quoteFields() {
  return screen.getAllByRole("textbox", { name: /^Zitat \d+$/ });
}

/** Pflichtfelder für einen gültigen Bericht ausfüllen */
function fillRequired() {
  const set = (label: string, value: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  set("Kunde / Organisation", "  Haufe Akademie ");
  set("Titel der Veranstaltung", "KI-Grundlagen");
  set("Datum", "2026-10-01");
  set("Dauer in Tagen", "0,5");
  set("Was lief gut?", "Aktive Gruppe");
  set("Was lief nicht gut?", "Raum zu klein");
  set("Was möchten Sie beim nächsten Mal verbessern?", "Mehr Pausen");
}

/** Payload des letzten Aufrufs — FormData ist immer das letzte Argument */
function payloadOf(fn: unknown) {
  const calls = vi.mocked(fn as (...args: unknown[]) => Promise<unknown>).mock
    .calls;
  const args = calls[calls.length - 1];
  const fd = args[args.length - 1] as FormData;
  return JSON.parse(String(fd.get("payload")));
}

describe("BerichtForm", () => {
  it("„Zitat hinzufügen“ ergänzt Zeilen bis zum Maximum und ist dann deaktiviert", async () => {
    renderCreate();
    expect(quoteFields()).toHaveLength(1);

    for (let i = 1; i < QUOTES_MAX_COUNT; i++) {
      fireEvent.click(addQuoteButton());
    }

    expect(quoteFields()).toHaveLength(QUOTES_MAX_COUNT);
    expect(screen.getByRole("textbox", { name: "Zitat 20" })).toBeInTheDocument();
    expect(addQuoteButton()).toBeDisabled();

    // Nach dem Entfernen einer Zeile geht es wieder
    await userEvent.click(
      screen.getByRole("button", { name: "Zitat 20 entfernen" })
    );
    expect(addQuoteButton()).toBeEnabled();
  });

  it("entfernt ein Zitat gezielt und lässt immer mindestens eine leere Zeile stehen", async () => {
    const user = userEvent.setup();
    renderCreate();
    await user.click(addQuoteButton());
    await user.type(screen.getByRole("textbox", { name: "Zitat 1" }), "Erstes");
    await user.type(screen.getByRole("textbox", { name: "Zitat 2" }), "Zweites");
    expect(screen.getByText("2 von höchstens 20 Zitaten")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Zitat 1 entfernen" }));

    expect(quoteFields()).toHaveLength(1);
    expect(screen.getByRole("textbox", { name: "Zitat 1" })).toHaveValue("Zweites");
    expect(screen.getByText("1 von höchstens 20 Zitaten")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Zitat 1 entfernen" }));

    expect(quoteFields()).toHaveLength(1);
    expect(screen.getByRole("textbox", { name: "Zitat 1" })).toHaveValue("");
    expect(screen.getByText("0 von höchstens 20 Zitaten")).toBeInTheDocument();
  });

  it("macht die gestellte Frage zur Pflicht, sobald ein Zitat erfasst ist", async () => {
    const user = userEvent.setup();
    renderCreate();
    const question = screen.getByLabelText("Gestellte Frage");
    expect(question).not.toBeRequired();

    // Nur Leerzeichen zählen nicht als Zitat
    await user.type(screen.getByRole("textbox", { name: "Zitat 1" }), "   ");
    expect(question).not.toBeRequired();

    await user.type(screen.getByRole("textbox", { name: "Zitat 1" }), "Super");
    expect(question).toBeRequired();

    await user.clear(screen.getByRole("textbox", { name: "Zitat 1" }));
    expect(question).not.toBeRequired();
  });

  it("blockiert das Absenden mit Zitat, aber ohne Frage (Browser-Validierung)", async () => {
    const user = userEvent.setup();
    renderCreate();
    fillRequired();
    await choose(FEEDBACK, "4 — gut");
    await user.type(screen.getByRole("textbox", { name: "Zitat 1" }), "Top");

    await user.click(screen.getByRole("button", { name: "Bericht speichern" }));
    expect(submitSeminarReport).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Gestellte Frage")).toBeInvalid();

    await user.type(screen.getByLabelText("Gestellte Frage"), "Fazit?");
    await user.click(screen.getByRole("button", { name: "Bericht speichern" }));
    await waitFor(() => expect(submitSeminarReport).toHaveBeenCalledTimes(1));
  });

  it("sperrt das Speichern, solange kein Feedback gewählt ist", async () => {
    renderCreate();
    const submit = screen.getByRole("button", { name: "Bericht speichern" });
    expect(submit).toBeDisabled();

    await choose(FEEDBACK, "4 — gut");
    expect(submit).toBeEnabled();
  });

  it("Neuanlage: sendet das Payload mit getrimmten Texten, Dauer als Zahl und nur gefüllten Zitaten", async () => {
    const user = userEvent.setup();
    renderCreate();
    fillRequired();
    await choose(ART, "Beratung");
    await choose(FEEDBACK, "5 — sehr gut");
    await user.type(
      screen.getByLabelText("Gestellte Frage"),
      "Was nehmen Sie mit?"
    );
    await user.type(screen.getByRole("textbox", { name: "Zitat 1" }), "  Sehr praxisnah. ");
    await user.click(addQuoteButton()); // bleibt leer → wird verworfen
    await user.click(addQuoteButton());
    await user.type(screen.getByRole("textbox", { name: "Zitat 3" }), "Gerne wieder");

    await user.click(screen.getByRole("button", { name: "Bericht speichern" }));

    await waitFor(() => expect(submitSeminarReport).toHaveBeenCalledTimes(1));
    expect(payloadOf(submitSeminarReport)).toEqual({
      kind: "beratung",
      customerName: "Haufe Akademie",
      title: "KI-Grundlagen",
      eventDate: "2026-10-01",
      durationDays: 0.5,
      whatWentWell: "Aktive Gruppe",
      whatWentBadly: "Raum zu klein",
      improvements: "Mehr Pausen",
      feedbackRating: 5,
      quoteQuestion: "Was nehmen Sie mit?",
      quotes: [
        { id: null, quote: "Sehr praxisnah." },
        { id: null, quote: "Gerne wieder" },
      ],
    });
    // Ohne successMessage kein Erfolgs-Toast (die Action leitet weiter)
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("Bearbeiten: behält Zitat-Ids, übernimmt Änderungen und meldet Erfolg", async () => {
    const user = userEvent.setup();
    renderEdit();
    expect(quoteFields()).toHaveLength(2);
    expect(screen.getByRole("textbox", { name: "Zitat 1" })).toHaveValue(
      "Sehr praxisnah."
    );
    expect(
      screen.getByRole("button", { name: "Änderungen speichern" })
    ).toBeEnabled();

    // Zitat 2 entfernen, Zitat 1 korrigieren, neues Zitat ergänzen
    await user.click(screen.getByRole("button", { name: "Zitat 2 entfernen" }));
    await user.type(screen.getByRole("textbox", { name: "Zitat 1" }), " Danke!");
    await user.click(addQuoteButton());
    await user.type(screen.getByRole("textbox", { name: "Zitat 2" }), "Neu");

    await user.click(
      screen.getByRole("button", { name: "Änderungen speichern" })
    );

    await waitFor(() =>
      expect(updateSeminarReportAction).toHaveBeenCalledTimes(1)
    );
    expect(vi.mocked(updateSeminarReportAction).mock.calls[0][0]).toBe(
      "bericht-1"
    );
    expect(payloadOf(updateSeminarReportAction)).toMatchObject({
      kind: "beratung",
      customerName: "dbb akademie",
      durationDays: 1.5,
      feedbackRating: 4,
      quoteQuestion: "Was nehmen Sie mit?",
      quotes: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          quote: "Sehr praxisnah. Danke!",
        },
        { id: null, quote: "Neu" },
      ],
    });
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Bericht aktualisiert.")
    );
  });

  it("zeigt fachliche Fehler aus dem ActionResult als Toast — ohne Erfolgsmeldung", async () => {
    vi.mocked(updateSeminarReportAction).mockResolvedValueOnce({
      ok: false,
      error: "Bitte die gestellte Frage angeben.",
    });
    const user = userEvent.setup();
    renderEdit();

    await user.click(
      screen.getByRole("button", { name: "Änderungen speichern" })
    );

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Bitte die gestellte Frage angeben."
      )
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("zeigt geworfene Fehler als Toast", async () => {
    vi.mocked(submitSeminarReport).mockRejectedValueOnce(
      new Error("Keine Berechtigung.")
    );
    const user = userEvent.setup();
    renderCreate();
    fillRequired();
    await choose(FEEDBACK, "3 — befriedigend");

    await user.click(screen.getByRole("button", { name: "Bericht speichern" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Keine Berechtigung.")
    );
  });

  it("bietet bekannte Kunden als Vorschläge an", () => {
    renderCreate();
    const input = screen.getByLabelText("Kunde / Organisation");
    const list = document.getElementById(input.getAttribute("list")!);
    expect(
      Array.from(list!.querySelectorAll("option")).map((o) => o.value)
    ).toEqual(["Haufe Akademie", "dbb akademie"]);
  });
});
