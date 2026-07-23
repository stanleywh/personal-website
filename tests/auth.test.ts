import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { accountMode, safeNextPage } from "../src/auth/navigation";

describe("account navigation", () => {
  it("accepts only known internal return pages", () => {
    expect(safeNextPage("tracker.html")).toBe("tracker.html");
    expect(safeNextPage("/projects.html")).toBe("index.html");
    expect(safeNextPage("https://attacker.example/")).toBe("index.html");
    expect(safeNextPage("//attacker.example/tracker.html")).toBe("index.html");
    expect(safeNextPage("tracker.html?ignored=true")).toBe("tracker.html");
  });

  it("normalizes unknown account modes to login", () => {
    expect(accountMode("signup")).toBe("signup");
    expect(accountMode("forgot-password")).toBe("forgot-password");
    expect(accountMode("recovery")).toBe("recovery");
    expect(accountMode("complete-profile")).toBe("complete-profile");
    expect(accountMode("password")).toBe("login");
    expect(accountMode(null)).toBe("login");
  });

  it("keeps return destinations internal even when query text is injected", () => {
    expect(safeNextPage("tracker.html?next=https://attacker.example")).toBe("tracker.html");
    expect(safeNextPage("unknown.html")).toBe("index.html");
    expect(safeNextPage("javascript:alert(1)")).toBe("index.html");
  });
});

describe("removed magic-link client paths", () => {
  it("does not retain OTP endpoints, link controls, or cooldown logic in active clients", () => {
    const sources = [
      "../src/auth/session.ts",
      "../src/account/main.ts",
      "../account.html",
      "../apple/RevisionTracker/Services/AuthService.swift",
      "../apple/RevisionTracker/Views/ContentView.swift",
    ].map((path) => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");

    expect(sources).not.toContain("signInWithOtp");
    expect(sources).not.toContain("/auth/v1/otp");
    expect(sources).not.toContain("Email me a login link");
    expect(sources).not.toContain("Try again in");
  });
});
