import { describe, expect, it } from "vitest";
import { ALLOWED_EMAIL_DOMAIN, fullName, isAllowedEmail } from "./auth";

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
