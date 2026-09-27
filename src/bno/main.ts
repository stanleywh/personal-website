import { Calendar } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import { DateTime } from 'luxon';
import { requireSupabase } from '../auth/client';
import { accountUrl } from '../auth/navigation';
import { authController } from '../auth/session';
import { createConfirmationDialog } from '../tracker/confirmation-dialog';
import '../tracker/tracker.css';
import './bno.css';
import { airportCombobox } from './airports';
import { addDays, date, flightInstant, todayUK, ukDay } from './dates';
import { buildTimeline, citizenship, locationOn, nextUKMidnightDelay, plannedAsTrips, rollingAbsences, simulateTrip, tripCounts, validateSettings } from './engine';
import { BnoAuthorizationError, BnoRepository, type TravelRecord } from './store';
import { button, chartHtml, chartReadout, esc, field, flightDetails, fmt, metric, notesField, notices, overview, range, rulesHtml, selectField, tripDetails, worstConservativeWindow } from './render';
import { RULES, warningLevel } from './rules';
import { emptyState, type Airport, type Flight, type ManualTrip, type PlannedTrip, type State, type Trip } from './types';
const $ = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T => root.querySelector<T>(selector)!;
const shell = $('[data-bno-shell]'), content = $('#bno-content'), status = $('[data-sync]'), pageError = $('[data-page-error]');
const owner = authController.state.user!.id;
const repo = new BnoRepository(requireSupabase(), owner);
let state: State = emptyState(), timeline = buildTimeline(state, todayUK(), new Date().toISOString()), tab = 'overview';
let calendar: Calendar | undefined, plannerWorker: Worker | undefined;
let active = true, refreshing = false, offline = false;
let historyView = 'trips', search = '', yearFilter = '', destinationFilter = '', sourceFilter = '', sort = 'newest';
let calendarMonth = todayUK().slice(5, 7);
let calendarView = 'month', calendarYear = DateTime.now().setZone(RULES.zone).year, includePlans = false;
const editor = $<HTMLDialogElement>('[data-editor]'), form = $<HTMLFormElement>('[data-editor-form]'), fields = $('[data-editor-fields]');
const details = $<HTMLDialogElement>('[data-details]');
let saveEditor: (() => Promise<void>) | undefined, editorTrigger: HTMLElement | null = null;
let editorPending = false;
const confirmation = createConfirmationDialog({ dialog: $('[data-confirm]'), title: $('#confirm-title'), message: $('[data-confirm-message]'), error: $('[data-confirm-error]'), cancel: $('[data-confirm-cancel]'), confirm: $('[data-confirm-accept]') });
function showError(error: unknown): void {
  if (!active) return;
  if (error instanceof BnoAuthorizationError) { lock(); return; }
  pageError.textContent = error instanceof Error ? error.message : 'Something went wrong.'; pageError.hidden = false;
}
function lock(): void {
  active = false; repo.dispose(); plannerWorker?.terminate(); calendar?.destroy(); shell.hidden = true;
  document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(d => d.close());
  state = emptyState(); content.replaceChildren(); window.location.replace(accountUrl('login', 'bno'));
}
authController.onChange(auth => {
  if (auth.phase === 'loading' && auth.user?.id === owner) return;
  if (auth.phase !== 'signedIn' || auth.user?.id !== owner) lock();
});
async function refresh(): Promise<void> {
  if (!active || refreshing) return; refreshing = true; status.textContent = 'Refreshing…';
  try { const result = await repo.load(); if (!active) return; state = result.state; offline = result.offline;
    status.textContent = `${offline ? 'Offline · read-only cache' : 'Synced'} · ${DateTime.fromISO(result.cachedAt).toFormat('dd LLL, HH:mm')}`;
    pageError.hidden = true; render();
  } catch (error) { status.textContent = 'Refresh failed · last loaded data retained'; showError(error); }
  finally { refreshing = false; }
}
function render(): void {
  if (!active) return;
  calendar?.destroy(); calendar = undefined; plannerWorker?.terminate(); plannerWorker = undefined;
  timeline = buildTimeline(state, todayUK(), new Date().toISOString());
  document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b => b.dataset.tab === tab ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'));
  if (tab === 'overview') content.innerHTML = overview(state, timeline);
  if (tab === 'history') renderHistory();
  if (tab === 'calendar') renderCalendar();
  if (tab === 'analysis') renderAnalysis();
  if (tab === 'planning') renderPlanning();
  if (tab === 'settings') renderSettings();
}
function navigate(next: string): void { tab = next; render(); content.focus(); }
function table(headers: string[], rows: string[][]): string {
  return `<table class="bno-table"><thead><tr>${headers.map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map((cell, i) => `<td data-label="${headers[i]}">${cell}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
function renderHistory(): void {
  const years = [...new Set(timeline.trips.map(t => t.departure.slice(0, 4)).concat(state.flights.map(f => ukDay(f.departure_at).slice(0, 4))))].sort().reverse();
  const countries = [...new Set(timeline.trips.flatMap(t => t.countries))].sort();
  content.innerHTML = `<section class="surface-card bno-panel"><div class="bno-toolbar"><h2>Travel History</h2><div class="segmented"><button data-history-view="trips" aria-pressed="${historyView === 'trips'}">Trips</button><button data-history-view="flights" aria-pressed="${historyView === 'flights'}">Flights</button></div></div><div class="bno-filters">${field('search', 'Search', search)}${selectField('year', 'Year', [['', 'All years'], ...years.map(y => [y, y] as [string, string])], yearFilter)}${selectField('destination', 'Destination', [['', 'All destinations'], ...countries.map(c => [c, c] as [string, string])], destinationFilter)}${selectField('source', 'Source', [['', 'All sources'], ['flight', 'Flight-derived'], ['manual', 'Manual']], sourceFilter)}${selectField('sort', 'Sort', [['newest', 'Newest first'], ['oldest', 'Oldest first'], ['days', 'Most official days'], ['destination', 'Destination A–Z']], sort)}</div><div data-history-rows></div></section>${notices(timeline)}`;
  renderHistoryRows();
  $('.bno-filters', content).addEventListener('input', event => {
    const target = event.target as HTMLInputElement; if (target.name === 'search') search = target.value; else if (target.name === 'year') yearFilter = target.value; else if (target.name === 'destination') destinationFilter = target.value; else if (target.name === 'source') sourceFilter = target.value; else if (target.name === 'sort') sort = target.value; renderHistoryRows();
  });
}
function renderHistoryRows(): void {
  const q = search.toLowerCase();
  if (historyView === 'trips') {
    const trips = timeline.trips.filter(t => (!yearFilter || (t.departure <= `${yearFilter}-12-31` && (t.returned ?? timeline.today) >= `${yearFilter}-01-01`)) && (!destinationFilter || t.countries.includes(destinationFilter)) && (!sourceFilter || t.source === sourceFilter) && `${t.countries.join(' ')} ${t.notes} ${t.flights.map(f => `${f.departure_airport.code} ${f.arrival_airport.code} ${f.flight_number} ${f.airline} ${f.notes}`).join(' ')}`.toLowerCase().includes(q));
    trips.sort((a, b) => sort === 'days' ? tripCounts(b, timeline.today).official - tripCounts(a, timeline.today).official : sort === 'destination' ? a.countries.join().localeCompare(b.countries.join()) : (sort === 'oldest' ? 1 : -1) * a.departure.localeCompare(b.departure));
    $('[data-history-rows]').innerHTML = trips.length ? table(['Destination(s)', 'Left UK', 'Returned', 'Official days', 'Conservative buffer', 'Flights'], trips.map(t => { const counts = tripCounts(t, timeline.today); return [button(t.countries.join(', ') || 'Trip details', `data-trip="${esc(t.id)}"`) + `<small>${t.source === 'flight' ? 'Derived from flights' : 'Manual entry'}</small>`, fmt(t.departure), fmt(t.returned), `<strong>${counts.official}</strong>`, String(counts.conservative), String(t.flights.length)]; })) : '<p>No matching trips. Add a flight or manual trip to begin.</p>';
  } else {
    const flights = state.flights.filter(f => (!yearFilter || ukDay(f.departure_at).startsWith(yearFilter)) && (!destinationFilter || [f.departure_airport.country, f.arrival_airport.country].includes(destinationFilter)) && sourceFilter !== 'manual' && `${f.departure_airport.code} ${f.arrival_airport.code} ${f.flight_number} ${f.airline} ${f.notes}`.toLowerCase().includes(q)).sort((a, b) => (sort === 'oldest' ? 1 : -1) * a.departure_at.localeCompare(b.departure_at));
    $('[data-history-rows]').innerHTML = flights.length ? table(['Date', 'Flight', 'Route', 'Departure', 'Arrival', 'Relevance'], flights.map(f => {
      const d = DateTime.fromISO(f.departure_at).setZone(f.departure_airport.timezone), a = DateTime.fromISO(f.arrival_at).setZone(f.arrival_airport.timezone);
      const delta = Math.round(date(a.toISODate()!).diff(date(d.toISODate()!), 'days').days);
      return [fmt(d.toISODate()!), button(f.flight_number || 'View flight', `data-flight="${esc(f.id)}"`), `${esc(f.departure_airport.code)} → ${esc(f.arrival_airport.code)}`, esc(d.toFormat('HH:mm ZZZZ')), `${esc(a.toFormat('HH:mm ZZZZ'))}${delta ? ` (${delta > 0 ? '+' : ''}${delta}d)` : ''}`, f.departure_airport.uk ? f.arrival_airport.uk ? 'UK domestic' : 'UK exit' : f.arrival_airport.uk ? 'UK entry' : 'Foreign travel'];
    })) : '<p>No matching flights.</p>';
  }
}
function renderAnalysis(): void {
  const r = rollingAbsences(timeline);
  const ending = state.settings.ilr_date ? 'at ILR' : 'today';
  content.innerHTML = `<section class="surface-card bno-panel"><h2>Rolling 12-month analysis</h2><p class="bno-caption">Absence days are counted from your BNO start through ${ending}.</p>${r ? `<div class="bno-grid bno-grid--rolling">${metric(state.settings.ilr_date ? 'Final rolling 12 months at ILR' : 'Current rolling 12 months', r.current, RULES.bno, range(r.current.start, r.current.end), r.complete, state.settings.warning_thresholds, '', `Absence days in the 12-month window ending ${ending}.`)}${metric('Worst official 12-month window', r.worst, RULES.bno, range(r.worst.start, r.worst.end), r.complete, state.settings.warning_thresholds, worstConservativeWindow(r), 'Highest official absence total in any rolling 12-month window.', 'Conservative count in this same window')}</div>${chartHtml(r)}` : `<p>Configure your BNO start date first.</p>${button('Configure', 'data-go="settings"')}`}</section>${notices(timeline)}`;
  if (r) {
    const slider = $<HTMLInputElement>('[data-chart-date]');
    const inspect = (index: number) => { slider.value = String(index); $('[data-chart-readout]').textContent = chartReadout(r.points[index]); };
    slider.addEventListener('input', () => inspect(Number(slider.value)));
    $('.bno-chart').addEventListener('pointermove', event => { const e = event as PointerEvent, rect = (e.currentTarget as Element).getBoundingClientRect(); const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left - rect.width * 42 / 760) / (rect.width * 706 / 760))); inspect(Math.round(ratio * (r.points.length - 1))); });
  }
}
function dayTrip(day: string): Trip | undefined { return timeline.trips.find(t => t.departure <= day && (t.returned ?? timeline.today) >= day); }
function renderCalendar(): void {
  calendar?.destroy(); calendar = undefined;
  const savedPlans = plannedAsTrips(state);
  content.innerHTML = `<section class="surface-card bno-panel"><div class="bno-toolbar"><h2>Residence calendar</h2><div class="segmented"><button data-calendar-view="month" aria-pressed="${calendarView === 'month'}">Month</button><button data-calendar-view="year" aria-pressed="${calendarView === 'year'}">Year</button></div></div><div class="bno-toolbar"><div class="button-group">${button('←', 'data-calendar-prev aria-label="Previous period"')}${button('Today', 'data-calendar-today')}${button('→', 'data-calendar-next aria-label="Next period"')}<strong data-calendar-title>${calendarYear}</strong></div>${savedPlans.length ? `<label class="bno-caption"><input type="checkbox" data-calendar-plans ${includePlans ? 'checked' : ''}> Show planned trips</label>` : ''}</div><div class="bno-legend"><span>Recorded UK</span><span class="outside">Outside UK</span><span class="travel">Travel day</span><span class="unknown">Unknown</span></div><div data-calendar-body></div><h3 data-annual-title>${calendarYear} annual timeline</h3><div class="bno-month-labels">${Array.from({ length: 12 }, (_, i) => `<span>${DateTime.utc(calendarYear, i + 1).toFormat('LLL')}</span>`).join('')}</div><div class="bno-timeline" data-timeline></div><p class="bno-caption" data-day-readout aria-live="polite">Select a day to inspect its recorded location.${savedPlans.length ? ' Planned trips are projections.' : ''}</p></section>`;

  const planTrips = includePlans ? savedPlans : [];
  const dayLabel = (day: string) => `${fmt(day)} · ${locationOn(timeline, day)}${dayTrip(day) ? ` · ${dayTrip(day)!.countries.join(', ')}` : ''}${planTrips.some(p => p.departure <= day && p.returned! >= day) ? ' · Planned travel' : ''}`;
  const renderAnnual = () => {
    const first = `${calendarYear}-01-01`, length = DateTime.utc(calendarYear).daysInYear!;
    $('[data-annual-title]').textContent = `${calendarYear} annual timeline`;
    $('[data-timeline]').innerHTML = Array.from({ length }, (_, i) => { const day = addDays(first, i); return `<button data-day="${day}" tabindex="${day === first ? 0 : -1}" data-location="${locationOn(timeline, day)}" title="${esc(dayLabel(day))}" aria-label="${esc(dayLabel(day))}"></button>`; }).join('');
  };
  renderAnnual();
  if (calendarView === 'month') {
    calendar = new Calendar($('[data-calendar-body]'), { plugins: [dayGridPlugin, interactionPlugin], initialView: 'dayGridMonth', initialDate: `${calendarYear}-${calendarMonth}-01`, firstDay: 1, headerToolbar: false, height: 'auto', editable: false,
      events: [...timeline.trips, ...planTrips].map(t => ({ id: t.id, title: `${t.source === 'planned' ? 'Planned: ' : ''}${t.countries.join(', ') || 'Outside UK'}`, start: t.departure, end: addDays(t.returned ?? timeline.today, 1), allDay: true, classNames: t.source === 'planned' ? ['bno-planned'] : [] })),
      dayCellClassNames: info => locationOn(timeline, DateTime.fromJSDate(info.date).toISODate()!) === 'unknown' ? ['bno-unknown'] : [],
      datesSet: info => { $('[data-calendar-title]').textContent = info.view.title; calendarMonth = String(info.view.currentStart.getMonth() + 1).padStart(2, '0'); const nextYear = info.view.currentStart.getFullYear(); if (nextYear !== calendarYear) { calendarYear = nextYear; renderAnnual(); } },
      dateClick: info => inspectDay(info.dateStr), eventClick: info => { const trip = [...timeline.trips, ...planTrips].find(t => t.id === info.event.id); if (trip) showTrip(trip); }, dayMaxEvents: 2 });
    calendar.render(); requestAnimationFrame(() => calendar?.updateSize());
  } else {
    $('[data-calendar-body]').innerHTML = `<div class="bno-year">${Array.from({ length: 12 }, (_, i) => { const start = DateTime.utc(calendarYear, i + 1, 1); return `<section class="bno-month"><h3>${start.toFormat('LLLL')}</h3><div class="bno-days">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(d => `<span aria-hidden="true">${d}</span>`).join('')}${'<span></span>'.repeat(start.weekday - 1)}${Array.from({ length: start.daysInMonth! }, (_, n) => { const day = start.plus({ days: n }).toISODate()!; return `<button data-day="${day}" tabindex="${n === 0 ? 0 : -1}" data-location="${locationOn(timeline, day)}" title="${esc(dayLabel(day))}" aria-label="${esc(dayLabel(day))}">${n + 1}${planTrips.some(p => p.departure <= day && p.returned! >= day) ? '·' : ''}</button>`; }).join('')}</div></section>`; }).join('')}</div>`;
  }
  $('[data-calendar-plans]')?.addEventListener('change', event => { includePlans = (event.target as HTMLInputElement).checked; renderCalendar(); });
  $('[data-calendar-prev]').addEventListener('click', () => { if (calendarView === 'month') calendar?.prev(); else { calendarYear--; renderCalendar(); } });
  $('[data-calendar-next]').addEventListener('click', () => { if (calendarView === 'month') calendar?.next(); else { calendarYear++; renderCalendar(); } });
  $('[data-calendar-today]').addEventListener('click', () => { calendarYear = Number(timeline.today.slice(0, 4)); if (calendarView === 'month') calendar?.today(); else renderCalendar(); });
}
content.addEventListener('keydown', event => {
  const target = (event.target as Element).closest<HTMLButtonElement>('[data-day]');
  if (!target) return;
  const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
  if (!(event.key in offsets)) return;
  const scope = target.closest('.bno-timeline') ?? target.closest('.bno-year');
  const next = scope?.querySelector<HTMLButtonElement>(`[data-day="${addDays(target.dataset.day!, offsets[event.key])}"]`);
  if (next) { event.preventDefault(); target.tabIndex = -1; next.tabIndex = 0; next.focus(); }
});
function inspectDay(day: string): void {
  const trip = dayTrip(day); $('[data-day-readout]').textContent = `${fmt(day)} · ${locationOn(timeline, day)}${trip ? ` · ${trip.countries.join(', ')}` : ''}`;
  if (trip) showTrip(trip);
}
function renderSettings(): void {
  const s = state.settings;
  content.innerHTML = `<section class="surface-card bno-panel"><h2>BNO settings</h2><form data-settings-form><div class="bno-form-grid">${field('bno_start_date', 'BNO visa / grant date', s.bno_start_date ?? '', 'date')}${field('ilr_date', 'Actual ILR date', s.ilr_date ?? '', 'date', false, 'BNO monitoring ends on this date; leave blank until granted.')}${field('citizenship_application_date', 'Intended citizenship application date', s.citizenship_application_date ?? '', 'date')}${selectField('planning_mode', 'Planning safety mode', [['official', 'Official'], ['conservative', 'Conservative']], s.planning_mode, 'Official uses whole days abroad. Conservative also counts departure and return dates as a personal buffer. This changes planner warnings and recommendations, not the official dashboard count.')}${field('coverage_start', 'History complete from', s.coverage_start ?? '', 'date', false, 'Confirm that all travel since this date has been entered. Earlier periods remain unknown.')}${selectField('initial_location', 'Location at coverage start', [['unknown', 'Unknown'], ['uk', 'In UK'], ['outside', 'Outside UK — record the initial absence manually']], s.initial_location)}${field('thresholds', 'Warning thresholds (%)', s.warning_thresholds.join(', '), 'text', true, 'Three increasing percentages, e.g. 70, 85, 95.')}</div><div data-settings-preview></div><p data-settings-error class="bno-error" role="alert"></p><button class="button button--primary" type="submit">Save settings</button></form></section>`;
  const settingsForm = $<HTMLFormElement>('[data-settings-form]'); const settingsVersion = s.version;
  const read = () => { const d = new FormData(settingsForm); return { ...s, version: settingsVersion, bno_start_date: String(d.get('bno_start_date') || '') || null, ilr_date: String(d.get('ilr_date') || '') || null, citizenship_application_date: String(d.get('citizenship_application_date') || '') || null, coverage_start: String(d.get('coverage_start') || '') || null, initial_location: String(d.get('initial_location')) as State['settings']['initial_location'], planning_mode: String(d.get('planning_mode')) as State['settings']['planning_mode'], warning_thresholds: String(d.get('thresholds')).split(',').map(v => Number(v.trim())) }; };
  settingsForm.addEventListener('input', () => { try { const next = read(); const c = citizenship({ ...timeline, settings: next }); $('[data-settings-preview]').innerHTML = c ? `<p class="bno-caption">Five-year window ${range(c.start, c.end)}: ${c.five.official} official days. Final year: ${c.year.official}. Presence: ${c.presence}; exact anniversary: ${c.anniversaryPresence}.</p>` : ''; } catch { /* Incomplete date input. */ } });
  settingsForm.addEventListener('submit', async event => { event.preventDefault(); const submit = $<HTMLButtonElement>('[type="submit"]', settingsForm); submit.disabled = true;
    try { const next = read(); validateSettings(next, timeline.today); await repo.saveSettings(next); await refresh(); }
    catch (error) { $('[data-settings-error]').textContent = error instanceof Error ? error.message : 'Save failed.'; }
    finally { submit.disabled = false; }
  });
}
function renderPlanning(): void {
  const open = timeline.trips.filter(t => !t.returned);
  const activePlans = plannedAsTrips(state);
  const ongoing = open.length === 1 ? `<p class="bno-caption bno-planner-context" data-open-trip>Simulating a return from ${esc(open[0].countries.join(', ') || 'your ongoing trip')}, which began ${fmt(open[0].departure)}.</p>` : '';
  const chooseOpen = open.length > 1 ? selectField('close', 'Open trip to return', open.map(t => [t.id, `${t.countries.join(', ') || 'Ongoing trip'} (${fmt(t.departure)})`] as [string, string]), open[0].id) : '';
  content.innerHTML = `<section class="surface-card bno-panel"><h2>Trip planner</h2><p class="bno-caption">Simulations leave actual travel unchanged. Latest-return dates use your selected planning safety mode.</p>${ongoing}<form data-planner><div class="bno-form-grid">${chooseOpen}${field('departure', open.length ? 'Recorded UK departure' : 'Proposed UK departure', open[0]?.departure ?? '', 'date', true)}${field('returned', 'Proposed UK return', '', 'date')}${open.length ? '' : field('destination', 'Destination')}${activePlans.length ? selectField('scope', 'Include saved plans', [['actual', 'Actual only'], ['planned', 'Actual + planned']], 'actual') : ''}</div><div class="bno-dialog-actions"><button class="button button--quiet" type="button" data-latest>Find latest return</button><button class="button button--primary" type="submit">Simulate trip</button></div></form><div data-simulation aria-live="polite"></div></section><section class="surface-card bno-panel"><div class="bno-toolbar"><h2>Saved plans</h2>${button('Add planned trip', 'data-add="plan"')}</div><div data-plan-list>${state.planned.length ? table(['Destination', 'Dates', 'Status', 'Actions'], state.planned.map(p => [esc(p.destination || 'Planned trip'), range(p.departure_date, p.return_date), esc(p.status), `<div class="bno-inline-actions">${p.status === 'planned' ? `${button('Edit', `data-edit-plan="${p.id}"`)}${button('Convert to actual', `data-convert="${p.id}"`)}${button('Link actual flights', `data-fulfil="${p.id}"`)}` : ''}${button('Delete plan', `data-delete-plan="${p.id}"`)}</div>`])) : '<p class="bno-caption">No saved plans.</p>'}</div></section>`;
  const planner = $<HTMLFormElement>('[data-planner]');
  const departure = $<HTMLInputElement>('[name="departure"]', planner);
  departure.readOnly = open.length > 0;
  const read = () => { const d = new FormData(planner); return { departure: String(d.get('departure')), returned: String(d.get('returned')), destination: String(d.get('destination') ?? ''), closeTripId: open.length === 1 ? open[0].id : String(d.get('close') || '') || undefined }; };
  const plans = () => $<HTMLSelectElement>('[name="scope"]', planner)?.value === 'planned' ? activePlans : [];
  $<HTMLSelectElement>('[name="close"]', planner)?.addEventListener('change', event => { const chosen = open.find(t => t.id === (event.target as HTMLSelectElement).value); departure.value = chosen?.departure ?? ''; });
  planner.addEventListener('submit', event => { event.preventDefault(); const output = $('[data-simulation]');
    try { const p = read(); const selectedPlans = plans(); const hypothetical = simulateTrip(timeline, p, selectedPlans); const horizon = selectedPlans.reduce((end, trip) => trip.returned! > end ? trip.returned! : end, p.returned); const before = rollingAbsences(timeline); const after = rollingAbsences(hypothetical, horizon); const atReturn = rollingAbsences(hypothetical, p.returned); const c = citizenship(hypothetical); const baseC = citizenship(timeline); const proposed = hypothetical.trips.at(-1)!; const counts = tripCounts(proposed, p.returned);
      const mode = state.settings.planning_mode;
      const planningTotal = after ? (mode === 'official' ? after.worst.official : after.conservativeWorst.conservative) : null;
      const planningWarning = after ? (after.complete ? warningLevel(planningTotal!, RULES.bno, state.settings.warning_thresholds) : 'Provisional — history needs review') : '';
      output.innerHTML = `<h3>${p.closeTripId ? 'Proposed return' : 'Proposed trip'}: ${range(p.departure, p.returned)}</h3><p>Official absence: <strong>${counts.official} days</strong></p><p class="bno-caption">Conservative buffer: ${counts.conservative} days</p><p>Current actual rolling window: <strong>${before?.current.official ?? 'Not configured'} official days</strong></p><p class="bno-caption">Conservative buffer in that window: ${before?.current.conservative ?? '—'} days</p>${after ? `<div class="bno-planning-result"><p>Worst official rolling total: ${before?.worst.official ?? '—'} → <strong>${after.worst.official} / ${RULES.bno}</strong> · ${Math.max(0, RULES.bno - after.worst.official)} official days remaining</p><p class="bno-caption">Worst official window: ${range(after.worst.start, after.worst.end)}. Conservative count in this same window: ${after.worst.conservative} / ${RULES.bno}.</p><p class="bno-caption">Worst conservative buffer window: ${after.conservativeWorst.conservative} / ${RULES.bno}, ${range(after.conservativeWorst.start, after.conservativeWorst.end)}.</p><p>Planning warning (${mode === 'official' ? 'official count' : 'conservative buffer'}): <span class="bno-badge" data-level="${planningWarning}">${planningWarning}</span> · ${planningTotal} / ${RULES.bno}</p><p class="bno-caption">At return: ${atReturn!.current.official} official days; conservative buffer ${atReturn!.current.conservative} days.</p>${after.worst.official > RULES.bno ? '<p class="bno-error">The simulation contains a rolling period above 180 official absence days.</p>' : ''}</div>` : '<p>Configure BNO dates for rolling projections.</p>'}${c ? `<p>Citizenship five years: ${baseC!.five.official} → ${c.five.official} / ${RULES.citizenship} official days. Final year: ${baseC!.year.official} → ${c.year.official} / ${RULES.finalYear} official days.</p><p class="bno-caption">Conservative buffer: ${c.five.conservative} / ${RULES.citizenship} over five years; ${c.year.conservative} / ${RULES.finalYear} in the final year. Future location is projected; this is not an eligibility determination.</p>` : '<p class="bno-caption">Set a citizenship application date to project its absence limits.</p>'}${p.closeTripId ? '' : button('Save as Planned Trip', 'data-save-simulation')}`;
      $('[data-save-simulation]', output)?.addEventListener('click', () => openPlan(undefined, p));
    } catch (error) { output.textContent = error instanceof Error ? error.message : 'Simulation failed.'; }
  });
  $('[data-latest]').addEventListener('click', () => { const output = $('[data-simulation]'); try { const p = read(); date(p.departure); output.textContent = 'Checking every candidate return against rolling windows…'; plannerWorker?.terminate(); plannerWorker = new Worker(new URL('./planner-worker.ts', import.meta.url), { type: 'module' });
    plannerWorker.onmessage = ({ data }) => { if (!active || tab !== 'planning') return; if (data.error) output.textContent = data.error; else output.innerHTML = `<div class="bno-latest-results">${(['official', 'conservative'] as const).map(mode => `<section class="bno-latest-result" data-latest-${mode}><h3>${mode === 'official' ? 'Official calculation' : 'Conservative buffer'}</h3>${mode === state.settings.planning_mode ? '<p class="bno-recommendation">Planning recommendation</p>' : ''}<p>${data[mode].date ? `<strong>${fmt(data[mode].date)}</strong> · ${data[mode].total} / ${RULES.bno}` : 'No definitive date'}</p><p class="bno-caption">${esc(data[mode].message)}</p></section>`).join('')}</div>`; plannerWorker?.terminate(); plannerWorker = undefined; };
    plannerWorker.onerror = () => { output.textContent = 'Calculation could not finish. Try again.'; plannerWorker?.terminate(); };
    plannerWorker.postMessage({ timeline, departure: p.departure, closeTripId: p.closeTripId, plans: plans() });
  } catch (error) { output.textContent = error instanceof Error ? error.message : 'Enter a departure date.'; } });
}
function openEditor(title: string, html: string, save: () => Promise<void>): void {
  editorTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  $('#editor-title').textContent = title; fields.innerHTML = html; $('[data-editor-error]').textContent = '';
  saveEditor = save; editor.showModal();
}
const value = (name: string) => String(new FormData(form).get(name) ?? '').trim();
function airportFields(prefix: string, label: string, a?: Airport | null): string {
  return `<div class="bno-field bno-combobox"><label for="${prefix}-search">${label} airport</label><input class="form-control" id="${prefix}-search" autocomplete="off" value="${esc(a ? `${a.code} — ${a.name}` : '')}" aria-label="${label} airport search"><div class="bno-airports" id="${prefix}-results" hidden></div></div>${field(`${prefix}_zone`, `${label} timezone (IANA)`, a?.timezone ?? '', 'text', false, 'Selected airport timezone; enter explicitly if missing.')}`;
}
function bindAirport(prefix: string, existing?: Airport | null): () => Airport | null {
  let selected = existing ?? null;
  airportCombobox($(`#${prefix}-search`), $(`#${prefix}-results`), a => { selected = a; $<HTMLInputElement>(`[name="${prefix}_zone"]`, form).value = a?.timezone ?? ''; });
  return () => selected ? { ...selected, timezone: value(`${prefix}_zone`) } : null;
}
function base(existing?: TravelRecord) { return { id: existing?.id ?? crypto.randomUUID(), version: existing?.version ?? 0 }; }
function openFlight(existing?: Flight): void {
  let departureAirport: () => Airport | null, arrivalAirport: () => Airport | null;
  const dep = existing ? DateTime.fromISO(existing.departure_at).setZone(existing.departure_airport.timezone) : null;
  const arr = existing ? DateTime.fromISO(existing.arrival_at).setZone(existing.arrival_airport.timezone) : null;
  openEditor(existing ? 'Edit flight' : 'Add Flight', `${airportFields('dep', 'Departure', existing?.departure_airport)}${airportFields('arr', 'Arrival', existing?.arrival_airport)}${field('departure_date', 'Departure date', dep?.toISODate() ?? '', 'date', true)}${field('departure_time', 'Departure time', dep?.toFormat('HH:mm') ?? '', 'time', true)}${field('arrival_date', 'Arrival date', arr?.toISODate() ?? '', 'date', true)}${field('arrival_time', 'Arrival time', arr?.toFormat('HH:mm') ?? '', 'time', true)}${field('departure_offset', 'Departure UTC offset (only if ambiguous)', '', 'text', false, 'For a repeated clock time, enter the requested offset such as +01:00.')}${field('arrival_offset', 'Arrival UTC offset (only if ambiguous)', '')}${field('flight_number', 'Flight number', existing?.flight_number)}${field('airline', 'Airline', existing?.airline)}${field('booking_reference', 'Booking reference', existing?.booking_reference)}${notesField(existing?.notes)}`, async () => {
    const a = departureAirport(), b = arrivalAirport(); if (!a || !b) throw new Error('Select both airports from the search results.');
    const departure_at = flightInstant(`${value('departure_date')}T${value('departure_time')}`, a.timezone, value('departure_offset') || undefined);
    const arrival_at = flightInstant(`${value('arrival_date')}T${value('arrival_time')}`, b.timezone, value('arrival_offset') || undefined);
    if (Date.parse(arrival_at) <= Date.parse(departure_at)) throw new Error('Arrival must be after departure in absolute time. Check airport timezones and the arrival date.');
    if (Date.parse(departure_at) > Date.now()) throw new Error('Use Planning for a future journey. Actual flights must have departed.');
    const record: Flight = { ...base(existing), departure_airport: a, arrival_airport: b, departure_at, arrival_at,
      flight_number: value('flight_number'), airline: value('airline'), booking_reference: value('booking_reference'), notes: value('notes') };
    await repo.save('travel_flights', record);
  });
  departureAirport = bindAirport('dep', existing?.departure_airport); arrivalAirport = bindAirport('arr', existing?.arrival_airport);
}
function openManual(existing?: ManualTrip): void {
  openEditor(existing ? 'Edit manual trip' : 'Add Manual Trip', `${field('departed', 'Left UK', existing?.departed_uk_date ?? '', 'date', true)}${field('returned', 'Returned to UK', existing?.returned_uk_date ?? '', 'date', false, 'Leave blank if still abroad.')}${field('countries', 'Countries / territories visited', existing?.countries.join(', ') ?? '', 'text', true, 'Separate destinations with commas.')}${field('departure_location', 'Departure location', existing?.departure_location)}${field('return_location', 'Return location', existing?.return_location)}${notesField(existing?.notes)}`, async () => {
    const departed = value('departed'), returned = value('returned') || null; date(departed); if (returned) date(returned);
    if ((returned && returned < departed) || departed > todayUK() || (returned && returned > todayUK())) throw new Error('Actual travel dates must be ordered and no later than today. Use Planning for future travel.');
    await repo.save('manual_trips', { ...base(existing), departed_uk_date: departed, returned_uk_date: returned, countries: value('countries').split(',').map(c => c.trim()).filter(Boolean), departure_location: value('departure_location'), return_location: value('return_location'), notes: value('notes') });
  });
}
function openPlan(existing?: PlannedTrip, proposal?: { departure: string; returned: string; destination?: string }): void {
  let departureAirport: () => Airport | null, arrivalAirport: () => Airport | null;
  openEditor(existing ? 'Edit planned trip' : 'Save planned trip', `${field('departure', 'UK departure', existing?.departure_date ?? proposal?.departure ?? '', 'date', true)}${field('returned', 'UK return', existing?.return_date ?? proposal?.returned ?? '', 'date', true)}${field('destination', 'Destination', existing?.destination ?? proposal?.destination ?? '')}${airportFields('dep', 'Optional departure', existing?.departure_airport)}${airportFields('arr', 'Optional arrival', existing?.arrival_airport)}${notesField(existing?.notes)}`, async () => {
    const departure = value('departure'), returned = value('returned'); date(departure); date(returned); if (returned < departure) throw new Error('Return cannot precede departure.');
    await repo.save('planned_trips', { ...base(existing), departure_date: departure, return_date: returned, destination: value('destination'), departure_airport: departureAirport(), arrival_airport: arrivalAirport(), notes: value('notes'), status: 'planned', converted_manual_id: null, flight_ids: [] });
  });
  departureAirport = bindAirport('dep', existing?.departure_airport); arrivalAirport = bindAirport('arr', existing?.arrival_airport);
}
function showTrip(trip: Trip): void { $('[data-details-content]').innerHTML = tripDetails(trip, timeline.today); details.showModal(); }
function showFlight(flight: Flight): void { $('[data-details-content]').innerHTML = flightDetails(flight); details.showModal(); }
function confirmDelete(label: string, message: string, action: () => Promise<void>): void {
  confirmation.open({ title: label, message, confirmLabel: 'Delete', trigger: document.activeElement as HTMLElement,
    action: async () => { await action(); details.close(); await refresh(); } });
}
form.addEventListener('submit', async event => {
  event.preventDefault(); if (editorPending || !saveEditor) return; editorPending = true;
  const submit = $<HTMLButtonElement>('[type="submit"]', form); submit.disabled = true; editor.setAttribute('aria-busy', 'true');
  try { await saveEditor(); if (!active) return; editor.close(); details.close(); await refresh(); }
  catch (error) { $('[data-editor-error]').textContent = error instanceof Error ? error.message : 'Save failed. Your form has been kept.'; }
  finally { editorPending = false; submit.disabled = false; editor.removeAttribute('aria-busy'); }
});
editor.addEventListener('cancel', e => { if (editorPending) e.preventDefault(); });
editor.addEventListener('close', () => { if (editorTrigger?.isConnected) editorTrigger.focus(); });
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => { if (!editorPending) editor.close(); }));
$('[data-close-details]').addEventListener('click', () => details.close());
document.addEventListener('click', event => {
  const target = (event.target as Element).closest<HTMLElement>('button'); if (!target || !active) return;
  const d = target.dataset;
  if (d.tab) navigate(d.tab); if (d.go) navigate(d.go);
  if (d.add === 'flight') openFlight(); if (d.add === 'manual') openManual(); if (d.add === 'plan') openPlan();
  if (d.historyView) { historyView = d.historyView; renderHistory(); }
  if (d.calendarView) { calendarView = d.calendarView; calendar?.destroy(); calendar = undefined; renderCalendar(); }
  if (d.day) inspectDay(d.day);
  if (d.trip) { const t = timeline.trips.find(t => t.id === d.trip); if (t) showTrip(t); }
  if (d.flight) { const f = state.flights.find(f => f.id === d.flight); if (f) showFlight(f); }
  if (d.review) { const f = state.flights.find(f => f.id === d.review); const m = state.manual.find(m => m.id === d.review); if (f) showFlight(f); else if (m) openManual(m); }
  if (d.editFlight) openFlight(state.flights.find(f => f.id === d.editFlight));
  if (d.editManual) openManual(state.manual.find(m => m.id === d.editManual));
  if (d.editPlan) openPlan(state.planned.find(p => p.id === d.editPlan));
  if (d.deleteFlight) { const f = state.flights.find(f => f.id === d.deleteFlight)!; confirmDelete('Delete flight?', `${f.departure_airport.code} → ${f.arrival_airport.code}. This will recalculate all trips and residence totals.`, () => repo.deleteFlights([f])); }
  if (d.deleteTrip) { const t = timeline.trips.find(t => t.id === d.deleteTrip)!; confirmDelete('Delete trip?', t.source === 'flight' ? `Delete all ${t.flights.length} underlying flights: ${t.flights.map(f => `${f.departure_airport.code} → ${f.arrival_airport.code}`).join(', ')}?` : 'Delete this manual absence and recalculate all totals?', () => t.source === 'flight' ? repo.deleteFlights(t.flights) : repo.remove('manual_trips', state.manual.find(m => m.id === t.id)!)); }
  if (d.deletePlan) { const p = state.planned.find(p => p.id === d.deletePlan)!; confirmDelete('Delete planned trip?', 'Only the plan will be deleted. Any actual travel remains.', () => repo.remove('planned_trips', p)); }
  if (d.convert) { const p = state.planned.find(p => p.id === d.convert)!;
    confirmation.open({ title: 'Convert planned trip?', message: 'This creates one actual manual absence and marks the plan converted. If you have entered its flights, use Link actual flights instead.', confirmLabel: 'Convert to actual', trigger: target,
      action: async () => { if (p.return_date > timeline.today) throw new Error('The trip must have returned before conversion.'); if (timeline.trips.some(t => p.departure_date < (t.returned ?? timeline.today) && p.return_date > t.departure)) throw new Error('This plan overlaps actual travel. Link its flights or correct the records instead.'); await repo.convertPlan(p); await refresh(); } });
  }
  if (d.fulfil) { const plan = state.planned.find(p => p.id === d.fulfil)!;
    const candidates = timeline.trips.filter(t => t.source === 'flight' && t.returned);
    openEditor('Link actual flights', selectField('trip', 'Completed flight-derived trip', [['', 'Choose a trip'], ...candidates.map(t => [t.id, `${t.countries.join(', ')} · ${range(t.departure, t.returned!)}`] as [string, string])], ''), async () => { const chosen = candidates.find(t => t.id === value('trip')); if (!chosen) throw new Error('Choose a completed flight-derived trip.'); await repo.save('planned_trips', { ...plan, status: 'fulfilled', flight_ids: chosen.flights.map(f => f.id) }); });
  }
});
$('[data-refresh]').addEventListener('click', () => void refresh());
$('[data-rules]').innerHTML = rulesHtml();
window.addEventListener('online', () => { if (!editor.open && !$('[data-settings-form]')) void refresh(); });
window.addEventListener('offline', () => { offline = true; status.textContent = 'Offline · read and plan; saving requires connectivity'; });
window.addEventListener('focus', () => { if (!editor.open && !details.open && tab !== 'settings' && tab !== 'planning') void refresh(); });
let midnightTimer: number;
function scheduleMidnight(): void { midnightTimer = window.setTimeout(() => { if (!active) return; if (!editor.open && tab !== 'settings' && tab !== 'planning') render(); else timeline = buildTimeline(state, todayUK(), new Date().toISOString()); scheduleMidnight(); }, nextUKMidnightDelay()); }
window.addEventListener('pagehide', () => { clearTimeout(midnightTimer); plannerWorker?.terminate(); });
const initial = await repo.load(); state = initial.state; offline = initial.offline;
status.textContent = `${offline ? 'Offline · read-only cache' : 'Synced'} · ${DateTime.fromISO(initial.cachedAt).toFormat('dd LLL, HH:mm')}`;
shell.hidden = false; render(); scheduleMidnight();
