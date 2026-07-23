import { beforeEach, describe, expect, it } from "vitest";
import {
  LEGACY_STATE_KEY,
  legacyRecordCounts,
  readLegacyState,
  trackerStateIsEmpty,
} from "../src/tracker/store";
import { createInitialState } from "../src/tracker/seed";
import { isoNow } from "../src/tracker/utils";

describe("legacy browser data", () => {
  beforeEach(() => localStorage.clear());

  it("detects only a populated legacy state as importable content", () => {
    const legacy = createInitialState();
    expect(trackerStateIsEmpty(legacy)).toBe(true);
    legacy.labels.push({
      id: "label",
      kind: "subject",
      name: "Biology",
      color: "#78634b",
      createdAt: isoNow(),
      updatedAt: isoNow(),
    });
    localStorage.setItem(LEGACY_STATE_KEY, JSON.stringify(legacy));

    expect(trackerStateIsEmpty(readLegacyState()!)).toBe(false);
    expect(legacyRecordCounts(readLegacyState()!)).toEqual({
      events: 0,
      labels: 1,
      revisionItems: 0,
      sessions: 0,
    });
  });

  it("returns no legacy state for malformed data", () => {
    localStorage.setItem(LEGACY_STATE_KEY, "{not-json");
    expect(readLegacyState()).toBeUndefined();
    localStorage.setItem(LEGACY_STATE_KEY, JSON.stringify({ labels: [] }));
    expect(readLegacyState()).toBeUndefined();
  });
});
