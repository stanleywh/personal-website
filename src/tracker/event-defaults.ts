import { DateTime } from "luxon";
import type { CalendarEventRecord } from "./types";

export const CALENDAR_SNAP_MINUTES = 30;
export const DEFAULT_EVENT_DURATION_MINUTES = 60;

export interface EventCreationDefaults {
  start: Date;
  end: Date;
  allDay: boolean;
}

export interface EventDialogTiming extends EventCreationDefaults {
  timezone: string;
}

type ExistingEventTiming = Pick<
  CalendarEventRecord,
  "startAt" | "endAt" | "allDay" | "timezone"
>;

export function addDefaultEventDuration(start: Date): Date {
  return new Date(start.getTime() + DEFAULT_EVENT_DURATION_MINUTES * 60_000);
}

export function roundUpToCalendarInterval(
  value: DateTime,
  intervalMinutes = CALENDAR_SNAP_MINUTES,
): DateTime {
  if (!Number.isInteger(intervalMinutes) || intervalMinutes <= 0) {
    throw new RangeError("Calendar interval must be a positive whole number of minutes.");
  }

  const elapsedMinutes = value.hour * 60 + value.minute;
  const hasPartialMinute = value.second !== 0 || value.millisecond !== 0;
  const remainder = elapsedMinutes % intervalMinutes;
  const minutesToAdd = remainder === 0 && !hasPartialMinute
    ? 0
    : intervalMinutes - remainder;

  return value
    .plus({ minutes: minutesToAdd })
    .set({ second: 0, millisecond: 0 });
}

export function calendarPointDefaults(
  start: Date,
  allDay: boolean,
  timezone: string,
): EventCreationDefaults {
  if (allDay) {
    const end = DateTime
      .fromJSDate(start)
      .setZone(timezone)
      .plus({ days: 1 })
      .toJSDate();
    return { start, end, allDay: true };
  }

  return {
    start,
    end: addDefaultEventDuration(start),
    allDay: false,
  };
}

export function calendarSelectionDefaults(
  start: Date,
  end: Date,
  allDay: boolean,
): EventCreationDefaults {
  return { start, end, allDay };
}

export function toolbarEventDefaults(
  selectedDate: Date,
  now: Date,
  timezone: string,
  intervalMinutes = CALENDAR_SNAP_MINUTES,
): EventCreationDefaults {
  const selectedDay = DateTime.fromJSDate(selectedDate).setZone(timezone);
  const currentTime = DateTime.fromJSDate(now).setZone(timezone);
  const combined = selectedDay.set({
    hour: currentTime.hour,
    minute: currentTime.minute,
    second: currentTime.second,
    millisecond: currentTime.millisecond,
  });
  const start = roundUpToCalendarInterval(combined, intervalMinutes).toJSDate();

  return {
    start,
    end: addDefaultEventDuration(start),
    allDay: false,
  };
}

export function resolveEventDialogTiming(
  existing: ExistingEventTiming | undefined,
  creation: EventCreationDefaults,
  fallbackTimezone: string,
): EventDialogTiming {
  if (existing) {
    return {
      start: new Date(existing.startAt),
      end: new Date(existing.endAt),
      allDay: existing.allDay,
      timezone: existing.timezone,
    };
  }

  return { ...creation, timezone: fallbackTimezone };
}
