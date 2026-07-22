import { describe, expect, it } from "vitest";
import type { CalendarEventRecord, RevisionSession } from "../src/tracker/types";
import { eventsToIcs, getLastRevised, safeColor } from "../src/tracker/utils";

describe("revision history", () => {
  it("derives last revised from the newest session", () => {
    const sessions: RevisionSession[] = [
      { id: "1", revisionItemId: "topic", revisedAt: "2026-02-01T10:00:00.000Z", durationMinutes: 30, mastery: 2, createdAt: "", updatedAt: "" },
      { id: "2", revisionItemId: "other", revisedAt: "2026-07-01T10:00:00.000Z", durationMinutes: 30, mastery: 2, createdAt: "", updatedAt: "" },
      { id: "3", revisionItemId: "topic", revisedAt: "2026-06-01T10:00:00.000Z", durationMinutes: 45, mastery: 4, createdAt: "", updatedAt: "" },
    ];
    expect(getLastRevised("topic", sessions)).toBe("2026-06-01T10:00:00.000Z");
  });
});

describe("calendar export", () => {
  it("creates an importable recurring event with escaped text and alerts", () => {
    const event: CalendarEventRecord = {
      id: "event-id", title: "Biology, cells", startAt: "2026-07-22T09:00:00.000Z", endAt: "2026-07-22T10:00:00.000Z",
      allDay: false, timezone: "Asia/Hong_Kong", notes: "Review; then\nquestions", availability: "busy", travelMinutes: 0,
      alerts: [15], recurrence: { frequency: "weekly", interval: 1, until: "2026-09-01" }, origin: "web", version: 1,
      createdAt: "2026-07-20T00:00:00.000Z", updatedAt: "2026-07-20T00:00:00.000Z",
    };
    const output = eventsToIcs([event]);
    expect(output).toContain("SUMMARY:Biology\\, cells");
    expect(output).toContain("DESCRIPTION:Review\\; then\\nquestions");
    expect(output).toContain("RRULE:FREQ=WEEKLY;INTERVAL=1;UNTIL=20260901T235959Z");
    expect(output).toContain("TRIGGER:-PT15M");
  });

  it("excludes soft-deleted events", () => {
    const event = { id: "deleted", deletedAt: "2026-07-22T00:00:00.000Z" } as CalendarEventRecord;
    expect(eventsToIcs([event])).not.toContain("BEGIN:VEVENT");
  });
});

describe("colour validation", () => {
  it("uses the site accent when a stored colour is invalid", () => {
    expect(safeColor("red")).toBe("#78634b");
    expect(safeColor("#12A0ff")).toBe("#12A0ff");
  });
});
