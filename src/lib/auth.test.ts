import { describe, expect, it } from "vitest";
import type { User } from "@/db";
import {
  ALLOWED_EMAIL_DOMAIN,
  fullName,
  hasEntered,
  isAllowedEmail,
} from "./auth";

describe("isAllowedEmail", () => {
  it("akzeptiert Adressen der erlaubten Domain (case-insensitiv)", () => {
    expect(isAllowedEmail(`max@${ALLOWED_EMAIL_DOMAIN}`)).toBe(true);
    expect(isAllowedEmail(`MAX@${ALLOWED_EMAIL_DOMAIN.toUpperCase()}`)).toBe(
      true
    );
  });

  it("lehnt fremde Domains ab", () => {
    expect(isAllowedEmail("max@example.com")).toBe(false);
    expect(isAllowedEmail("max@evil-stefanai.de.example.com")).toBe(false);
  });

  it("lehnt Adressen ab, die die Domain nur enthalten statt damit zu enden", () => {
    expect(isAllowedEmail(`max@${ALLOWED_EMAIL_DOMAIN}.example.com`)).toBe(
      false
    );
  });
});

describe("fullName", () => {
  it("setzt Vor- und Nachname zusammen", () => {
    expect(fullName({ firstName: "Erika", lastName: "Muster" })).toBe(
      "Erika Muster"
    );
  });

  it("trimmt bei fehlendem Nachnamen", () => {
    expect(fullName({ firstName: "Erika", lastName: "" })).toBe("Erika");
  });
});

describe("hasEntered", () => {
  function user(entryDate: string | null): Pick<User, "entryDate"> {
    return { entryDate };
  }

  it("gewährt Zugang, wenn kein Eintrittsdatum hinterlegt ist", () => {
    expect(hasEntered(user(null), "2026-08-03")).toBe(true);
  });

  it("gewährt Zugang am Eintrittstag selbst", () => {
    expect(hasEntered(user("2026-08-03"), "2026-08-03")).toBe(true);
  });

  it("sperrt den Zugang vor dem Eintrittstag", () => {
    expect(hasEntered(user("2026-09-01"), "2026-08-31")).toBe(false);
  });

  it("gewährt Zugang nach dem Eintrittstag", () => {
    expect(hasEntered(user("2020-01-01"), "2026-08-03")).toBe(true);
  });
});
