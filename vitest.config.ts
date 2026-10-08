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
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/components/ui/**",
        // reine Typen/Konstanten bzw. Framework-Glue ohne eigene Logik
        "src/db/schema.ts",
        "src/db/seed.ts",
      ],
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
