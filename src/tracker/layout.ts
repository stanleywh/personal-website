export interface CalendarLayoutApi {
  updateSize(): void;
}

export function revealTrackerAndUpdateCalendar(
  guard: HTMLElement,
  shell: HTMLElement,
  calendar: CalendarLayoutApi,
  scheduleFrame: (callback: FrameRequestCallback) => number = window.requestAnimationFrame.bind(window),
): void {
  guard.hidden = true;
  shell.hidden = false;
  scheduleFrame(() => calendar.updateSize());
}
