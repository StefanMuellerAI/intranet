import { defineConfig, devices } from "@playwright/test";
import { loadTestEnv } from "./tests/helpers/env";

loadTestEnv();

const BASE_URL = process.env.APP_BASE_URL ?? "http://localhost:3100";
const PORT = new URL(BASE_URL).port || "3100";

// Nur definierte Werte an den Dev-Server durchreichen (Typ-Anforderung)
const env = Object.fromEntries(
  Object.entries(process.env).filter(([, v]) => v !== undefined)
) as Record<string, string>;

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  // Alle Tests teilen sich eine Datenbank — strikt sequentiell
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `${BASE_URL}/anmelden`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env,
  },
});
