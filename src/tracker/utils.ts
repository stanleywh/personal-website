import type { CalendarEventRecord, RecurrenceRule, RevisionSession } from "./types";

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
