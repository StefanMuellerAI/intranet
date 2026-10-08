import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { WorkationRequest } from "@/db/schema";
import { WORKATION_DECLARATIONS } from "@/lib/workation/validate";
import { WorkationDetails } from "./workation-details";

const CREATED = new Date(2026, 6, 1);

function request(overrides: Partial<WorkationRequest> = {}): WorkationRequest {
  return {
    id: "workation-1",
    userId: "user-1",
    status: "eingereicht",
    version: 1,
    country: "Spanien",
    countryCategory: "eu_ewr_ch",
    city: "Valencia",
    accommodationAddress: "Calle Mayor 1",
    startDate: "2026-09-01",
    endDate: "2026-09-12",
    workDays: 9,
    vacationDays: 0,
    timezoneAvailability: "10–16 Uhr MEZ",
    daysInCountryThisYear: 14,
    emergencyContactName: "Erika Muster",
    emergencyContactPhone: "+49 221 123456",
    visaType: "kein Visum erforderlich",
    visaValidUntil: null,
    insuranceDetails: "Auslandskranken XYZ, Police 4711",
    proofProvidedAt: null,
    plannedTasks: "Konzeption Schulungsunterlagen",
    excludedProjects: null,
    domesticSubstitution: "Ben Beispiel",
    declResidence: true,
    declVisa: true,
    declWorkingTime: true,
    declDataProtection: true,
    declNoForbiddenActivities: true,
    declReportChanges: true,
    declCosts: true,
    a1Status: null,
    rejectionComment: null,
    decidedById: null,
    decidedAt: null,
    createdAt: CREATED,
    updatedAt: CREATED,
    ...overrides,
  };
}

function card(title: string): HTMLElement {
  return screen
    .getByText(title, { selector: "[data-slot=card-title]" })
    .closest("[data-slot=card]") as HTMLElement;
}

function queryCard(title: string): HTMLElement | null {
  return screen.queryByText(title, { selector: "[data-slot=card-title]" });
}

function valueOf(scope: HTMLElement, label: string): HTMLElement {
  return within(scope).getByText(label, { selector: "dt" })
    .nextElementSibling as HTMLElement;
}

const A1_PANEL = "A1-relevante Daten (Übertrag SV-Meldeportal / Lohnabrechnung)";

describe("WorkationDetails", () => {
  it("zeigt Person, Aufenthalt und Zeitraum mit deutschem Datum", () => {
    render(<WorkationDetails request={request()} applicantName="Max Mitarbeiter" />);

    const stay = card("Angaben zur Person und zum Aufenthalt");
    expect(valueOf(stay, "Name, Vorname")).toHaveTextContent(/^Max Mitarbeiter$/);
    expect(valueOf(stay, "Zielland")).toHaveTextContent(/^Spanien\s*EU\/EWR\/Schweiz$/);
    expect(valueOf(stay, "Aufenthaltsort (Stadt)")).toHaveTextContent(/^Valencia$/);
    expect(valueOf(stay, "Anschrift der Unterkunft")).toHaveTextContent(
      /^Calle Mayor 1$/
    );
    expect(valueOf(stay, "Zeitraum (Enddatum verbindlich)")).toHaveTextContent(
      /^01\.09\.2026 – 12\.09\.2026$/
    );
    expect(valueOf(stay, "davon Arbeitstage")).toHaveTextContent(/^9$/);
    // 0 Urlaubstage werden als "0" angezeigt, nicht als Gedankenstrich
    expect(valueOf(stay, "davon beantragte Urlaubstage")).toHaveTextContent(/^0$/);
    expect(valueOf(stay, "Zeitzone / Erreichbarkeit")).toHaveTextContent(
      /^10–16 Uhr MEZ$/
    );
    expect(
      valueOf(stay, "Bisherige Tage in diesem Land (lfd. Jahr)")
    ).toHaveTextContent(/^14$/);
    expect(valueOf(stay, "Notfallkontakt")).toHaveTextContent(
      /^Erika Muster, \+49 221 123456$/
    );

    const activity = card("Tätigkeit im Aufenthaltszeitraum");
    expect(valueOf(activity, "Geplante Aufgaben")).toHaveTextContent(
      /^Konzeption Schulungsunterlagen$/
    );
    expect(valueOf(activity, "Vertretungsregelung im Inland")).toHaveTextContent(
      /^Ben Beispiel$/
    );
  });

  it("zeigt Platzhalter für noch fehlende Nachweise, Visum-Datum und Ausschlüsse", () => {
    render(
      <WorkationDetails
        request={request({ timezoneAvailability: "" })}
        applicantName="Max Mitarbeiter"
      />
    );

    const legal = card("Aufenthaltsrecht und Versicherung");
    expect(valueOf(legal, "Art des Visums / Aufenthaltstitels")).toHaveTextContent(
      /^kein Visum erforderlich$/
    );
    expect(valueOf(legal, "gültig bis")).toHaveTextContent(/^—$/);
    expect(valueOf(legal, "Versicherung (Anbieter, Police)")).toHaveTextContent(
      /^Auslandskranken XYZ, Police 4711$/
    );
    expect(valueOf(legal, "Nachweise vorgelegt am")).toHaveTextContent(
      /^noch nicht vorgelegt$/
    );
    expect(
      valueOf(
        card("Tätigkeit im Aufenthaltszeitraum"),
        "Ausgeschlossene Projekte / Mandate (EU-Beschränkung)"
      )
    ).toHaveTextContent(/^—$/);
    // Leere Werte fallen auf den Gedankenstrich zurück
    expect(
      valueOf(card("Angaben zur Person und zum Aufenthalt"), "Zeitzone / Erreichbarkeit")
    ).toHaveTextContent(/^—$/);
  });

  it("formatiert gepflegte Daten zu Visum und Nachweisen und zeigt Ausschlüsse", () => {
    render(
      <WorkationDetails
        request={request({
          visaValidUntil: "2027-03-31",
          proofProvidedAt: "2026-08-15",
          excludedProjects: "Mandat Stadtwerke Valencia",
        })}
        applicantName="Max Mitarbeiter"
      />
    );

    const legal = card("Aufenthaltsrecht und Versicherung");
    expect(valueOf(legal, "gültig bis")).toHaveTextContent(/^31\.03\.2027$/);
    expect(valueOf(legal, "Nachweise vorgelegt am")).toHaveTextContent(
      /^15\.08\.2026$/
    );
    expect(
      valueOf(
        card("Tätigkeit im Aufenthaltszeitraum"),
        "Ausgeschlossene Projekte / Mandate (EU-Beschränkung)"
      )
    ).toHaveTextContent(/^Mandat Stadtwerke Valencia$/);
  });

  it("listet alle bestätigten Erklärungen", () => {
    render(<WorkationDetails request={request()} applicantName="Max Mitarbeiter" />);

    const items = within(card("Bestätigte Erklärungen")).getAllByRole("listitem");
    expect(items).toHaveLength(WORKATION_DECLARATIONS.length);
    WORKATION_DECLARATIONS.forEach((declaration, i) => {
      expect(items[i]).toHaveTextContent(declaration.text);
    });
  });

  it("EU/EWR/CH: zeigt den A1-Status (ohne Status: „nicht beantragt“)", () => {
    const { unmount } = render(
      <WorkationDetails request={request({ a1Status: null })} applicantName="Max" />
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "A1-Bescheinigung: nicht beantragt"
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "die Gesellschaft beantragt die A1-Bescheinigung"
    );
    expect(screen.queryByText(/^Drittstaat/)).not.toBeInTheDocument();
    unmount();

    const { unmount: unmount2 } = render(
      <WorkationDetails request={request({ a1Status: "beantragt" })} applicantName="Max" />
    );
    expect(screen.getByRole("alert")).toHaveTextContent("A1-Bescheinigung: beantragt");
    unmount2();

    render(
      <WorkationDetails request={request({ a1Status: "liegt_vor" })} applicantName="Max" />
    );
    expect(screen.getByRole("alert")).toHaveTextContent("A1-Bescheinigung: liegt vor");
  });

  it("Drittstaat: kennzeichnet das Land und verlangt eine gesonderte Prüfung", () => {
    render(
      <WorkationDetails
        request={request({
          country: "Thailand",
          countryCategory: "drittstaat",
          city: "Bangkok",
        })}
        applicantName="Max Mitarbeiter"
        showA1Panel
      />
    );

    expect(
      valueOf(card("Angaben zur Person und zum Aufenthalt"), "Zielland")
    ).toHaveTextContent(/^Thailand\s*Drittstaat$/);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Drittstaat — gesonderte Prüfung erforderlich");
    expect(alert).not.toHaveTextContent("A1-Bescheinigung");
    // Die A1-Kompaktansicht gibt es nur für EU/EWR/CH
    expect(queryCard(A1_PANEL)).not.toBeInTheDocument();
  });

  it("zeigt die A1-Kompaktansicht nur auf Wunsch", () => {
    const { unmount } = render(
      <WorkationDetails request={request()} applicantName="Max Mitarbeiter" />
    );
    expect(queryCard(A1_PANEL)).not.toBeInTheDocument();
    unmount();

    render(
      <WorkationDetails request={request()} applicantName="Max Mitarbeiter" showA1Panel />
    );
    const panel = card(A1_PANEL);
    expect(valueOf(panel, "Person")).toHaveTextContent(/^Max Mitarbeiter$/);
    expect(valueOf(panel, "Beschäftigungsstaat")).toHaveTextContent(/^Spanien$/);
    expect(valueOf(panel, "Entsendezeitraum")).toHaveTextContent(
      /^01\.09\.2026 – 12\.09\.2026$/
    );
    expect(valueOf(panel, "Anschrift im Ausland")).toHaveTextContent(
      /^Calle Mayor 1, Valencia, Spanien$/
    );
  });
});
