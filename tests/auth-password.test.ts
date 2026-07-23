import { describe, expect, it } from "vitest";
import {
  passwordIssues,
  validatePassword,
  validatePasswordConfirmation,
} from "../src/auth/password";

describe("password policy", () => {
  it("accepts a password satisfying every configured requirement", () => {
    expect(passwordIssues("StudyNow1!")).toEqual([]);
    expect(() => validatePassword("StudyNow1!")).not.toThrow();
  });

  it.each([
    ["short passwords", "Aa1!", "minimumLength"],
    ["passwords without lowercase", "STUDYNOW1!", "lowercase"],
    ["passwords without uppercase", "studynow1!", "uppercase"],
    ["passwords without a digit", "StudyNow!", "digit"],
    ["passwords without a supported symbol", "StudyNow12", "symbol"],
  ])("rejects %s", (_case, password, requirement) => {
    expect(passwordIssues(password).map((issue) => issue.requirement)).toContain(requirement);
  });

  it("rejects a mismatched confirmation after validating the password", () => {
    expect(() => validatePasswordConfirmation("StudyNow1!", "StudyNow2!"))
      .toThrow("Passwords do not match.");
  });
});
