export type TrackerAuthGateState =
  | "pending"
  | "loading"
  | "slow"
  | "error"
  | "complete";

type TimerHandle = ReturnType<typeof globalThis.setTimeout>;

export interface TrackerAuthGateOptions {
  guard: HTMLElement;
  message: HTMLElement;
  showDelayMs?: number;
  slowDelayMs?: number;
  schedule?: (callback: () => void, delayMs: number) => TimerHandle;
  cancel?: (handle: TimerHandle) => void;
}

export interface TrackerAuthGate {
  finish(): void;
  showError(message: string): void;
}

const DEFAULT_SHOW_DELAY_MS = 200;
const DEFAULT_SLOW_DELAY_MS = 10_000;

export function createTrackerAuthGate(options: TrackerAuthGateOptions): TrackerAuthGate {
  const {
    guard,
    message,
    showDelayMs = DEFAULT_SHOW_DELAY_MS,
    slowDelayMs = DEFAULT_SLOW_DELAY_MS,
    schedule = globalThis.setTimeout.bind(globalThis),
    cancel = globalThis.clearTimeout.bind(globalThis),
  } = options;

  let active = true;
  guard.hidden = false;
  guard.dataset.state = "pending";
  guard.setAttribute("aria-busy", "true");

  const showTimer = schedule(() => {
    if (!active) return;
    guard.dataset.state = "loading";
  }, showDelayMs);

  const slowTimer = schedule(() => {
    if (!active) return;
    message.textContent = "Still checking your account\u2026";
    guard.dataset.state = "slow";
  }, slowDelayMs);

  function clearTimers(): void {
    cancel(showTimer);
    cancel(slowTimer);
  }

  return {
    finish(): void {
      if (!active) return;
      active = false;
      clearTimers();
      guard.dataset.state = "complete";
      guard.setAttribute("aria-busy", "false");
      guard.hidden = true;
    },

    showError(errorMessage: string): void {
      if (!active) return;
      active = false;
      clearTimers();
      message.textContent = errorMessage;
      guard.dataset.state = "error";
      guard.setAttribute("aria-busy", "false");
      guard.hidden = false;
    },
  };
}
