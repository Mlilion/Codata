import { describe, expect, it } from "vitest";
import { activeSessionIdsFromJobs } from "./active-chat-jobs";

describe("activeSessionIdsFromJobs", () => {
  it("returns unique non-empty active session ids", () => {
    const ids = activeSessionIdsFromJobs([
      { stream_id: "stream-1", session_id: "session-1" },
      { stream_id: "stream-2", session_id: "session-1" },
      { stream_id: "stream-3", session_id: "session-2", needs_input: true },
      { stream_id: "stream-4", session_id: "" },
    ]);

    expect([...ids]).toEqual(["session-1", "session-2"]);
  });
});
