import type { TrackerState } from "./types";
import { isoNow, uid } from "./utils";

export function createInitialState(): TrackerState {
  const locale = navigator.language || "en-GB";
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return {
    profile: { timezone, locale, weekStart: 1, calendarView: "dayGridMonth", onboardingComplete: false },
    labels: [],
    events: [],
    revisionItems: [],
    sessions: [],
  };
}

export function createDemoState(): TrackerState {
  const state = createInitialState();
  const now = new Date();
  const createdAt = isoNow();
  const biology = { id: uid(), kind: "subject" as const, name: "Biology", color: "#6f8b72", createdAt: isoNow(), updatedAt: isoNow() };
  const maths = { id: uid(), kind: "subject" as const, name: "Mathematics", color: "#8a7055", createdAt: isoNow(), updatedAt: isoNow() };
  const classLabel = { id: uid(), kind: "class" as const, name: "Advanced class", color: "#8b768e", createdAt: isoNow(), updatedAt: isoNow() };
  const cells = { id: uid(), kind: "topic" as const, name: "Cell biology", color: "#79918f", createdAt: isoNow(), updatedAt: isoNow() };
  const revisionId = uid();
  const start = new Date(now);
  start.setHours(Math.max(now.getHours() + 1, 10), 0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60_000);
  state.labels = [biology, maths, classLabel, cells];
  state.events = [{
    id: uid(), title: "Cell structure review", startAt: start.toISOString(), endAt: end.toISOString(), allDay: false,
    timezone: state.profile.timezone, subjectId: biology.id, classId: classLabel.id, topicId: cells.id,
    notes: "Review organelles, then answer two exam questions.", availability: "busy", travelMinutes: 0, alerts: [15],
    origin: "web", version: 1, createdAt: isoNow(), updatedAt: isoNow(),
  }];
  state.revisionItems = [{ id: revisionId, title: "Cell structure", subjectId: biology.id, topicId: cells.id, mastery: 3, notes: "Focus on mitochondria and ribosomes.", createdAt, updatedAt: createdAt }];
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  state.sessions = [{ id: uid(), revisionItemId: revisionId, revisedAt: yesterday.toISOString(), durationMinutes: 45, mastery: 3, createdAt, updatedAt: createdAt }];
  return state;
}
