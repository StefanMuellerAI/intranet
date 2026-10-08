import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CommissionClaim } from "@/db";
import { CommissionDetails } from "./commission-details";

function claim(overrides: Partial<CommissionClaim> = {}): CommissionClaim {
  return {
    id: "claim-1",
    userId: "user-1",
    status: "eingereicht",
    version: 1,
    businessType: "schulung",
    customerType: "bestandskunde",
    customerName: "Haufe Akademie",
    orderDate: "2026-09-15",
    unit: "tage",
    quantity: 3,
    trainingFormat: "ganztaegig",
    trainingCount: 3,
    netOrderValueCents: null,
    note: "Folgeauftrag aus dem Frühjahrsseminar",
    ratesSnapshot: null,
    calculatedAmountCents: 22500,
    referralBonusCents: null,
    finalAmountCents: 22500,
    rejectionComment: null,
    decidedById: null,
    decidedAt: null,
    createdAt: new Date(2026, 8, 16),
    updatedAt: new Date(2026, 8, 16),
    ...overrides,
  };
}

/** Wert (<dd>) zu einer Beschriftung (<dt>) */
function valueOf(label: string): HTMLElement {
  const dt = screen.getByText(label, { selector: "dt" });
  return dt.nextElementSibling as HTMLElement;
}

function hasLabel(label: string): boolean {
  return screen.queryByText(label, { selector: "dt" }) !== null;
}

describe("CommissionDetails", () => {
  it("zeigt die Stammdaten einer Schulung mit Labels und deutschem Datum", () => {
    render(<CommissionDetails claim={claim()} />);

    expect(screen.getByText("Angaben zum Folgegeschäft")).toBeInTheDocument();
    expect(valueOf("Art")).toHaveTextContent(/^Schulung$/);
    expect(valueOf("Kundenart")).toHaveTextContent(/^Bestandskunde$/);
    expect(valueOf("Kunde / Organisation")).toHaveTextContent(/^Haufe Akademie$/);
    expect(valueOf("Datum der Bestellung")).toHaveTextContent(/^15\.09\.2026$/);
    expect(valueOf("Umfang")).toHaveTextContent(/^3 Tage$/);
    expect(valueOf("Trainings")).toHaveTextContent(/^3 × ganztägig$/);
    expect(valueOf("Berechneter Anspruch")).toHaveTextContent(/^225,00 €$/);
    expect(valueOf("Finaler Betrag")).toHaveTextContent(/^225,00 €$/);
    expect(valueOf("Bemerkung")).toHaveTextContent(
      /^Folgeauftrag aus dem Frühjahrsseminar$/
    );
  });

  it("Schulung: blendet den Nettoauftragswert aus, Beratung die Trainings", () => {
    const { unmount } = render(<CommissionDetails claim={claim()} />);
    expect(hasLabel("Trainings")).toBe(true);
    expect(hasLabel("Nettoauftragswert")).toBe(false);
    unmount();

    render(
      <CommissionDetails
        claim={claim({
          businessType: "beratung",
          unit: "liefergegenstaende",
          quantity: 2,
          trainingFormat: null,
          trainingCount: null,
          netOrderValueCents: 1234567,
          calculatedAmountCents: 49383,
          finalAmountCents: 50000,
        })}
      />
    );
    expect(valueOf("Art")).toHaveTextContent(/^Beratung$/);
    expect(valueOf("Umfang")).toHaveTextContent(/^2 Liefergegenstände$/);
    expect(hasLabel("Trainings")).toBe(false);
    expect(valueOf("Nettoauftragswert")).toHaveTextContent(/^12\.345,67 €$/);
    expect(valueOf("Berechneter Anspruch")).toHaveTextContent(/^493,83 €$/);
    expect(valueOf("Finaler Betrag")).toHaveTextContent(/^500,00 €$/);
  });

  it("zeigt die Vermittlungsprovision nur bei Neukunden", () => {
    const { unmount } = render(
      <CommissionDetails claim={claim({ customerType: "bestandskunde" })} />
    );
    expect(hasLabel("Vermittlungsprovision (Einzelfall)")).toBe(false);
    unmount();

    render(
      <CommissionDetails
        claim={claim({ customerType: "neukunde", referralBonusCents: 15000 })}
      />
    );
    expect(valueOf("Kundenart")).toHaveTextContent(/^Neukunde$/);
    expect(valueOf("Vermittlungsprovision (Einzelfall)")).toHaveTextContent(
      /^150,00 €$/
    );
  });

  it("Neukunde ohne festgelegte Vermittlungsprovision: „noch nicht festgelegt“", () => {
    render(
      <CommissionDetails
        claim={claim({ customerType: "neukunde", referralBonusCents: null })}
      />
    );
    expect(valueOf("Vermittlungsprovision (Einzelfall)")).toHaveTextContent(
      /^noch nicht festgelegt$/
    );
  });

  it("abweichendes Schulungsformat ohne Berechnung und ohne Endbetrag", () => {
    render(
      <CommissionDetails
        claim={claim({
          trainingFormat: "abweichend",
          trainingCount: 1,
          calculatedAmountCents: null,
          finalAmountCents: null,
        })}
      />
    );
    expect(valueOf("Trainings")).toHaveTextContent(
      /^1 × abweichendes Format \(Pauschale\)$/
    );
    expect(valueOf("Berechneter Anspruch")).toHaveTextContent(
      /^individuell zu vereinbaren$/
    );
    expect(valueOf("Finaler Betrag")).toHaveTextContent(/^noch offen$/);
  });

  it("zeigt Gedankenstriche für fehlende Angaben", () => {
    const { unmount } = render(
      <CommissionDetails
        claim={claim({ trainingCount: null, trainingFormat: null, note: null })}
      />
    );
    expect(valueOf("Trainings")).toHaveTextContent(/^— × —$/);
    expect(valueOf("Bemerkung")).toHaveTextContent(/^—$/);
    unmount();

    render(
      <CommissionDetails
        claim={claim({
          businessType: "beratung",
          trainingFormat: null,
          trainingCount: null,
          netOrderValueCents: null,
          note: "",
        })}
      />
    );
    expect(valueOf("Nettoauftragswert")).toHaveTextContent(/^—$/);
    expect(valueOf("Bemerkung")).toHaveTextContent(/^—$/);
  });
});
