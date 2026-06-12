import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";

export interface ImagePlaceholder {
  originalPath: string;
  placeholder: string;
  alt?: string;
}

export interface ResolvedImageInfo extends ImagePlaceholder {
  localPath: string;
}

export function replaceMarkdownImagesWithPlaceholders(
  markdown: string,
  placeholderPrefix: string,
): {
  images: ImagePlaceholder[];
  markdown: string;
} {
  const images: ImagePlaceholder[] = [];
  let imageCounter = 0;
  let lastIndex = 0;
  let rewritten = "";

  const imagePattern = /!\[([^\]]*)\]\(([^)]+)\)|!\[\[([^\]\n]+)\]\]/g;
  for (const match of markdown.matchAll(imagePattern)) {
    const fullMatch = match[0];
    const matchIndex = match.index ?? 0;
    const markdownAlt = match[1];
    const markdownSrc = match[2];
    const wikilinkTarget = match[3];
    const wikilinkImage = wikilinkTarget
      ? parseObsidianImageWikilink(wikilinkTarget)
      : null;

    if (wikilinkTarget && !wikilinkImage) {
      continue;
    }

    const originalPath = wikilinkImage?.originalPath ?? markdownSrc ?? "";
    const alt = wikilinkImage?.alt ?? markdownAlt ?? "";
    const placeholder = `${placeholderPrefix}${++imageCounter}`;

    rewritten += markdown.slice(lastIndex, matchIndex);
    images.push({
      alt,
      originalPath,
      placeholder,
    });
    rewritten += placeholder;
    lastIndex = matchIndex + fullMatch.length;
  }

  rewritten += markdown.slice(lastIndex);

  return { images, markdown: rewritten };
}

export function getImageExtension(urlOrPath: string): string {
  const match = urlOrPath.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i);
  return match ? match[1]!.toLowerCase() : "png";
}

export async function downloadFile(url: string, destPath: string): Promise<void> {
  return await new Promise((resolve, reject) => {
    const protocol = url.startsWith("https://") ? https : http;
    const file = fs.createWriteStream(destPath);

    const request = protocol.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          file.close();
          fs.unlinkSync(destPath);
          void downloadFile(redirectUrl, destPath).then(resolve).catch(reject);
          return;
        }
      }

      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(destPath);
        reject(new Error(`Failed to download: ${response.statusCode}`));
        return;
      }

      response.pipe(file);
      file.on("finish", () => {
        file.close();
        resolve();
      });
    });

    request.on("error", (error) => {
      file.close();
      fs.unlink(destPath, () => {});
      reject(error);
    });

    request.setTimeout(30_000, () => {
      request.destroy();
      reject(new Error("Download timeout"));
    });
  });
}

export async function resolveImagePath(
  imagePath: string,
  baseDir: string,
  tempDir: string,
  logLabel = "baoyu-md",
): Promise<string> {
  if (imagePath.startsWith("http://") || imagePath.startsWith("https://")) {
    const hash = createHash("md5").update(imagePath).digest("hex").slice(0, 8);
    const ext = getImageExtension(imagePath);
    const localPath = path.join(tempDir, `remote_${hash}.${ext}`);

    if (!fs.existsSync(localPath)) {
      console.error(`[${logLabel}] Downloading: ${imagePath}`);
      await downloadFile(imagePath, localPath);
    }
    return localPath;
  }

  return resolveLocalImagePath(imagePath, baseDir, logLabel);
}

export async function resolveContentImages(
  images: ImagePlaceholder[],
  baseDir: string,
  tempDir: string,
  logLabel = "baoyu-md",
): Promise<ResolvedImageInfo[]> {
  const resolved: ResolvedImageInfo[] = [];

  for (const image of images) {
    resolved.push({
      ...image,
      localPath: await resolveImagePath(image.originalPath, baseDir, tempDir, logLabel),
    });
  }

  return resolved;
}

function parseObsidianImageWikilink(target: string): {
  originalPath: string;
  alt: string;
} | null {
  const separatorIndex = target.indexOf("|");
  const originalPath = (separatorIndex === -1
    ? target
    : target.slice(0, separatorIndex)).trim();
  const alt = separatorIndex === -1 ? "" : target.slice(separatorIndex + 1).trim();

  if (!hasExplicitImageExtension(originalPath)) {
    return null;
  }

  return { originalPath, alt };
}

function hasExplicitImageExtension(value: string): boolean {
  return /\.(?:jpe?g|png|gif|webp)(?:[?#].*)?$/i.test(value);
}

function resolveLocalImagePath(imagePath: string, baseDir: string, logLabel: string): string {
  const decoded = safeDecodeImagePath(imagePath);
  const decodedResolved = resolveAgainstBaseDir(decoded, baseDir);
  const decodedWithFallback = resolveLocalWithFallback(
    decodedResolved,
    logLabel,
    buildAttachmentFallbackPath(decoded, baseDir),
  );

  if (decoded === imagePath || fs.existsSync(decodedWithFallback)) {
    return decodedWithFallback;
  }

  return resolveLocalWithFallback(
    resolveAgainstBaseDir(imagePath, baseDir),
    logLabel,
    buildAttachmentFallbackPath(imagePath, baseDir),
  );
}

function resolveLocalWithFallback(
  resolved: string,
  logLabel: string,
  attachmentResolved?: string,
): string {
  if (fs.existsSync(resolved)) {
    return resolved;
  }

  if (attachmentResolved && fs.existsSync(attachmentResolved)) {
    logImageFallback(resolved, attachmentResolved, logLabel);
    return attachmentResolved;
  }

  const originalAlternative = findExtensionFallback(resolved);
  if (originalAlternative) {
    logImageFallback(resolved, originalAlternative, logLabel);
    return originalAlternative;
  }

  if (attachmentResolved) {
    const attachmentAlternative = findExtensionFallback(attachmentResolved);
    if (attachmentAlternative) {
      logImageFallback(resolved, attachmentAlternative, logLabel);
      return attachmentAlternative;
    }
  }

  return resolved;
}

function findExtensionFallback(resolved: string): string | null {
  const ext = path.extname(resolved);
  const base = ext ? resolved.slice(0, -ext.length) : resolved;
  const alternatives = [
    `${base}.webp`,
    `${base}.jpg`,
    `${base}.jpeg`,
    `${base}.png`,
    `${base}.gif`,
    `${base}_original.png`,
    `${base}_original.jpg`,
  ].filter((candidate) => candidate !== resolved);

  for (const alternative of alternatives) {
    if (!fs.existsSync(alternative)) continue;
    return alternative;
  }

  return null;
}

function logImageFallback(fromPath: string, toPath: string, logLabel: string): void {
  console.error(
    `[${logLabel}] Image fallback: ${path.basename(fromPath)} -> ${path.basename(toPath)}`,
  );
}

function safeDecodeImagePath(imagePath: string): string {
  try {
    return decodeURIComponent(imagePath);
  } catch {
    return imagePath;
  }
}

function resolveAgainstBaseDir(imagePath: string, baseDir: string): string {
  return path.isAbsolute(imagePath) ? imagePath : path.resolve(baseDir, imagePath);
}

function buildAttachmentFallbackPath(imagePath: string, baseDir: string): string | undefined {
  if (path.isAbsolute(imagePath)) {
    return undefined;
  }
  return path.resolve(baseDir, "Attachments", imagePath);
}
