import { describe, expect, it } from 'vitest';
import { DateTime, Settings as LuxonSettings } from 'luxon';
import { addDays, anniversary, flightInstant, fromDayNumber, dayNumber, localTimeOptions, ukDay } from '../src/bno/dates';
import { buildTimeline, citizenship, countWindow, currentLocation, historyComplete, latestSafeReturn, locationOn, rollingAbsences, simulateTrip, tripCounts, validateSettings } from '../src/bno/engine';
import { emptyState, type Airport, type Flight, type State, type Trip } from '../src/bno/types';
import { warningLevel } from '../src/bno/rules';
const airport = (code: string, country: string, zone: string, uk = false): Airport => ({ code, name: code, city: code, country, countryCode: uk ? 'GB' : country === 'Japan' ? 'JP' : 'HK', timezone: zone, uk, latitude: 0, longitude: 0 });
const LHR = airport('LHR', 'United Kingdom', 'Europe/London', true), HKG = airport('HKG', 'Hong Kong', 'Asia/Hong_Kong'), NRT = airport('NRT', 'Japan', 'Asia/Tokyo');
const flight = (id: string, a: Airport, b: Airport, dep: string, arr: string): Flight => ({ id, version: 1, departure_airport: a, arrival_airport: b, departure_at: dep, arrival_at: arr, notes: '', airline: '', flight_number: '', booking_reference: '' });
const trip = (departure: string, returned: string | null, id = departure): Trip => ({ id, source: 'manual', departure, returned, countries: ['Hong Kong'], flights: [], notes: '' });
function stateWith(trips: Trip[] = []): State {
  const state = emptyState(); state.settings = { ...state.settings, bno_start_date: '2020-01-01', coverage_start: '2020-01-01', initial_location: 'uk' };
  state.manual = trips.map(t => ({ id: t.id, version: 1, departed_uk_date: t.departure, returned_uk_date: t.returned, countries: t.countries, departure_location: '', return_location: '', notes: '' })); return state;
}
const exampleFlights = [flight('1', LHR, HKG, '2026-07-02T21:15:00Z', '2026-07-03T09:40:00Z'), flight('2', HKG, NRT, '2026-07-15T01:00:00Z', '2026-07-15T05:00:00Z'), flight('3', NRT, HKG, '2026-07-25T01:00:00Z', '2026-07-25T05:00:00Z'), flight('4', HKG, LHR, '2026-09-10T22:00:00Z', '2026-09-11T12:00:00Z')];
describe('absence engine', () => {
  it('derives one absence across four flights including overnight and foreign legs', () => {
    const state = stateWith(); state.flights = exampleFlights;
    const t = buildTimeline(state, '2026-09-26'); expect(t.issues).toEqual([]); expect(t.trips).toHaveLength(1);
    expect(t.trips[0].countries).toEqual(['Hong Kong', 'Japan']); expect(t.trips[0].flights).toHaveLength(4);
    expect(tripCounts(t.trips[0], t.today)).toEqual({ official: 70, conservative: 72 });
  });
  it.each([['2026-07-02', '2026-07-02', 0, 1], ['2026-07-02', '2026-07-03', 0, 2], ['2024-02-28', '2024-03-01', 1, 3], ['2025-12-30', '2026-01-02', 2, 4], ['2026-01-15', '2026-04-15', 89, 91]])('counts boundaries %s to %s', (s, e, o, c) => expect(tripCounts(trip(s, e), e)).toEqual({ official: o, conservative: c }));
  it('counts open trips through yesterday officially and today conservatively', () => expect(tripCounts(trip('2026-07-02', null), '2026-07-26')).toEqual({ official: 23, conservative: 25 }));
  it('unions shared boundaries and overlapping intervals', () => {
    expect(countWindow([trip('2026-01-01', '2026-01-05'), trip('2026-01-05', '2026-01-10')], '2026-01-01', '2026-01-10', '2026-01-10')).toEqual({ official: 7, conservative: 10 });
    expect(countWindow([trip('2026-01-01', '2026-01-10'), trip('2026-01-03', '2026-01-08')], '2026-01-01', '2026-01-10', '2026-01-10')).toEqual({ official: 8, conservative: 10 });
  });
  it.each([180, 181])('handles %i BNO days exactly', n => {
    const t = buildTimeline(stateWith([trip('2026-01-01', addDays('2026-01-01', n + 1))]), '2026-09-26');
    expect(rollingAbsences(t)!.worst.official).toBe(n); expect(warningLevel(n, 180)).toBe(n === 180 ? 'Critical' : 'Exceeded');
  });
  it('finds a historical maximum, not merely today, across individually safe trips', () => {
    const t = buildTimeline(stateWith([trip('2023-01-01', '2023-04-12'), trip('2023-06-01', '2023-09-11')]), '2026-09-26');
    const r = rollingAbsences(t)!; expect(r.worst.official).toBe(201); expect(r.current.official).toBe(0); expect(r.worst.end).toBe('2023-09-10');
  });
  it.each([450, 451])('counts %i citizenship five-year days', n => {
    const t = buildTimeline(stateWith([trip('2021-01-01', addDays('2021-01-01', n + 1))]), '2026-01-01');
    expect(citizenship(t, '2026-01-01')!.five.official).toBe(n);
  });
  it.each([90, 91])('counts %i final-year days', n => {
    const t = buildTimeline(stateWith([trip('2025-01-01', addDays('2025-01-01', n + 1))]), '2026-01-01');
    expect(citizenship(t, '2026-01-01')!.year.official).toBe(n); expect(citizenship(t, '2027-01-01')!.year.official).toBe(0);
  });
  it('exposes both citizenship boundary interpretations and presence', () => {
    const t = buildTimeline(stateWith([trip('2021-01-01', '2021-01-03')]), '2026-01-01');
    const c = citizenship(t, '2026-01-01')!; expect(c.start).toBe('2021-01-02'); expect(c.presence).toBe('No'); expect(c.anniversaryPresence).toBe('Yes');
    expect(citizenship(t, '2028-02-29')!.leapBoundary).toBe(true);
  });
  it('flags duplicates without doubling totals', () => {
    const state = stateWith(); state.flights = [exampleFlights[0], { ...exampleFlights[0], id: 'duplicate' }, exampleFlights[3]];
    const t = buildTimeline(state, '2026-09-26'); expect(t.issues.some(i => i.message.includes('Duplicate'))).toBe(true); expect(tripCounts(t.trips[0], t.today).official).toBe(70); expect(historyComplete(t, '2021-01-01')).toBe(false);
  });
  it('flags contradictory flights, unknown foreign legs and reversed times', () => {
    for (const flights of [[exampleFlights[0], { ...exampleFlights[0], id: 'again', departure_at: '2026-07-04T01:00:00Z', arrival_at: '2026-07-04T12:00:00Z' }], [exampleFlights[1]], [{ ...exampleFlights[0], arrival_at: '2026-07-01T00:00:00Z' }]]) {
      const state = stateWith(); state.flights = flights; expect(buildTimeline(state, '2026-09-26').issues.some(i => i.blocking)).toBe(true);
    }
  });
  it('combines manual and flight trips; detects overlapping source records', () => {
    const state = stateWith([trip('2026-01-01', '2026-01-04')]); state.flights = exampleFlights;
    let t = buildTimeline(state, '2026-09-26'); expect(t.trips).toHaveLength(2); expect(rollingAbsences(t)!.current.official).toBe(72);
    state.manual[0].departed_uk_date = '2026-07-04'; state.manual[0].returned_uk_date = '2026-07-10'; t = buildTimeline(state, '2026-09-26'); expect(t.issues.some(i => i.message.includes('Overlapping'))).toBe(true);
  });
  it('starts empty and unknown; coverage is explicit', () => {
    const t = buildTimeline(emptyState(), '2026-09-26'); expect(t.trips).toEqual([]); expect(locationOn(t, t.today)).toBe('unknown'); expect(rollingAbsences(t)).toBeNull(); expect(citizenship(t)).toBeNull();
    expect(locationOn(buildTimeline(stateWith(), t.today), t.today)).toBe('uk');
  });
  it('does not mutate actuals when simulating; supports closure of an open trip', () => {
    const t = buildTimeline(stateWith(), '2026-09-26'), original = JSON.stringify(t);
    const s = simulateTrip(t, { departure: '2027-06-15', returned: '2027-08-20' }); expect(tripCounts(s.trips[0], s.today)).toEqual({ official: 65, conservative: 67 }); expect(JSON.stringify(t)).toBe(original);
    const open = buildTimeline(stateWith([trip('2026-07-02', null)]), '2026-08-01');
    expect(() => simulateTrip(open, { departure: '2026-08-02', returned: '2026-08-03' })).toThrow('open trip');
    expect(simulateTrip(open, { departure: '2026-07-02', returned: '2026-09-11', closeTripId: '2026-07-02' }).trips[0].returned).toBe('2026-09-11');
  });
  it('latest return uses historical rolling interactions and validates adjacent dates', () => {
    const t = buildTimeline(stateWith([trip('2025-10-01', '2026-01-10')]), '2026-09-26');
    for (const mode of ['official', 'conservative'] as const) {
      const result = latestSafeReturn(t, '2026-10-01', mode); expect(result.date).not.toBeNull();
      const at = rollingAbsences(simulateTrip(t, { departure: '2026-10-01', returned: result.date! }))!;
      const after = rollingAbsences(simulateTrip(t, { departure: '2026-10-01', returned: addDays(result.date!, 1) }))!;
      expect(mode === 'official' ? at.worst.official : at.conservativeWorst.conservative).toBe(180);
      expect(mode === 'official' ? after.worst.official : after.conservativeWorst.conservative).toBe(181);
    }
  }, 10_000);
  it('refuses safe labels for unknown history and existing breaches', () => {
    expect(latestSafeReturn(buildTimeline(emptyState(), '2026-09-26'), '2026-10-01', 'official').date).toBeNull();
    const t = buildTimeline(stateWith([trip('2026-01-01', '2026-08-01')]), '2026-09-26'); expect(latestSafeReturn(t, '2026-10-01', 'official').message).toContain('already exceeds');
  });
  it('clips BNO at ILR without clipping citizenship', () => {
    const state = stateWith([trip('2026-01-01', '2026-04-01')]); state.settings.ilr_date = '2026-02-01'; const t = buildTimeline(state, '2026-09-26');
    expect(rollingAbsences(t)!.current.end).toBe('2026-02-01'); expect(rollingAbsences(t)!.worst.official).toBe(31); expect(citizenship(t, '2026-09-26')!.year.official).toBe(89);
  });
  it('does not depend on the computer timezone', () => {
    const before = LuxonSettings.defaultZone;
    try {
      for (const zone of ['Pacific/Auckland', 'America/Los_Angeles', 'UTC']) { LuxonSettings.defaultZone = zone; expect(ukDay('2026-07-02T23:30:00Z')).toBe('2026-07-03'); expect(tripCounts(trip('2026-07-02', '2026-09-11'), '2026-09-26').official).toBe(70); }
    } finally { LuxonSettings.defaultZone = before; }
  });
  it('handles DST gaps and ambiguous times and overnight date-line journeys', () => {
    expect(() => flightInstant('2026-03-29T01:30', 'Europe/London')).toThrow('does not exist');
    expect(localTimeOptions('2026-10-25T01:30', 'Europe/London')).toHaveLength(2);
    expect(() => flightInstant('2026-10-25T01:30', 'Europe/London')).toThrow('Ambiguous');
    expect(flightInstant('2026-10-25T01:30', 'Europe/London', '+00:00')).toContain('01:30');
    expect(DateTime.fromISO(flightInstant('2026-07-02T12:00', 'Pacific/Honolulu')).toMillis()).toBeLessThan(DateTime.fromISO(flightInstant('2026-07-03T18:00', 'Asia/Tokyo')).toMillis());
  });
  it('matches an independent daily-set oracle over deterministic generated histories', () => {
    let seed = 17; const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    for (let sample = 0; sample < 6; sample++) {
      const trips: Trip[] = []; for (let i = 0; i < 12; i++) { const a = addDays('2023-01-01', Math.floor(random() * 500)); trips.push(trip(a, addDays(a, Math.floor(random() * 35) + 1), String(i))); }
      const state = stateWith(trips); state.settings.bno_start_date = '2023-01-01'; const t = buildTimeline(state, '2024-09-01'); const r = rollingAbsences(t)!;
      const sets = { official: new Set<number>(), conservative: new Set<number>() };
      for (const tr of trips) for (let n = dayNumber(tr.departure); n <= dayNumber(tr.returned!); n++) { sets.conservative.add(n); if (n > dayNumber(tr.departure) && n < dayNumber(tr.returned!)) sets.official.add(n); }
      for (const point of r.points.filter((_, i) => i % 17 === 0)) for (const mode of ['official', 'conservative'] as const) {
        const lo = dayNumber(addDays(anniversary(point.end, 12), 1)), hi = dayNumber(point.end);
        expect(point[mode]).toBe([...sets[mode]].filter(n => n >= lo && n <= hi).length);
      }
      expect(fromDayNumber(dayNumber('2024-02-29'))).toBe('2024-02-29');
    }
  });
  it('validates settings thresholds and actual ILR', () => {
    const s = stateWith().settings; s.warning_thresholds = [95, 70, 85]; expect(() => validateSettings(s, '2026-09-26')).toThrow('thresholds');
  });
  it('reports current destination for an open trip', () => {
    const state = stateWith(); state.flights = exampleFlights.slice(0, 2); const t = buildTimeline(state, '2026-07-20'); expect(currentLocation(t, '2026-07-20T12:00:00Z').country).toBe('Japan');
  });
});

describe('additional timeline and simulation safeguards', () => {
  it('keeps a return flight in progress open until its arrival instant', () => {
    const state = stateWith(); state.flights = [exampleFlights[0], flight('return', HKG, LHR, '2026-09-10T22:00:00Z', '2026-09-11T12:00:00Z')];
    const before = buildTimeline(state, '2026-09-11', '2026-09-11T08:00:00Z');
    expect(before.trips[0].returned).toBeNull(); expect(currentLocation(before, '2026-09-11T08:00:00Z').state).toContain('transit');
    const after = buildTimeline(state, '2026-09-11', '2026-09-11T13:00:00Z'); expect(after.trips[0].returned).toBe('2026-09-11');
    expect(tripCounts(before.trips[0], before.today).official).toBe(70); expect(tripCounts(after.trips[0], after.today).official).toBe(70);
  });
  it('detects overlapping flight instants and excludes future departures', () => {
    const state = stateWith(); state.flights = [exampleFlights[0], flight('overlap', HKG, NRT, '2026-07-03T08:00:00Z', '2026-07-03T12:00:00Z')];
    expect(buildTimeline(state, '2026-07-05').issues.some(i => i.message.includes('overlap'))).toBe(true);
    expect(buildTimeline(state, '2026-07-01').trips).toHaveLength(0);
  });
  it('rejects saved plans that overlap each other or actual travel', () => {
    const t = buildTimeline(stateWith(), '2026-09-26');
    expect(() => simulateTrip(t, { departure:'2027-03-01', returned:'2027-03-10' }, [trip('2027-01-01','2027-01-10','a'),trip('2027-01-05','2027-01-15','b')])).toThrow('Selected plans overlap');
  });
  it('does not label unrecorded initial overseas history complete', () => {
    const state = stateWith(); state.settings.initial_location = 'outside';
    const t = buildTimeline(state,'2026-09-26'); expect(historyComplete(t,'2021-01-01')).toBe(false); expect(locationOn(t,t.today)).toBe('unknown');
  });
  it('independently finds conservative and official worst windows and earliest ties', () => {
    const t = buildTimeline(stateWith([trip('2026-01-01','2026-01-04')]),'2026-09-26');const r=rollingAbsences(t)!;
    expect(r.worst.end).toBe('2026-01-03');expect(r.conservativeWorst.end).toBe('2026-01-04');expect(r.worst.official).toBe(2);expect(r.conservativeWorst.conservative).toBe(4);
  });
  it('handles a leap-year window with calendar months rather than fixed 365 days',()=>{
    const state=stateWith([trip('2023-02-28','2023-03-02')]);state.settings.bno_start_date='2023-01-01';const r=rollingAbsences(buildTimeline(state,'2024-02-29'))!;
    expect(r.current.start).toBe('2023-03-01');expect(r.current.official).toBe(1);
  });
  it('includes saved plans in the latest-return check without changing actual records',()=>{
    const t=buildTimeline(stateWith(),'2026-09-26');const original=JSON.stringify(t);
    const result=latestSafeReturn(t,'2026-10-01','official',[trip('2027-05-01','2027-08-01','plan')]);
    expect(result.date).not.toBeNull();expect(result.date!<'2027-03-31').toBe(true);expect(JSON.stringify(t)).toBe(original);
  });
});

describe('manual and declared presence consistency', () => {
  it('flags a UK flight inside a manual absence', () => {
    const state=stateWith([trip('2026-01-01','2026-01-10')]);state.flights=[flight('domestic',LHR,LHR,'2026-01-05T10:00:00Z','2026-01-05T11:00:00Z')];
    expect(buildTimeline(state,'2026-09-26').issues.some(i=>i.message.includes('UK presence inside'))).toBe(true);
  });
  it('flags coverage declared UK when the person was recorded abroad', () => {
    const state=stateWith([trip('2025-12-01','2026-01-10')]);state.settings.coverage_start='2026-01-01';
    expect(buildTimeline(state,'2026-09-26').issues.some(i=>i.message.includes('Initial UK location conflicts'))).toBe(true);
  });
});
