import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  preprocessMermaidInMarkdown,
  type MermaidRenderFn,
} from "./mermaid-preprocess.ts";

function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mermaid-preprocess-test-"));
  return fn(dir).finally(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

const stubPngBytes = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const stubRender: MermaidRenderFn = async (_code, outPath) => {
  await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
  await fs.promises.writeFile(outPath, stubPngBytes);
};

test("preprocessMermaidInMarkdown skips when disabled", async () => {
  await withTempDir(async (baseDir) => {
    const markdown = "```mermaid\ngraph TD\nA-->B\n```";
    const result = await preprocessMermaidInMarkdown(markdown, {
      baseDir,
      renderFn: stubRender,
      enabled: false,
    });
    assert.equal(result.markdown, markdown);
    assert.equal(result.images.length, 0);
  });
});

test("preprocessMermaidInMarkdown skips when renderFn is missing", async () => {
  await withTempDir(async (baseDir) => {
    const markdown = "```mermaid\ngraph TD\nA-->B\n```";
    const result = await preprocessMermaidInMarkdown(markdown, { baseDir });
    assert.equal(result.markdown, markdown);
    assert.equal(result.images.length, 0);
  });
});

test("preprocessMermaidInMarkdown deduplicates identical blocks via hashed cache", async () => {
  await withTempDir(async (baseDir) => {
    const block = "```mermaid\ngraph TD\nA-->B\n```";
    const markdown = `${block}\n\nsome text\n\n${block}\n\nother text\n\n\`\`\`mermaid\nflowchart LR\nX-->Y\n\`\`\``;

    let renderCalls = 0;
    const renderFn: MermaidRenderFn = async (code, outPath) => {
      renderCalls += 1;
      await stubRender(code, outPath, {});
    };

    const result = await preprocessMermaidInMarkdown(markdown, {
      baseDir,
      renderFn,
    });

    assert.equal(renderCalls, 2, "should render two distinct blocks");
    assert.equal(result.images.length, 3, "all three blocks produce image entries");
    const uniqueHashes = new Set(result.images.map((image) => image.hash));
    assert.equal(uniqueHashes.size, 2);

    const matches = result.markdown.match(/!\[Mermaid diagram\]/g) ?? [];
    assert.equal(matches.length, 3);
    assert.ok(!result.markdown.includes("```mermaid"));
  });
});

test("preprocessMermaidInMarkdown reuses cached files (cached=true when file exists)", async () => {
  await withTempDir(async (baseDir) => {
    const markdown = "```mermaid\ngraph TD\nA-->B\n```";

    let renderCalls = 0;
    const renderFn: MermaidRenderFn = async (code, outPath) => {
      renderCalls += 1;
      await stubRender(code, outPath, {});
    };

    const first = await preprocessMermaidInMarkdown(markdown, { baseDir, renderFn });
    assert.equal(renderCalls, 1);
    assert.equal(first.images[0]!.cached, false);

    const second = await preprocessMermaidInMarkdown(markdown, { baseDir, renderFn });
    assert.equal(renderCalls, 1, "second pass hits cache");
    assert.equal(second.images[0]!.cached, true);
  });
});

test("preprocessMermaidInMarkdown survives renderFn errors and keeps raw block", async () => {
  await withTempDir(async (baseDir) => {
    const markdown = "```mermaid\ninvalid syntax!!\n```\n\nrest";
    const errors: string[] = [];
    const failingRender: MermaidRenderFn = async () => {
      throw new Error("render boom");
    };

    const result = await preprocessMermaidInMarkdown(markdown, {
      baseDir,
      renderFn: failingRender,
      onError: (error) => {
        errors.push(error instanceof Error ? error.message : String(error));
      },
    });

    assert.equal(errors.length, 1);
    assert.equal(errors[0], "render boom");
    assert.equal(result.images.length, 0);
    assert.ok(result.markdown.includes("```mermaid"));
    assert.ok(result.markdown.includes("rest"));
  });
});

test("preprocessMermaidInMarkdown writes PNGs under imgs/.mermaid-cache/", async () => {
  await withTempDir(async (baseDir) => {
    const markdown = "```mermaid\ngraph TD\nA-->B\n```";
    const result = await preprocessMermaidInMarkdown(markdown, {
      baseDir,
      renderFn: stubRender,
    });
    assert.equal(result.images.length, 1);
    const image = result.images[0]!;
    assert.ok(image.localPath.includes(path.join("imgs", ".mermaid-cache")));
    assert.ok(image.mdRef.includes("imgs/.mermaid-cache/"));
    assert.ok(fs.existsSync(image.localPath));
  });
});
