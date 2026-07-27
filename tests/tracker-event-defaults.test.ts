import { DateTime } from "luxon";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addDefaultEventDuration,
  CALENDAR_SNAP_MINUTES,
  calendarPointDefaults,
  calendarSelectionDefaults,
  resolveEventDialogTiming,
  roundUpToCalendarInterval,
  toolbarEventDefaults,
} from "../src/tracker/event-defaults";
import { toZonedLocalInput } from "../src/tracker/utils";

const TIMEZONE = "Asia/Hong_Kong";

function zonedDate(value: string, timezone = TIMEZONE): Date {
  return DateTime.fromISO(value, { zone: timezone }).toJSDate();
}

afterEach(() => {
  vi.useRealTimers();
});

describe("calendar event creation defaults", () => {
  it("starts a timed slot event at the clicked time for exactly one hour", () => {
    const clicked = zonedDate("2026-07-29T14:30");
    const defaults = calendarPointDefaults(clicked, false, TIMEZONE);

    expect(toZonedLocalInput(defaults.start, TIMEZONE)).toBe("2026-07-29T14:30");
    expect(toZonedLocalInput(defaults.end, TIMEZONE)).toBe("2026-07-29T15:30");
    expect(defaults.end.getTime() - defaults.start.getTime()).toBe(60 * 60_000);
    expect(defaults.allDay).toBe(false);
  });

  it("lets a one-hour timed default cross midnight", () => {
    const start = zonedDate("2026-07-27T23:30");
    const end = addDefaultEventDuration(start);

    expect(toZonedLocalInput(end, TIMEZONE)).toBe("2026-07-28T00:30");
  });

  it("uses the selected date and rounds fake current time up to the calendar interval", () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-07-27T06:07:19.000Z");
    const selectedDate = zonedDate("2026-07-29T00:00");
    const defaults = toolbarEventDefaults(
      selectedDate,
      new Date(),
      TIMEZONE,
      CALENDAR_SNAP_MINUTES,
    );

    expect(toZonedLocalInput(defaults.start, TIMEZONE)).toBe("2026-07-29T14:30");
    expect(toZonedLocalInput(defaults.end, TIMEZONE)).toBe("2026-07-29T15:30");
  });

  it("rounds against the supplied interval and keeps an exact boundary", () => {
    const unrounded = DateTime.fromISO("2026-07-27T14:07:00", { zone: TIMEZONE });
    const exact = DateTime.fromISO("2026-07-27T14:15:00", { zone: TIMEZONE });

    expect(roundUpToCalendarInterval(unrounded, 15).toFormat("HH:mm")).toBe("14:15");
    expect(roundUpToCalendarInterval(exact, 15).toFormat("HH:mm")).toBe("14:15");
  });

  it("preserves an explicitly selected multi-slot range", () => {
    const start = zonedDate("2026-07-29T13:00");
    const end = zonedDate("2026-07-29T15:30");
    const defaults = calendarSelectionDefaults(start, end, false);

    expect(defaults).toEqual({ start, end, allDay: false });
  });

  it("keeps genuine all-day creation all-day with an exclusive next-day end", () => {
    const start = zonedDate("2026-07-29T00:00");
    const pointDefaults = calendarPointDefaults(start, true, TIMEZONE);
    const selectedEnd = zonedDate("2026-08-01T00:00");
    const selectionDefaults = calendarSelectionDefaults(
      start,
      selectedEnd,
      true,
    );

    expect(pointDefaults.allDay).toBe(true);
    expect(toZonedLocalInput(pointDefaults.end, TIMEZONE)).toBe("2026-07-30T00:00");
    expect(selectionDefaults).toEqual({
      start,
      end: selectedEnd,
      allDay: true,
    });
  });

  it("preserves an existing event's timezone, endpoints, and duration", () => {
    const creation = calendarPointDefaults(
      zonedDate("2026-07-29T14:30"),
      false,
      TIMEZONE,
    );
    const timing = resolveEventDialogTiming({
      startAt: "2026-07-25T01:00:00.000Z",
      endAt: "2026-07-25T03:30:00.000Z",
      allDay: false,
      timezone: TIMEZONE,
    }, creation, "UTC");

    expect(toZonedLocalInput(timing.start, timing.timezone)).toBe("2026-07-25T09:00");
    expect(toZonedLocalInput(timing.end, timing.timezone)).toBe("2026-07-25T11:30");
    expect(timing.end.getTime() - timing.start.getTime()).toBe(150 * 60_000);
    expect(timing.timezone).toBe(TIMEZONE);
  });

  it("keeps local form times stable through timezone conversion", () => {
    const clicked = zonedDate("2026-12-15T09:30", "America/New_York");
    const defaults = calendarPointDefaults(clicked, false, "America/New_York");

    expect(toZonedLocalInput(defaults.start, "America/New_York"))
      .toBe("2026-12-15T09:30");
    expect(toZonedLocalInput(defaults.end, "America/New_York"))
      .toBe("2026-12-15T10:30");
  });
});
