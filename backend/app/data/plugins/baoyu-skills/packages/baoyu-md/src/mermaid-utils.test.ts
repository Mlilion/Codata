import assert from "node:assert/strict";
import test from "node:test";

import {
  MERMAID_VERSION,
  extractMermaidBlocks,
  hashMermaidCode,
  replaceMermaidBlocks,
} from "./mermaid-utils.ts";

test("extractMermaidBlocks finds fenced mermaid blocks at the top level", () => {
  const markdown = `Intro

\`\`\`mermaid
graph TD
  A --> B
\`\`\`

Outro`;

  const blocks = extractMermaidBlocks(markdown);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]!.code.trim(), "graph TD\n  A --> B");
  assert.equal(blocks[0]!.infoString, "");
  assert.ok(blocks[0]!.raw.includes("```mermaid"));
});

test("extractMermaidBlocks preserves info-string suffixes", () => {
  const markdown = "```mermaid theme=dark\nflowchart LR\n  A --> B\n```";
  const blocks = extractMermaidBlocks(markdown);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]!.infoString, "theme=dark");
});

test("extractMermaidBlocks finds blocks nested inside lists", () => {
  const markdown = `Steps:

1. First, render the diagram:

   \`\`\`mermaid
   sequenceDiagram
     Alice->>Bob: Hello
   \`\`\`

2. Then do something else.`;

  const blocks = extractMermaidBlocks(markdown);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]!.code.includes("sequenceDiagram"), true);
});

test("extractMermaidBlocks ignores non-mermaid fences and empty blocks", () => {
  const markdown = `\`\`\`ts
const x = 1;
\`\`\`

\`\`\`mermaid

\`\`\`

\`\`\`mermaidsomething
not a real lang
\`\`\``;

  const blocks = extractMermaidBlocks(markdown);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]!.infoString, "something");
  assert.equal(blocks[0]!.code.trim(), "not a real lang");
});

test("replaceMermaidBlocks performs exact string replacement", () => {
  const markdown = "before\n\n```mermaid\ngraph TD\nA-->B\n```\n\nafter";
  const blocks = extractMermaidBlocks(markdown);
  const map = new Map([[blocks[0]!.raw, "![diagram](img.png)"]]);
  const replaced = replaceMermaidBlocks(markdown, map);
  assert.equal(replaced, "before\n\n![diagram](img.png)\n\nafter");
});

test("replaceMermaidBlocks leaves markdown unchanged when no replacements match", () => {
  const markdown = "hello\n\nworld";
  const replaced = replaceMermaidBlocks(markdown, new Map([["nope", "x"]]));
  assert.equal(replaced, markdown);
});

test("hashMermaidCode is stable for the same inputs", () => {
  const a = hashMermaidCode({ code: "graph TD\nA-->B" });
  const b = hashMermaidCode({ code: "graph TD\nA-->B" });
  assert.equal(a, b);
  assert.equal(a.length, 12);
});

test("hashMermaidCode defaults to 2x render scale", () => {
  const implicit = hashMermaidCode({ code: "graph TD\nA-->B" });
  const explicit = hashMermaidCode({ code: "graph TD\nA-->B", scale: 2 });
  assert.equal(implicit, explicit);
});

test("hashMermaidCode ignores trailing whitespace", () => {
  const a = hashMermaidCode({ code: "graph TD\nA-->B" });
  const b = hashMermaidCode({ code: "graph TD\nA-->B   \n\n" });
  assert.equal(a, b);
});

test("hashMermaidCode reflects theme/scale/background/version changes", () => {
  const base = hashMermaidCode({ code: "graph TD\nA-->B" });
  assert.notEqual(base, hashMermaidCode({ code: "graph TD\nA-->B", theme: "dark" }));
  assert.notEqual(base, hashMermaidCode({ code: "graph TD\nA-->B", scale: 3 }));
  assert.notEqual(base, hashMermaidCode({ code: "graph TD\nA-->B", minWidth: 860 }));
  assert.notEqual(base, hashMermaidCode({ code: "graph TD\nA-->B", background: "#000" }));
  assert.notEqual(base, hashMermaidCode({ code: "graph TD\nA-->B", version: "x.y.z" }));
});

test("MERMAID_VERSION matches the vendored bundle (10.x)", () => {
  assert.match(MERMAID_VERSION, /^10\./);
});
