import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AUSNAHMEN } from "./interaktionen-ausnahmen";
import { collectInteractions, readAllTestSources } from "./interaktionen";

/**
 * Jedes Bedienelement mit fester Beschriftung (Buttons, Dialog-Trigger,
 * Links, Navigation, Auswahloptionen) muss in mindestens einem E2E- oder
 * Komponententest vorkommen. Neue Buttons ohne Test lassen diesen Test
 * fehlschlagen. Bewusste Ausnahmen stehen mit Begründung in
 * interaktionen-ausnahmen.ts.
 */
describe("Testabdeckung der Bedienelemente", () => {
  const interactions = collectInteractions();
  const tests = readAllTestSources();

  it("findet die Bedienelemente der App", () => {
    expect(interactions.length).toBeGreaterThan(100);
  });

  it("jede Beschriftung kommt in einem E2E- oder Komponententest vor", () => {
    const missing = [
      ...new Map(
        interactions
          .filter((i) => !tests.includes(i.label) && !(i.label in AUSNAHMEN))
          .map((i) => [i.label, `${i.label}  (${i.file}:${i.line})`])
      ).values(),
    ];
    expect(missing, "Bedienelemente ohne Test").toEqual([]);
  });

  it("Ausnahmen sind begründet und nicht veraltet", () => {
    const labels = new Set(interactions.map((i) => i.label));
    for (const [label, grund] of Object.entries(AUSNAHMEN)) {
      expect(grund.length, `Begründung für „${label}“`).toBeGreaterThan(10);
      expect(labels.has(label), `„${label}“ gibt es nicht mehr`).toBe(true);
      expect(tests.includes(label), `„${label}“ ist inzwischen getestet`).toBe(false);
    }
  });

  it("die Ausnahmeliste wird nicht stillschweigend länger", () => {
    // Bewusste Hürde: neue Ausnahmen erfordern auch eine Änderung hier
    const source = readFileSync(
      path.join(__dirname, "interaktionen-ausnahmen.ts"),
      "utf8"
    );
    expect(Object.keys(AUSNAHMEN).length).toBe(
      (source.match(/^\s+"[^"]+":/gm) ?? []).length
    );
  });
});
