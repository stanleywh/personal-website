import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sharedStyles = readFileSync(resolve("styles.css"), "utf8");
const trackerStyles = readFileSync(
  resolve("src/tracker/tracker.css"),
  "utf8",
);
const trackerSource = readFileSync(resolve("src/tracker/main.ts"), "utf8");
const designSystem = readFileSync(
  resolve("docs/design/DESIGN_SYSTEM.md"),
  "utf8",
);
const repositoryGuidance = readFileSync(resolve("AGENTS.md"), "utf8");

describe("shared scrollbar system", () => {
  it("defines the shared visual and all-day overflow tokens", () => {
    for (const declaration of [
      "--scrollbar-desktop-size: 8px",
      "--scrollbar-track: transparent",
      "--scrollbar-thumb:",
      "--scrollbar-thumb-hover:",
      "--scrollbar-thumb-active:",
      "--calendar-all-day-max-height: 120px",
      "--calendar-all-day-max-height: 96px",
    ]) {
      expect(sharedStyles).toContain(declaration);
    }
  });

  it("progressively styles desktop native scrollbars without creating overflow", () => {
    expect(sharedStyles).toContain(
      "@media (hover: hover) and (pointer: fine)",
    );
    expect(sharedStyles).toContain(
      "@supports not selector(::-webkit-scrollbar)",
    );
    expect(sharedStyles).toContain("scrollbar-width: thin");
    expect(sharedStyles).toContain(
      "scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track)",
    );
    expect(sharedStyles).toMatch(
      /\*::?-webkit-scrollbar-track,\s*\*::?-webkit-scrollbar-corner\s*\{[^}]*background:\s*var\(--scrollbar-track\)/,
    );
    expect(sharedStyles).toMatch(
      /\*::?-webkit-scrollbar-thumb\s*\{[^}]*border-radius:\s*var\(--radius-pill\)[^}]*background:\s*var\(--scrollbar-thumb\)[^}]*background-clip:\s*padding-box/,
    );
    expect(sharedStyles).toContain("*::-webkit-scrollbar-thumb:hover");
    expect(sharedStyles).toContain("*::-webkit-scrollbar-thumb:active");
    expect(sharedStyles).toMatch(
      /\*::?-webkit-scrollbar-button\s*\{[^}]*width:\s*0[^}]*height:\s*0[^}]*display:\s*none/,
    );
    expect(sharedStyles).not.toMatch(
      /(?:^|\s)(?:overflow|overflow-y):\s*(?:auto|scroll)\s*;/m,
    );
  });

  it("returns scrollbar rendering to the platform in forced-colour mode", () => {
    expect(sharedStyles).toContain("@media (forced-colors: active)");
    expect(sharedStyles).toContain("scrollbar-color: auto");
    expect(sharedStyles).toContain("scrollbar-width: auto");
    expect(sharedStyles).toMatch(
      /\*::?-webkit-scrollbar,[\s\S]*?\*::?-webkit-scrollbar-corner\s*\{\s*all:\s*revert;/,
    );
  });
});

describe("FullCalendar overflow contract", () => {
  it("keeps the calendar card out of fixed-position containing blocks", () => {
    const calendarCardRules = [...trackerStyles.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, selector]) =>
        selector.includes(".calendar-card")
        && !selector.includes(":not(.calendar-card)"))
      .map(([, selector, declarations]) => ({
        selector: selector.trim(),
        declarations,
      }));

    expect(calendarCardRules.length).toBeGreaterThan(0);
    for (const rule of calendarCardRules) {
      expect(rule.declarations, rule.selector).not.toMatch(
        /(?:^|;)\s*(?:backdrop-filter|filter|perspective|contain)\s*:/,
      );
      const transform = rule.declarations.match(
        /(?:^|;)\s*transform\s*:\s*([^;]+)/,
      )?.[1].trim();
      expect([undefined, "none"], rule.selector).toContain(transform);
    }
    expect(trackerStyles).toContain(
      ".js .tracker .reveal:not(.calendar-card)",
    );
  });

  it("limits Month cell height rules to Month view", () => {
    expect(trackerStyles).not.toMatch(
      /(?<!dayGridMonth-view )\.fc-daygrid-day-frame\s*\{/,
    );
    expect(
      trackerStyles.match(
        /\.fc-dayGridMonth-view \.fc-daygrid-day-frame\s*\{/g,
      ),
    ).toHaveLength(3);
  });

  it("allows only the tracker all-day section to scroll on real overflow", () => {
    const allDayRule = trackerStyles.match(
      /\.tracker #calendar[\s\S]*?\.fc-scrollgrid-section-body:not\(\.fc-scrollgrid-section-liquid\)[\s\S]*?\.fc-scroller\s*\{[^}]*\}/,
    )?.[0];

    expect(allDayRule).toBeDefined();
    expect(allDayRule).toContain(
      "max-height: var(--calendar-all-day-max-height)",
    );
    expect(allDayRule).toContain("overflow-y: auto !important");
    expect(allDayRule).not.toContain("overflow-y: scroll");
    expect(trackerStyles).not.toContain(
      ".fc-scrollgrid-section-liquid .fc-scroller",
    );
  });

  it("preserves the timed-grid height, range, and first-scroll position", () => {
    expect(trackerSource).toContain(
      'const TIME_GRID_HEIGHT = "var(--calendar-height)";',
    );
    expect(trackerSource).toContain("height: TIME_GRID_HEIGHT");
    expect(trackerSource).toContain('slotMinTime: "00:00:00"');
    expect(trackerSource).toContain('slotMaxTime: "24:00:00"');
    expect(trackerSource).toContain('scrollTime: "00:00:00"');
  });

  it("keeps native drag, resize, and snap behavior configured", () => {
    expect(trackerSource).toContain(
      "slotDuration: { minutes: CALENDAR_SNAP_MINUTES }",
    );
    expect(trackerSource).toContain(
      "snapDuration: { minutes: CALENDAR_SNAP_MINUTES }",
    );
    expect(trackerSource).toContain("select: (info: DateSelectArg)");
    expect(trackerSource).toContain("eventDrop: (info: EventDropArg)");
    expect(trackerSource).toContain("eventResize: (info: EventResizeDoneArg)");
    expect(trackerSource).toContain(
      'addEventListener("change", handleAllDayChange)',
    );
    expect(trackerSource).toContain(
      "addDefaultEventDuration(new Date(startAt))",
    );
    expect(trackerSource).not.toContain("fixedMirrorParent");
    expect(trackerSource).not.toContain("mousemove");
  });
});

describe("scrolling guidance", () => {
  it("documents shared overflow behavior and the FullCalendar exception", () => {
    for (const phrase of [
      "## Scrolling and overflow",
      "`overflow: auto`",
      "Forced-colour mode",
      "The non-liquid all-day section",
      "scrollbar-width compensation",
    ]) {
      expect(designSystem).toContain(phrase);
    }
  });

  it("keeps concise persistent repository instructions", () => {
    for (const phrase of [
      "shared native scrollbar tokens",
      "deliberate height boundary",
      "accessible native scrolling",
      "FullCalendar header, all-day, and timed-grid",
      "fitting and overflowing content",
    ]) {
      expect(repositoryGuidance).toContain(phrase);
    }
  });
});
