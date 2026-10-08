import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * Liest alle Bedienelemente mit fester Beschriftung aus den TSX-Dateien:
 * Buttons, Dialog-Trigger, Tabs, Links im Button-Stil und die Label-Props
 * der Dialog-Bausteine (triggerLabel, submitLabel, confirmLabel, …).
 * Grundlage für den Meta-Test, der zu jeder Beschriftung einen Test verlangt.
 */

export interface Interaction {
  label: string;
  file: string;
  line: number;
}

const ROOT = path.resolve(__dirname, "../..");

/** JSX-Tags, deren Text eine Bedienhandlung beschreibt */
const INTERACTIVE_TAGS = new Set([
  "Button",
  "button",
  "DialogTrigger",
  "DialogClose",
  "TabsTrigger",
  "DropdownMenuItem",
  "Link",
  "a",
]);

/** Auswahloptionen: nur fester Text (Zusätze wie " (inaktiv)" sind keine Option) */
const OPTION_TAGS = new Set(["SelectItem", "option"]);

/** Props, die Beschriftungen von Bedienelementen tragen */
const LABEL_PROPS = new Set([
  "triggerLabel",
  "submitLabel",
  "confirmLabel",
  "aria-label",
]);

/** Bedingungen für Lade-Zustände — deren Text ist kein eigener Button */
const PENDING_CONDITION = /^(pending|isPending|saving|loading|busy|submitting)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** String-Literale eines Ausdrucks; bei Lade-Bedingungen nur der Ruhe-Zweig. */
function literalsOf(expr: ts.Expression): string[] {
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr))
    return [expr.text];
  if (ts.isParenthesizedExpression(expr)) return literalsOf(expr.expression);
  if (ts.isConditionalExpression(expr)) {
    const cond = expr.condition.getText();
    if (PENDING_CONDITION.test(cond)) return literalsOf(expr.whenFalse);
    return [...literalsOf(expr.whenTrue), ...literalsOf(expr.whenFalse)];
  }
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.BarBarToken)
    return [...literalsOf(expr.left), ...literalsOf(expr.right)];
  return [];
}

function childLabels(children: ts.NodeArray<ts.JsxChild>): string[] {
  const texts: string[] = [];
  let plain = "";
  for (const child of children) {
    if (ts.isJsxText(child)) plain += child.text;
    else if (ts.isJsxExpression(child) && child.expression)
      texts.push(...literalsOf(child.expression));
  }
  if (normalize(plain)) texts.unshift(normalize(plain));
  return texts;
}

function tagName(node: ts.JsxOpeningLikeElement): string {
  return node.tagName.getText();
}

export function collectInteractions(): Interaction[] {
  const files = [
    ...walk(path.join(ROOT, "src/components")),
    ...walk(path.join(ROOT, "src/app")),
  ].filter(
    (f) =>
      f.endsWith(".tsx") &&
      !f.endsWith(".test.tsx") &&
      !f.includes(`${path.sep}components${path.sep}ui${path.sep}`)
  );

  const result: Interaction[] = [];
  for (const file of files) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );
    const add = (label: string, node: ts.Node) => {
      const text = normalize(label);
      // Einzelzeichen/Symbole (z. B. "×") sind keine prüfbaren Beschriftungen,
      // Platzhalter-Optionen ("— wählen —", "Bitte wählen …") keine Aktionen
      if (text.length < 2 || !/[A-Za-zÄÖÜäöü]/.test(text)) return;
      if (/^—|^Bitte wählen/.test(text)) return;
      result.push({
        label: text,
        file: path.relative(ROOT, file),
        line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      });
    };

    const visit = (node: ts.Node) => {
      if (ts.isJsxElement(node) && INTERACTIVE_TAGS.has(tagName(node.openingElement))) {
        for (const label of childLabels(node.children)) add(label, node);
      }
      if (
        ts.isJsxElement(node) &&
        OPTION_TAGS.has(tagName(node.openingElement)) &&
        node.children.every(ts.isJsxText)
      ) {
        const plain = node.children
          .filter(ts.isJsxText)
          .map((c) => c.text)
          .join("");
        if (normalize(plain)) add(plain, node);
      }
      // Navigations- und Aktionseinträge als Objekt: { href: "…", label: "…" }
      if (ts.isObjectLiteralExpression(node)) {
        const props = new Map<string, ts.Expression>();
        for (const p of node.properties)
          if (ts.isPropertyAssignment(p)) props.set(p.name.getText(), p.initializer);
        const label = props.get("label");
        if (props.has("href") && label && ts.isStringLiteral(label))
          add(label.text, node);
      }
      if (ts.isJsxAttribute(node) && LABEL_PROPS.has(node.name.getText())) {
        const init = node.initializer;
        if (init && ts.isStringLiteral(init)) add(init.text, node);
        else if (init && ts.isJsxExpression(init) && init.expression)
          for (const label of literalsOf(init.expression)) add(label, node);
      }
      // iconTrigger("Bearbeiten") u. ä. — Icon-Buttons mit aria-label
      if (
        ts.isCallExpression(node) &&
        node.expression.getText() === "iconTrigger" &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      )
        add(node.arguments[0].text, node);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return result;
}

/** Inhalt aller Testdateien (E2E-Specs und Komponententests) */
export function readAllTestSources(): string {
  const files = [
    ...walk(path.join(ROOT, "tests/e2e")),
    ...walk(path.join(ROOT, "src")),
  ].filter((f) => /\.(spec|test)\.tsx?$/.test(f));
  return files.map((f) => readFileSync(f, "utf8")).join("\n");
}
