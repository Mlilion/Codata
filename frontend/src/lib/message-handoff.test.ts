import { describe, expect, it } from "vitest";
import { canFinalizeMessageHandoff, canFinalizeMessagesHandoff } from "./message-handoff";
import type { MessageResponse, PartData } from "@/types/message";

function part(messageId: string, data: PartData, index: number) {
  return {
    id: `${messageId}-part-${index}`,
    message_id: messageId,
    session_id: "session-a",
    time_created: "2026-04-26T12:00:00.000Z",
    data,
  };
}

function assistant(id: string, parts: PartData[]): MessageResponse {
  return {
    id,
    session_id: "session-a",
    time_created: "2026-04-26T12:00:00.000Z",
    data: { role: "assistant" },
    parts: parts.map((data, index) => part(id, data, index)),
  };
}

describe("canFinalizeMessageHandoff", () => {
  it("does not finalize from an older assistant message when the current assistant id is known", () => {
    const previous = assistant("assistant-old", [
      { type: "text", text: "previous answer" },
      { type: "step-finish", reason: "stop", tokens: {}, cost: 0 },
    ]);

    expect(
      canFinalizeMessageHandoff(previous, {
        currentAssistantMessageIds: new Set(["assistant-new"]),
        currentToolCallIds: new Set(),
      }),
    ).toBe(false);
  });

  it("finalizes when the current assistant message has visible output and a terminal finish", () => {
    const current = assistant("assistant-new", [
      { type: "text", text: "latest answer" },
      { type: "step-finish", reason: "stop", tokens: {}, cost: 0 },
    ]);

    expect(
      canFinalizeMessageHandoff(current, {
        currentAssistantMessageIds: new Set(["assistant-new"]),
        currentToolCallIds: new Set(),
      }),
    ).toBe(true);
  });

  it("does not finalize an invisible current assistant shell", () => {
    const current = assistant("assistant-new", [
      { type: "step-start", snapshot: null },
      { type: "step-finish", reason: "stop", tokens: {}, cost: 0 },
    ]);

    expect(
      canFinalizeMessageHandoff(current, {
        currentAssistantMessageIds: new Set(["assistant-new"]),
        currentToolCallIds: new Set(),
      }),
    ).toBe(false);
  });

  it("does not finalize without a current assistant or tool identity", () => {
    const previous = assistant("assistant-old", [
      { type: "text", text: "previous answer" },
      { type: "step-finish", reason: "stop", tokens: {}, cost: 0 },
    ]);

    expect(
      canFinalizeMessagesHandoff([previous], {
        currentAssistantMessageIds: new Set(),
        currentToolCallIds: new Set(),
      }),
    ).toBe(false);
  });

  it("finalizes a multi-step assistant group when one current message has output and another has terminal finish", () => {
    const progress = assistant("assistant-progress", [
      { type: "text", text: "I found the data source." },
      { type: "step-finish", reason: "tool_use", tokens: {}, cost: 0 },
    ]);
    const final = assistant("assistant-final", [
      { type: "step-start", snapshot: null },
      { type: "step-finish", reason: "stop", tokens: {}, cost: 0 },
    ]);

    expect(
      canFinalizeMessagesHandoff([progress, final], {
        currentAssistantMessageIds: new Set(["assistant-progress", "assistant-final"]),
        currentToolCallIds: new Set(),
      }),
    ).toBe(true);
  });
});
