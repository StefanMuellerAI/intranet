import { describe, expect, it } from "vitest";
import type { User, VacationRequest } from "@/db";
import { buildWebhookPayload } from "./workflow";

const applicant = {
  id: "user-1",
  firstName: "Max",
  lastName: "Mitarbeiter",
  email: "max@stefanai.de",
} as User;

const request = {
  id: "req-1",
  status: "genehmigt",
  userId: "user-1",
  startDate: "2026-08-03",
  endDate: "2026-08-07",
  days: 5,
} as VacationRequest;

describe("buildWebhookPayload", () => {
  it("liefert Vorgangs-ID, Status, User-Infos und die Formulardaten", async () => {
    const payload = await buildWebhookPayload("urlaub", request, applicant);
    expect(payload).toEqual({
      vorgangs_id: "req-1",
      status: "genehmigt",
      user: {
        id: "user-1",
        name: "Max Mitarbeiter",
        email: "max@stefanai.de",
      },
      formulardaten: request,
    });
  });
});
