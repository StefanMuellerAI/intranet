import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CalendarAbsence } from "@/lib/absences";
import { DashboardBriefing } from "./dashboard-briefing";

const TODAY = "2026-10-08";
const RANGE_END = "2026-10-22";

function absence(
  type: CalendarAbsence["type"],
  userName: string,
  from: string,
  to: string
): CalendarAbsence {
  return { userId: `id-${userName}`, userName, type, from, to };
}

function briefingText(): string {
  return screen.getByText(/./, { selector: "p" }).textContent ?? "";
}

describe("DashboardBriefing", () => {
  it("zeigt Überschrift und einen Link zum Kalender", () => {
    render(<DashboardBriefing absences={[]} todayISO={TODAY} rangeEndISO={RANGE_END} />);

    expect(screen.getByText("Kurzbriefing · Die nächsten 2 Wochen")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zum Kalender" })).toHaveAttribute(
      "href",
      "/kalender"
    );
  });

  it("meldet ohne Einträge, dass nichts ansteht", () => {
    render(<DashboardBriefing absences={[]} todayISO={TODAY} rangeEndISO={RANGE_END} />);

    expect(briefingText()).toBe(
      "In den nächsten zwei Wochen stehen keine Abwesenheiten, Geburtstage oder Teamevents an."
    );
  });

  it("fasst die Einträge der nächsten zwei Wochen als Fließtext zusammen", () => {
    render(
      <DashboardBriefing
        absences={[
          absence("geburtstag", "Ben Beispiel", "2026-10-15", "2026-10-15"),
          absence("urlaub", "Anna Muster", "2026-10-12", "2026-10-16"),
          // offene Krankmeldung: Ende = Bereichsende
          absence("abwesend", "Carla Krank", "2026-10-06", RANGE_END),
          // bereits beendet — taucht nicht auf
          absence("urlaub", "Dora Vorbei", "2026-10-01", "2026-10-07"),
        ]}
        todayISO={TODAY}
        rangeEndISO={RANGE_END}
      />
    );

    expect(briefingText()).toBe(
      "Anna Muster ist vom 12.10. bis 16.10. im Urlaub. " +
        "Carla Krank ist seit dem 06.10. abwesend. " +
        "Ben Beispiel hat am 15.10. Geburtstag."
    );
  });
});
