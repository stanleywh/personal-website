import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  accountMode,
  accountUrl,
  pageUrl,
  safeNextPage,
} from "../src/auth/navigation";

describe("account navigation", () => {
  it("accepts only known internal return pages", () => {
    expect(safeNextPage("tracker")).toBe("tracker");
    expect(safeNextPage("home")).toBe("home");
    expect(safeNextPage("/projects/")).toBe("home");
    expect(safeNextPage("https://attacker.example/")).toBe("home");
    expect(safeNextPage("//attacker.example/tracker/")).toBe("home");
    expect(safeNextPage("tracker?ignored=true")).toBe("tracker");
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
    expect(safeNextPage("tracker?next=https://attacker.example")).toBe("tracker");
    expect(safeNextPage("tracker.html")).toBe("home");
    expect(safeNextPage("unknown")).toBe("home");
    expect(safeNextPage("javascript:alert(1)")).toBe("home");
  });

  it("builds canonical root-relative page and account URLs", () => {
    expect(pageUrl("home").pathname).toBe("/");
    expect(pageUrl("tracker").pathname).toBe("/tracker/");
    expect(pageUrl("account").pathname).toBe("/account/");

    const login = accountUrl("login", "tracker");
    expect(login.pathname).toBe("/account/");
    expect(login.searchParams.get("mode")).toBe("login");
    expect(login.searchParams.get("next")).toBe("tracker");
  });
});

describe("removed magic-link client paths", () => {
  it("does not retain OTP endpoints, link controls, or cooldown logic in active clients", () => {
    const sources = [
      "../src/auth/session.ts",
      "../src/account/main.ts",
      "../account/index.html",
      "../apple/RevisionTracker/Services/AuthService.swift",
      "../apple/RevisionTracker/Views/ContentView.swift",
    ].map((path) => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");

    expect(sources).not.toContain("signInWithOtp");
    expect(sources).not.toContain("/auth/v1/otp");
    expect(sources).not.toContain("Email me a login link");
    expect(sources).not.toContain("Try again in");
  });
});
