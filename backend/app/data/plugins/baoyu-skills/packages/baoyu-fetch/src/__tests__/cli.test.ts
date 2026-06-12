import { describe, expect, test } from "bun:test";
import { HELP_TEXT, parseArgs } from "../cli";

describe("parseArgs", () => {
  test("defaults to markdown output", () => {
    const options = parseArgs(["bun", "src/cli.ts", "https://example.com"]);
    expect(options.format).toBe("markdown");
  });

  test("parses explicit json output format", () => {
    const options = parseArgs(["bun", "src/cli.ts", "https://example.com", "--format", "json"]);
    expect(options.format).toBe("json");
  });

  test("maps --json to json output format", () => {
    const options = parseArgs(["bun", "src/cli.ts", "https://example.com", "--json"]);
    expect(options.format).toBe("json");
  });

  test("parses --wait-for interaction", () => {
    const options = parseArgs(["bun", "src/cli.ts", "https://example.com", "--wait-for", "interaction"]);
    expect(options.waitMode).toBe("interaction");
  });

  test("parses --wait-for force", () => {
    const options = parseArgs(["bun", "src/cli.ts", "https://example.com", "--wait-for", "force"]);
    expect(options.waitMode).toBe("force");
  });

  test("maps legacy wait flags to interaction mode", () => {
    const options = parseArgs(["bun", "src/cli.ts", "https://example.com", "--wait-for-interaction"]);
    expect(options.waitMode).toBe("interaction");
  });

  test("parses media download options", () => {
    const options = parseArgs([
      "bun",
      "src/cli.ts",
      "https://example.com",
      "--download-media",
      "--media-dir",
      "./assets",
    ]);

    expect(options.downloadMedia).toBe(true);
    expect(options.mediaDir).toBe("./assets");
  });

  test("rejects invalid wait modes", () => {
    expect(() =>
      parseArgs(["bun", "src/cli.ts", "https://example.com", "--wait-for", "unknown"]),
    ).toThrow("Invalid wait mode");
  });

  test("rejects invalid output formats", () => {
    expect(() =>
      parseArgs(["bun", "src/cli.ts", "https://example.com", "--format", "xml"]),
    ).toThrow("Invalid output format");
  });

  test("documents wait modes in help text", () => {
    expect(HELP_TEXT).toContain("baoyu-fetch");
    expect(HELP_TEXT).toContain("--format <type>");
    expect(HELP_TEXT).toContain("--wait-for <mode>");
    expect(HELP_TEXT).toContain("--download-media");
    expect(HELP_TEXT).toContain("force: start visible Chrome, then auto-continue");
    expect(HELP_TEXT).toContain("or continue immediately when you press Enter");
  });
});
