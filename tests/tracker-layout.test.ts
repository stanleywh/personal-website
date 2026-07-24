import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { revealTrackerAndUpdateCalendar } from "../src/tracker/layout";

describe("initial calendar layout", () => {
  it("updates the Month view exactly once after the tracker shell is visible", () => {
    const guard = document.createElement("div");
    const shell = document.createElement("div");
    guard.hidden = false;
    shell.hidden = true;
    const calendar = {
      view: { type: "dayGridMonth" },
      updateSize: vi.fn(() => {
        expect(shell.hidden).toBe(false);
      }),
    };
    let scheduled: FrameRequestCallback | undefined;
    const scheduleFrame = vi.fn((callback: FrameRequestCallback) => {
      scheduled = callback;
      return 1;
    });

    revealTrackerAndUpdateCalendar(guard, shell, calendar, scheduleFrame);

    expect(calendar.view.type).toBe("dayGridMonth");
    expect(guard.hidden).toBe(true);
    expect(shell.hidden).toBe(false);
    expect(calendar.updateSize).not.toHaveBeenCalled();

    scheduled?.(0);

    expect(calendar.updateSize).toHaveBeenCalledTimes(1);
  });

  it("loads critical gate styles before the tracker module and keeps the skip link in the private shell", () => {
    const html = readFileSync(resolve("tracker/index.html"), "utf8");
    const parsed = new DOMParser().parseFromString(html, "text/html");
    const gateStyles = parsed.querySelector<HTMLLinkElement>(
      'head link[rel="stylesheet"][href="/src/tracker/auth-gate.css"]',
    );
    const sharedStyles = parsed.querySelector<HTMLLinkElement>(
      'head link[rel="stylesheet"][href="/styles.css"]',
    );
    const entryScript = parsed.querySelector<HTMLScriptElement>(
      'head script[src="/src/tracker/entry.ts"]',
    );
    const shell = parsed.querySelector<HTMLElement>("[data-tracker-shell]");
    const skipLink = parsed.querySelector<HTMLAnchorElement>(".skip-link");

    expect(sharedStyles).not.toBeNull();
    expect(gateStyles).not.toBeNull();
    expect(entryScript).not.toBeNull();
    expect(
      sharedStyles!.compareDocumentPosition(gateStyles!)
      & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      gateStyles!.compareDocumentPosition(entryScript!)
      & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(shell?.hidden).toBe(true);
    expect(skipLink?.closest("[data-tracker-shell]")).toBe(shell);
  });

  it("defines one desktop density scale with compensated viewport sizing", () => {
    const sharedStyles = readFileSync(resolve("styles.css"), "utf8");
    const gateStyles = readFileSync(resolve("src/tracker/auth-gate.css"), "utf8");
    const trackerStyles = readFileSync(resolve("src/tracker/tracker.css"), "utf8");
    const trackerSource = readFileSync(resolve("src/tracker/main.ts"), "utf8");

    expect(sharedStyles).toContain("@supports (zoom: 0.8)");
    expect(sharedStyles).toContain("@media (min-width: 1024px)");
    expect(sharedStyles).toContain("--app-density-scale: 0.8");
    expect(sharedStyles).toContain("zoom: var(--app-density-scale)");
    expect(sharedStyles).toContain("--app-full-viewport-height: 125svh");
    expect(sharedStyles).toContain("--app-modal-viewport-limit: 110vh");
    expect(sharedStyles).toContain("--app-calendar-fluid-height: 90vh");
    expect(gateStyles).toContain("var(--app-full-viewport-height, 100svh)");
    expect(trackerStyles).toContain("var(--app-modal-viewport-limit, 88vh)");
    expect(trackerStyles).toContain("@media (width < 1024px)");
    expect(trackerSource).toContain(
      'const TIME_GRID_HEIGHT = "clamp(560px, var(--app-calendar-fluid-height, 72vh), 720px)";',
    );
  });

  it("keeps one labelled add-event action and includes inline validation and confirmation UI", () => {
    const html = readFileSync(resolve("tracker/index.html"), "utf8");
    const source = readFileSync(resolve("src/tracker/main.ts"), "utf8");
    const parsed = new DOMParser().parseFromString(html, "text/html");

    expect(parsed.querySelectorAll("[data-add-event]")).toHaveLength(1);
    expect(parsed.querySelector("[data-agenda-add]")).toBeNull();
    expect(parsed.querySelector("[data-event-time-error]")).not.toBeNull();
    expect(parsed.querySelector("[data-session-mastery-error]")).not.toBeNull();
    expect(parsed.querySelector("[data-confirm-dialog]")).not.toBeNull();
    expect(source).not.toContain("window.confirm");
    for (const label of [
      "Remove event",
      "Delete revision item",
      "Delete label",
      "Delete account",
      "Discard local data",
    ]) {
      expect(source).toContain(label);
    }
  });
});
