import { describe, expect, test } from "bun:test";
import {
  buildYouTubeThumbnailCandidates,
  formatTimestampRange,
  parseYouTubeDescriptionChapters,
  parseYouTubeVideoId,
  renderYouTubeTranscriptMarkdown,
} from "../adapters/youtube/utils";

describe("parseYouTubeVideoId", () => {
  test("parses watch URLs", () => {
    expect(parseYouTubeVideoId(new URL("https://www.youtube.com/watch?v=abc123"))).toBe("abc123");
  });

  test("parses youtu.be URLs", () => {
    expect(parseYouTubeVideoId(new URL("https://youtu.be/abc123"))).toBe("abc123");
  });

  test("parses shorts URLs", () => {
    expect(parseYouTubeVideoId(new URL("https://www.youtube.com/shorts/abc123"))).toBe("abc123");
  });
});

describe("parseYouTubeDescriptionChapters", () => {
  test("extracts chapter timestamps from description lines", () => {
    expect(
      parseYouTubeDescriptionChapters(`0:00 Intro
2:15 What is a product engineer?
10:05 Career paths`),
    ).toEqual([
      { title: "Intro", time: 0 },
      { title: "What is a product engineer?", time: 135 },
      { title: "Career paths", time: 605 },
    ]);
  });

  test("ignores isolated timestamps that do not look like chapters", () => {
    expect(parseYouTubeDescriptionChapters("Published on 2026-03-26\nSee you at 1:23")).toEqual([]);
  });
});

describe("renderYouTubeTranscriptMarkdown", () => {
  test("renders description before chapters and keeps every segment on its own line", () => {
    const markdown = renderYouTubeTranscriptMarkdown({
      description: "Line one\nLine two",
      chapters: [
        { title: "Intro", time: 0 },
        { title: "Deep Dive", time: 4 },
      ],
      segments: [
        { start: 0, end: 2, text: "Hello everyone." },
        { start: 2, end: 4, text: "Welcome back." },
        { start: 4, end: 7, text: "Now the details." },
      ],
    });

    expect(markdown).toContain("## Description");
    expect(markdown).toContain("Line one  \nLine two");
    expect(markdown).toContain("## Chapters");
    expect(markdown).toContain("### Intro [0:00 -> 0:04]");
    expect(markdown).toContain("[0:00 -> 0:02] Hello everyone.");
    expect(markdown).toContain("[0:02 -> 0:04] Welcome back.");
    expect(markdown).toContain("### Deep Dive [0:04 -> 0:07]");
    expect(markdown).toContain("[0:04 -> 0:07] Now the details.");
  });

  test("falls back to a transcript section when chapters are unavailable", () => {
    const markdown = renderYouTubeTranscriptMarkdown({
      segments: [{ start: 65, end: 70, text: "Single line." }],
      chapters: [],
    });

    expect(markdown).toContain("## Transcript");
    expect(markdown).toContain("[1:05 -> 1:10] Single line.");
  });
});

describe("thumbnail helpers", () => {
  test("prefers max resolution thumbnail candidates before listed fallbacks", () => {
    expect(
      buildYouTubeThumbnailCandidates("abc123", [
        "https://i.ytimg.com/vi/abc123/hqdefault.jpg",
        "https://i.ytimg.com/vi/abc123/mqdefault.jpg?foo=bar",
      ]),
    ).toEqual([
      "https://i.ytimg.com/vi/abc123/maxresdefault.jpg",
      "https://i.ytimg.com/vi/abc123/sddefault.jpg",
      "https://i.ytimg.com/vi/abc123/hqdefault.jpg",
      "https://i.ytimg.com/vi/abc123/mqdefault.jpg",
      "https://i.ytimg.com/vi/abc123/default.jpg",
    ]);
  });

  test("renders timestamp ranges with start and end values", () => {
    expect(formatTimestampRange(3661, 3675)).toBe("[1:01:01 -> 1:01:15]");
  });
});
