import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const artifactRoot = path.resolve(rootDir, process.argv[2] || "artifacts");
const outRoot = path.resolve(rootDir, process.env.RELEASE_SITE_DIR || "release-site");
// Assets are published to a dedicated public release repo (code lives in a
// private repo, so anonymous updater downloads must point elsewhere). Override
// with CODATA_RELEASE_REPOSITORY.
const repository =
  process.env.CODATA_RELEASE_REPOSITORY || "Mlilion/Codata-releases";
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
const releasePath = `downloads/releases/${tag}`;
const releaseAssetBaseUrl = (() => {
  if (process.env.CODATA_RELEASE_ASSET_BASE_URL) {
    return process.env.CODATA_RELEASE_ASSET_BASE_URL.replace(/\/$/, "");
  }

  if (process.env.CODATA_SITE_BASE_URL) {
    return `${process.env.CODATA_SITE_BASE_URL.replace(/\/$/, "")}/${releasePath}`;
  }

  return `https://github.com/${repository}/releases/download/${tag}`;
})();
const releaseOutDir = path.join(outRoot, releasePath);
const updateOutDir = path.join(outRoot, "update");
const downloadsOutDir = path.join(outRoot, "downloads");

fs.rmSync(outRoot, { recursive: true, force: true });
fs.mkdirSync(releaseOutDir, { recursive: true });
fs.mkdirSync(updateOutDir, { recursive: true });
fs.mkdirSync(downloadsOutDir, { recursive: true });

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

function fileSize(filePath) {
  return fs.statSync(filePath).size;
}

function readSignature(filePath) {
  const sigPath = `${filePath}.sig`;
  if (!fs.existsSync(sigPath)) {
    throw new Error(`Missing updater signature for ${path.basename(filePath)}: ${sigPath}`);
  }
  return fs.readFileSync(sigPath, "utf8").trim();
}

function copyFlat(filePath) {
  const dest = path.join(releaseOutDir, path.basename(filePath));
  if (fs.existsSync(dest)) {
    throw new Error(`Duplicate release asset filename: ${path.basename(filePath)}`);
  }
  fs.copyFileSync(filePath, dest);
}

const allFiles = walk(artifactRoot).sort();
for (const file of allFiles) {
  copyFlat(file);
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

const windowsInstaller = requireFile(
  "Windows NSIS installer",
  inArtifact("windows-bundle", (name) => name.endsWith(".exe")),
);
const macAppleSiliconUpdate = requireFile(
  "macOS Apple Silicon updater archive",
  inArtifact("macos-aarch64-bundle", (name) => name.endsWith(".app.tar.gz")),
);
const macIntelUpdate = requireFile(
  "macOS Intel updater archive",
  inArtifact("macos-x64-bundle", (name) => name.endsWith(".app.tar.gz")),
);
const macAppleSiliconDmg = requireFile(
  "macOS Apple Silicon DMG",
  inArtifact("macos-aarch64-bundle", (name) => name.endsWith(".dmg")),
);
const macIntelDmg = requireFile(
  "macOS Intel DMG",
  inArtifact("macos-x64-bundle", (name) => name.endsWith(".dmg")),
);

const notes = process.env.RELEASE_NOTES || `Codata ${version}`;
const pubDate = new Date().toISOString();

const updateManifest = {
  version,
  notes,
  pub_date: pubDate,
  platforms: {
    "windows-x86_64": {
      signature: readSignature(windowsInstaller),
      url: publicUrl(windowsInstaller),
    },
    "darwin-aarch64": {
      signature: readSignature(macAppleSiliconUpdate),
      url: publicUrl(macAppleSiliconUpdate),
    },
    "darwin-x86_64": {
      signature: readSignature(macIntelUpdate),
      url: publicUrl(macIntelUpdate),
    },
  },
};

function downloadEntry(filePath, label, platform, arch, kind) {
  return {
    label,
    platform,
    arch,
    kind,
    filename: path.basename(filePath),
    url: publicUrl(filePath),
    size: fileSize(filePath),
    sha256: sha256(filePath),
  };
}

const downloadManifest = {
  version,
  notes,
  pub_date: pubDate,
  source: `https://github.com/${repository}/releases/tag/${tag}`,
  downloads: {
    "macos-aarch64": downloadEntry(macAppleSiliconDmg, "macOS Apple Silicon", "macos", "aarch64", "dmg"),
    "macos-x86_64": downloadEntry(macIntelDmg, "macOS Intel", "macos", "x86_64", "dmg"),
    "windows-x86_64": downloadEntry(windowsInstaller, "Windows", "windows", "x86_64", "nsis"),
  },
};

fs.writeFileSync(path.join(updateOutDir, "latest.json"), `${JSON.stringify(updateManifest, null, 2)}\n`);
fs.writeFileSync(path.join(downloadsOutDir, "latest.json"), `${JSON.stringify(downloadManifest, null, 2)}\n`);
fs.writeFileSync(path.join(outRoot, "latest.json"), `${JSON.stringify(updateManifest, null, 2)}\n`);
fs.writeFileSync(path.join(outRoot, "downloads-latest.json"), `${JSON.stringify(downloadManifest, null, 2)}\n`);

console.log(`Generated release manifests for Codata ${version}`);
console.log(`Release payload: ${outRoot}`);
