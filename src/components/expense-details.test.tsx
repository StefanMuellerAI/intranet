import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ExpenseItem, ExpenseReport, Receipt } from "@/db/schema";
import { ExpenseDetails } from "./expense-details";

const CREATED = new Date(2026, 7, 10);

function report(overrides: Partial<ExpenseReport> = {}): ExpenseReport {
  return {
    id: "report-1",
    userId: "user-1",
    status: "eingereicht",
    version: 1,
    destination: "Berlin",
    customerPurpose: "Haufe Akademie — Seminar KI im Vertrieb",
    departureDate: "2026-08-03",
    departureTime: "07:30",
    returnDate: "2026-08-05",
    returnTime: "19:15",
    isAbroad: false,
    ratesSnapshot: null,
    mealAllowanceCents: 5600,
    transportCents: 12990,
    carCents: 3600,
    lodgingCents: 18900,
    incidentalsCents: 450,
    employerSupplementCents: 0,
    totalCents: 41540,
    rejectionComment: null,
    decidedById: null,
    decidedAt: null,
    createdAt: CREATED,
    updatedAt: CREATED,
    ...overrides,
  };
}

let itemCounter = 0;
function item(
  kind: ExpenseItem["kind"],
  overrides: Partial<ExpenseItem> = {}
): ExpenseItem {
  itemCounter += 1;
  return {
    id: `item-${itemCounter}`,
    reportId: "report-1",
    kind,
    position: itemCounter,
    itemDate: null,
    absenceType: null,
    breakfastProvided: false,
    lunchProvided: false,
    dinnerProvided: false,
    grossCents: 0,
    reductionCents: 0,
    netCents: 0,
    description: null,
    amountCents: null,
    kilometers: null,
    passengers: null,
    createdAt: CREATED,
    ...overrides,
  };
}

function receipt(itemId: string | null, filename: string): Receipt {
  return {
    id: `receipt-${filename}`,
    reportId: "report-1",
    itemId,
    userId: "user-1",
    filename,
    contentType: "application/pdf",
    sizeBytes: 1024,
    blobUrl: `https://blob.example/${filename}`,
    createdAt: CREATED,
  };
}

/** Karte zu einer Überschrift (CardTitle) */
function card(title: string): HTMLElement {
  return screen
    .getByText(title, { selector: "[data-slot=card-title]" })
    .closest("[data-slot=card]") as HTMLElement;
}

function valueOf(scope: HTMLElement, label: string): HTMLElement {
  return within(scope).getByText(label, { selector: "dt" })
    .nextElementSibling as HTMLElement;
}

describe("ExpenseDetails", () => {
  it("zeigt die Reiseangaben mit deutschem Datum und Uhrzeit", () => {
    render(<ExpenseDetails report={report()} items={[]} receipts={[]} />);

    const trip = card("1. Angaben zur Reise");
    expect(valueOf(trip, "Reiseziel (Ort)")).toHaveTextContent(/^Berlin$/);
    expect(valueOf(trip, "Kunde / Anlass")).toHaveTextContent(
      "Haufe Akademie — Seminar KI im Vertrieb"
    );
    expect(valueOf(trip, "Abreise")).toHaveTextContent(/^03\.08\.2026, 07:30 Uhr$/);
    expect(valueOf(trip, "Rückkehr")).toHaveTextContent(/^05\.08\.2026, 19:15 Uhr$/);
    expect(screen.queryByText("Auslandsreise")).not.toBeInTheDocument();
  });

  it("kennzeichnet Auslandsreisen und weist auf vorläufige Sätze hin", () => {
    render(
      <ExpenseDetails
        report={report({ destination: "Wien", isAbroad: true })}
        items={[]}
        receipts={[]}
      />
    );

    expect(valueOf(card("1. Angaben zur Reise"), "Reiseziel (Ort)")).toHaveTextContent(
      /^Wien \(Ausland\)$/
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Auslandsreise");
    expect(alert).toHaveTextContent(
      "Länderspezifische BMF-Sätze sind nicht hinterlegt"
    );
  });

  it("listet die Verpflegungstage mit Mahlzeiten, Kürzung und Pauschale", () => {
    const items = [
      item("verpflegung", {
        itemDate: "2026-08-03",
        absenceType: "an_abreisetag",
        breakfastProvided: false,
        lunchProvided: true,
        dinnerProvided: false,
        grossCents: 1400,
        reductionCents: 560,
        netCents: 840,
      }),
      item("verpflegung", {
        itemDate: "2026-08-04",
        absenceType: "ganzer_tag",
        breakfastProvided: true,
        lunchProvided: false,
        dinnerProvided: true,
        grossCents: 2800,
        reductionCents: 1680,
        netCents: 1120,
      }),
      // ohne Datum und Abwesenheitsart
      item("verpflegung", { grossCents: 0, reductionCents: 0, netCents: 0 }),
    ];
    render(
      <ExpenseDetails
        report={report({ mealAllowanceCents: 1960 })}
        items={items}
        receipts={[]}
      />
    );

    const meals = card("2. Verpflegungspauschale");
    const rows = within(meals).getAllByRole("row").slice(1); // ohne Kopfzeile
    expect(rows).toHaveLength(3);

    const cells = (row: HTMLElement) =>
      within(row)
        .getAllByRole("cell")
        .map((c) => c.textContent?.replace(/\s+/g, " "));
    expect(cells(rows[0])).toEqual([
      "03.08.2026",
      "An-/Abreisetag",
      "nein",
      "ja",
      "nein",
      "14,00 €",
      "−5,60 €",
      "8,40 €",
    ]);
    expect(cells(rows[1])).toEqual([
      "04.08.2026",
      "ganzer Tag",
      "ja",
      "nein",
      "ja",
      "28,00 €",
      "−16,80 €",
      "11,20 €",
    ]);
    expect(cells(rows[2]).slice(0, 2)).toEqual(["—", "—"]);
    expect(meals).toHaveTextContent("Summe Verpflegung: 19,60 €");
  });

  it("zeigt Belegblöcke nur mit Positionen und verlinkt vorhandene Belege", () => {
    const train = item("fahrt", {
      itemDate: "2026-08-03",
      description: "Bahn Köln–Berlin",
      amountCents: 12990,
    });
    const taxi = item("fahrt", {
      itemDate: null,
      description: "Taxi Hotel",
      amountCents: null,
    });
    const parking = item("nebenkosten", {
      itemDate: "2026-08-04",
      description: "Parkhaus",
      amountCents: 450,
    });
    render(
      <ExpenseDetails
        report={report()}
        items={[train, taxi, parking]}
        receipts={[receipt(train.id, "bahnticket.pdf"), receipt(null, "sonstiges.pdf")]}
      />
    );

    expect(
      screen.queryByText("4. Übernachtung", { selector: "[data-slot=card-title]" })
    ).not.toBeInTheDocument();

    const transport = card("3. Fahrtkosten (Belege)");
    const [trainRow, taxiRow] = within(transport).getAllByRole("row").slice(1);
    expect(trainRow).toHaveTextContent("03.08.2026");
    expect(trainRow).toHaveTextContent("Bahn Köln–Berlin");
    expect(trainRow).toHaveTextContent("129,90 €");
    const link = within(trainRow).getByRole("link", { name: "bahnticket.pdf" });
    expect(link).toHaveAttribute("href", "/api/receipts/receipt-bahnticket.pdf");
    expect(link).toHaveAttribute("target", "_blank");

    expect(within(taxiRow).getAllByRole("cell")[0]).toHaveTextContent(/^—$/);
    expect(taxiRow).toHaveTextContent("Taxi Hotel");
    expect(taxiRow).toHaveTextContent("0,00 €");
    expect(taxiRow).toHaveTextContent("kein Beleg");
    expect(within(taxiRow).queryByRole("link")).not.toBeInTheDocument();

    const incidentals = card("5. Reisenebenkosten");
    expect(within(incidentals).getAllByRole("row")).toHaveLength(2);
    expect(incidentals).toHaveTextContent("Parkhaus");
    expect(incidentals).toHaveTextContent("4,50 €");
    expect(incidentals).toHaveTextContent("kein Beleg");
  });

  it("zeigt die Übernachtung, wenn eine Position vorhanden ist", () => {
    const hotel = item("uebernachtung", {
      itemDate: "2026-08-03",
      description: "Hotel am Hauptbahnhof",
      amountCents: 18900,
    });
    render(
      <ExpenseDetails
        report={report()}
        items={[hotel]}
        receipts={[receipt(hotel.id, "hotel.pdf")]}
      />
    );

    const lodging = card("4. Übernachtung");
    expect(lodging).toHaveTextContent("Hotel am Hauptbahnhof");
    expect(within(lodging).getByRole("link", { name: "hotel.pdf" })).toHaveAttribute(
      "href",
      "/api/receipts/receipt-hotel.pdf"
    );
    expect(
      screen.queryByText("3. Fahrtkosten (Belege)", {
        selector: "[data-slot=card-title]",
      })
    ).not.toBeInTheDocument();
  });

  it("zeigt den Privat-Pkw mit Kilometern und Mitfahrenden nur bei vorhandener Position", () => {
    const { unmount } = render(
      <ExpenseDetails report={report()} items={[]} receipts={[]} />
    );
    expect(
      screen.queryByText("Privat-Pkw", { selector: "[data-slot=card-title]" })
    ).not.toBeInTheDocument();
    unmount();

    const { unmount: unmount2 } = render(
      <ExpenseDetails
        report={report()}
        items={[item("pkw", { kilometers: 120, passengers: 2, netCents: 3840 })]}
        receipts={[]}
      />
    );
    expect(card("Privat-Pkw")).toHaveTextContent(
      "120 km, 2 mitgenommene Person(en) → 38,40 €"
    );
    unmount2();

    render(
      <ExpenseDetails
        report={report()}
        items={[item("pkw", { kilometers: 80, passengers: 0, netCents: 2400 })]}
        receipts={[]}
      />
    );
    const car = card("Privat-Pkw");
    expect(car).toHaveTextContent("80 km → 24,00 €");
    expect(car).not.toHaveTextContent("mitgenommene");
  });

  it("fasst den Erstattungsbetrag zusammen und zählt die Belege", () => {
    render(
      <ExpenseDetails
        report={report()}
        items={[]}
        receipts={[receipt(null, "a.pdf"), receipt(null, "b.pdf")]}
      />
    );

    const total = card("6. Erstattungsbetrag");
    expect(valueOf(total, "Verpflegungspauschale (steuerfrei)")).toHaveTextContent(
      /^56,00 €$/
    );
    expect(valueOf(total, "Fahrtkosten (Belege)")).toHaveTextContent(/^129,90 €$/);
    expect(valueOf(total, "Fahrtkosten Privat-Pkw")).toHaveTextContent(/^36,00 €$/);
    expect(valueOf(total, "Übernachtung")).toHaveTextContent(/^189,00 €$/);
    expect(valueOf(total, "Reisenebenkosten")).toHaveTextContent(/^4,50 €$/);
    expect(valueOf(total, "Gesamterstattung")).toHaveTextContent(/^415,40 €$/);
    expect(
      within(total).queryByText("Arbeitgeber-Zuschlag (pauschal versteuert)")
    ).not.toBeInTheDocument();
    expect(total).toHaveTextContent("Beleganzahl: 2 (ergibt sich aus den Uploads)");
  });

  it("weist einen Arbeitgeber-Zuschlag nur aus, wenn er größer als null ist", () => {
    render(
      <ExpenseDetails
        report={report({ employerSupplementCents: 1200, totalCents: 42740 })}
        items={[]}
        receipts={[]}
      />
    );

    const total = card("6. Erstattungsbetrag");
    expect(
      valueOf(total, "Arbeitgeber-Zuschlag (pauschal versteuert)")
    ).toHaveTextContent(/^12,00 €$/);
    expect(valueOf(total, "Gesamterstattung")).toHaveTextContent(/^427,40 €$/);
    expect(total).toHaveTextContent("Beleganzahl: 0");
  });
});
