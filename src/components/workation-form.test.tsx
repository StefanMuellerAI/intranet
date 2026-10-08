import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import {
  resubmitWorkationRequest,
  submitWorkationRequest,
} from "@/app/(app)/workation/actions";
import { WORKATION_DECLARATIONS } from "@/lib/workation/validate";
import { WorkationForm } from "./workation-form";

vi.mock("@/app/(app)/workation/actions", () => ({
  submitWorkationRequest: vi.fn(async () => {}),
  resubmitWorkationRequest: vi.fn(async () => {}),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Vorlaufprüfung rechnet ab "heute" — nur Date einfrieren, Timer bleiben echt
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 8, 10, 0)); // Do 08.10.2026
});
afterEach(() => {
  vi.useRealTimers();
});

const DRITTSTAAT_HINWEIS = "Drittstaat — gesonderte Prüfung erforderlich";
const ERKLAERUNGEN_HINWEIS =
  "Ohne alle sieben Erklärungen ist keine Einreichung möglich.";

function renderForm(
  props: Partial<React.ComponentProps<typeof WorkationForm>> = {}
) {
  return render(
    <WorkationForm
      action={submitWorkationRequest}
      usedWorkDaysThisYear={0}
      yearlyLimitDays={30}
      consecutiveLimitDays={20}
      submitLabel="Antrag einreichen"
      {...props}
    />
  );
}

function setValue(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function setStay(country: string, from: string, to: string) {
  setValue("Zielland", country);
  setValue("Zeitraum von", from);
  setValue("bis (Enddatum verbindlich)", to);
}

async function checkDeclarations(count: number = WORKATION_DECLARATIONS.length) {
  for (const d of WORKATION_DECLARATIONS.slice(0, count)) {
    await userEvent.click(screen.getByRole("checkbox", { name: d.text }));
  }
}

function submitButton() {
  return screen.getByRole("button", { name: "Antrag einreichen" });
}

describe("WorkationForm", () => {
  it("kennzeichnet EU-Länder und Drittstaaten per Badge", () => {
    renderForm();
    expect(screen.queryByText(DRITTSTAAT_HINWEIS)).not.toBeInTheDocument();

    setValue("Zielland", "Spanien");
    expect(screen.getByText("EU / EWR / Schweiz")).toBeInTheDocument();

    setValue("Zielland", "Thailand");
    expect(screen.getByText(DRITTSTAAT_HINWEIS)).toBeInTheDocument();
    expect(screen.queryByText("EU / EWR / Schweiz")).not.toBeInTheDocument();
  });

  it("verlangt für Drittstaaten 8 Wochen Vorlauf, für EU-Länder nur 4 Wochen", () => {
    renderForm();
    // Mo 23.11.2026 – Fr 27.11.2026: 46 Tage Vorlauf
    setStay("Spanien", "2026-11-23", "2026-11-27");
    expect(screen.queryByText("Hinweise zur Prüfung")).not.toBeInTheDocument();

    setValue("Zielland", "Thailand");
    expect(screen.getByText("Hinweise zur Prüfung")).toBeInTheDocument();
    expect(
      screen.getByText(
        /Der Mindestvorlauf von 8 Wochen \(Drittstaat\) ist unterschritten \(46 Tage Vorlauf\)/
      )
    ).toBeInTheDocument();
  });

  it("berechnet die Arbeitstage automatisch und lässt sie manuell überschreiben", () => {
    renderForm();
    const workDays = screen.getByLabelText("davon Arbeitstage");
    expect(workDays).toHaveValue(null);

    setStay("Spanien", "2027-02-01", "2027-02-05");
    expect(workDays).toHaveValue(5);

    // Zwei Wochen → 10 Arbeitstage
    setValue("bis (Enddatum verbindlich)", "2027-02-12");
    expect(workDays).toHaveValue(10);

    // Manuelle Korrektur bleibt auch bei Datumsänderung stehen
    setValue("davon Arbeitstage", "7.5");
    setValue("bis (Enddatum verbindlich)", "2027-02-05");
    expect(workDays).toHaveValue(7.5);
  });

  it("zeigt blockierende Fehler aus validateWorkation und sperrt die Einreichung trotz Erklärungen", async () => {
    renderForm({ usedWorkDaysThisYear: 28 });
    await checkDeclarations();
    setStay("Spanien", "2027-02-01", "2027-02-05");

    expect(screen.getByText("Einreichung nicht möglich")).toBeInTheDocument();
    expect(
      screen.getByText(
        /Das Jahreskontingent von 30 Arbeitstagen wird überschritten: 28 Tage sind bereits verplant/
      )
    ).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();

    // Weniger Arbeitstage → Fehler weg, Einreichung möglich
    setValue("davon Arbeitstage", "2");
    expect(screen.queryByText("Einreichung nicht möglich")).not.toBeInTheDocument();
    expect(submitButton()).toBeEnabled();
  });

  it("blockiert Aufenthalte über dem Limit zusammenhängender Arbeitstage", async () => {
    renderForm({ consecutiveLimitDays: 20 });
    await checkDeclarations();
    // 01.02.–05.03.2027: 25 Arbeitstage
    setStay("Spanien", "2027-02-01", "2027-03-05");

    expect(
      screen.getByText(
        /höchstens 20 zusammenhängende Arbeitstage umfassen — dieser Antrag enthält 25 Arbeitstage/
      )
    ).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });

  it("zeigt Warnungen (90-Tage-Grenze, Jahreswechsel), ohne die Einreichung zu sperren", async () => {
    renderForm();
    await checkDeclarations();
    setStay("Spanien", "2026-12-28", "2027-01-08");
    setValue("Bisherige Tage in diesem Land (lfd. Kalenderjahr)", "85");

    expect(screen.getByText("Hinweise zur Prüfung")).toBeInTheDocument();
    expect(
      screen.getByText(/Plausibilitätswarnung: Mit diesem Aufenthalt ergeben sich 97 Tage/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/erstreckt sich über den Jahreswechsel/)
    ).toBeInTheDocument();
    expect(screen.queryByText("Einreichung nicht möglich")).not.toBeInTheDocument();
    expect(submitButton()).toBeEnabled();
  });

  it("aktiviert das Absenden erst, wenn alle sieben Erklärungen bestätigt sind", async () => {
    renderForm();
    setStay("Spanien", "2027-02-01", "2027-02-05");
    expect(screen.getByText(ERKLAERUNGEN_HINWEIS)).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(7);

    await checkDeclarations(6);
    expect(submitButton()).toBeDisabled();
    expect(screen.getByText(ERKLAERUNGEN_HINWEIS)).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("checkbox", { name: WORKATION_DECLARATIONS[6].text })
    );
    expect(submitButton()).toBeEnabled();
    expect(screen.queryByText(ERKLAERUNGEN_HINWEIS)).not.toBeInTheDocument();

    // Wieder abwählen sperrt erneut
    await userEvent.click(
      screen.getByRole("checkbox", { name: WORKATION_DECLARATIONS[0].text })
    );
    expect(submitButton()).toBeDisabled();
  });

  it("übergibt alle Angaben und Erklärungen als FormData", async () => {
    const user = userEvent.setup();
    renderForm();
    setStay("Thailand", "2027-02-01", "2027-02-05");
    await user.type(screen.getByLabelText("Aufenthaltsort (Stadt)"), "Bangkok");
    await user.type(
      screen.getByLabelText("Anschrift der Unterkunft"),
      "Sukhumvit Rd 1"
    );
    await user.type(
      screen.getByLabelText("Zeitzone / zugesagte Erreichbarkeit"),
      "MEZ+6"
    );
    await user.type(screen.getByLabelText("Notfallkontakt (Name)"), "Eva");
    await user.type(screen.getByLabelText("Notfallkontakt (Telefon)"), "0170");
    await user.type(
      screen.getByLabelText("Art des Visums / Aufenthaltstitels"),
      "Digital Nomad Visa"
    );
    await user.type(
      screen.getByLabelText(
        "Auslandskranken- und Rückholversicherung (Anbieter, Police)"
      ),
      "ADAC 123"
    );
    await user.type(screen.getByLabelText("Geplante Aufgaben"), "Konzeption");
    await user.type(
      screen.getByLabelText("Vertretungsregelung im Inland"),
      "Ben vertritt"
    );
    await checkDeclarations();

    await user.click(submitButton());

    await waitFor(() => expect(submitWorkationRequest).toHaveBeenCalledTimes(1));
    const fd = vi.mocked(submitWorkationRequest).mock.calls[0][0];
    expect(fd.get("country")).toBe("Thailand");
    expect(fd.get("city")).toBe("Bangkok");
    expect(fd.get("startDate")).toBe("2027-02-01");
    expect(fd.get("endDate")).toBe("2027-02-05");
    expect(fd.get("workDays")).toBe("5");
    expect(fd.get("vacationDays")).toBe("0");
    expect(fd.get("daysInCountryThisYear")).toBe("0");
    expect(fd.get("visaType")).toBe("Digital Nomad Visa");
    expect(fd.get("domesticSubstitution")).toBe("Ben vertritt");
    for (const d of WORKATION_DECLARATIONS) {
      expect(fd.get(d.key)).toBe("on");
    }
  });

  it("Korrekturmodus: übernimmt Vorgaben inkl. Erklärungen und manueller Arbeitstage", async () => {
    const user = userEvent.setup();
    renderForm({
      action: resubmitWorkationRequest.bind(null, "w-1"),
      submitLabel: "Korrigiert erneut einreichen",
      defaults: {
        country: "Portugal",
        city: "Lissabon",
        accommodationAddress: "Rua 1",
        startDate: "2027-02-01",
        endDate: "2027-02-05",
        workDays: 4,
        vacationDays: 1,
        daysInCountryThisYear: 10,
        timezoneAvailability: "WEZ",
        emergencyContactName: "Eva",
        emergencyContactPhone: "0170",
        visaType: "EU-Bürger",
        insuranceDetails: "ADAC",
        plannedTasks: "Doku",
        domesticSubstitution: "Ben",
        declResidence: true,
        declVisa: true,
        declWorkingTime: true,
        declDataProtection: true,
        declNoForbiddenActivities: true,
        declReportChanges: true,
        declCosts: true,
      },
    });

    expect(screen.getByText("EU / EWR / Schweiz")).toBeInTheDocument();
    expect(screen.getByLabelText("davon Arbeitstage")).toHaveValue(4);
    const submit = screen.getByRole("button", {
      name: "Korrigiert erneut einreichen",
    });
    expect(submit).toBeEnabled();

    await user.click(submit);

    await waitFor(() =>
      expect(resubmitWorkationRequest).toHaveBeenCalledTimes(1)
    );
    const [id, fd] = vi.mocked(resubmitWorkationRequest).mock.calls[0];
    expect(id).toBe("w-1");
    expect(fd.get("workDays")).toBe("4");
    expect(fd.get("vacationDays")).toBe("1");
    expect(fd.get("daysInCountryThisYear")).toBe("10");
  });

  it("zeigt einen Fehler-Toast, wenn die Action fehlschlägt", async () => {
    vi.mocked(submitWorkationRequest).mockRejectedValueOnce(
      new Error("Kontingent erschöpft.")
    );
    const user = userEvent.setup();
    renderForm({
      defaults: {
        country: "Spanien",
        city: "Madrid",
        accommodationAddress: "Calle 1",
        startDate: "2027-02-01",
        endDate: "2027-02-05",
        timezoneAvailability: "MEZ",
        emergencyContactName: "Eva",
        emergencyContactPhone: "0170",
        visaType: "EU-Bürger",
        insuranceDetails: "ADAC",
        plannedTasks: "Doku",
        domesticSubstitution: "Ben",
      },
    });
    await checkDeclarations();

    await user.click(submitButton());

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Kontingent erschöpft.")
    );
  });
});
