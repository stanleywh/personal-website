import { afterEach, describe, expect, it, vi } from "vitest";
import { createTrackerAuthGate } from "../src/tracker/auth-gate";

function createGate() {
  const guard = document.createElement("div");
  const message = document.createElement("p");
  message.textContent = "Checking your account\u2026";
  guard.append(message);

  const gate = createTrackerAuthGate({ guard, message });
  return { gate, guard, message };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("tracker authentication gate", () => {
  it("keeps the loading indicator pending for 200ms before showing it", () => {
    vi.useFakeTimers();
    const { guard } = createGate();

    expect(guard.dataset.state).toBe("pending");
    vi.advanceTimersByTime(199);
    expect(guard.dataset.state).toBe("pending");
    vi.advanceTimersByTime(1);
    expect(guard.dataset.state).toBe("loading");
  });

  it("shows a recoverable slow state after ten seconds", () => {
    vi.useFakeTimers();
    const { guard, message } = createGate();

    vi.advanceTimersByTime(10_000);

    expect(guard.dataset.state).toBe("slow");
    expect(message.textContent).toBe("Still checking your account\u2026");
    expect(guard.getAttribute("aria-busy")).toBe("true");
  });

  it("shows initialization errors immediately and cancels later changes", () => {
    vi.useFakeTimers();
    const { gate, guard, message } = createGate();

    gate.showError("Accounts are unavailable.");

    expect(guard.hidden).toBe(false);
    expect(guard.dataset.state).toBe("error");
    expect(guard.getAttribute("aria-busy")).toBe("false");
    expect(message.textContent).toBe("Accounts are unavailable.");

    vi.advanceTimersByTime(10_000);
    expect(guard.dataset.state).toBe("error");
    expect(message.textContent).toBe("Accounts are unavailable.");
  });

  it("clears both timers when authentication finishes", () => {
    vi.useFakeTimers();
    const { gate, guard, message } = createGate();

    gate.finish();
    vi.advanceTimersByTime(10_000);

    expect(guard.hidden).toBe(true);
    expect(guard.dataset.state).toBe("complete");
    expect(guard.getAttribute("aria-busy")).toBe("false");
    expect(message.textContent).toBe("Checking your account\u2026");
  });
});
