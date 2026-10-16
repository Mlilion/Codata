import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const artifactRoot = path.resolve(rootDir, process.argv[2] || "artifacts");
const outRoot = path.resolve(rootDir, process.env.RELEASE_SITE_DIR || "release-site");
const repository =
  process.env.CODATA_RELEASE_REPOSITORY || process.env.GITHUB_REPOSITORY || "Mlilion/Codata";
const tag = process.env.GITHUB_REF_NAME || process.env.RELEASE_TAG;
const releaseCacheKey = process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_RUN_ID}.${process.env.GITHUB_RUN_ATTEMPT || "1"}`
  : tag;

if (!tag) {
  throw new Error("GITHUB_REF_NAME or RELEASE_TAG is required");
}

if (!fs.existsSync(artifactRoot)) {
  throw new Error(`Artifact directory does not exist: ${artifactRoot}`);
}

const version = tag.replace(/^v/, "");
const releaseAssetBaseUrl = process.env.CODATA_RELEASE_ASSET_BASE_URL
  ? process.env.CODATA_RELEASE_ASSET_BASE_URL.replace(/\/$/, "")
  : `https://github.com/${repository}/releases/download/${tag}`;

fs.rmSync(outRoot, { recursive: true, force: true });
fs.mkdirSync(outRoot, { recursive: true });

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function publicUrl(filePath) {
  return `${releaseAssetBaseUrl}/${encodeURIComponent(path.basename(filePath))}?r=${encodeURIComponent(releaseCacheKey)}`;
}

function inArtifact(name, predicate) {
  return allFiles.find((file) => {
    const rel = path.relative(artifactRoot, file).split(path.sep);
    return rel[0] === name && predicate(path.basename(file), file);
  });
}

function requireFile(label, filePath) {
  if (!filePath) {
    throw new Error(`Missing required release artifact: ${label}`);
  }
  return filePath;
}

function parseReleasePlatforms(value) {
  const requested = (value || "windows,macos-aarch64,macos-x86_64")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const platforms = new Set();

  for (const item of requested) {
    if (item === "all") {
      platforms.add("windows-x86_64");
      platforms.add("macos-aarch64");
      platforms.add("macos-x86_64");
    } else if (item === "windows" || item === "windows-x86_64") {
      platforms.add("windows-x86_64");
    } else if (item === "macos") {
      platforms.add("macos-aarch64");
      platforms.add("macos-x86_64");
    } else if (item === "macos-aarch64" || item === "macos-x86_64") {
      platforms.add(item);
    } else {
      throw new Error(`Unknown release platform: ${item}`);
    }
  }

  if (platforms.size === 0) {
    throw new Error("At least one release platform must be enabled");
  }

  return platforms;
}

const allFiles = walk(artifactRoot).sort();
const enabledPlatforms = parseReleasePlatforms(process.env.CODATA_RELEASE_PLATFORMS);
const downloadArtifacts = [];

if (enabledPlatforms.has("windows-x86_64")) {
  downloadArtifacts.push({
    file: requireFile(
      "Windows NSIS installer",
      inArtifact("windows-bundle", (name) => name.endsWith(".exe")),
    ),
    label: "Windows",
    platform: "windows",
    arch: "x86_64",
    kind: "nsis",
    key: "windows-x86_64",
  });
}

for (const [platform, arch, directory] of [
  ["macos", "aarch64", "macos-aarch64-bundle"],
  ["macos", "x86_64", "macos-x64-bundle"],
]) {
  const key = `macos-${arch}`;
  if (!enabledPlatforms.has(key)) continue;
  downloadArtifacts.push({
    file: requireFile(
      `macOS ${arch} DMG`,
      inArtifact(directory, (name) => name.endsWith(".dmg")),
    ),
    label: arch === "aarch64" ? "macOS Apple Silicon" : "macOS Intel",
    platform,
    arch,
    kind: "dmg",
    key,
  });
}

const notes = process.env.RELEASE_NOTES || `Codata ${version}`;
const downloads = Object.fromEntries(
  downloadArtifacts.map(({ file, label, platform, arch, kind, key }) => [
    key,
    {
      label,
      platform,
      arch,
      kind,
      filename: path.basename(file),
      url: publicUrl(file),
      size: fs.statSync(file).size,
      sha256: sha256(file),
    },
  ]),
);
const downloadManifest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  source: `https://github.com/${repository}/releases/tag/${tag}`,
  downloads,
};

fs.writeFileSync(path.join(outRoot, "downloads-latest.json"), `${JSON.stringify(downloadManifest, null, 2)}\n`);
console.log(`Generated release download manifest for Codata ${version}`);
console.log(`Release payload: ${outRoot}`);
