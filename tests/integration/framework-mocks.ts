import { beforeEach, vi } from "vitest";
import { resetFakes } from "../helpers/framework-fakes";

// Framework-Grenzen für alle Integrationstests durch Test-Doubles ersetzen
// (siehe tests/helpers/framework-fakes.ts). Ohne actAs() gibt es keine
// Session — Route-Handler sehen dann "nicht angemeldet".
vi.mock("@clerk/nextjs/server", async () => {
  const fakes = await import("../helpers/framework-fakes");
  return fakes.clerkServerModule;
});
vi.mock("next/cache", async () => {
  const fakes = await import("../helpers/framework-fakes");
  return fakes.nextCacheModule;
});
vi.mock("next/navigation", async () => {
  const fakes = await import("../helpers/framework-fakes");
  return fakes.nextNavigationModule;
});
vi.mock("@vercel/blob", async () => {
  const fakes = await import("../helpers/framework-fakes");
  return fakes.blobModule;
});
vi.mock("@/lib/mail", async () => {
  const fakes = await import("../helpers/framework-fakes");
  return fakes.mailModule;
});

beforeEach(() => {
  resetFakes();
});
