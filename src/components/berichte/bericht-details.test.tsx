import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SeminarReport, SeminarReportQuote } from "@/db";
import { BerichtDetails } from "./bericht-details";

const CREATED = new Date(2026, 8, 20);

function report(overrides: Partial<SeminarReport> = {}): SeminarReport {
  return {
    id: "bericht-1",
    userId: "user-1",
    kind: "seminar",
    customerName: "dbb akademie",
    title: "KI im Verwaltungsalltag",
    eventDate: "2026-09-18",
    durationDays: 1,
    whatWentWell: "Gute Beteiligung.\nViele Praxisfragen.",
    whatWentBadly: "Beamer fiel aus.",
    improvements: "Ersatzgerät mitnehmen.",
    feedbackRating: 4,
    quoteQuestion: null,
    createdAt: CREATED,
    updatedAt: CREATED,
    ...overrides,
  };
}

function quote(
  id: string,
  text: string,
  websiteApproved = false
): SeminarReportQuote {
  return {
    id,
    reportId: "bericht-1",
    position: 0,
    quote: text,
    websiteApproved,
    createdAt: CREATED,
  };
}

function card(title: string | RegExp): HTMLElement {
  return screen
    .getByText(title, { selector: "[data-slot=card-title]" })
    .closest("[data-slot=card]") as HTMLElement;
}

function valueOf(scope: HTMLElement, label: string): HTMLElement {
  return within(scope).getByText(label, { selector: "dt" })
    .nextElementSibling as HTMLElement;
}

describe("BerichtDetails", () => {
  it("zeigt die Angaben zur Veranstaltung mit Labels und deutschem Datum", () => {
    render(<BerichtDetails report={report()} quotes={[]} />);

    const event = card("Angaben zur Veranstaltung");
    expect(valueOf(event, "Art")).toHaveTextContent(/^Seminar$/);
    expect(valueOf(event, "Titel")).toHaveTextContent(/^KI im Verwaltungsalltag$/);
    expect(valueOf(event, "Kunde / Organisation")).toHaveTextContent(/^dbb akademie$/);
    expect(valueOf(event, "Datum")).toHaveTextContent(/^18\.09\.2026$/);
    expect(valueOf(event, "Dauer")).toHaveTextContent(/^1 Tag$/);
    expect(valueOf(event, "Feedback der Teilnehmenden")).toHaveTextContent(
      /^4 — gut$/
    );
  });

  it("nennt die Person nur in der Lesesicht fremder Berichte", () => {
    const { unmount } = render(<BerichtDetails report={report()} quotes={[]} />);
    expect(screen.queryByText("Mitarbeiter/in")).not.toBeInTheDocument();
    unmount();

    render(
      <BerichtDetails report={report()} quotes={[]} userName="Anna Muster" />
    );
    expect(
      valueOf(card("Angaben zur Veranstaltung"), "Mitarbeiter/in")
    ).toHaveTextContent(/^Anna Muster$/);
  });

  it("formatiert Beratung, halbe und mehrere Tage sowie die Feedback-Skala", () => {
    const { unmount } = render(
      <BerichtDetails
        report={report({ kind: "beratung", durationDays: 0.5, feedbackRating: 1 })}
        quotes={[]}
      />
    );
    let event = card("Angaben zur Veranstaltung");
    expect(valueOf(event, "Art")).toHaveTextContent(/^Beratung$/);
    expect(valueOf(event, "Dauer")).toHaveTextContent(/^0,5 Tage$/);
    expect(valueOf(event, "Feedback der Teilnehmenden")).toHaveTextContent(
      /^1 — sehr schlecht$/
    );
    unmount();

    render(
      <BerichtDetails
        report={report({ durationDays: 2, feedbackRating: 5 })}
        quotes={[]}
      />
    );
    event = card("Angaben zur Veranstaltung");
    expect(valueOf(event, "Dauer")).toHaveTextContent(/^2 Tage$/);
    expect(valueOf(event, "Feedback der Teilnehmenden")).toHaveTextContent(
      /^5 — sehr gut$/
    );
  });

  it("zeigt den Rückblick mit erhaltenen Zeilenumbrüchen", () => {
    render(<BerichtDetails report={report()} quotes={[]} />);

    const review = card("Rückblick");
    const good = valueOf(review, "Was lief gut?");
    expect(good.textContent).toBe("Gute Beteiligung.\nViele Praxisfragen.");
    expect(good).toHaveClass("whitespace-pre-wrap");
    expect(valueOf(review, "Was lief nicht gut?")).toHaveTextContent(
      /^Beamer fiel aus\.$/
    );
    expect(
      valueOf(review, "Was möchten Sie beim nächsten Mal verbessern?")
    ).toHaveTextContent(/^Ersatzgerät mitnehmen\.$/);
  });

  it("ohne Zitate: Hinweis statt Liste und keine Frage", () => {
    render(<BerichtDetails report={report()} quotes={[]} />);

    const quotes = card("Zitate von Teilnehmenden (0)");
    expect(quotes).toHaveTextContent("Zu diesem Bericht wurden keine Zitate erfasst.");
    expect(within(quotes).queryByRole("list")).not.toBeInTheDocument();
    expect(within(quotes).queryByText("Gestellte Frage")).not.toBeInTheDocument();
  });

  it("listet Zitate in Anführungszeichen mit Frage und Website-Freigabe", () => {
    render(
      <BerichtDetails
        report={report({ quoteQuestion: "Was nehmen Sie mit?" })}
        quotes={[
          quote("q1", "Endlich verständlich erklärt!", true),
          quote("q2", "Mehr Pausen wären schön."),
        ]}
      />
    );

    const quotes = card("Zitate von Teilnehmenden (2)");
    expect(valueOf(quotes, "Gestellte Frage")).toHaveTextContent(
      /^Was nehmen Sie mit\?$/
    );
    expect(quotes).not.toHaveTextContent("keine Zitate erfasst");

    const items = within(quotes).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("„Endlich verständlich erklärt!“");
    expect(items[0]).toHaveTextContent("für Website freigegeben");
    expect(items[1]).toHaveTextContent("„Mehr Pausen wären schön.“");
    expect(items[1]).not.toHaveTextContent("für Website freigegeben");
  });
});
