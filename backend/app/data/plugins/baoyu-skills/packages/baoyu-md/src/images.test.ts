import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  getImageExtension,
  replaceMarkdownImagesWithPlaceholders,
  resolveContentImages,
  resolveImagePath,
} from "./images.ts";

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

test("replaceMarkdownImagesWithPlaceholders rewrites markdown and tracks image metadata", () => {
  const result = replaceMarkdownImagesWithPlaceholders(
    `![cover](imgs/cover.png)\n\nText\n\n![diagram](imgs/diagram.webp)`,
    "IMG_",
  );

  assert.equal(result.markdown, `IMG_1\n\nText\n\nIMG_2`);
  assert.deepEqual(result.images, [
    { alt: "cover", originalPath: "imgs/cover.png", placeholder: "IMG_1" },
    { alt: "diagram", originalPath: "imgs/diagram.webp", placeholder: "IMG_2" },
  ]);
});

test("replaceMarkdownImagesWithPlaceholders supports Obsidian image wikilinks in document order", () => {
  const result = replaceMarkdownImagesWithPlaceholders(
    `Intro\n\n![[a.png]]\n\n![B](b.jpg)\n\n![[c.webp|C alt]]\n\n![[note]]`,
    "IMG_",
  );

  assert.equal(result.markdown, `Intro\n\nIMG_1\n\nIMG_2\n\nIMG_3\n\n![[note]]`);
  assert.deepEqual(result.images, [
    { alt: "", originalPath: "a.png", placeholder: "IMG_1" },
    { alt: "B", originalPath: "b.jpg", placeholder: "IMG_2" },
    { alt: "C alt", originalPath: "c.webp", placeholder: "IMG_3" },
  ]);
});

test("replaceMarkdownImagesWithPlaceholders supports Obsidian image wikilinks with paths", () => {
  const result = replaceMarkdownImagesWithPlaceholders(
    `![[Attachments/screenshot.png]]`,
    "IMG_",
  );

  assert.equal(result.markdown, `IMG_1`);
  assert.deepEqual(result.images, [
    { alt: "", originalPath: "Attachments/screenshot.png", placeholder: "IMG_1" },
  ]);
});

test("image extension and local fallback resolution handle common path variants", async (t) => {
  assert.equal(getImageExtension("https://example.com/a.jpeg?x=1"), "jpeg");
  assert.equal(getImageExtension("/tmp/figure"), "png");

  const root = await makeTempDir("baoyu-md-images-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const baseDir = path.join(root, "article");
  const tempDir = path.join(root, "tmp");
  await fs.mkdir(baseDir, { recursive: true });
  await fs.mkdir(tempDir, { recursive: true });
  await fs.writeFile(path.join(baseDir, "figure.webp"), "webp");

  const resolved = await resolveImagePath("figure.png", baseDir, tempDir, "test");
  assert.equal(resolved, path.join(baseDir, "figure.webp"));
});

test("resolveImagePath falls back to Attachments subdirectory before extension variants", async (t) => {
  const root = await makeTempDir("baoyu-md-attachments-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const baseDir = path.join(root, "article");
  const tempDir = path.join(root, "tmp");
  const attachmentsDir = path.join(baseDir, "Attachments");
  await fs.mkdir(attachmentsDir, { recursive: true });
  await fs.mkdir(tempDir, { recursive: true });
  await fs.writeFile(path.join(baseDir, "figure.webp"), "webp");
  await fs.writeFile(path.join(attachmentsDir, "figure.png"), "png");

  const resolved = await resolveImagePath("figure.png", baseDir, tempDir, "test");
  assert.equal(resolved, path.join(attachmentsDir, "figure.png"));
});

test("resolveImagePath prefers original path before Attachments fallback", async (t) => {
  const root = await makeTempDir("baoyu-md-attachments-original-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const baseDir = path.join(root, "article");
  const tempDir = path.join(root, "tmp");
  const attachmentsDir = path.join(baseDir, "Attachments");
  await fs.mkdir(attachmentsDir, { recursive: true });
  await fs.mkdir(tempDir, { recursive: true });
  await fs.writeFile(path.join(baseDir, "figure.png"), "png");
  await fs.writeFile(path.join(attachmentsDir, "figure.png"), "attachment png");

  const resolved = await resolveImagePath("figure.png", baseDir, tempDir, "test");
  assert.equal(resolved, path.join(baseDir, "figure.png"));
});

test("resolveImagePath decodes URL-encoded filenames with spaces", async (t) => {
  const root = await makeTempDir("baoyu-md-urlencoded-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const baseDir = path.join(root, "article");
  const tempDir = path.join(root, "tmp");
  await fs.mkdir(baseDir, { recursive: true });
  await fs.mkdir(tempDir, { recursive: true });
  await fs.writeFile(path.join(baseDir, "Pasted image 20260524.png"), "png");

  const resolved = await resolveImagePath("Pasted%20image%2020260524.png", baseDir, tempDir, "test");
  assert.equal(resolved, path.join(baseDir, "Pasted image 20260524.png"));
});

test("resolveImagePath keeps literal percent filenames usable", async (t) => {
  const root = await makeTempDir("baoyu-md-percent-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const baseDir = path.join(root, "article");
  const tempDir = path.join(root, "tmp");
  await fs.mkdir(baseDir, { recursive: true });
  await fs.mkdir(tempDir, { recursive: true });
  await fs.writeFile(path.join(baseDir, "100% complete.png"), "png");
  await fs.writeFile(path.join(baseDir, "diagram%23hash.png"), "png");

  const malformedPercent = await resolveImagePath("100% complete.png", baseDir, tempDir, "test");
  assert.equal(malformedPercent, path.join(baseDir, "100% complete.png"));

  const literalEncodedPercent = await resolveImagePath("diagram%23hash.png", baseDir, tempDir, "test");
  assert.equal(literalEncodedPercent, path.join(baseDir, "diagram%23hash.png"));
});

test("resolveContentImages resolves image placeholders against the content directory", async (t) => {
  const root = await makeTempDir("baoyu-md-content-images-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const baseDir = path.join(root, "article");
  const tempDir = path.join(root, "tmp");
  await fs.mkdir(baseDir, { recursive: true });
  await fs.mkdir(tempDir, { recursive: true });
  await fs.writeFile(path.join(baseDir, "cover.png"), "png");

  const resolved = await resolveContentImages(
    [
      {
        alt: "cover",
        originalPath: "cover.png",
        placeholder: "IMG_1",
      },
    ],
    baseDir,
    tempDir,
    "test",
  );

  assert.deepEqual(resolved, [
    {
      alt: "cover",
      originalPath: "cover.png",
      placeholder: "IMG_1",
      localPath: path.join(baseDir, "cover.png"),
    },
  ]);
});
