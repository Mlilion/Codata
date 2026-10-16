import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";

const scriptPath = path.resolve("scripts/generate-release-manifests.mjs");
const scratchRoot = path.resolve(`.test-release-manifests-${process.pid}-${randomUUID()}`);

function writeFile(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function createWindowsArtifacts(root) {
  writeFile(path.join(root, "windows-bundle/Codata_9.9.9_x64-setup.exe"), "win");
}

function runGenerator(artifacts, releaseSite, extraEnv = {}) {
  const env = { ...process.env };
  delete env.CODATA_RELEASE_REPOSITORY;
  delete env.CODATA_RELEASE_ASSET_BASE_URL;
  delete env.CODATA_SITE_BASE_URL;
  delete env.CODATA_RELEASE_PLATFORMS;
  return spawnSync(process.execPath, [scriptPath, artifacts], {
    env: {
      ...env,
      GITHUB_REPOSITORY: "Mlilion/Codata",
      GITHUB_REF_NAME: "v9.9.9",
      RELEASE_SITE_DIR: releaseSite,
      CODATA_RELEASE_PLATFORMS: "windows",
      ...extraEnv,
    },
    encoding: "utf8",
  });
}

after(() => {
  fs.rmSync(scratchRoot, { recursive: true, force: true });
});

test("generates Windows-only download metadata without updater signatures or manifests", () => {
  const artifacts = path.join(scratchRoot, "windows-artifacts");
  const releaseSite = path.join(scratchRoot, "release-site");
  createWindowsArtifacts(artifacts);

  const result = runGenerator(artifacts, releaseSite);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const manifestPath = path.join(releaseSite, "downloads-latest.json");
  const downloadManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.deepEqual(Object.keys(downloadManifest.downloads), ["windows-x86_64"]);
  assert.equal(downloadManifest.downloads["windows-x86_64"].kind, "nsis");
  assert.equal(downloadManifest.source, "https://github.com/Mlilion/Codata/releases/tag/v9.9.9");
  assert.match(
    downloadManifest.downloads["windows-x86_64"].url,
    /^https:\/\/github\.com\/Mlilion\/Codata\/releases\/download\/v9\.9\.9\//,
  );
  assert.deepEqual(fs.readdirSync(releaseSite), ["downloads-latest.json"]);
});

test("adds a run-specific cache key to same-repository release asset URLs", () => {
  const artifacts = path.join(scratchRoot, "cache-artifacts");
  const releaseSite = path.join(scratchRoot, "cache-release-site");
  createWindowsArtifacts(artifacts);

  const result = runGenerator(artifacts, releaseSite, {
    GITHUB_RUN_ID: "12345",
    GITHUB_RUN_ATTEMPT: "2",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const downloadManifest = JSON.parse(
    fs.readFileSync(path.join(releaseSite, "downloads-latest.json"), "utf8"),
  );
  assert.equal(
    new URL(downloadManifest.downloads["windows-x86_64"].url).searchParams.get("r"),
    "12345.2",
  );
});

test("fails clearly when the enabled platform artifact is missing", () => {
  const artifacts = path.join(scratchRoot, "missing-artifacts");
  fs.mkdirSync(artifacts, { recursive: true });
  const result = runGenerator(artifacts, path.join(scratchRoot, "missing-release-site"));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing required release artifact: Windows NSIS installer/);
});

test("generates Windows and both macOS downloads without updater signatures", () => {
  const artifacts = path.join(scratchRoot, "desktop-artifacts");
  const releaseSite = path.join(scratchRoot, "desktop-release-site");
  createWindowsArtifacts(artifacts);
  writeFile(path.join(artifacts, "macos-aarch64-bundle/Codata_9.9.9_arm64.dmg"), "arm");
  writeFile(path.join(artifacts, "macos-x64-bundle/Codata_9.9.9_x64.dmg"), "intel");
  const result = runGenerator(artifacts, releaseSite, { CODATA_RELEASE_PLATFORMS: "windows,macos" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const manifest = JSON.parse(fs.readFileSync(path.join(releaseSite, "downloads-latest.json"), "utf8"));
  assert.deepEqual(Object.keys(manifest.downloads), [
    "windows-x86_64", "macos-aarch64", "macos-x86_64",
  ]);
  for (const entry of Object.values(manifest.downloads)) {
    assert.match(entry.sha256, /^[a-f0-9]{64}$/);
  }
});
