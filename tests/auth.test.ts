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
    expect(accountMode("complete-profile")).toBe("complete-profile");
    expect(accountMode("password")).toBe("login");
    expect(accountMode(null)).toBe("login");
  });
});
