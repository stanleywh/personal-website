import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const routes = [
  "index.html",
  "tracker/index.html",
  "about/index.html",
  "account/index.html",
];

describe("shared visual system", () => {
  it("loads the shared stylesheet and page-shell primitives on every route", () => {
    for (const route of routes) {
      const html = readFileSync(resolve(route), "utf8");
      const parsed = new DOMParser().parseFromString(html, "text/html");

      expect(
        parsed.querySelector('link[rel="stylesheet"][href="/styles.css"]'),
        `${route} must load the shared design system`,
      ).not.toBeNull();
      expect(parsed.body.classList.contains("site-page")).toBe(true);
      expect(parsed.querySelector(".page-shell")).not.toBeNull();
    }
  });

  it("keeps tracker gate styles render-blocking after the shared foundation", () => {
    const html = readFileSync(resolve("tracker/index.html"), "utf8");
    const parsed = new DOMParser().parseFromString(html, "text/html");
    const shared = parsed.querySelector<HTMLLinkElement>(
      'link[rel="stylesheet"][href="/styles.css"]',
    );
    const gate = parsed.querySelector<HTMLLinkElement>(
      'link[rel="stylesheet"][href="/src/tracker/auth-gate.css"]',
    );
    const entry = parsed.querySelector<HTMLScriptElement>(
      'script[src="/src/tracker/entry.ts"]',
    );

    expect(shared).not.toBeNull();
    expect(gate).not.toBeNull();
    expect(entry).not.toBeNull();
    expect(
      shared!.compareDocumentPosition(gate!)
      & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      gate!.compareDocumentPosition(entry!)
      & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("defines tokenized desktop density without document scaling shortcuts", () => {
    const styles = readFileSync(resolve("styles.css"), "utf8");
    const trackerStyles = readFileSync(
      resolve("src/tracker/tracker.css"),
      "utf8",
    );
    const trackerSource = readFileSync(resolve("src/tracker/main.ts"), "utf8");

    for (const declaration of [
      "--home-max-width: 896px",
      "--tracker-max-width: 1152px",
      "--account-max-width: 520px",
      "--control-height: 34px",
      "--calendar-height: clamp(448px, 72vh, 576px)",
    ]) {
      expect(styles).toContain(declaration);
    }
    expect(styles).toContain(".page-shell");
    expect(styles).toContain(".surface-card");
    expect(styles).toContain(".form-control");
    expect(styles).not.toMatch(/(?:^|\s)zoom\s*:/m);
    expect(styles).not.toContain("transform: scale(");
    expect(trackerStyles).not.toContain("transform: scale(");
    expect(trackerSource).toContain(
      'const TIME_GRID_HEIGHT = "var(--calendar-height)";',
    );
  });
});
