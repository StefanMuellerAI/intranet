import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import {
  resubmitVacationRequest,
  submitVacationRequest,
} from "@/app/(app)/urlaub/actions";
import { VacationForm, type AbsenceRange } from "./vacation-form";

vi.mock("@/app/(app)/urlaub/actions", () => ({
  submitVacationRequest: vi.fn(async () => {}),
  resubmitVacationRequest: vi.fn(async () => {}),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const USERS = [
  { id: "u-anna", name: "Anna Muster" },
  { id: "u-ben", name: "Ben Beispiel" },
];

// Mo 09.11.2026 – Fr 13.11.2026: fünf Arbeitstage ohne NRW-Feiertag
const MONTAG = "2026-11-09";
const FREITAG = "2026-11-13";

function renderForm(
  props: Partial<React.ComponentProps<typeof VacationForm>> = {}
) {
  return render(
    <VacationForm
      action={submitVacationRequest}
      users={USERS}
      remainingDays={20}
      absences={[]}
      submitLabel="Antrag einreichen"
      {...props}
    />
  );
}

function setDates(from: string, to: string) {
  fireEvent.change(screen.getByLabelText("Von"), { target: { value: from } });
  fireEvent.change(screen.getByLabelText("Bis"), { target: { value: to } });
}

/** Letzter Aufruf der (gemockten) Action → übergebene FormData */
function lastFormData(fn: unknown): FormData {
  const calls = vi.mocked(fn as (fd: FormData) => Promise<void>).mock.calls;
  return calls[calls.length - 1][0];
}

describe("VacationForm", () => {
  it("zeigt im Auswahlfeld den Namen der Vertretung statt ihrer ID", async () => {
    renderForm();
    const select = screen.getByRole("combobox");
    expect(select).toHaveTextContent("Keine / Freitext");
    await userEvent.click(select);
    await userEvent.click(await screen.findByRole("option", { name: "Ben Beispiel" }));
    expect(screen.getByRole("combobox")).toHaveTextContent("Ben Beispiel");
    expect(screen.getByRole("combobox")).not.toHaveTextContent("u-ben");
  });

  it("schreibt halbe Tage mit deutschem Komma", async () => {
    renderForm();
    setDates(MONTAG, FREITAG);
    await userEvent.click(
      screen.getByRole("checkbox", { name: "Erster Tag nur halber Tag" })
    );
    expect(screen.getByText(/4,5 Urlaubstage/)).toBeInTheDocument();
  });

  it("zeigt für Mo–Fr eine Vorschau von 5 Urlaubstagen und den Resturlaub danach", () => {
    renderForm();
    setDates(MONTAG, FREITAG);

    expect(
      screen.getByText(/5 Urlaubstage \(ohne Wochenenden und Feiertage NRW\)/)
    ).toBeInTheDocument();
    expect(
      screen.getByText("Verbleibender Resturlaub nach diesem Antrag: 15 Tage.")
    ).toBeInTheDocument();
  });

  it("halbe Tage am Anfang und Ende reduzieren die Urlaubstage um je 0,5", async () => {
    renderForm();
    setDates(MONTAG, FREITAG);

    await userEvent.click(
      screen.getByRole("checkbox", { name: "Erster Tag nur halber Tag" })
    );
    expect(screen.getByText(/4.5 Urlaubstage/)).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("checkbox", { name: "Letzter Tag nur halber Tag" })
    );
    expect(screen.getByText(/^4 Urlaubstage/)).toBeInTheDocument();
  });

  it("warnt, wenn der Antrag den Resturlaub des Startjahres übersteigt", () => {
    renderForm({ remainingDays: 3, remainingByYear: { "2026": 3 } });
    setDates(MONTAG, FREITAG);

    expect(
      screen.getByText(
        "Achtung: Dieser Antrag übersteigt Ihren Resturlaub von 3 Tagen."
      )
    ).toBeInTheDocument();
  });

  it("nutzt den Resturlaub des Jahres, in dem der Urlaub beginnt", () => {
    renderForm({
      remainingDays: 20,
      remainingByYear: { "2026": 20, "2027": 30 },
    });
    // Mo 11.01.2027 – Fr 15.01.2027
    setDates("2027-01-11", "2027-01-15");

    expect(
      screen.getByText("Verbleibender Resturlaub nach diesem Antrag: 25 Tage.")
    ).toBeInTheDocument();
  });

  it("deaktiviert das Absenden ohne Zeitraum und bei 0 Urlaubstagen (Wochenende)", () => {
    renderForm();
    const submit = screen.getByRole("button", { name: "Antrag einreichen" });
    expect(submit).toBeDisabled();

    // Sa 14.11.2026 – So 15.11.2026
    setDates("2026-11-14", "2026-11-15");
    expect(screen.getByText(/0 Urlaubstage/)).toBeInTheDocument();
    expect(submit).toBeDisabled();

    setDates(MONTAG, FREITAG);
    expect(submit).toBeEnabled();
  });

  it("zeigt keine Vorschau, wenn das Enddatum vor dem Startdatum liegt", () => {
    renderForm();
    setDates(FREITAG, MONTAG);

    expect(screen.queryByText(/Urlaubstag/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Antrag einreichen" })
    ).toBeDisabled();
  });

  it("weist auf Überschneidungen mit Abwesenheiten anderer hin — nur bei tatsächlicher Überlappung", () => {
    const absences: AbsenceRange[] = [
      { name: "Anna Muster", type: "Urlaub", from: "2026-11-12", to: "2026-11-20" },
      { name: "Ben Beispiel", type: "Workation", from: "2026-12-01", to: "2026-12-05" },
    ];
    renderForm({ absences });
    expect(
      screen.queryByText("Überschneidung mit Abwesenheiten anderer")
    ).not.toBeInTheDocument();

    setDates(MONTAG, FREITAG);

    expect(
      screen.getByText("Überschneidung mit Abwesenheiten anderer")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Anna Muster: Urlaub (12.11.2026 bis 20.11.2026)")
    ).toBeInTheDocument();
    expect(screen.queryByText(/Ben Beispiel: Workation/)).not.toBeInTheDocument();
  });

  it("übergibt Zeitraum, halbe Tage, Vertretung (Auswahl + Freitext) und Bemerkung als FormData", async () => {
    const user = userEvent.setup();
    renderForm();
    setDates(MONTAG, FREITAG);
    await user.click(
      screen.getByRole("checkbox", { name: "Letzter Tag nur halber Tag" })
    );

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Ben Beispiel" }));
    await user.type(
      screen.getByPlaceholderText("Alternativ: Vertretung als Freitext"),
      "Team Vertrieb"
    );
    await user.type(screen.getByLabelText("Bemerkung (optional)"), "Familienfeier");

    await user.click(screen.getByRole("button", { name: "Antrag einreichen" }));

    await waitFor(() => expect(submitVacationRequest).toHaveBeenCalledTimes(1));
    const fd = lastFormData(submitVacationRequest);
    expect(fd.get("startDate")).toBe(MONTAG);
    expect(fd.get("endDate")).toBe(FREITAG);
    expect(fd.get("halfDayStart")).toBeNull();
    expect(fd.get("halfDayEnd")).toBe("on");
    expect(fd.get("substituteUserId")).toBe("u-ben");
    expect(fd.get("substituteText")).toBe("Team Vertrieb");
    expect(fd.get("note")).toBe("Familienfeier");
  });

  it("„Keine / Freitext“ setzt die Vertretung wieder zurück", async () => {
    const user = userEvent.setup();
    renderForm({ defaults: { substituteUserId: "u-anna" } });
    setDates(MONTAG, FREITAG);

    await user.click(screen.getByRole("combobox"));
    await user.click(
      await screen.findByRole("option", { name: "Keine / Freitext" })
    );
    await user.click(screen.getByRole("button", { name: "Antrag einreichen" }));

    await waitFor(() => expect(submitVacationRequest).toHaveBeenCalledTimes(1));
    expect(lastFormData(submitVacationRequest).get("substituteUserId")).toBe("");
  });

  it("Korrekturmodus: übernimmt Vorgaben und reicht mit „Korrigiert erneut einreichen“ ein", async () => {
    const user = userEvent.setup();
    renderForm({
      action: resubmitVacationRequest.bind(null, "antrag-1"),
      submitLabel: "Korrigiert erneut einreichen",
      defaults: {
        startDate: MONTAG,
        endDate: FREITAG,
        halfDayStart: true,
        substituteUserId: "u-anna",
        substituteText: "Notfall: Ben",
        note: "Bitte prüfen",
      },
    });

    expect(screen.getByText(/4.5 Urlaubstage/)).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Erster Tag nur halber Tag" })
    ).toBeChecked();

    await user.click(
      screen.getByRole("button", { name: "Korrigiert erneut einreichen" })
    );

    await waitFor(() =>
      expect(resubmitVacationRequest).toHaveBeenCalledTimes(1)
    );
    const [id, fd] = vi.mocked(resubmitVacationRequest).mock.calls[0];
    expect(id).toBe("antrag-1");
    expect(fd.get("startDate")).toBe(MONTAG);
    expect(fd.get("halfDayStart")).toBe("on");
    expect(fd.get("substituteUserId")).toBe("u-anna");
    expect(fd.get("substituteText")).toBe("Notfall: Ben");
    expect(fd.get("note")).toBe("Bitte prüfen");
  });

  it("zeigt einen Fehler-Toast, wenn die Action fehlschlägt", async () => {
    vi.mocked(submitVacationRequest).mockRejectedValueOnce(
      new Error("Zeitraum überschneidet sich mit einem eigenen Antrag.")
    );
    const user = userEvent.setup();
    renderForm();
    setDates(MONTAG, FREITAG);

    await user.click(screen.getByRole("button", { name: "Antrag einreichen" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Zeitraum überschneidet sich mit einem eigenen Antrag."
      )
    );
    // Nach dem Fehler ist der Button wieder bedienbar
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Antrag einreichen" })
      ).toBeEnabled()
    );
  });
});
