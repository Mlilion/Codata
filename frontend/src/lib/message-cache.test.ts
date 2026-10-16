import { describe, expect, it } from "vitest";
import {
  compareMessagesChronologically,
  mergeLatestMessagePage,
} from "./message-cache";
import type { MessageResponse, PaginatedMessages } from "@/types/message";

function message(id: string, time_created: string): MessageResponse {
  return {
    id,
    session_id: "session-a",
    time_created,
    data: { role: "assistant" },
    parts: [],
  };
}

describe("message cache helpers", () => {
  it("sorts equal-timestamp messages by id for deterministic ordering", () => {
    const later = message("assistant-b", "2026-09-10T00:00:00.000Z");
    const earlier = message("assistant-a", "2026-09-10T00:00:00.000Z");

    expect([later, earlier].sort(compareMessagesChronologically).map((item) => item.id))
      .toEqual(["assistant-a", "assistant-b"]);
  });

  it("merges a refreshed latest page without dropping loaded history", () => {
    const first = message("message-1", "2026-09-10T00:00:01.000Z");
    const second = message("message-2", "2026-09-10T00:00:02.000Z");
    const third = message("message-3", "2026-09-10T00:00:03.000Z");
    const fourth = message("message-4", "2026-09-10T00:00:04.000Z");
    const fifth = message("message-5", "2026-09-10T00:00:05.000Z");

    const old: {
      pages: PaginatedMessages[];
      pageParams: unknown[];
    } = {
      pages: [
        { total: 4, offset: 0, messages: [first, second] },
        { total: 4, offset: 2, messages: [third, fourth] },
      ],
      pageParams: [0, -1],
    };

    const merged = mergeLatestMessagePage(old, {
      total: 5,
      offset: 3,
      messages: [fourth, fifth],
    });

    expect(merged.pages.map((page) => page.offset)).toEqual([0, 2, 3]);
    expect(merged.pages.flatMap((page) => page.messages).map((item) => item.id))
      .toEqual(["message-1", "message-2", "message-3", "message-4", "message-5"]);
    expect(merged.pages.every((page) => page.total === 5)).toBe(true);
  });
});
