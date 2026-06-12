import fs from "node:fs/promises";
import path from "node:path";

const PACKAGE_DEPENDENCY_SECTIONS = [
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
  "devDependencies",
];

const SKIPPED_DIRS = new Set([".git", ".clawhub", ".clawdhub", "node_modules", "out", "dist", "build"]);
const SKIPPED_FILES = new Set([".DS_Store", "bun.lockb"]);
const MIME_MAP = {
  ".md": "text/markdown",
  ".ts": "text/plain",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".yml": "text/yaml",
  ".yaml": "text/yaml",
  ".txt": "text/plain",
  ".html": "text/html",
  ".css": "text/css",
  ".xml": "text/xml",
  ".svg": "image/svg+xml",
};

export async function readSkillMetadataVersion(root) {
  const skillFile = await findSkillMarkdown(root);
  const source = await fs.readFile(skillFile, "utf8");
  const version = readSkillFrontmatterVersion(source);
  if (!version) {
    throw new Error(`Missing version in ${path.relative(process.cwd(), skillFile) || skillFile}`);
  }
  return version;
}

export async function validateSkillMetadataVersion(root, expectedVersion) {
  const actualVersion = await readSkillMetadataVersion(root);
  if (actualVersion !== expectedVersion) {
    throw new Error(
      `SKILL.md version mismatch for ${path.basename(path.resolve(root))}: expected ${expectedVersion}, found ${actualVersion}`,
    );
  }
}

export function readSkillFrontmatterVersion(source) {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (!match) return null;

  for (const line of match[1].split(/\r?\n/)) {
    const versionMatch = /^version:\s*["']?([^"'\s#]+)["']?\s*(?:#.*)?$/.exec(line.trim());
    if (versionMatch) return versionMatch[1];
  }

  return null;
}

export async function listReleaseFiles(root) {
  const resolvedRoot = path.resolve(root);
  const files = [];

  async function walk(folder) {
    const entries = await fs.readdir(folder, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && SKIPPED_DIRS.has(entry.name)) continue;
      if (entry.isFile() && SKIPPED_FILES.has(entry.name)) continue;

      const fullPath = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;

      const relPath = path.relative(resolvedRoot, fullPath).split(path.sep).join("/");
      const bytes = await fs.readFile(fullPath);
      files.push({ relPath, bytes });
    }
  }

  await walk(resolvedRoot);
  files.sort((left, right) => left.relPath.localeCompare(right.relPath));
  return files;
}

async function findSkillMarkdown(root) {
  const resolvedRoot = path.resolve(root);
  for (const name of ["SKILL.md", "skill.md"]) {
    const candidate = path.join(resolvedRoot, name);
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) return candidate;
    } catch {
      // Try the next supported skill filename.
    }
  }
  throw new Error(`Missing SKILL.md in ${resolvedRoot}`);
}

export async function validateSelfContainedRelease(root) {
  const resolvedRoot = path.resolve(root);
  const files = await listReleaseFiles(root);
  for (const file of files.filter((entry) => path.posix.basename(entry.relPath) === "package.json")) {
    const packageDir = path.resolve(resolvedRoot, fromPosixRel(path.posix.dirname(file.relPath)));
    const packageJson = JSON.parse(file.bytes.toString("utf8"));
    for (const section of PACKAGE_DEPENDENCY_SECTIONS) {
      const dependencies = packageJson[section];
      if (!dependencies || typeof dependencies !== "object") continue;

      for (const [name, spec] of Object.entries(dependencies)) {
        if (typeof spec !== "string" || !spec.startsWith("file:")) continue;
        const targetDir = path.resolve(packageDir, spec.slice(5));
        if (!isWithinRoot(resolvedRoot, targetDir)) {
          throw new Error(
            `Release target is not self-contained: ${file.relPath} depends on ${name} via ${spec}`,
          );
        }
        await fs.access(targetDir).catch(() => {
          throw new Error(`Missing local dependency for release: ${file.relPath} -> ${spec}`);
        });
      }
    }

    for (const target of getPackageBinTargets(packageJson)) {
      const targetPath = path.resolve(packageDir, target);
      if (!isWithinRoot(resolvedRoot, targetPath)) {
        throw new Error(`Release target is not self-contained: ${file.relPath} bin points to ${target}`);
      }
      await fs.access(targetPath).catch(() => {
        throw new Error(`Missing package bin target for release: ${file.relPath} -> ${target}`);
      });
    }
  }
}

export function mimeType(relPath) {
  const ext = path.extname(relPath).toLowerCase();
  return MIME_MAP[ext] || "text/plain";
}

function getPackageBinTargets(packageJson) {
  const bin = packageJson.bin;
  if (typeof bin === "string" && bin.trim()) {
    return [bin.trim()];
  }
  if (!bin || typeof bin !== "object" || Array.isArray(bin)) {
    return [];
  }
  return Object.values(bin).filter((value) => typeof value === "string" && value.trim());
}

function fromPosixRel(relPath) {
  return relPath === "." ? "." : relPath.split("/").join(path.sep);
}

function isWithinRoot(root, target) {
  const resolvedRoot = path.resolve(root);
  const relative = path.relative(resolvedRoot, path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
