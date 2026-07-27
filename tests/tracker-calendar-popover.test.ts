import { Calendar, type CalendarOptions, type EventInput } from "@fullcalendar/core";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachCalendarPopoverEnhancements,
  enhanceOpenCalendarPopover,
} from "../src/tracker/calendar-popover";

const trackerStyles = readFileSync(resolve("src/tracker/tracker.css"), "utf8");
const trackerSource = readFileSync(resolve("src/tracker/main.ts"), "utf8");
const designSystem = readFileSync(
  resolve("docs/design/DESIGN_SYSTEM.md"),
  "utf8",
);

const originalOffsetParent = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "offsetParent",
);
const originalRequestAnimationFrame = window.requestAnimationFrame;
const originalCancelAnimationFrame = window.cancelAnimationFrame;
const originalInnerHeight = Object.getOwnPropertyDescriptor(window, "innerHeight");

let calendar: Calendar | undefined;
let frameCallbacks: Map<number, FrameRequestCallback>;
let nextFrameId: number;

function rect(
  top: number,
  height: number,
  width = 900,
  left = 0,
): DOMRect {
  return {
    x: left,
    y: top,
    top,
    right: left + width,
    bottom: top + height,
    left,
    width,
    height,
    toJSON: () => ({}),
  };
}

function flushFrames(): void {
  const callbacks = [...frameCallbacks.values()];
  frameCallbacks.clear();
  callbacks.forEach((callback) => callback(0));
}

async function flushFullCalendarUpdates(): Promise<void> {
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  flushFrames();
  await Promise.resolve();
}

function createCalendar(
  view: "timeGridWeek" | "timeGridDay" | "dayGridMonth",
  events: EventInput[],
  options: Partial<CalendarOptions> = {},
): HTMLElement {
  document.body.innerHTML = '<div class="tracker"><div id="calendar"></div></div>';
  const root = document.querySelector<HTMLElement>("#calendar")!;
  calendar = new Calendar(root, {
    plugins: [dayGridPlugin, timeGridPlugin],
    initialView: view,
    initialDate: "2026-07-27",
    headerToolbar: false,
    dayMaxEvents: 3,
    height: 600,
    events,
    ...options,
  });
  calendar.render();
  return root;
}

function allDayEvents(): EventInput[] {
  return ["1", "2", "3", "Mathematics revision"].map((title, index) => ({
    id: String(index + 1),
    title,
    start: "2026-07-27",
    end: "2026-07-28",
    allDay: true,
  }));
}

function timedEvents(): EventInput[] {
  return ["1", "2", "3", "Mathematics revision"].map((title, index) => {
    const startHour = String(index + 8).padStart(2, "0");
    const endHour = String(index + 9).padStart(2, "0");
    return {
      id: String(index + 1),
      title,
      start: `2026-07-27T${startHour}:00:00`,
      end: `2026-07-27T${endHour}:00:00`,
      allDay: false,
    };
  });
}

async function openPopover(root: HTMLElement): Promise<HTMLElement> {
  const moreLink = root.querySelector<HTMLElement>(".fc-more-link");
  expect(moreLink).not.toBeNull();
  moreLink!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await flushFullCalendarUpdates();
  const popover = root.querySelector<HTMLElement>(".fc-more-popover");
  expect(popover).not.toBeNull();
  return popover!;
}

beforeEach(() => {
  frameCallbacks = new Map();
  nextFrameId = 1;
  Object.defineProperty(HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get() {
      return this.parentElement ?? document.body;
    },
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function mockBounds(this: HTMLElement) {
      const element = this;
      const top = Number.parseFloat(element.style.top) || 0;
      if (element.classList.contains("fc-more-popover")) {
        return rect(top, 220, 352);
      }
      if (element.classList.contains("fc-popover-header")) {
        return rect(top, 40, 352);
      }
      if (element.classList.contains("fc-more-link")) {
        return rect(top, 24, 80);
      }
      return rect(top, 600);
    },
  );
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: 800,
  });
  Object.defineProperty(window, "requestAnimationFrame", {
    configurable: true,
    value: (callback: FrameRequestCallback) => {
      const id = nextFrameId++;
      frameCallbacks.set(id, callback);
      return id;
    },
  });
  Object.defineProperty(window, "cancelAnimationFrame", {
    configurable: true,
    value: (id: number) => {
      frameCallbacks.delete(id);
    },
  });
});

afterEach(() => {
  calendar?.destroy();
  calendar = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  if (originalOffsetParent) {
    Object.defineProperty(
      HTMLElement.prototype,
      "offsetParent",
      originalOffsetParent,
    );
  }
  Object.defineProperty(window, "requestAnimationFrame", {
    configurable: true,
    value: originalRequestAnimationFrame,
  });
  Object.defineProperty(window, "cancelAnimationFrame", {
    configurable: true,
    value: originalCancelAnimationFrame,
  });
  if (originalInnerHeight) {
    Object.defineProperty(window, "innerHeight", originalInnerHeight);
  }
});

describe("FullCalendar overflow rendering", () => {
  it.each(["timeGridWeek", "timeGridDay"] as const)(
    "renders each all-day title once without a time in %s",
    async (view) => {
      const root = createCalendar(view, allDayEvents());
      const popover = await openPopover(root);
      const rows = [...popover.querySelectorAll<HTMLElement>(".fc-event")];

      expect(rows).toHaveLength(4);
      expect(root.querySelectorAll(".fc-event")).toHaveLength(8);
      expect(
        rows.map((row) => ({
          text: row.textContent,
          time: row.querySelector(".fc-event-time")?.textContent ?? null,
          title: row.querySelector(".fc-event-title")?.textContent ?? null,
        })),
      ).toEqual([
        { text: "1", time: null, title: "1" },
        { text: "2", time: null, title: "2" },
        { text: "3", time: null, title: "3" },
        {
          text: "Mathematics revision",
          time: null,
          title: "Mathematics revision",
        },
      ]);
    },
  );

  it("renders one formatted time and one title for Month-view timed events", async () => {
    const root = createCalendar("dayGridMonth", timedEvents(), {
      eventTimeFormat: {
        hour: "numeric",
        minute: "2-digit",
        meridiem: "short",
      },
    });
    const popover = await openPopover(root);
    const rows = [...popover.querySelectorAll<HTMLElement>(".fc-event")];

    expect(rows).toHaveLength(4);
    expect(
      rows.map((row) => ({
        time: row.querySelector(".fc-event-time")?.textContent,
        title: row.querySelector(".fc-event-title")?.textContent,
      })),
    ).toEqual([
      { time: "8:00am", title: "1" },
      { time: "9:00am", title: "2" },
      { time: "10:00am", title: "3" },
      { time: "11:00am", title: "Mathematics revision" },
    ]);
  });

  it("keeps popover event clicks connected to FullCalendar eventClick", async () => {
    const eventClick = vi.fn();
    const root = createCalendar("timeGridWeek", allDayEvents(), { eventClick });
    const popover = await openPopover(root);
    const eventRows = popover.querySelectorAll<HTMLElement>(".fc-event");

    expect(eventRows).toHaveLength(4);
    eventRows[3].click();

    expect(eventClick).toHaveBeenCalledTimes(1);
    expect(eventClick.mock.calls[0][0].event.title).toBe(
      "Mathematics revision",
    );
  });
});

describe("calendar popover enhancement", () => {
  it("adds a real close button while preserving native dismissal behavior", async () => {
    const root = createCalendar("timeGridWeek", allDayEvents());
    const detach = attachCalendarPopoverEnhancements(root);

    await openPopover(root);
    const closeButton = root.querySelector<HTMLButtonElement>(
      "[data-calendar-popover-close]",
    );
    const nativeClose = root.querySelector<HTMLElement>(".fc-popover-close");

    expect(closeButton?.tagName).toBe("BUTTON");
    expect(closeButton?.type).toBe("button");
    expect(closeButton?.getAttribute("aria-label")).toBe("Close");
    expect(nativeClose?.hidden).toBe(true);
    closeButton!.click();
    await flushFullCalendarUpdates();
    expect(root.querySelector(".fc-more-popover")).toBeNull();

    await openPopover(root);
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await flushFullCalendarUpdates();
    expect(root.querySelector(".fc-more-popover")).toBeNull();

    await openPopover(root);
    document.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
    );
    await flushFullCalendarUpdates();
    expect(root.querySelector(".fc-more-popover")).toBeNull();

    await openPopover(root);
    calendar!.changeView("dayGridMonth");
    expect(root.querySelector(".fc-more-popover")).toBeNull();

    detach();
  });

  it("caps the body and shifts only by measured viewport overflow", async () => {
    const root = createCalendar("timeGridWeek", allDayEvents());
    const popover = await openPopover(root);
    const body = popover.querySelector<HTMLElement>(".fc-popover-body")!;
    popover.style.top = "180px";
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 260,
    });
    Object.defineProperty(popover, "getBoundingClientRect", {
      configurable: true,
      value: () => rect(180, 500, 352),
    });
    Object.defineProperty(body, "clientHeight", {
      configurable: true,
      value: 96,
    });
    Object.defineProperty(body, "scrollHeight", {
      configurable: true,
      value: 300,
    });

    enhanceOpenCalendarPopover(root);

    expect(
      body.style.getPropertyValue("--calendar-popover-available-height"),
    ).toBe("96px");
    expect(popover.style.top).toBe("10px");
    expect(body.tabIndex).toBe(0);
    expect(body.getAttribute("role")).toBe("region");
    expect(body.getAttribute("aria-label")).toBe("Events on July 27, 2026");
  });
});

describe("calendar popover styling contract", () => {
  it("uses an opaque, responsive, tracker-scoped elevated surface", () => {
    const surfaceRule = trackerStyles.match(
      /\.tracker #calendar \.fc-more-popover\s*\{[^}]*\}/,
    )?.[0];

    expect(surfaceRule).toBeDefined();
    expect(surfaceRule).toContain("width: min(22rem, calc(100vw - 20px))");
    expect(surfaceRule).toContain("background: var(--surface)");
    expect(surfaceRule).toContain("border-radius: var(--radius-lg)");
    expect(surfaceRule).toContain("box-shadow: var(--shadow-dialog)");
    expect(surfaceRule).toContain("z-index: 20");
    expect(trackerStyles).not.toMatch(/(?:^|\n)\.fc-more-popover/m);
  });

  it("scrolls only a genuinely overflowing body with shared safeguards intact", () => {
    const bodyRule = trackerStyles.match(
      /\.tracker #calendar \.fc-more-popover \.fc-popover-body\s*\{[^}]*\}/,
    )?.[0];

    expect(bodyRule).toBeDefined();
    expect(bodyRule).toContain(
      "max-height: min(420px, var(--calendar-popover-available-height, 420px))",
    );
    expect(bodyRule).toContain("overflow-y: auto");
    expect(bodyRule).not.toContain("overflow-y: scroll");
    expect(trackerStyles).toContain("@media (forced-colors: active)");
    expect(trackerStyles).toContain("background: Canvas");
    expect(trackerSource).not.toContain("eventContent:");
    expect(trackerSource).toContain(
      "attachCalendarPopoverEnhancements(calendarRoot)",
    );
  });

  it("documents the shared popover behavior without changing repository guidance", () => {
    for (const phrase of [
      "### Popovers",
      "opaque elevated surface",
      "real close button",
      "scroll only the body",
      "one title",
      "scrollbar treatment",
    ]) {
      expect(designSystem).toContain(phrase);
    }
  });
});
