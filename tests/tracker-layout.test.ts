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
});
