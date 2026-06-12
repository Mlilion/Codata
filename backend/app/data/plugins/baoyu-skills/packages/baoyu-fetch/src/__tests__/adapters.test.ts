import { describe, expect, test } from "bun:test";
import { resolveAdapter } from "../adapters";

describe("adapter registry", () => {
  test("matches x adapter for x.com status URLs", () => {
    const adapter = resolveAdapter({
      url: new URL("https://x.com/openai/status/1234567890"),
    });
    expect(adapter.name).toBe("x");
  });

  test("matches hn adapter for item URLs", () => {
    const adapter = resolveAdapter({
      url: new URL("https://news.ycombinator.com/item?id=47534848"),
    });
    expect(adapter.name).toBe("hn");
  });

  test("falls back to generic adapter", () => {
    const adapter = resolveAdapter({
      url: new URL("https://example.com/post"),
    });
    expect(adapter.name).toBe("generic");
  });
});
