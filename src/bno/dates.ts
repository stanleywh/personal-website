import { DateTime, IANAZone } from 'luxon';
import { RULES } from './rules';
import type { Day } from './types';
export const todayUK = (): Day => DateTime.now().setZone(RULES.zone).toISODate()!;
export function date(day: Day): DateTime {
  const value = DateTime.fromISO(day, { zone: 'UTC' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !value.isValid) throw new Error('Enter a valid date.');
  return value;
}
export const addDays = (day: Day, days: number): Day => date(day).plus({ days }).toISODate()!;
export const anniversary = (day: Day, months: number): Day => date(day).minus({ months }).toISODate()!;
export const dayNumber = (day: Day): number => Math.floor(date(day).toMillis() / 86400000);
export const fromDayNumber = (value: number): Day => DateTime.fromMillis(value * 86400000, { zone: 'UTC' }).toISODate()!;
export const daysBetween = (start: Day, end: Day): number => dayNumber(end) - dayNumber(start);
export const ukDay = (instant: string): Day => {
  const dt = DateTime.fromISO(instant, { setZone: true }).setZone(RULES.zone);
  if (!dt.isValid || !/(Z|[+-]\d{2}:\d{2})$/.test(instant)) throw new Error('A timezone-aware timestamp is required.');
  return dt.toISODate()!;
};
export const displayDay = (day: Day): string => date(day).toFormat('dd LLL yyyy');
export function localTimeOptions(local: string, zone: string): Array<{ utc: string; offset: string }> {
  if (!IANAZone.isValidZone(zone)) throw new Error('Select a valid IANA airport timezone.');
  const value = DateTime.fromISO(local, { zone });
  if (!value.isValid || value.toFormat("yyyy-MM-dd'T'HH:mm") !== local) throw new Error('This local time does not exist in the airport timezone.');
  return value.getPossibleOffsets().map(dt => ({ utc: dt.toUTC().toISO()!, offset: dt.toFormat('ZZ') }));
}
export function flightInstant(local: string, zone: string, offset?: string): string {
  const choices = localTimeOptions(local, zone);
  if (choices.length > 1 && !offset) throw new Error(`Ambiguous local time: choose UTC offset ${choices.map(c => c.offset).join(' or ')}.`);
  const chosen = offset ? choices.find(c => c.offset === offset) : choices[0];
  if (!chosen) throw new Error('The selected UTC offset does not match this airport time.');
  return chosen.utc;
}
