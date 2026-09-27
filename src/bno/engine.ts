import { DateTime } from 'luxon';
import { addDays, anniversary, date, dayNumber, daysBetween, fromDayNumber, ukDay } from './dates';
import { RULES } from './rules';
import type { Counts, Day, Flight, Issue, Mode, Rolling, State, Timeline, Trip, WindowTotal } from './types';

const max = (a: Day, b: Day) => a > b ? a : b;
const min = (a: Day, b: Day) => a < b ? a : b;
export function tripCounts(trip: Trip, today: Day): Counts {
  const end = trip.returned ?? today;
  return { official: Math.max(0, daysBetween(trip.departure, end) - 1),
    conservative: Math.max(0, daysBetween(trip.departure, end) + 1) };
}
export function buildTimeline(state: State, today: Day, asOf?: string): Timeline {
  date(today);
  const cutoff = asOf ? Date.parse(asOf) : DateTime.fromISO(today, { zone: RULES.zone }).endOf('day').toMillis();
  const issues: Issue[] = [];
  const trips: Trip[] = [];
  const issue = (ids: string[], message: string, blocking = true) => issues.push({ recordIds: ids, message, blocking });
  const flights = [...state.flights].sort((a, b) => Date.parse(a.departure_at) - Date.parse(b.departure_at) || a.id.localeCompare(b.id));
  let active: Trip | undefined;
  let previous: Flight | undefined;
  let known: 'uk' | 'outside' | 'unknown' = 'unknown';
  const seen = new Map<string, string>();
  for (const flight of flights) {
    const dep = Date.parse(flight.departure_at), arr = Date.parse(flight.arrival_at);
    if (!Number.isFinite(dep) || !Number.isFinite(arr) || arr <= dep) { issue([flight.id], 'Arrival must be after departure.'); continue; }
    let departure: Day, returned: Day;
    try { departure = ukDay(flight.departure_at); returned = ukDay(flight.arrival_at); }
    catch { issue([flight.id], 'Flight timestamps need an explicit timezone.'); continue; }
    if (departure > today || dep > cutoff) { issue([flight.id], 'Future flight is excluded from actual totals. Save future journeys in Planning.'); continue; }
    const signature = [flight.departure_airport.code, flight.arrival_airport.code, dep, arr].join('|');
    if (seen.has(signature)) { issue([seen.get(signature)!, flight.id], 'Duplicate flight; counted once until corrected.'); continue; }
    seen.set(signature, flight.id);
    if (previous && Date.parse(previous.arrival_at) > dep) issue([previous.id, flight.id], 'Flights overlap in time.');
    if (previous && previous.arrival_airport.countryCode !== flight.departure_airport.countryCode) {
      const between = state.manual.some(m => m.departed_uk_date >= ukDay(previous!.arrival_at) && (m.returned_uk_date ?? today) <= departure);
      if (!between) issue([previous.id, flight.id], 'Unrecorded journey between countries; review the itinerary.');
    }
    const out = flight.departure_airport.uk && !flight.arrival_airport.uk;
    const into = !flight.departure_airport.uk && flight.arrival_airport.uk;
    if ([flight.departure_airport.countryCode, flight.arrival_airport.countryCode].some(c => ['JE', 'GG', 'IM'].includes(c))) issue([flight.id], 'Crown Dependency travel needs rule-specific review; no exemption has been assumed.');
    if (out) {
      if (active) issue([active.id, flight.id], 'UK exit while a previous absence is still open.');
      else {
        active = { id: flight.id, source: 'flight', departure, returned: null, countries: [], flights: [], notes: '' };
        trips.push(active);
      }
      known = 'outside';
    } else if (into && !active) {
      // A first entry can close an explicitly recorded initial/manual absence.
      const initial = state.manual.find(m => m.departed_uk_date <= returned && m.returned_uk_date === returned);
      if (!initial) issue([flight.id], known === 'uk' ? 'UK entry while already recorded in the UK.' : 'UK entry has no recorded exit or initial manual absence.');
    } else if (!flight.departure_airport.uk && !flight.arrival_airport.uk && !active) {
      const manual = state.manual.find(m => m.departed_uk_date <= departure && (m.returned_uk_date ?? today) >= returned);
      if (!manual) issue([flight.id], 'Foreign flight has no preceding UK exit or manual absence.');
    } else if (flight.departure_airport.uk && flight.arrival_airport.uk && active) issue([flight.id, active.id], 'Domestic flight while recorded outside the UK.');
    if (active) {
      active.flights.push(flight);
      for (const airport of [flight.departure_airport, flight.arrival_airport]) if (!airport.uk && !active.countries.includes(airport.country)) active.countries.push(airport.country);
      if (into && arr <= cutoff) { active.returned = returned; active = undefined; }
    }
    if ((into && arr <= cutoff) || (flight.departure_airport.uk && flight.arrival_airport.uk)) known = 'uk';
    previous = flight;
  }
  for (const manual of state.manual) {
    try { date(manual.departed_uk_date); if (manual.returned_uk_date) date(manual.returned_uk_date); }
    catch { issue([manual.id], 'Manual trip has an invalid date.'); continue; }
    if ((manual.returned_uk_date && manual.returned_uk_date < manual.departed_uk_date) || manual.departed_uk_date > today || (manual.returned_uk_date && manual.returned_uk_date > today)) {
      issue([manual.id], 'Manual actual trip has reversed or future dates; use Planning for future journeys.'); continue;
    }
    if (manual.countries.some(c => /jersey|guernsey|isle of man|channel islands|^(JE|GG|IM)$/i.test(c))) issue([manual.id], 'Crown Dependency travel needs rule-specific review.');
    trips.push({ id: manual.id, source: 'manual', departure: manual.departed_uk_date, returned: manual.returned_uk_date,
      countries: manual.countries, flights: [], notes: manual.notes, departureLocation: manual.departure_location, returnLocation: manual.return_location });
  }
  for (const manual of trips.filter(t => t.source === 'manual')) {
    for (const f of flights) {
      if (!Number.isFinite(Date.parse(f.departure_at)) || !Number.isFinite(Date.parse(f.arrival_at))) continue;
      const contact = [f.departure_airport.uk ? ukDay(f.departure_at) : null, f.arrival_airport.uk ? ukDay(f.arrival_at) : null];
      if (contact.some(day => day && day > manual.departure && day < (manual.returned ?? addDays(today, 1)))) issue([manual.id, f.id], 'A flight records UK presence inside a manual absence.');
    }
  }
  const coverage = state.settings.coverage_start;
  if (coverage && state.settings.initial_location === 'uk') {
    const inconsistent = trips.find(t => t.departure < coverage && (!t.returned || t.returned > coverage));
    if (inconsistent) issue([inconsistent.id], 'Initial UK location conflicts with an absence covering the start of history.');
  }
  trips.sort((a, b) => a.departure.localeCompare(b.departure) || a.id.localeCompare(b.id));
  for (let i = 0; i < trips.length; i++) {
    if (!trips[i].returned) issue([trips[i].id], 'Open trip: today is provisional until the UK day ends.', false);
    for (let j = i + 1; j < trips.length && trips[j].departure < (trips[i].returned ?? addDays(today, 1)); j++) {
      issue([trips[i].id, trips[j].id], 'Overlapping absences; review the source records. Shared days are counted once.');
    }
  }
  return { trips, issues, settings: state.settings, today };
}
export function locationOn(timeline: Timeline, day: Day): 'uk' | 'outside' | 'travel' | 'unknown' {
  if (day > timeline.today || timeline.issues.some(i => i.blocking)) return 'unknown';
  if (timeline.trips.some(t => t.departure === day || t.returned === day)) return 'travel';
  if (timeline.trips.some(t => t.departure < day && (!t.returned || t.returned > day))) return 'outside';
  const { coverage_start: coverage, initial_location: initial } = timeline.settings;
  if (!coverage || day < coverage || initial === 'unknown') return 'unknown';
  if (initial === 'uk') return 'uk';
  return timeline.trips.some(t => t.returned && t.returned <= day && t.returned >= coverage) ? 'uk' : 'unknown';
}
export function currentLocation(timeline: Timeline, now: string): { state: string; country?: string; trip?: Trip } {
  if (timeline.issues.some(i => i.blocking)) return { state: 'Location state needs review' };
  const instant = Date.parse(now);
  const active = timeline.trips.find(t => {
    if (t.source === 'manual') return t.departure <= timeline.today && (!t.returned || t.returned > timeline.today);
    const first = t.flights[0], last = t.flights.at(-1)!;
    return Date.parse(first.departure_at) <= instant && (!t.returned || Date.parse(last.arrival_at) > instant);
  });
  if (active) {
    const flight = active.flights.filter(f => Date.parse(f.departure_at) <= instant).at(-1);
    return { state: flight && Date.parse(flight.arrival_at) > instant ? 'In transit outside UK' : 'Outside UK',
      country: flight ? flight.arrival_airport.country : active.countries.at(-1), trip: active };
  }
  const location = locationOn(timeline, timeline.today);
  return { state: location === 'uk' || location === 'travel' ? 'In UK' : 'Location state needs review' };
}
function interval(trip: Trip, mode: Mode, today: Day): [Day, Day] {
  return mode === 'official' ? [addDays(trip.departure, 1), addDays(trip.returned ?? today, -1)] : [trip.departure, trip.returned ?? today];
}
export function countWindow(trips: Trip[], start: Day, end: Day, today: Day): Counts {
  const count = (mode: Mode) => {
    const ranges = trips.map(t => interval(t, mode, today)).map(([s, e]) => [max(s, start), min(e, end)])
      .filter(([s, e]) => s <= e).sort((a, b) => a[0].localeCompare(b[0]));
    let total = 0, last = -Infinity;
    for (const [s, e] of ranges) { const a = Math.max(dayNumber(s), last + 1), b = dayNumber(e); if (a <= b) total += b - a + 1; last = Math.max(last, b); }
    return total;
  };
  return { official: count('official'), conservative: count('conservative') };
}
export function historyComplete(t: Timeline, start: Day): boolean {
  const s = t.settings;
  return Boolean(s.coverage_start && s.coverage_start <= start && s.initial_location !== 'unknown'
    && (s.initial_location === 'uk' || t.trips.some(trip => trip.departure <= s.coverage_start! && (!trip.returned || trip.returned >= s.coverage_start!)))
    && !t.issues.some(i => i.blocking));
}
export function rollingAbsences(t: Timeline, horizon: Day = t.today): Rolling | null {
  const start = t.settings.bno_start_date;
  const end = t.settings.ilr_date ? min(t.settings.ilr_date, horizon) : horizon;
  if (!start || start > end) return null;
  const first = dayNumber(start), last = dayNumber(end), length = last - first + 1;
  if (length > 73050) throw new Error('Choose a residence period of no more than 200 years.');
  const prefixes = (mode: Mode) => {
    const deltas = new Int32Array(length + 1);
    for (const trip of t.trips) {
      const [s, e] = interval(trip, mode, horizon);
      const a = Math.max(first, dayNumber(s)), b = Math.min(last, dayNumber(e));
      if (a <= b) { deltas[a - first]++; deltas[b - first + 1]--; }
    }
    const sums = new Int32Array(length + 1); let active = 0;
    for (let i = 0; i < length; i++) { active += deltas[i]; sums[i + 1] = sums[i] + Number(active > 0); }
    return sums;
  };
  const official = prefixes('official'), conservative = prefixes('conservative');
  const points: WindowTotal[] = [];
  for (let i = 0; i < length; i++) {
    const e = fromDayNumber(first + i), s = addDays(anniversary(e, 12), 1);
    const a = Math.max(0, dayNumber(s) - first);
    points.push({ start: s, end: e, official: official[i + 1] - official[a], conservative: conservative[i + 1] - conservative[a] });
  }
  return { points, current: points.at(-1)!, worst: points.reduce((a, b) => b.official > a.official ? b : a),
    conservativeWorst: points.reduce((a, b) => b.conservative > a.conservative ? b : a), complete: historyComplete(t, start), issues: t.issues };
}
export function citizenship(t: Timeline, application = t.settings.citizenship_application_date) {
  if (!application) return null;
  const anniversaryDay = anniversary(application, 60), start = addDays(anniversaryDay, 1);
  const yearAnniversary = anniversary(application, 12), yearStart = addDays(yearAnniversary, 1);
  const presence = (day: Day) => { const l = locationOn(t, day); return l === 'uk' || l === 'travel' ? 'Yes' : l === 'outside' ? 'No' : 'Unknown'; };
  return { start, end: application, yearStart, anniversaryDay, yearAnniversary,
    five: countWindow(t.trips, start, application, t.today), year: countWindow(t.trips, yearStart, application, t.today),
    alternativeFive: countWindow(t.trips, anniversaryDay, application, t.today), alternativeYear: countWindow(t.trips, yearAnniversary, application, t.today),
    presence: presence(start), anniversaryPresence: presence(anniversaryDay),
    complete: historyComplete(t, anniversaryDay), projected: application > t.today,
    leapBoundary: application.slice(5) === '02-29' || anniversaryDay.slice(5) !== application.slice(5) };
}
export interface Proposal { departure: Day; returned: Day; destination?: string; closeTripId?: string }
export function simulateTrip(t: Timeline, p: Proposal, planned: Trip[] = []): Timeline {
  date(p.departure); date(p.returned);
  if (p.returned < p.departure) throw new Error('Return cannot be before departure.');
  if (!p.closeTripId && p.departure < t.today) throw new Error('A new simulation must depart today or later.');
  if (p.returned < t.today) throw new Error('A simulated return must be today or later.');
  const open = t.trips.filter(trip => !trip.returned);
  if (open.length && !p.closeTripId) throw new Error('Select the open trip to simulate its return first.');
  const closing = p.closeTripId ? t.trips.find(trip => trip.id === p.closeTripId && !trip.returned) : undefined;
  if (p.closeTripId && (!closing || closing.departure !== p.departure)) throw new Error('Select a valid open trip and keep its departure date.');
  const others = [...t.trips.filter(trip => trip.id !== p.closeTripId), ...planned];
  for (const plan of planned) {
    if (others.some(other => other.id !== plan.id && plan.departure < (other.returned ?? p.returned) && plan.returned! > other.departure)) throw new Error('Selected plans overlap actual travel or each other. Review the saved plans first.');
  }
  if (others.some(trip => p.departure < (trip.returned ?? p.returned) && p.returned > trip.departure)) throw new Error('This proposal overlaps an existing trip or selected plan.');
  const trip: Trip = closing ? { ...closing, returned: p.returned } : { id: 'simulation', source: 'planned', departure: p.departure, returned: p.returned, countries: [p.destination || 'Proposed trip'], flights: [], notes: '' };
  return { ...t, trips: [...others, trip], today: max(t.today, p.returned), issues: t.issues.filter(i => i.blocking || !i.recordIds.includes(p.closeTripId ?? '')) };
}
export function plannedAsTrips(state: State): Trip[] {
  return state.planned.filter(p => p.status === 'planned').map(p => ({ id: p.id, source: 'planned', departure: p.departure_date,
    returned: p.return_date, countries: [p.destination || 'Planned trip'], flights: [], notes: p.notes }));
}
export function latestSafeReturn(t: Timeline, departure: Day, mode: Mode, planned: Trip[] = [], closeTripId?: string): { date: Day | null; message: string; total?: number } {
  const base = rollingAbsences(t);
  if (!base || !base.complete) return { date: null, message: 'Complete the BNO dates, coverage, and data review before calculating a latest return.' };
  if ((mode === 'official' ? base.worst.official : base.conservativeWorst.conservative) > RULES.bno) return { date: null, message: 'Existing history already exceeds the configured limit.' };
  if (t.settings.ilr_date && departure >= t.settings.ilr_date) return { date: null, message: 'BNO monitoring has ended at ILR; use citizenship projections.' };
  if (departure < t.settings.bno_start_date!) return { date: null, message: 'Departure must fall within the configured BNO period.' };
  let safe: Day | null = null, total = 0;
  // A continuous absence must breach within limit + two travel days, unless ILR ends monitoring.
  const firstReturn = max(departure, t.today);
  const end = addDays(departure, RULES.bno + 2);
  for (let returned = firstReturn; returned <= end; returned = addDays(returned, 1)) {
    let simulation: Timeline;
    try { simulation = simulateTrip(t, { departure, returned, closeTripId }, planned); }
    catch (error) { return { date: null, message: error instanceof Error ? error.message : 'Conflicting travel.' }; }
    const horizon = planned.reduce((a, p) => max(a, p.returned!), returned);
    const result = rollingAbsences(simulation, horizon)!;
    const value = mode === 'official' ? result.worst.official : result.conservativeWorst.conservative;
    if (value > RULES.bno) return { date: safe, total, message: safe ? 'Last return within the configured BNO allowance; the next day exceeds it.' : 'No return date satisfies the configured allowance.' };
    safe = returned; total = value;
    if (t.settings.ilr_date && returned >= t.settings.ilr_date) return { date: null, total, message: 'No finite BNO return limit before the recorded ILR cutoff. Citizenship limits still apply.' };
  }
  return { date: null, message: 'No safe boundary could be established; review the residence period.' };
}
export function validateSettings(s: State['settings'], today: Day): void {
  for (const day of [s.bno_start_date, s.ilr_date, s.citizenship_application_date, s.coverage_start]) if (day) date(day);
  if (s.ilr_date && (s.ilr_date > today || (s.bno_start_date && s.ilr_date < s.bno_start_date))) throw new Error('Enter an actual ILR date, on or after BNO start and no later than today.');
  if (s.coverage_start && s.coverage_start > today) throw new Error('History coverage cannot begin in the future.');
  if (s.warning_thresholds.length !== 3 || s.warning_thresholds.some((v, i, all) => !Number.isFinite(v) || v <= 0 || v >= 100 || (i > 0 && v <= all[i - 1]))) throw new Error('Warning thresholds must be three increasing percentages between 0 and 100.');
}
export function nextUKMidnightDelay(now = DateTime.now()): number {
  const uk = now.setZone(RULES.zone); return Math.max(1000, uk.plus({ days: 1 }).startOf('day').toMillis() - uk.toMillis() + 100);
}
