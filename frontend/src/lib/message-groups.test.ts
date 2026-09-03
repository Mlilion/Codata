import { describe, expect, it } from "vitest";
import { groupMessages } from "./message-groups";
import type { MessageResponse, PartData } from "@/types/message";

function makeMessage(
  id: string,
  role: "user" | "assistant",
  parts: PartData[],
  extra: Record<string, unknown> = {},
): MessageResponse {
  return {
    id,
    session_id: "session-1",
    time_created: "2026-09-02T00:00:00.000Z",
    data: { role, ...extra } as MessageResponse["data"],
    parts: parts.map((part, index) => ({
      id: `${id}-part-${index}`,
      message_id: id,
      session_id: "session-1",
      time_created: "2026-09-02T00:00:00.000Z",
      data: part,
    })),
  };
}

describe("groupMessages", () => {
  it("keeps the final visible assistant reply when an empty memory message follows it", () => {
    const groups = groupMessages([
      makeMessage("user-1", "user", [{ type: "text", text: "publish" }]),
      makeMessage("assistant-1", "assistant", [{ type: "text", text: "done" }]),
      makeMessage("memory-1", "assistant", [], { agent: "memory", system: true }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[1]).toMatchObject({
      kind: "assistant",
      messages: [{ id: "assistant-1" }],
    });
  });

  it("does not split a response when a system user message is injected", () => {
    const groups = groupMessages([
      makeMessage("user-1", "user", [{ type: "text", text: "start" }]),
      makeMessage("assistant-1", "assistant", [{ type: "text", text: "part one" }]),
      makeMessage("system-1", "user", [{ type: "text", text: "[System: continue]" }], { system: true }),
      makeMessage("assistant-2", "assistant", [{ type: "text", text: "part two" }]),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[1].kind).toBe("assistant");
    if (groups[1].kind === "assistant") {
      expect(groups[1].messages.map((msg) => msg.id)).toEqual(["assistant-1", "assistant-2"]);
    }
  });
});
