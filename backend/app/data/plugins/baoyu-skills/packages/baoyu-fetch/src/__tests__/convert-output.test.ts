import { describe, expect, test } from "bun:test";
import { formatOutputContent } from "../commands/convert";

describe("formatOutputContent", () => {
  test("returns raw markdown for markdown output", () => {
    expect(
      formatOutputContent("markdown", {
        adapter: "generic",
        status: "ok",
        media: [],
        downloads: null,
        document: {
          url: "https://example.com",
          content: [],
        },
        markdown: "# Example",
      }),
    ).toBe("# Example");
  });

  test("returns structured json for json output", () => {
    const parsed = JSON.parse(
      formatOutputContent("json", {
        adapter: "generic",
        status: "ok",
        media: [],
        downloads: null,
        document: {
          url: "https://example.com",
          content: [],
        },
        markdown: "# Example",
      }),
    );

    expect(parsed.status).toBe("ok");
    expect(parsed.markdown).toBe("# Example");
    expect(parsed.document.url).toBe("https://example.com");
  });

  test("rejects markdown output for interaction-required payloads", () => {
    expect(() =>
      formatOutputContent("markdown", {
        adapter: "x",
        status: "needs_interaction",
        interaction: {
          type: "wait_for_interaction",
          kind: "login",
          provider: "x",
          prompt: "Login required",
        },
      }),
    ).toThrow("Markdown output is only available");
  });
});
