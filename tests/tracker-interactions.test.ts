import { describe, expect, it } from "vitest";
import { mountStarRating } from "../src/tracker/rating";
import type { CalendarEventRecord, RevisionSession } from "../src/tracker/types";
import {
  defaultSessionDuration,
  isSourceEventLogged,
  reconcileEndAfterStart,
  toZonedLocalInput,
  validateEventRange,
} from "../src/tracker/utils";

function calendarEvent(overrides: Partial<CalendarEventRecord> = {}): CalendarEventRecord {
  return {
    id: "event-1",
    title: "Test",
    startAt: "2026-07-25T01:00:00.000Z",
    endAt: "2026-07-25T02:00:00.000Z",
    allDay: false,
    timezone: "Asia/Hong_Kong",
    availability: "busy",
    travelMinutes: 0,
    alerts: [],
    origin: "web",
    version: 1,
    createdAt: "2026-07-25T00:00:00.000Z",
    updatedAt: "2026-07-25T00:00:00.000Z",
    ...overrides,
  };
}

function revisionSession(sourceEventId?: string): RevisionSession {
  return {
    id: crypto.randomUUID(),
    revisionItemId: "item-1",
    sourceEventId,
    revisedAt: "2026-07-25T02:00:00.000Z",
    durationMinutes: 60,
    mastery: 3,
    createdAt: "2026-07-25T02:00:00.000Z",
    updatedAt: "2026-07-25T02:00:00.000Z",
  };
}

describe("event-linked revision sessions", () => {
  it("distinguishes a persisted source event from unrelated table sessions", () => {
    const sessions = [revisionSession(), revisionSession("event-1")];

    expect(isSourceEventLogged(sessions, "event-1")).toBe(true);
    expect(isSourceEventLogged(sessions, "event-2")).toBe(false);
  });

  it("uses event duration and documented fallbacks", () => {
    expect(defaultSessionDuration(calendarEvent())).toBe(60);
    expect(defaultSessionDuration(calendarEvent({
      startAt: "2026-07-25T15:30:00.000Z",
      endAt: "2026-07-25T16:45:00.000Z",
    }))).toBe(75);
    expect(defaultSessionDuration(calendarEvent({ allDay: true }))).toBe(60);
    expect(defaultSessionDuration()).toBe(45);
    expect(defaultSessionDuration(calendarEvent({ endAt: "invalid" }))).toBe(45);
    expect(defaultSessionDuration(calendarEvent({
      endAt: "2026-07-27T02:00:00.000Z",
    }))).toBe(45);
  });
});

describe("event time ranges", () => {
  it("formats in the event timezone and accepts cross-midnight ranges", () => {
    expect(toZonedLocalInput("2026-07-25T01:00:00.000Z", "Asia/Hong_Kong"))
      .toBe("2026-07-25T09:00");

    const result = validateEventRange(
      "2026-07-25T23:30",
      "2026-07-26T00:30",
      "Asia/Hong_Kong",
    );
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.durationMs).toBe(60 * 60_000);
  });

  it("preserves a valid end and adjusts an invalid end using prior duration", () => {
    expect(reconcileEndAfterStart(
      "2026-07-25T08:00",
      "2026-07-25T10:00",
      "Asia/Hong_Kong",
      60 * 60_000,
    )).toBe("2026-07-25T10:00");

    expect(reconcileEndAfterStart(
      "2026-07-25T15:00",
      "2026-07-25T10:00",
      "Asia/Hong_Kong",
      60 * 60_000,
    )).toBe("2026-07-25T16:00");

    expect(reconcileEndAfterStart(
      "2026-07-25T23:30",
      "2026-07-25T10:00",
      "Asia/Hong_Kong",
      60 * 60_000,
    )).toBe("2026-07-26T00:30");
  });

  it("rejects reversed, invalid-timezone, and nonexistent DST ranges", () => {
    expect(validateEventRange(
      "2026-07-25T15:00",
      "2026-07-25T10:00",
      "Asia/Hong_Kong",
    )).toEqual({
      valid: false,
      field: "end",
      message: "End time must be after start time.",
    });
    expect(validateEventRange(
      "2026-07-25T09:00",
      "2026-07-25T10:00",
      "Not/A_Zone",
    )).toMatchObject({ valid: false, field: "timezone" });
    expect(validateEventRange(
      "2026-03-08T02:30",
      "2026-03-08T04:00",
      "America/New_York",
    )).toMatchObject({ valid: false, field: "start" });
  });
});

describe("mastery rating", () => {
  it("starts unset, blocks validation, and commits a clicked score", () => {
    document.body.innerHTML = '<div data-rating></div><p id="rating-error"></p>';
    const container = document.querySelector<HTMLElement>("[data-rating]")!;
    const error = document.querySelector<HTMLElement>("#rating-error")!;
    const rating = mountStarRating(container, {
      name: "mastery",
      required: true,
      errorElement: error,
    });
    const radios = Array.from(container.querySelectorAll<HTMLInputElement>("input"));

    expect(radios.every((radio) => !radio.checked)).toBe(true);
    expect(rating.value()).toBeUndefined();
    expect(rating.validate()).toBe(false);
    expect(error.textContent).toContain("Choose a mastery rating");
    expect(document.activeElement).toBe(radios[0]);

    radios[2].closest("label")!.click();
    expect(rating.value()).toBe(3);
    expect(error.textContent).toBe("");
    expect(container.querySelectorAll(".is-filled")).toHaveLength(3);
  });

  it("supports arrow, Home, End, Space, and reset behaviour", () => {
    document.body.innerHTML = '<div data-rating></div><p id="rating-error"></p>';
    const container = document.querySelector<HTMLElement>("[data-rating]")!;
    const rating = mountStarRating(container, {
      name: "mastery",
      required: true,
      errorElement: document.querySelector<HTMLElement>("#rating-error")!,
    });
    const radios = Array.from(container.querySelectorAll<HTMLInputElement>("input"));

    radios[0].focus();
    radios[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(rating.value()).toBe(2);

    radios[1].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(rating.value()).toBe(5);

    radios[4].dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(rating.value()).toBe(1);

    radios[2].dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    expect(rating.value()).toBe(3);

    rating.reset();
    expect(rating.value()).toBeUndefined();
    expect(radios[0].tabIndex).toBe(0);
  });
});
