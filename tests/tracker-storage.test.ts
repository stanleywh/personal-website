import { beforeEach, describe, expect, it } from "vitest";
import {
  cacheUserState,
  queueKey,
  readUserCache,
  readUserQueue,
  stateKey,
} from "../src/tracker/store";
import { createInitialState } from "../src/tracker/seed";
import type { QueuedMutation } from "../src/tracker/types";

describe("account-partitioned tracker storage", () => {
  beforeEach(() => localStorage.clear());

  it("keeps each user's cached state under a separate key", () => {
    const first = createInitialState();
    const second = createInitialState();
    first.profile.locale = "en-GB";
    second.profile.locale = "zh-HK";

    cacheUserState("user-a", first);
    cacheUserState("user-b", second);

    expect(stateKey("user-a")).not.toBe(stateKey("user-b"));
    expect(readUserCache("user-a")?.profile.locale).toBe("en-GB");
    expect(readUserCache("user-b")?.profile.locale).toBe("zh-HK");
  });

  it("refuses queued operations whose recorded owner does not match the partition", () => {
    const own: QueuedMutation = {
      id: "one",
      ownerId: "user-a",
      operation: "delete_label",
      payload: { id: "label" },
      queuedAt: new Date().toISOString(),
    };
    const foreign: QueuedMutation = { ...own, id: "two", ownerId: "user-b" };
    const unknown = { ...own, id: "three", operation: "arbitrary_table_write" };
    localStorage.setItem(queueKey("user-a"), JSON.stringify([own, foreign, unknown]));

    expect(readUserQueue("user-a")).toEqual([own]);
  });
});
