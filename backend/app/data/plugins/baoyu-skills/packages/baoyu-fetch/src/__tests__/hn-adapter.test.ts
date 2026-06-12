import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "../extract/markdown-renderer";
import {
  buildHnDocument,
  buildHnThreadMarkdown,
  extractHnThreadFromHtml,
  parseHnItemId,
  type HnCommentNode,
  type HnItem,
} from "../adapters/hn";

describe("hn adapter helpers", () => {
  test("parses item id from hn item url", () => {
    expect(parseHnItemId(new URL("https://news.ycombinator.com/item?id=47534848"))).toBe(47534848);
    expect(parseHnItemId(new URL("https://news.ycombinator.com/newest"))).toBeNull();
  });

  test("renders threaded comments with author, time, and nested indentation", () => {
    const story: HnItem = {
      id: 47534848,
      type: "story",
      by: "mmcclure",
      time: 1774554485,
      title: "Example &amp; Title",
      url: "https://example.com/post",
      score: 257,
      descendants: 2,
    };

    const comments: HnCommentNode[] = [
      {
        item: {
          id: 47535377,
          type: "comment",
          by: "jackfruitpeel",
          time: 1774557334,
          text: "Root comment<p>With two paragraphs.",
        },
        children: [
          {
            item: {
              id: 47535469,
              type: "comment",
              by: "__MatrixMan__",
              time: 1774557848,
              text: "Nested reply with a <a href=\"item?id=1\">relative link</a>.",
            },
            children: [],
          },
        ],
      },
    ];

    const body = buildHnThreadMarkdown(story, comments, "https://news.ycombinator.com/item?id=47534848");
    expect(body).toContain("Source: [https://example.com/post](https://example.com/post)");
    expect(body).toContain("Submitted by mmcclure at 2026-03-26 19:48:05 UTC");
    expect(body).toContain("- jackfruitpeel · [2026-03-26 20:35:34 UTC](https://news.ycombinator.com/item?id=47534848#47535377)");
    expect(body).toContain("    Root comment");
    expect(body).toContain("    With two paragraphs.");
    expect(body).toContain("    - __MatrixMan__ · [2026-03-26 20:44:08 UTC](https://news.ycombinator.com/item?id=47534848#47535469)");
    expect(body).toContain("        Nested reply with a [relative link](https://news.ycombinator.com/item?id=1).");
  });

  test("extracts story metadata and nested comments from hn html", () => {
    const parsed = extractHnThreadFromHtml(
      `
      <html>
        <body>
          <table class="fatitem">
            <tr class="athing submission" id="47534848">
              <td class="title">
                <span class="titleline">
                  <a href="https://example.com/post">Example story</a>
                </span>
              </td>
            </tr>
            <tr>
              <td class="subtext">
                <span class="subline">
                  <span class="score">257 points</span>
                  by <a href="user?id=mmcclure" class="hnuser">mmcclure</a>
                  <span class="age" title="2026-03-26T19:48:05 1774554485">
                    <a href="item?id=47534848">1 hour ago</a>
                  </span>
                  <a href="item?id=47534848">152 comments</a>
                </span>
              </td>
            </tr>
            <tr>
              <td><div class="toptext">Story <p>body</p></div></td>
            </tr>
          </table>
          <table class="comment-tree">
            <tr class="athing comtr" id="47535377">
              <td class="ind" indent="0"></td>
              <td class="default">
                <span class="comhead">
                  <a href="user?id=jackfruitpeel" class="hnuser">jackfruitpeel</a>
                  <span class="age" title="2026-03-26T20:35:34 1774557334">
                    <a href="item?id=47535377">36 minutes ago</a>
                  </span>
                </span>
                <div class="comment"><div class="commtext c00">Root</div></div>
              </td>
            </tr>
            <tr class="athing comtr" id="47535469">
              <td class="ind" indent="1"></td>
              <td class="default">
                <span class="comhead">
                  <a href="user?id=willio58" class="hnuser">willio58</a>
                  <span class="age" title="2026-03-26T20:44:08 1774557848">
                    <a href="item?id=47535469">27 minutes ago</a>
                  </span>
                </span>
                <div class="comment"><div class="commtext c00">Child</div></div>
              </td>
            </tr>
          </table>
        </body>
      </html>
      `,
      "https://news.ycombinator.com/item?id=47534848",
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.story.title).toBe("Example story");
    expect(parsed?.story.url).toBe("https://example.com/post");
    expect(parsed?.story.by).toBe("mmcclure");
    expect(parsed?.story.time).toBe(1774554485);
    expect(parsed?.story.score).toBe(257);
    expect(parsed?.story.descendants).toBe(152);
    expect(parsed?.story.text).toContain("Story");
    expect(parsed?.comments).toHaveLength(1);
    expect(parsed?.comments[0]?.item.by).toBe("jackfruitpeel");
    expect(parsed?.comments[0]?.children).toHaveLength(1);
    expect(parsed?.comments[0]?.children[0]?.item.by).toBe("willio58");
  });

  test("builds hn document with metadata and markdown body", () => {
    const document = buildHnDocument(
      {
        id: 123,
        type: "story",
        by: "pg",
        time: 1175714200,
        title: "Ask HN: Example",
        text: "What are you working on?",
        score: 111,
        descendants: 0,
      },
      [],
      "https://news.ycombinator.com/item?id=123",
    );

    const markdown = renderMarkdown(document);
    expect(document.adapter).toBe("hn");
    expect(document.siteName).toBe("Hacker News");
    expect(document.publishedAt).toBe("2007-04-04T19:16:40.000Z");
    expect(markdown).toContain('adapter: "hn"');
    expect(markdown).toContain('siteName: "Hacker News"');
    expect(markdown).toContain("# Ask HN: Example");
    expect(markdown).toContain("## Post");
    expect(markdown).toContain("What are you working on?");
    expect(markdown).toContain("## Comments");
    expect(markdown).toContain("No comments.");
  });
});
