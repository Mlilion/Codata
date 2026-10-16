import { describe, expect, it } from "vitest";

import { extractTextFromParts, parseBackendDate, visibleMessageParts } from "./utils";
import type { PartData } from "@/types/message";

describe("trace text handling", () => {
  it("keeps trace parts available while excluding them from copied answer text", () => {
    const parts: PartData[] = [
      { type: "text", text: "Let me query the metric.", visibility: "trace" },
      { type: "text", text: "收入增长主要由北京贡献。", visibility: "answer" },
    ];

    expect(visibleMessageParts(parts)).toHaveLength(2);
    expect(extractTextFromParts(parts)).toBe("收入增长主要由北京贡献。");
  });
});

describe("backend timestamp parsing", () => {
  it("treats legacy timezone-less SQLite timestamps as UTC", () => {
    const legacy = parseBackendDate("2026-09-16T08:27:04.257644");
    const explicit = parseBackendDate("2026-09-16T08:27:04.257644Z");
    expect(legacy.getTime()).toBe(explicit.getTime());
    expect(legacy.toISOString()).toBe("2026-09-16T08:27:04.257Z");
  });

  it("preserves explicit timezone offsets", () => {
    const china = parseBackendDate("2026-09-16T16:27:04+08:00");
    expect(china.toISOString()).toBe("2026-09-16T08:27:04.000Z");
  });
});
