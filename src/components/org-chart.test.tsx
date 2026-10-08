import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OrgChart, type OrgChartNode } from "./org-chart";

// Layout-Konstanten der Komponente: Knoten 168×56, Abstand 28 horizontal,
// 72 vertikal → Ebenenabstand 128.
const DISCIPLINARY = "#334155";
const TECHNICAL = "#d97706";

function person(
  id: string,
  name: string,
  supervisors: { technical?: string; disciplinary?: string } = {},
  isManagingDirector = false
): OrgChartNode {
  return {
    id,
    name,
    isManagingDirector,
    technicalSupervisorId: supervisors.technical ?? null,
    disciplinarySupervisorId: supervisors.disciplinary ?? null,
  };
}

function renderChart(nodes: OrgChartNode[], currentUserId = "niemand") {
  return render(<OrgChart nodes={nodes} currentUserId={currentUserId} />);
}

/** Kasten eines Knotens im Diagramm */
function chartNode(name: string): HTMLElement {
  return screen.getByText(name, { selector: "span" }).parentElement as HTMLElement;
}

function position(name: string) {
  const el = chartNode(name);
  return { left: el.style.left, top: el.style.top };
}

/** Namen je Ebene (nach top gruppiert, innerhalb nach left sortiert) */
function levels(container: HTMLElement): string[][] {
  const boxes = Array.from(
    container.querySelectorAll<HTMLElement>("div.absolute")
  ).map((el) => ({
    name: el.querySelector("span")?.textContent ?? "",
    top: parseFloat(el.style.top),
    left: parseFloat(el.style.left),
  }));
  const tops = [...new Set(boxes.map((b) => b.top))].sort((a, b) => a - b);
  return tops.map((top) =>
    boxes
      .filter((b) => b.top === top)
      .sort((a, b) => a.left - b.left)
      .map((b) => b.name)
  );
}

function edges(container: HTMLElement) {
  return Array.from(container.querySelectorAll("svg path")).map((p) => ({
    d: p.getAttribute("d"),
    stroke: p.getAttribute("stroke"),
    dashed: p.getAttribute("stroke-dasharray") === "6 4",
  }));
}

function unassignedList(): HTMLElement {
  const heading = screen.getByRole("heading", { name: "Ohne Zuordnung" });
  return within(heading.parentElement as HTMLElement).getByRole("list");
}

// GF → Anna (fachlich + disziplinarisch), Ben (disz. GF, fachlich Anna);
// Carla fachlich unter Anna, Dora disziplinarisch unter Ben.
const TEAM = [
  person("gf", "Stefan Chef", {}, true),
  person("anna", "Anna Muster", { technical: "gf", disciplinary: "gf" }),
  person("ben", "Ben Beispiel", { technical: "anna", disciplinary: "gf" }),
  person("carla", "Carla Klein", { technical: "anna" }),
  person("dora", "Dora Neu", { disciplinary: "ben" }),
];

describe("OrgChart", () => {
  it("zeigt ohne Mitarbeitende nur Legende und Leerhinweis", () => {
    const { container } = renderChart([]);

    expect(screen.getByText("Disziplinarisch")).toBeInTheDocument();
    expect(screen.getByText("Fachlich")).toBeInTheDocument();
    expect(
      screen.getByText("Doppelstrich = fachlich und disziplinarisch dieselbe Person")
    ).toBeInTheDocument();
    expect(screen.getByText("Noch keine Mitarbeitenden vorhanden.")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeNull();
    expect(screen.queryByText("Ohne Zuordnung")).not.toBeInTheDocument();
  });

  it("ordnet die Personen nach Berichtsweg in Ebenen an und zentriert jede Ebene", () => {
    const { container } = renderChart(TEAM);

    expect(levels(container)).toEqual([
      ["Stefan Chef"],
      ["Anna Muster", "Ben Beispiel"],
      ["Carla Klein", "Dora Neu"],
    ]);
    // breiteste Ebene: 2 × 168 + 28 = 364 → GF mittig bei (364 − 168) / 2
    expect(position("Stefan Chef")).toEqual({ left: "98px", top: "0px" });
    expect(position("Anna Muster")).toEqual({ left: "0px", top: "128px" });
    expect(position("Ben Beispiel")).toEqual({ left: "196px", top: "128px" });
    expect(position("Carla Klein")).toEqual({ left: "0px", top: "256px" });
    expect(position("Dora Neu")).toEqual({ left: "196px", top: "256px" });

    // Höhe: 3 Ebenen × 56 + 2 × 72
    const svg = container.querySelector("svg") as SVGSVGElement;
    expect(svg).toHaveAttribute("width", "364");
    expect(svg).toHaveAttribute("height", "312");
    const canvas = svg.parentElement as HTMLElement;
    expect(canvas.style.width).toBe("364px");
    expect(canvas.style.height).toBe("312px");
    expect(screen.queryByText("Noch keine Mitarbeitenden vorhanden.")).not.toBeInTheDocument();
  });

  it("zeichnet disziplinarische Linien durchgezogen, fachliche gestrichelt und gleiche Person doppelt", () => {
    const { container } = renderChart(TEAM);

    expect(edges(container)).toEqual([
      // Anna → GF: fachlich und disziplinarisch → zwei parallel versetzte Linien
      { d: "M 81 128 C 81 92, 179 92, 179 56", stroke: DISCIPLINARY, dashed: false },
      { d: "M 87 128 C 87 92, 185 92, 185 56", stroke: TECHNICAL, dashed: true },
      // Ben → GF disziplinarisch, Ben → Anna fachlich
      { d: "M 280 128 C 280 92, 182 92, 182 56", stroke: DISCIPLINARY, dashed: false },
      { d: "M 280 128 C 280 156, 84 156, 84 184", stroke: TECHNICAL, dashed: true },
      // Carla → Anna fachlich
      { d: "M 84 256 C 84 220, 84 220, 84 184", stroke: TECHNICAL, dashed: true },
      // Dora → Ben disziplinarisch
      { d: "M 280 256 C 280 220, 280 220, 280 184", stroke: DISCIPLINARY, dashed: false },
    ]);
  });

  it("sortiert innerhalb einer Ebene nach deutschem Alphabet", () => {
    const { container } = renderChart([
      person("z", "Zoe Zander", { disciplinary: "gf" }),
      person("oe", "Özlem Yilmaz", { disciplinary: "gf" }),
      person("gf", "Stefan Chef", {}, true),
      person("o", "Oskar Berg", { disciplinary: "gf" }),
    ]);

    // Umlaut wird wie der Grundbuchstabe einsortiert, nicht hinter Z
    expect(levels(container)).toEqual([
      ["Stefan Chef"],
      ["Oskar Berg", "Özlem Yilmaz", "Zoe Zander"],
    ]);
  });

  it("kennzeichnet nur die Geschäftsführung mit einem Badge", () => {
    renderChart(TEAM);

    expect(screen.getAllByText("Geschäftsführung")).toHaveLength(1);
    expect(chartNode("Stefan Chef")).toHaveTextContent("Geschäftsführung");
    expect(chartNode("Anna Muster")).not.toHaveTextContent("Geschäftsführung");
  });

  it("führt Personen ohne (aktive) Vorgesetzte unter „Ohne Zuordnung“, die Geschäftsführung bleibt im Diagramm", () => {
    const { container } = renderChart([
      person("gf", "Stefan Chef", {}, true),
      person("anna", "Anna Muster", { disciplinary: "gf" }),
      person("zeno", "Zeno Solo"),
      // Vorgesetzte/r nicht (mehr) in der Liste, z. B. deaktiviert
      person("bea", "Bea Verwaist", { technical: "weg-1", disciplinary: "weg-2" }),
      person("emil", "Emil Ehemals", { disciplinary: "weg-1" }),
    ]);

    expect(levels(container)).toEqual([["Stefan Chef"], ["Anna Muster"]]);
    expect(
      within(unassignedList())
        .getAllByRole("listitem")
        .map((li) => li.textContent)
    ).toEqual(["Bea Verwaist", "Emil Ehemals", "Zeno Solo"]);
    // Kanten nur innerhalb des Diagramms
    expect(edges(container)).toHaveLength(1);
  });

  it("Vorgesetzte ohne eigene Vorgesetzte bleiben mit ihren Berichtslinien im Diagramm", () => {
    const { container } = renderChart([
      person("gf", "Stefan Chef", {}, true),
      // Teamleitung ohne eingetragene Vorgesetzte, aber mit Berichten
      person("tl", "Tina Leitung"),
      person("max", "Max Mitarbeiter", { disciplinary: "tl" }),
      person("nina", "Nina Neu", { technical: "tl" }),
      // Vorgesetzte/r deaktiviert, selbst aber Vorgesetzte/r
      person("olaf", "Olaf Oben", { disciplinary: "weg" }),
      person("pia", "Pia Praktikum", { technical: "olaf", disciplinary: "olaf" }),
    ]);

    expect(levels(container)).toEqual([
      ["Olaf Oben", "Stefan Chef", "Tina Leitung"],
      ["Max Mitarbeiter", "Nina Neu", "Pia Praktikum"],
    ]);
    expect(screen.queryByText("Ohne Zuordnung")).not.toBeInTheDocument();
    // Max und Nina je eine Linie, Pia (fachlich + disziplinarisch) eine Doppellinie
    expect(edges(container)).toHaveLength(4);
  });

  it("Geschäftsführung mit inaktivem Vorgesetzten bleibt Wurzel des Diagramms", () => {
    const { container } = renderChart([
      person("gf", "Stefan Chef", { disciplinary: "ehemals" }, true),
      person("anna", "Anna Muster", { disciplinary: "gf" }),
    ]);

    expect(levels(container)).toEqual([["Stefan Chef"], ["Anna Muster"]]);
    expect(screen.queryByText("Ohne Zuordnung")).not.toBeInTheDocument();
  });

  it("zeigt nur die Liste, wenn niemand zugeordnet ist", () => {
    const { container } = renderChart([
      person("a", "Anna Muster"),
      person("b", "Ben Beispiel"),
    ]);

    expect(container.querySelector("svg")).toBeNull();
    expect(screen.queryByText("Noch keine Mitarbeitenden vorhanden.")).not.toBeInTheDocument();
    expect(
      within(unassignedList())
        .getAllByRole("listitem")
        .map((li) => li.textContent)
    ).toEqual(["Anna Muster", "Ben Beispiel"]);
  });

  it("hebt den eigenen Knoten im Diagramm hervor", () => {
    renderChart(TEAM, "ben");

    expect(chartNode("Ben Beispiel")).toHaveClass("ring-2");
    for (const other of ["Stefan Chef", "Anna Muster", "Carla Klein", "Dora Neu"]) {
      expect(chartNode(other)).not.toHaveClass("ring-2");
    }
  });

  it("hebt den eigenen Eintrag auch in „Ohne Zuordnung“ hervor", () => {
    renderChart(
      [
        person("gf", "Stefan Chef", {}, true),
        person("me", "Mia Ich"),
        person("other", "Otto Anders"),
      ],
      "me"
    );

    const items = within(unassignedList()).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Mia Ich");
    expect(items[0]).toHaveClass("ring-2");
    expect(items[1]).not.toHaveClass("ring-2");
    expect(chartNode("Stefan Chef")).not.toHaveClass("ring-2");
  });

  it("platziert Personen in einem Zyklus ohne Wurzel auf der obersten Ebene", () => {
    const { container } = renderChart([
      person("gf", "Stefan Chef", {}, true),
      person("a", "Anna Muster", { disciplinary: "b" }),
      person("b", "Ben Beispiel", { disciplinary: "a" }),
    ]);

    // nicht als "ohne Zuordnung" behandelt, aber auch nicht von der GF erreichbar
    expect(screen.queryByText("Ohne Zuordnung")).not.toBeInTheDocument();
    expect(levels(container)).toEqual([["Anna Muster", "Ben Beispiel", "Stefan Chef"]]);
    // beide Berichtswege werden trotzdem gezeichnet
    expect(edges(container)).toHaveLength(2);
    expect(edges(container).every((e) => e.stroke === DISCIPLINARY)).toBe(true);
  });

  it("bricht einen Zyklus unterhalb der Wurzel ab (Breitensuche, erste Ebene gewinnt)", () => {
    const { container } = renderChart([
      person("gf", "Stefan Chef", {}, true),
      person("a", "Anna Muster", { disciplinary: "gf", technical: "b" }),
      person("b", "Ben Beispiel", { disciplinary: "a" }),
    ]);

    expect(levels(container)).toEqual([
      ["Stefan Chef"],
      ["Anna Muster"],
      ["Ben Beispiel"],
    ]);
    // Anna → GF, Anna → Ben (fachlich), Ben → Anna
    expect(edges(container).map((e) => e.stroke)).toEqual([
      DISCIPLINARY,
      TECHNICAL,
      DISCIPLINARY,
    ]);
  });

  it("gibt einer einzelnen Person eine Mindestbreite", () => {
    const { container } = renderChart([person("gf", "Stefan Chef", {}, true)], "gf");

    const svg = container.querySelector("svg") as SVGSVGElement;
    expect(svg).toHaveAttribute("width", "168");
    expect(svg).toHaveAttribute("height", "56");
    const canvas = svg.parentElement as HTMLElement;
    expect(canvas.style.width).toBe("280px");
    expect(canvas.style.height).toBe("56px");
    expect(position("Stefan Chef")).toEqual({ left: "0px", top: "0px" });
    expect(chartNode("Stefan Chef")).toHaveClass("ring-2");
    expect(edges(container)).toEqual([]);
  });
});
