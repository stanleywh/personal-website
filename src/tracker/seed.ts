import type { TrackerState } from "./types";

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
