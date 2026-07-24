import { DateTime } from "luxon";
import type { CalendarEventRecord, RecurrenceRule, RevisionSession } from "./types";

const LOCAL_INPUT_FORMAT = "yyyy-MM-dd'T'HH:mm";
const DEFAULT_SESSION_MINUTES = 45;
const ALL_DAY_SESSION_MINUTES = 60;
const MIN_SESSION_MINUTES = 1;
const MAX_SESSION_MINUTES = 1_440;

export const uid = (): string => crypto.randomUUID();

export function isoNow(): string {
  return new Date().toISOString();
}

export function toLocalInput(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function fromLocalInput(value: string): string {
  return new Date(value).toISOString();
}

export function toZonedLocalInput(value: string | Date, timezone: string): string {
  const dateTime = typeof value === "string"
    ? DateTime.fromISO(value, { setZone: true })
    : DateTime.fromJSDate(value);
  if (!dateTime.isValid) return "";
  const zoned = dateTime.setZone(timezone);
  return zoned.isValid ? zoned.toFormat(LOCAL_INPUT_FORMAT) : "";
}

export function fromZonedLocalInput(value: string, timezone: string): string | undefined {
  const dateTime = DateTime.fromFormat(value, LOCAL_INPUT_FORMAT, { zone: timezone });
  if (
    !dateTime.isValid
    || dateTime.toFormat(LOCAL_INPUT_FORMAT) !== value
  ) {
    return undefined;
  }
  return dateTime.toUTC().toISO() ?? undefined;
}

export type EventRangeValidation =
  | { valid: true; startAt: string; endAt: string; durationMs: number }
  | { valid: false; field: "start" | "end" | "timezone"; message: string };

export function validateEventRange(
  startValue: string,
  endValue: string,
  timezone: string,
): EventRangeValidation {
  if (!DateTime.local().setZone(timezone).isValid) {
    return { valid: false, field: "timezone", message: "Choose a valid timezone." };
  }
  const startAt = fromZonedLocalInput(startValue, timezone);
  if (!startAt) {
    return { valid: false, field: "start", message: "Enter a valid start date and time." };
  }
  const endAt = fromZonedLocalInput(endValue, timezone);
  if (!endAt) {
    return { valid: false, field: "end", message: "Enter a valid end date and time." };
  }
  const durationMs = Date.parse(endAt) - Date.parse(startAt);
  if (durationMs <= 0) {
    return { valid: false, field: "end", message: "End time must be after start time." };
  }
  return { valid: true, startAt, endAt, durationMs };
}

export function reconcileEndAfterStart(
  startValue: string,
  endValue: string,
  timezone: string,
  previousDurationMs: number,
  fallbackDurationMs = 60 * 60_000,
): string {
  const startAt = fromZonedLocalInput(startValue, timezone);
  if (!startAt) return endValue;
  const endAt = fromZonedLocalInput(endValue, timezone);
  if (endAt && Date.parse(endAt) > Date.parse(startAt)) return endValue;

  const durationMs = Number.isFinite(previousDurationMs) && previousDurationMs > 0
    ? previousDurationMs
    : fallbackDurationMs;
  return DateTime
    .fromMillis(Date.parse(startAt) + durationMs, { zone: timezone })
    .toFormat(LOCAL_INPUT_FORMAT);
}

export function defaultSessionDuration(event?: CalendarEventRecord): number {
  if (!event) return DEFAULT_SESSION_MINUTES;
  if (event.allDay) return ALL_DAY_SESSION_MINUTES;
  const durationMinutes = Math.round(
    (Date.parse(event.endAt) - Date.parse(event.startAt)) / 60_000,
  );
  if (
    !Number.isFinite(durationMinutes)
    || durationMinutes < MIN_SESSION_MINUTES
    || durationMinutes > MAX_SESSION_MINUTES
  ) {
    return DEFAULT_SESSION_MINUTES;
  }
  return durationMinutes;
}

export function loggedSourceEventIds(sessions: RevisionSession[]): Set<string> {
  return new Set(
    sessions
      .map((session) => session.sourceEventId)
      .filter((eventId): eventId is string => Boolean(eventId)),
  );
}

export function isSourceEventLogged(
  sessions: RevisionSession[],
  eventId: string,
): boolean {
  return loggedSourceEventIds(sessions).has(eventId);
}

export function startOfLocalDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function endOfLocalDay(date: Date): Date {
  const result = startOfLocalDay(date);
  result.setDate(result.getDate() + 1);
  result.setMilliseconds(-1);
  return result;
}

export function formatDate(value: string | Date, locale: string, options?: Intl.DateTimeFormatOptions): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat(locale, options ?? { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export function formatTime(value: string | Date, locale: string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(date);
}

export function getLastRevised(itemId: string, sessions: RevisionSession[]): string | undefined {
  return sessions
    .filter((session) => session.revisionItemId === itemId)
    .sort((a, b) => Date.parse(b.revisedAt) - Date.parse(a.revisedAt))[0]?.revisedAt;
}

export function escapeHtml(value: string): string {
  const node = document.createElement("div");
  node.textContent = value;
  return node.innerHTML;
}

function escapeIcs(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function icsDate(value: string, allDay: boolean): string {
  const date = new Date(value);
  if (allDay) return date.toISOString().slice(0, 10).replaceAll("-", "");
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function recurrenceToIcs(rule?: RecurrenceRule): string | undefined {
  if (!rule) return undefined;
  const parts = [`FREQ=${rule.frequency.toUpperCase()}`, `INTERVAL=${rule.interval}`];
  if (rule.until) parts.push(`UNTIL=${rule.until.replaceAll("-", "")}T235959Z`);
  if (rule.byWeekday?.length) parts.push(`BYDAY=${rule.byWeekday.join(",")}`);
  return parts.join(";");
}

export function eventsToIcs(events: CalendarEventRecord[]): string {
  const liveEvents = events.filter((event) => !event.deletedAt);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Stanley//Revision Tracker//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Revision Tracker",
  ];
  for (const event of liveEvents) {
    lines.push("BEGIN:VEVENT", `UID:${event.id}@revision-tracker`);
    lines.push(event.allDay ? `DTSTART;VALUE=DATE:${icsDate(event.startAt, true)}` : `DTSTART:${icsDate(event.startAt, false)}`);
    lines.push(event.allDay ? `DTEND;VALUE=DATE:${icsDate(event.endAt, true)}` : `DTEND:${icsDate(event.endAt, false)}`);
    lines.push(`DTSTAMP:${icsDate(event.updatedAt, false)}`, `SUMMARY:${escapeIcs(event.title)}`);
    if (event.location) lines.push(`LOCATION:${escapeIcs(event.location)}`);
    if (event.url) lines.push(`URL:${event.url}`);
    if (event.notes) lines.push(`DESCRIPTION:${escapeIcs(event.notes)}`);
    const recurrence = recurrenceToIcs(event.recurrence);
    if (recurrence) lines.push(`RRULE:${recurrence}`);
    for (const minutes of event.alerts) {
      lines.push("BEGIN:VALARM", `TRIGGER:-PT${minutes}M`, "ACTION:DISPLAY", `DESCRIPTION:${escapeIcs(event.title)}`, "END:VALARM");
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}

export function downloadText(filename: string, content: string, mime = "text/plain;charset=utf-8"): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function safeColor(color?: string): string {
  return /^#[0-9a-f]{6}$/i.test(color ?? "") ? color! : "#78634b";
}

export function nextMidnightDelay(): number {
  const next = new Date();
  next.setHours(24, 0, 1, 0);
  return Math.max(1_000, next.getTime() - Date.now());
}
