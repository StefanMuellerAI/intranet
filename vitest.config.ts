import path from "node:path";
import { defineConfig } from "vitest/config";

const alias = {
  "@": path.resolve(__dirname, "src"),
  "server-only": path.resolve(__dirname, "tests/helpers/server-only-stub.ts"),
};

export default defineConfig({
  resolve: { alias },
  test: {
    // Integrationstests teilen sich eine DB — Dateien strikt sequentiell
    // ausführen (gilt global; Unit-Tests sind schnell genug).
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary", "html", "lcov"],
      reportsDirectory: "coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/components/ui/**",
        // reine Typen/Konstanten bzw. Framework-Glue ohne eigene Logik
        "src/db/schema.ts",
        "src/db/seed.ts",
      ],
      // Mindestabdeckung je Bereich (CI: npm run test:coverage). Seiten und
      // Layouts (Server Components) laufen nur in den E2E-Tests und haben
      // deshalb keine Schwelle; eine globale Schwelle gibt es bewusst nicht.
      thresholds: {
        "src/lib/**": { lines: 95, statements: 95, functions: 95, branches: 90 },
        "src/app/**/actions.ts": {
          lines: 98,
          statements: 98,
          functions: 100,
          branches: 80,
        },
        "src/app/api/**": {
          lines: 98,
          statements: 98,
          functions: 100,
          branches: 90,
        },
      },
    },
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          include: ["src/**/*.test.ts", "tests/meta/**/*.test.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "component",
          include: ["src/**/*.test.tsx"],
          environment: "happy-dom",
          setupFiles: ["tests/component/setup.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          setupFiles: [
            "tests/integration/setup.ts",
            "tests/integration/framework-mocks.ts",
          ],
          globalSetup: ["tests/integration/global-setup.ts"],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
