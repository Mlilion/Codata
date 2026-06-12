import fs from "node:fs";
import path from "node:path";

import {
  MERMAID_VERSION,
  extractMermaidBlocks,
  hashMermaidCode,
  replaceMermaidBlocks,
  type MermaidBlock,
} from "./mermaid-utils.js";

export interface MermaidRenderOptions {
  theme?: string;
  scale?: number;
  background?: string;
  minWidth?: number;
}

export type MermaidRenderFn = (
  code: string,
  outputPath: string,
  options: MermaidRenderOptions,
) => Promise<void>;

export interface MermaidPreprocessOptions extends MermaidRenderOptions {
  baseDir: string;
  imgSubdir?: string;
  renderFn?: MermaidRenderFn;
  enabled?: boolean;
  alt?: string;
  onError?: (error: unknown, block: MermaidBlock) => void;
}

export interface MermaidPreprocessedImage {
  raw: string;
  code: string;
  hash: string;
  localPath: string;
  mdRef: string;
  cached: boolean;
}

export interface MermaidPreprocessResult {
  markdown: string;
  images: MermaidPreprocessedImage[];
}

export async function preprocessMermaidInMarkdown(
  markdown: string,
  options: MermaidPreprocessOptions,
): Promise<MermaidPreprocessResult> {
  const {
    baseDir,
    imgSubdir = "imgs/.mermaid-cache",
    renderFn,
    enabled = true,
    theme,
    scale,
    background,
    minWidth,
    alt = "Mermaid diagram",
    onError,
  } = options;

  if (!enabled || !renderFn) {
    return { markdown, images: [] };
  }

  const blocks = extractMermaidBlocks(markdown);
  if (blocks.length === 0) {
    return { markdown, images: [] };
  }

  const cacheDir = path.resolve(baseDir, imgSubdir);
  fs.mkdirSync(cacheDir, { recursive: true });

  const replacements = new Map<string, string>();
  const images: MermaidPreprocessedImage[] = [];
  const renderedHashes = new Set<string>();

  for (const block of blocks) {
    const hash = hashMermaidCode({
      code: block.code,
      theme,
      scale,
      background,
      minWidth,
      version: MERMAID_VERSION,
    });
    const filename = `mermaid-${hash}.png`;
    const localPath = path.join(cacheDir, filename);
    const mdRef = `![${alt}](${path.posix.join(imgSubdir, filename)})`;

    const cached = fs.existsSync(localPath);

    if (!cached && !renderedHashes.has(hash)) {
      try {
        await renderFn(block.code, localPath, { theme, scale, background, minWidth });
        renderedHashes.add(hash);
      } catch (error) {
        if (onError) {
          onError(error, block);
        } else {
          console.error(
            `[mermaid] render failed for block (hash ${hash}): ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
        continue;
      }
    }

    if (!fs.existsSync(localPath)) {
      continue;
    }

    replacements.set(block.raw, mdRef);
    images.push({
      raw: block.raw,
      code: block.code,
      hash,
      localPath,
      mdRef,
      cached,
    });
  }

  const newMarkdown = replaceMermaidBlocks(markdown, replacements);
  return { markdown: newMarkdown, images };
}
