import { Calendar, type CalendarOptions, type EventClickArg, type EventDropArg, type EventInput } from "@fullcalendar/core";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin, { type DateClickArg, type EventResizeDoneArg } from "@fullcalendar/interaction";
import luxonPlugin from "@fullcalendar/luxon3";
import rrulePlugin from "@fullcalendar/rrule";
import timeGridPlugin from "@fullcalendar/timegrid";
import { DateTime } from "luxon";
import "./tracker.css";
import { cacheState, PersistenceController, queuedMutationCount } from "./store";
import type { CalendarEventRecord, LabelKind, Profile, RevisionItem, RevisionSession, StudyLabel } from "./types";
import {
  downloadText,
  endOfLocalDay,
  escapeHtml,
  eventsToIcs,
  formatDate,
  formatTime,
  fromLocalInput,
  getLastRevised,
  isoNow,
  nextMidnightDelay,
  safeColor,
  startOfLocalDay,
  toLocalInput,
  uid,
} from "./utils";

document.documentElement.classList.add("js");

const $ = <T extends Element>(selector: string, root: ParentNode = document): T => {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
};
const $$ = <T extends Element>(selector: string, root: ParentNode = document): T[] => Array.from(root.querySelectorAll<T>(selector));

const persistence = new PersistenceController();
await persistence.initialize();
let repository = persistence.repository;
let state = await repository.load();
let selectedDate = DateTime.now().setZone(state.profile.timezone).startOf("day").toJSDate();
let calendar: Calendar;
let statusTimer: number | undefined;
let activeEventId: string | undefined;

const statusText = $<HTMLElement>("[data-status-text]");
const statusDot = $<HTMLElement>("[data-status-dot]");
const retryButton = $<HTMLButtonElement>("[data-retry-sync]");
const eventDialog = $<HTMLDialogElement>("[data-event-dialog]");
const eventForm = $<HTMLFormElement>("[data-event-form]");
const revisionDialog = $<HTMLDialogElement>("[data-revision-dialog]");
const revisionForm = $<HTMLFormElement>("[data-revision-form]");
const sessionDialog = $<HTMLDialogElement>("[data-session-dialog]");
const sessionForm = $<HTMLFormElement>("[data-session-form]");
const labelDialog = $<HTMLDialogElement>("[data-label-dialog]");
const authDialog = $<HTMLDialogElement>("[data-auth-dialog]");
const settingsDialog = $<HTMLDialogElement>("[data-settings-dialog]");
const privacyDialog = $<HTMLDialogElement>("[data-privacy-dialog]");

function setStatus(kind: "saved" | "saving" | "offline" | "error", message?: string): void {
  window.clearTimeout(statusTimer);
  statusDot.dataset.state = kind;
  const defaults = {
    saved: repository.mode === "cloud" ? "Synced to your account" : "Saved on this device",
    saving: "Saving…",
    offline: `Offline · ${queuedMutationCount()} change${queuedMutationCount() === 1 ? "" : "s"} queued`,
    error: "Couldn’t sync this change",
  };
  statusText.textContent = message ?? defaults[kind];
  retryButton.hidden = kind !== "offline" && kind !== "error";
  if (kind === "saving") statusTimer = window.setTimeout(() => setStatus("saved"), 4_000);
}

function toast(message: string, tone: "default" | "error" = "default"): void {
  const region = $<HTMLElement>("[data-toast-region]");
  const item = document.createElement("div");
  item.className = `toast${tone === "error" ? " toast--error" : ""}`;
  item.textContent = message;
  region.append(item);
  window.setTimeout(() => item.remove(), 4_500);
}

async function persist(task: () => Promise<void>, success?: string): Promise<void> {
  cacheState(state);
  setStatus(navigator.onLine ? "saving" : "offline");
  try {
    await task();
    setStatus(navigator.onLine ? "saved" : "offline");
    if (success) toast(success);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The change could not be saved.";
    setStatus(navigator.onLine ? "error" : "offline", message);
    toast(message, "error");
  }
}

function labelById(id?: string): StudyLabel | undefined {
  return id ? state.labels.find((label) => label.id === id) : undefined;
}

function eventColor(event: CalendarEventRecord): string {
  return safeColor(labelById(event.subjectId)?.color ?? labelById(event.classId)?.color ?? labelById(event.topicId)?.color);
}

function calendarEventInput(record: CalendarEventRecord): EventInput {
  const base: EventInput = {
    id: record.id,
    title: record.title,
    start: record.startAt,
    end: record.endAt,
    allDay: record.allDay,
    backgroundColor: eventColor(record),
    borderColor: eventColor(record),
    textColor: "#fffdf8",
    extendedProps: { recordId: record.id },
  };
  if (record.recurrence) {
    base.rrule = {
      freq: record.recurrence.frequency,
      interval: record.recurrence.interval,
      dtstart: record.startAt,
      until: record.recurrence.until ? `${record.recurrence.until}T23:59:59` : undefined,
      byweekday: record.recurrence.byWeekday,
    };
    base.duration = { milliseconds: Date.parse(record.endAt) - Date.parse(record.startAt) };
    delete base.start;
    delete base.end;
  }
  return base;
}

function refreshCalendar(): void {
  calendar.removeAllEvents();
  calendar.addEventSource(state.events.filter((event) => !event.deletedAt).map(calendarEventInput));
  renderAgenda();
}

function renderAgenda(): void {
  const locale = state.profile.locale;
  $("[data-agenda-date]").textContent = formatDate(selectedDate, locale, { weekday: "long", day: "numeric", month: "long" });
  const start = startOfLocalDay(selectedDate).getTime();
  const end = endOfLocalDay(selectedDate).getTime();
  const events = state.events
    .filter((event) => !event.deletedAt && Date.parse(event.startAt) <= end && Date.parse(event.endAt) >= start)
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  const list = $<HTMLElement>("[data-agenda-list]");
  if (!events.length) {
    list.innerHTML = `<div class="agenda-empty"><span>Nothing planned</span><p>Keep this day clear or add a focused revision block.</p></div>`;
    return;
  }
  list.innerHTML = events.map((event) => {
    const labels = [event.subjectId, event.classId, event.topicId].map(labelById).filter(Boolean) as StudyLabel[];
    return `<article class="agenda-item" style="--event-color:${eventColor(event)}">
      <button type="button" data-agenda-event="${event.id}">
        <span class="agenda-item__time">${event.allDay ? "All day" : `${escapeHtml(formatTime(event.startAt, locale))}–${escapeHtml(formatTime(event.endAt, locale))}`}</span>
        <strong>${escapeHtml(event.title)}</strong>
        <span>${labels.map((label) => escapeHtml(label.name)).join(" · ") || "Revision"}</span>
      </button>
      <button class="agenda-item__complete" type="button" data-log-event="${event.id}" aria-label="Log ${escapeHtml(event.title)} as revised">✓</button>
    </article>`;
  }).join("");
}

function fullCalendarOptions(): CalendarOptions {
  return {
    plugins: [dayGridPlugin, timeGridPlugin, interactionPlugin, rrulePlugin, luxonPlugin],
    initialView: state.profile.calendarView,
    initialDate: selectedDate,
    timeZone: state.profile.timezone,
    firstDay: state.profile.weekStart,
    headerToolbar: false,
    height: "auto" as const,
    nowIndicator: true,
    editable: true,
    selectable: true,
    dayMaxEvents: 3,
    slotMinTime: "06:00:00",
    slotMaxTime: "23:00:00",
    scrollTime: "08:00:00",
    eventTimeFormat: { hour: "numeric", minute: "2-digit", meridiem: "short" },
    events: state.events.filter((event) => !event.deletedAt).map(calendarEventInput),
    dateClick: (info: DateClickArg) => {
      selectedDate = info.date;
      renderAgenda();
      if (calendar.view.type === "dayGridMonth" && info.jsEvent.detail > 1) openEventDialog(undefined, info.date);
    },
    eventClick: (info: EventClickArg) => openEventDialog(info.event.extendedProps.recordId ?? info.event.id),
    eventDrop: (info: EventDropArg) => updateEventDates(info.event.extendedProps.recordId ?? info.event.id, info.event.start, info.event.end, info.event.allDay),
    eventResize: (info: EventResizeDoneArg) => updateEventDates(info.event.extendedProps.recordId ?? info.event.id, info.event.start, info.event.end, info.event.allDay),
    datesSet: (info: { view: { title: string; type: string } }) => {
      $("[data-calendar-title]").textContent = info.view.title;
      $$<HTMLButtonElement>("[data-view]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.view === info.view.type)));
    },
  };
}

async function updateEventDates(id: string, start: Date | null, end: Date | null, allDay: boolean): Promise<void> {
  const event = state.events.find((item) => item.id === id);
  if (!event || !start) return;
  event.startAt = start.toISOString();
  event.endAt = (end ?? new Date(start.getTime() + 60 * 60_000)).toISOString();
  event.allDay = allDay;
  event.updatedAt = isoNow();
  event.version += 1;
  await persist(() => repository.saveEvent(event), "Event rescheduled");
  renderAgenda();
}

function fillLabelSelects(root: ParentNode = document): void {
  for (const kind of ["subject", "class", "topic"] as LabelKind[]) {
    $$<HTMLSelectElement>(`select[name="${kind}Id"]`, root).forEach((select) => {
      const current = select.value;
      select.innerHTML = `<option value="">No ${kind}</option>${state.labels.filter((label) => label.kind === kind).map((label) => `<option value="${label.id}">${escapeHtml(label.name)}</option>`).join("")}`;
      select.value = current;
    });
  }
  const filter = $<HTMLSelectElement>("[data-revision-filter]");
  const current = filter.value;
  filter.innerHTML = `<option value="">All labels</option>${state.labels.map((label) => `<option value="${label.id}">${escapeHtml(label.name)} · ${label.kind}</option>`).join("")}`;
  filter.value = current;
}

function setFormValue(form: HTMLFormElement, name: string, value: string | number | boolean | undefined): void {
  const control = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
  if (!control) return;
  if (control instanceof HTMLInputElement && control.type === "checkbox") control.checked = Boolean(value);
  else control.value = value == null ? "" : String(value);
}

function openEventDialog(id?: string, date = selectedDate): void {
  activeEventId = id;
  eventForm.reset();
  fillLabelSelects(eventForm);
  const existing = id ? state.events.find((event) => event.id === id) : undefined;
  const start = existing ? new Date(existing.startAt) : new Date(date);
  if (!existing) start.setHours(start.getHours() < 8 ? 9 : start.getHours() + 1, 0, 0, 0);
  const end = existing ? new Date(existing.endAt) : new Date(start.getTime() + 60 * 60_000);
  $("[data-event-dialog-title]").textContent = existing ? "Edit event" : "New event";
  setFormValue(eventForm, "id", existing?.id);
  setFormValue(eventForm, "title", existing?.title);
  setFormValue(eventForm, "start", toLocalInput(start));
  setFormValue(eventForm, "end", toLocalInput(end));
  setFormValue(eventForm, "allDay", existing?.allDay ?? false);
  setFormValue(eventForm, "timezone", existing?.timezone ?? state.profile.timezone);
  setFormValue(eventForm, "subjectId", existing?.subjectId);
  setFormValue(eventForm, "classId", existing?.classId);
  setFormValue(eventForm, "topicId", existing?.topicId);
  setFormValue(eventForm, "availability", existing?.availability ?? "busy");
  setFormValue(eventForm, "location", existing?.location);
  setFormValue(eventForm, "latitude", existing?.latitude);
  setFormValue(eventForm, "longitude", existing?.longitude);
  setFormValue(eventForm, "url", existing?.url);
  setFormValue(eventForm, "recurrenceFrequency", existing?.recurrence?.frequency);
  setFormValue(eventForm, "recurrenceInterval", existing?.recurrence?.interval ?? 1);
  setFormValue(eventForm, "recurrenceUntil", existing?.recurrence?.until);
  setFormValue(eventForm, "travelMinutes", existing?.travelMinutes ?? 0);
  setFormValue(eventForm, "alerts", existing?.alerts.join(", ") ?? "15");
  setFormValue(eventForm, "notes", existing?.notes);
  $<HTMLButtonElement>("[data-delete-event]").hidden = !existing;
  $<HTMLButtonElement>("[data-export-event]").hidden = !existing;
  eventDialog.showModal();
  window.setTimeout(() => (eventForm.elements.namedItem("title") as HTMLInputElement).focus(), 0);
}

async function saveEventFromForm(): Promise<void> {
  if (!eventForm.reportValidity()) return;
  const data = new FormData(eventForm);
  const startAt = fromLocalInput(String(data.get("start")));
  const endAt = fromLocalInput(String(data.get("end")));
  if (Date.parse(endAt) <= Date.parse(startAt)) {
    toast("The event must end after it starts.", "error");
    return;
  }
  const existing = activeEventId ? state.events.find((event) => event.id === activeEventId) : undefined;
  const now = isoNow();
  const frequency = String(data.get("recurrenceFrequency") ?? "");
  const event: CalendarEventRecord = {
    id: existing?.id ?? uid(), title: String(data.get("title")).trim(), startAt, endAt,
    allDay: data.get("allDay") === "on", timezone: String(data.get("timezone")),
    subjectId: String(data.get("subjectId") || "") || undefined, classId: String(data.get("classId") || "") || undefined,
    topicId: String(data.get("topicId") || "") || undefined, location: String(data.get("location") || "") || undefined,
    latitude: data.get("latitude") ? Number(data.get("latitude")) : undefined, longitude: data.get("longitude") ? Number(data.get("longitude")) : undefined,
    url: String(data.get("url") || "") || undefined, notes: String(data.get("notes") || "") || undefined,
    availability: String(data.get("availability")) as CalendarEventRecord["availability"], travelMinutes: Number(data.get("travelMinutes") || 0),
    alerts: String(data.get("alerts") || "").split(",").map((value) => Number(value.trim())).filter((value) => Number.isFinite(value) && value >= 0),
    recurrence: frequency ? { frequency: frequency as NonNullable<CalendarEventRecord["recurrence"]>["frequency"], interval: Math.max(1, Number(data.get("recurrenceInterval") || 1)), until: String(data.get("recurrenceUntil") || "") || undefined } : undefined,
    recurrenceSeriesId: existing?.recurrenceSeriesId, originalStartAt: existing?.originalStartAt,
    participants: existing?.participants ?? [], attachments: existing?.attachments ?? [], origin: existing?.origin ?? "web",
    version: (existing?.version ?? 0) + 1, createdAt: existing?.createdAt ?? now, updatedAt: now, deletedAt: existing?.deletedAt,
  };
  const index = state.events.findIndex((item) => item.id === event.id);
  if (index >= 0) state.events[index] = event;
  else state.events.push(event);
  eventDialog.close();
  refreshCalendar();
  await persist(() => repository.saveEvent(event), existing ? "Event updated" : "Event added");
}

async function deleteActiveEvent(): Promise<void> {
  const event = state.events.find((item) => item.id === activeEventId);
  if (!event || !window.confirm(`Move “${event.title}” to the 30-day recovery window?`)) return;
  event.deletedAt = isoNow();
  event.updatedAt = isoNow();
  event.version += 1;
  eventDialog.close();
  refreshCalendar();
  await persist(() => repository.saveEvent(event), "Event removed");
}

function createStars(name: string, value: number): string {
  return Array.from({ length: 5 }, (_, index) => index + 1).map((score) => `<label><input type="radio" name="${name}" value="${score}" ${score === value ? "checked" : ""}><span aria-hidden="true">★</span><span class="sr-only">${score} star${score === 1 ? "" : "s"}</span></label>`).join("");
}

function openRevisionDialog(id?: string, prefill?: Partial<RevisionItem>): void {
  revisionForm.reset();
  fillLabelSelects(revisionForm);
  const existing = id ? state.revisionItems.find((item) => item.id === id) : undefined;
  const item = existing ?? prefill;
  $("[data-revision-dialog-title]").textContent = existing ? "Edit revision item" : "New revision item";
  setFormValue(revisionForm, "id", existing?.id);
  setFormValue(revisionForm, "title", item?.title);
  setFormValue(revisionForm, "subjectId", item?.subjectId);
  setFormValue(revisionForm, "classId", item?.classId);
  setFormValue(revisionForm, "topicId", item?.topicId);
  setFormValue(revisionForm, "notes", item?.notes);
  $<HTMLElement>("[data-revision-rating]").innerHTML = createStars("mastery", item?.mastery ?? 1);
  revisionDialog.showModal();
}

async function saveRevisionFromForm(): Promise<void> {
  if (!revisionForm.reportValidity()) return;
  const data = new FormData(revisionForm);
  const id = String(data.get("id") || "") || uid();
  const existing = state.revisionItems.find((entry) => entry.id === id);
  const now = isoNow();
  const item: RevisionItem = {
    id, title: String(data.get("title")).trim(), subjectId: String(data.get("subjectId") || "") || undefined,
    classId: String(data.get("classId") || "") || undefined, topicId: String(data.get("topicId") || "") || undefined,
    mastery: Number(data.get("mastery") || 1) as RevisionItem["mastery"], notes: String(data.get("notes") || "") || undefined,
    createdAt: existing?.createdAt ?? now, updatedAt: now,
  };
  const index = state.revisionItems.findIndex((entry) => entry.id === id);
  if (index >= 0) state.revisionItems[index] = item;
  else state.revisionItems.push(item);
  revisionDialog.close();
  renderRevisionTable();
  await persist(() => repository.saveRevisionItem(item), existing ? "Revision item updated" : "Revision item added");
}

function openSessionDialog(itemId: string, sourceEventId?: string): void {
  const item = state.revisionItems.find((entry) => entry.id === itemId);
  if (!item) return;
  sessionForm.reset();
  setFormValue(sessionForm, "revisionItemId", itemId);
  setFormValue(sessionForm, "sourceEventId", sourceEventId);
  setFormValue(sessionForm, "revisedAt", toLocalInput(new Date()));
  setFormValue(sessionForm, "durationMinutes", 45);
  $("[data-session-item-name]").textContent = item.title;
  $("[data-session-rating]").innerHTML = createStars("sessionMastery", item.mastery);
  sessionDialog.showModal();
}

async function saveSessionFromForm(): Promise<void> {
  if (!sessionForm.reportValidity()) return;
  const data = new FormData(sessionForm);
  const item = state.revisionItems.find((entry) => entry.id === data.get("revisionItemId"));
  if (!item) return;
  const now = isoNow();
  const session: RevisionSession = {
    id: uid(), revisionItemId: item.id, sourceEventId: String(data.get("sourceEventId") || "") || undefined,
    revisedAt: fromLocalInput(String(data.get("revisedAt"))), durationMinutes: Number(data.get("durationMinutes")),
    mastery: Number(data.get("sessionMastery") || item.mastery) as RevisionItem["mastery"], notes: String(data.get("notes") || "") || undefined,
    createdAt: now, updatedAt: now,
  };
  state.sessions.push(session);
  item.mastery = session.mastery;
  item.updatedAt = now;
  sessionDialog.close();
  renderRevisionTable();
  await persist(async () => { await repository.saveSession(session); await repository.saveRevisionItem(item); }, "Revision session logged");
}

async function logEvent(eventId: string): Promise<void> {
  const event = state.events.find((entry) => entry.id === eventId);
  if (!event) return;
  let item = state.revisionItems.find((entry) => (event.topicId && entry.topicId === event.topicId) || entry.title.toLowerCase() === event.title.toLowerCase());
  if (!item) {
    const now = isoNow();
    item = { id: uid(), title: event.title, subjectId: event.subjectId, classId: event.classId, topicId: event.topicId, mastery: 1, notes: event.notes, createdAt: now, updatedAt: now };
    state.revisionItems.push(item);
    await persist(() => repository.saveRevisionItem(item!), "Revision item created from event");
  }
  openSessionDialog(item.id, event.id);
}

function renderRevisionTable(): void {
  const search = $<HTMLInputElement>("[data-revision-search]").value.trim().toLowerCase();
  const filter = $<HTMLSelectElement>("[data-revision-filter]").value;
  const sort = $<HTMLSelectElement>("[data-revision-sort]").value;
  const items = state.revisionItems.filter((item) => {
    const labels = [item.subjectId, item.classId, item.topicId].map(labelById).filter(Boolean) as StudyLabel[];
    return (!filter || labels.some((label) => label.id === filter)) && (!search || `${item.title} ${labels.map((label) => label.name).join(" ")}`.toLowerCase().includes(search));
  });
  items.sort((a, b) => {
    const aLast = getLastRevised(a.id, state.sessions);
    const bLast = getLastRevised(b.id, state.sessions);
    if (sort === "oldest") return Date.parse(aLast ?? "1970-01-01") - Date.parse(bLast ?? "1970-01-01");
    if (sort === "mastery-asc") return a.mastery - b.mastery;
    if (sort === "mastery-desc") return b.mastery - a.mastery;
    if (sort === "title") return a.title.localeCompare(b.title);
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  });
  const body = $<HTMLElement>("[data-revision-body]");
  body.innerHTML = items.map((item) => {
    const labels = [item.subjectId, item.classId, item.topicId].map(labelById).filter(Boolean) as StudyLabel[];
    const sessions = state.sessions.filter((session) => session.revisionItemId === item.id);
    const last = getLastRevised(item.id, state.sessions);
    return `<tr>
      <td data-label="Revision item"><button class="table-title" type="button" data-edit-revision="${item.id}">${escapeHtml(item.title)}</button>${item.notes ? `<small>${escapeHtml(item.notes)}</small>` : ""}</td>
      <td data-label="Labels"><div class="label-pills">${labels.length ? labels.map((label) => `<span style="--label-color:${safeColor(label.color)}">${escapeHtml(label.name)}</span>`).join("") : "<span class=\"label-empty\">Unlabelled</span>"}</div></td>
      <td data-label="Mastery"><div class="inline-stars" role="group" aria-label="Mastery for ${escapeHtml(item.title)}">${Array.from({ length: 5 }, (_, i) => `<button type="button" data-set-mastery="${item.id}" data-score="${i + 1}" aria-label="Set mastery to ${i + 1}" aria-pressed="${i < item.mastery}">★</button>`).join("")}</div></td>
      <td data-label="Last revised"><time>${last ? escapeHtml(formatDate(last, state.profile.locale)) : "Not yet"}</time></td>
      <td data-label="Sessions"><span class="session-count">${sessions.length}</span></td>
      <td><div class="row-actions"><button class="button button--quiet button--compact" type="button" data-log-session="${item.id}">Log session</button><button class="menu-button" type="button" data-delete-revision="${item.id}" aria-label="Delete ${escapeHtml(item.title)}">×</button></div></td>
    </tr>`;
  }).join("");
  $<HTMLElement>("[data-revision-empty]").hidden = items.length > 0;
  body.closest("table")!.hidden = items.length === 0;
}

function renderLabelManager(): void {
  const manager = $<HTMLElement>("[data-label-manager]");
  manager.innerHTML = (["subject", "class", "topic"] as LabelKind[]).map((kind) => {
    const labels = state.labels.filter((label) => label.kind === kind);
    return `<section><h3>${kind[0].toUpperCase()}${kind.slice(1)}s</h3><div>${labels.length ? labels.map((label) => `<div class="label-editor" data-label-row="${label.id}"><input type="color" value="${safeColor(label.color)}" aria-label="${escapeHtml(label.name)} colour" data-label-color><input value="${escapeHtml(label.name)}" aria-label="${kind} name" maxlength="60" data-label-name><button type="button" data-save-label="${label.id}">Save</button><button type="button" data-delete-label="${label.id}" aria-label="Delete ${escapeHtml(label.name)}">×</button></div>`).join("") : `<p>No ${kind}s yet.</p>`}</div></section>`;
  }).join("");
}

async function addLabelFromForm(): Promise<void> {
  const form = $<HTMLFormElement>("[data-label-form]");
  const data = new FormData(form);
  const name = String(data.get("name") || "").trim();
  if (!name) return;
  const now = isoNow();
  const label: StudyLabel = { id: uid(), kind: String(data.get("kind")) as LabelKind, name, color: safeColor(String(data.get("color"))), createdAt: now, updatedAt: now };
  state.labels.push(label);
  (form.elements.namedItem("name") as HTMLInputElement).value = "";
  renderLabelManager(); fillLabelSelects(); refreshCalendar(); renderRevisionTable();
  await persist(() => repository.saveLabel(label), "Label added");
}

async function saveLabel(id: string): Promise<void> {
  const label = labelById(id);
  const row = $<HTMLElement>(`[data-label-row="${id}"]`);
  if (!label) return;
  label.name = $<HTMLInputElement>("[data-label-name]", row).value.trim() || label.name;
  label.color = safeColor($<HTMLInputElement>("[data-label-color]", row).value);
  label.updatedAt = isoNow();
  fillLabelSelects(); refreshCalendar(); renderRevisionTable();
  await persist(() => repository.saveLabel(label), "Label updated");
}

async function deleteLabel(id: string): Promise<void> {
  const label = labelById(id);
  if (!label || !window.confirm(`Delete the ${label.kind} “${label.name}”? Existing entries will become unlabelled.`)) return;
  state.labels = state.labels.filter((entry) => entry.id !== id);
  for (const event of state.events) {
    if (event.subjectId === id) event.subjectId = undefined;
    if (event.classId === id) event.classId = undefined;
    if (event.topicId === id) event.topicId = undefined;
  }
  for (const item of state.revisionItems) {
    if (item.subjectId === id) item.subjectId = undefined;
    if (item.classId === id) item.classId = undefined;
    if (item.topicId === id) item.topicId = undefined;
  }
  renderLabelManager(); fillLabelSelects(); refreshCalendar(); renderRevisionTable();
  await persist(() => repository.deleteLabel(id), "Label deleted");
}

function exportEvents(events: CalendarEventRecord[], filename: string): void {
  if (!events.length) { toast("There are no events to export.", "error"); return; }
  downloadText(filename, eventsToIcs(events), "text/calendar;charset=utf-8");
  toast("Calendar file downloaded");
}

function renderAccount(): void {
  const auth = persistence.authState;
  const button = $<HTMLButtonElement>("[data-auth-button]");
  button.textContent = auth.user ? auth.user.email ?? "Account" : auth.configured ? "Cloud sign in" : "Local mode";
  const account = $<HTMLElement>("[data-settings-account]");
  if (auth.user) {
    account.innerHTML = `<div><span>Signed in as</span><strong>${escapeHtml(auth.user.email ?? "Your account")}</strong></div><div class="settings-account__actions"><button class="button button--quiet" type="button" data-sign-out>Sign out</button><button class="button button--danger" type="button" data-delete-account>Delete account</button></div>`;
  } else {
    account.innerHTML = `<p>${auth.configured ? "Sign in to sync this tracker across devices." : "Cloud sync is not configured. Your data is safely stored in this browser."}</p>`;
  }
}

function openSettings(): void {
  const form = $<HTMLFormElement>("[data-settings-form]");
  setFormValue(form, "timezone", state.profile.timezone);
  setFormValue(form, "weekStart", state.profile.weekStart);
  renderAccount();
  settingsDialog.showModal();
}

async function saveSettings(): Promise<void> {
  const form = $<HTMLFormElement>("[data-settings-form]");
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  state.profile.timezone = String(data.get("timezone"));
  state.profile.weekStart = Number(data.get("weekStart")) as Profile["weekStart"];
  settingsDialog.close();
  calendar.setOption("timeZone", state.profile.timezone);
  calendar.setOption("firstDay", state.profile.weekStart);
  await persist(() => repository.saveProfile(state.profile), "Preferences saved");
}

async function reloadForAccount(): Promise<void> {
  repository = persistence.repository;
  try {
    state = await repository.load();
    selectedDate = DateTime.now().setZone(state.profile.timezone).startOf("day").toJSDate();
    calendar.setOption("timeZone", state.profile.timezone);
    calendar.setOption("firstDay", state.profile.weekStart);
    fillLabelSelects(); refreshCalendar(); renderRevisionTable(); renderAccount(); setStatus("saved");
  } catch (error) {
    toast(error instanceof Error ? error.message : "Could not load cloud data.", "error");
  }
}

function initializeCalendar(): void {
  calendar = new Calendar($<HTMLElement>("#calendar"), fullCalendarOptions());
  calendar.render();
}

function initializeTimezones(): void {
  const supported = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [state.profile.timezone, "UTC", "Europe/London", "Asia/Hong_Kong", "America/New_York"];
  $("#timezone-list").innerHTML = supported.map((zone) => `<option value="${zone}"></option>`).join("");
}

function initializeInteractions(): void {
  $("[data-calendar-prev]").addEventListener("click", () => calendar.prev());
  $("[data-calendar-next]").addEventListener("click", () => calendar.next());
  $("[data-calendar-today]").addEventListener("click", () => { calendar.today(); selectedDate = DateTime.now().setZone(state.profile.timezone).startOf("day").toJSDate(); renderAgenda(); });
  $$<HTMLButtonElement>("[data-view]").forEach((button) => button.addEventListener("click", async () => {
    calendar.changeView(button.dataset.view!);
    state.profile.calendarView = button.dataset.view as Profile["calendarView"];
    await persist(() => repository.saveProfile(state.profile));
  }));
  $("[data-add-event]").addEventListener("click", () => openEventDialog());
  $("[data-agenda-add]").addEventListener("click", () => openEventDialog(undefined, selectedDate));
  $("[data-add-revision]").addEventListener("click", () => openRevisionDialog());
  $("[data-empty-add-revision]").addEventListener("click", () => openRevisionDialog());
  $("[data-manage-labels]").addEventListener("click", () => { renderLabelManager(); labelDialog.showModal(); });
  $("[data-open-settings]").addEventListener("click", openSettings);
  $("[data-open-privacy]").addEventListener("click", () => privacyDialog.showModal());
  $("[data-export-all]").addEventListener("click", () => exportEvents(state.events.filter((event) => !event.deletedAt), "revision-tracker.ics"));
  $("[data-save-event]").addEventListener("click", (event) => { event.preventDefault(); void saveEventFromForm(); });
  $("[data-delete-event]").addEventListener("click", () => void deleteActiveEvent());
  $("[data-export-event]").addEventListener("click", () => { const item = state.events.find((event) => event.id === activeEventId); if (item) exportEvents([item], `${item.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.ics`); });
  $("[data-save-revision]").addEventListener("click", (event) => { event.preventDefault(); void saveRevisionFromForm(); });
  $("[data-save-session]").addEventListener("click", (event) => { event.preventDefault(); void saveSessionFromForm(); });
  $("[data-add-label]").addEventListener("click", (event) => { event.preventDefault(); void addLabelFromForm(); });
  $("[data-save-settings]").addEventListener("click", (event) => { event.preventDefault(); void saveSettings(); });
  $("[data-revision-search]").addEventListener("input", renderRevisionTable);
  $("[data-revision-filter]").addEventListener("change", renderRevisionTable);
  $("[data-revision-sort]").addEventListener("change", renderRevisionTable);
  $("[data-agenda-list]").addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const open = target.closest<HTMLElement>("[data-agenda-event]");
    const log = target.closest<HTMLElement>("[data-log-event]");
    if (open) openEventDialog(open.dataset.agendaEvent);
    if (log) void logEvent(log.dataset.logEvent!);
  });
  $("[data-revision-body]").addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const edit = target.closest<HTMLElement>("[data-edit-revision]");
    const log = target.closest<HTMLElement>("[data-log-session]");
    const mastery = target.closest<HTMLElement>("[data-set-mastery]");
    const remove = target.closest<HTMLElement>("[data-delete-revision]");
    if (edit) openRevisionDialog(edit.dataset.editRevision);
    if (log) openSessionDialog(log.dataset.logSession!);
    if (mastery) {
      const item = state.revisionItems.find((entry) => entry.id === mastery.dataset.setMastery);
      if (item) { item.mastery = Number(mastery.dataset.score) as RevisionItem["mastery"]; item.updatedAt = isoNow(); renderRevisionTable(); void persist(() => repository.saveRevisionItem(item)); }
    }
    if (remove) {
      const item = state.revisionItems.find((entry) => entry.id === remove.dataset.deleteRevision);
      if (item && window.confirm(`Delete “${item.title}” and its session history?`)) {
        state.revisionItems = state.revisionItems.filter((entry) => entry.id !== item.id);
        state.sessions = state.sessions.filter((session) => session.revisionItemId !== item.id);
        renderRevisionTable(); void persist(() => repository.deleteRevisionItem(item.id), "Revision item deleted");
      }
    }
  });
  $("[data-label-manager]").addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const save = target.closest<HTMLElement>("[data-save-label]");
    const remove = target.closest<HTMLElement>("[data-delete-label]");
    if (save) void saveLabel(save.dataset.saveLabel!);
    if (remove) void deleteLabel(remove.dataset.deleteLabel!);
  });
  $("[data-auth-button]").addEventListener("click", () => persistence.authState.user ? openSettings() : authDialog.showModal());
  $("[data-send-magic-link]").addEventListener("click", async (event) => {
    event.preventDefault();
    const form = $<HTMLFormElement>("[data-auth-form]");
    if (!form.reportValidity()) return;
    const message = $<HTMLElement>("[data-auth-message]");
    message.textContent = "Sending…";
    try {
      await persistence.sendMagicLink(String(new FormData(form).get("email")));
      message.textContent = "Check your inbox for the secure sign-in link.";
    } catch (error) { message.textContent = error instanceof Error ? error.message : "Could not send the link."; }
  });
  $("[data-settings-account]").addEventListener("click", async (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-sign-out]")) { settingsDialog.close(); await persistence.signOut(); }
    if (target.closest("[data-delete-account]") && window.confirm("Permanently delete your account and all tracker data? This cannot be undone.")) {
      try { await persistence.deleteAccount(); settingsDialog.close(); toast("Account deleted"); } catch (error) { toast(error instanceof Error ? error.message : "Account deletion failed.", "error"); }
    }
  });
  retryButton.addEventListener("click", async () => { const remaining = await persistence.flushQueue(); setStatus(remaining ? "error" : "saved"); if (!remaining) toast("Queued changes synced"); });
  window.addEventListener("online", async () => { const remaining = await persistence.flushQueue(); setStatus(remaining ? "error" : "saved"); });
  window.addEventListener("offline", () => setStatus("offline"));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { calendar.setOption("now", DateTime.now().setZone(state.profile.timezone).toISO() ?? new Date()); calendar.render(); } });
}

function scheduleTodayRefresh(): void {
  window.setTimeout(() => {
    calendar.setOption("now", DateTime.now().setZone(state.profile.timezone).toISO() ?? new Date());
    calendar.render();
    scheduleTodayRefresh();
  }, nextMidnightDelay());
}

initializeTimezones();
initializeCalendar();
fillLabelSelects();
renderRevisionTable();
renderAgenda();
renderAccount();
initializeInteractions();
scheduleTodayRefresh();
setStatus(navigator.onLine ? "saved" : "offline");
persistence.onAuthChange(() => void reloadForAccount());

requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add("is-ready")));
