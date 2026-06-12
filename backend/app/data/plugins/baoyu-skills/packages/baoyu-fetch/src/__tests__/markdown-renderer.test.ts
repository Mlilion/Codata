import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "../extract/markdown-renderer";

describe("renderMarkdown", () => {
  test("renders frontmatter and content blocks", () => {
    const markdown = renderMarkdown({
      url: "https://example.com/post",
      requestedUrl: "https://example.com/post?ref=test",
      title: "Example Title",
      author: "Alice",
      siteName: "Example",
      publishedAt: "2026-03-25",
      adapter: "generic",
      metadata: {
        authorName: "Alice Example",
        authorUsername: "alice",
        authorUrl: "https://example.com/@alice",
        kind: "generic/article",
      },
      content: [
        { type: "paragraph", text: "First paragraph." },
        { type: "list", ordered: false, items: ["One", "Two"] },
      ],
    });

    expect(markdown).toContain("---");
    expect(markdown).toContain('title: "Example Title"');
    expect(markdown).toContain('url: "https://example.com/post"');
    expect(markdown).toContain('requestedUrl: "https://example.com/post?ref=test"');
    expect(markdown).toContain('author: "Alice"');
    expect(markdown).toContain('authorName: "Alice Example"');
    expect(markdown).toContain('authorUsername: "alice"');
    expect(markdown).toContain('authorUrl: "https://example.com/@alice"');
    expect(markdown).toContain("# Example Title");
    expect(markdown).toContain("First paragraph.");
    expect(markdown).toContain("- One");
  });

  test("avoids duplicating the title when body already starts with it", () => {
    const markdown = renderMarkdown({
      url: "https://example.com/post",
      title: "Example Title",
      content: [{ type: "markdown", markdown: "# Example Title\n\nBody text." }],
    });

    expect(markdown.match(/# Example Title/g)?.length).toBe(1);
    expect(markdown).toContain("Body text.");
  });

  test("normalizes Substack CDN image links in rendered markdown", () => {
    const resizedUrl =
      "https://substackcdn.com/image/fetch/$s_!wORh!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fb83f9d2f-711f-4edd-bc8a-303b8de422e5_1600x1300.png";
    const linkedUrl =
      "https://substackcdn.com/image/fetch/$s_!wORh!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fb83f9d2f-711f-4edd-bc8a-303b8de422e5_1600x1300.png";
    const canonicalUrl =
      "https://substack-post-media.s3.amazonaws.com/public/images/b83f9d2f-711f-4edd-bc8a-303b8de422e5_1600x1300.png";

    const markdown = renderMarkdown({
      url: "https://example.com/post",
      metadata: {
        coverImage: resizedUrl,
      },
      content: [
        {
          type: "markdown",
          markdown: `[

![](${resizedUrl})

](${linkedUrl})`,
        },
      ],
    });

    expect(markdown).toContain(`coverImage: "${canonicalUrl}"`);
    expect(markdown).toContain(`![](${canonicalUrl})`);
    expect(markdown).not.toContain(`[![](${canonicalUrl})](${canonicalUrl})`);
    expect(markdown).not.toContain("substackcdn.com/image/fetch");
  });

  test("renders linked images on a single line when href differs from the image url", () => {
    const markdown = renderMarkdown({
      url: "https://example.com/post",
      content: [
        {
          type: "markdown",
          markdown: `[

![diagram](https://cdn.example.com/body.webp)

](https://example.com/source)`,
        },
      ],
    });

    expect(markdown).toContain("[![diagram](https://cdn.example.com/body.webp)](https://example.com/source)");
    expect(markdown).not.toContain("](https://example.com/source)\n");
  });
});
