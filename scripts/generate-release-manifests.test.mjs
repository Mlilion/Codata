import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const scriptPath = path.resolve("scripts/generate-release-manifests.mjs");

function writeFile(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function createArtifacts(root) {
  writeFile(path.join(root, "windows-bundle/Codata_9.9.9_x64-setup.exe"), "win");
  writeFile(path.join(root, "windows-bundle/Codata_9.9.9_x64-setup.exe.sig"), "winsig");
  writeFile(path.join(root, "macos-aarch64-bundle/Codata_9.9.9_aarch64.app.tar.gz"), "arm");
  writeFile(path.join(root, "macos-aarch64-bundle/Codata_9.9.9_aarch64.app.tar.gz.sig"), "armsig");
  writeFile(path.join(root, "macos-aarch64-bundle/Codata_9.9.9_aarch64.dmg"), "armdmg");
  writeFile(path.join(root, "macos-x64-bundle/Codata_9.9.9_x64.app.tar.gz"), "x64");
  writeFile(path.join(root, "macos-x64-bundle/Codata_9.9.9_x64.app.tar.gz.sig"), "x64sig");
  writeFile(path.join(root, "macos-x64-bundle/Codata_9.9.9_x64.dmg"), "x64dmg");
}

function createWindowsArtifacts(root) {
  writeFile(path.join(root, "windows-bundle/Codata_9.9.9_x64-setup.exe"), "win");
  writeFile(path.join(root, "windows-bundle/Codata_9.9.9_x64-setup.exe.sig"), "winsig");
}

test("generates Windows-only manifests when only Windows releases are enabled", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codata-release-manifest-"));
  const artifacts = path.join(tmp, "artifacts");
  const releaseSite = path.join(tmp, "release-site");
  createWindowsArtifacts(artifacts);

  const result = spawnSync(process.execPath, [scriptPath, artifacts], {
    env: {
      ...process.env,
      GITHUB_REF_NAME: "v9.9.9",
      RELEASE_SITE_DIR: releaseSite,
      CODATA_RELEASE_PLATFORMS: "windows",
    },
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const downloadManifest = JSON.parse(fs.readFileSync(path.join(releaseSite, "downloads/latest.json"), "utf8"));
  const updateManifest = JSON.parse(fs.readFileSync(path.join(releaseSite, "update/latest.json"), "utf8"));

  assert.deepEqual(Object.keys(updateManifest.platforms), ["windows-x86_64"]);
  assert.deepEqual(Object.keys(downloadManifest.downloads), ["windows-x86_64"]);
  assert.equal(downloadManifest.downloads["windows-x86_64"].kind, "nsis");
});

test("adds a run-specific query string to public release asset URLs", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codata-release-manifest-"));
  const artifacts = path.join(tmp, "artifacts");
  const releaseSite = path.join(tmp, "release-site");
  createArtifacts(artifacts);

  const result = spawnSync(process.execPath, [scriptPath, artifacts], {
    env: {
      ...process.env,
      GITHUB_REF_NAME: "v9.9.9",
      RELEASE_SITE_DIR: releaseSite,
      CODATA_SITE_BASE_URL: "https://codata.test",
    },
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);

  const downloadManifest = JSON.parse(fs.readFileSync(path.join(releaseSite, "downloads/latest.json"), "utf8"));
  const updateManifest = JSON.parse(fs.readFileSync(path.join(releaseSite, "update/latest.json"), "utf8"));
  const urls = [
    ...Object.values(downloadManifest.downloads).map((item) => item.url),
    ...Object.values(updateManifest.platforms).map((item) => item.url),
  ];

  assert(urls.length > 0);
  assert(urls.every((url) => new URL(url).searchParams.get("r")));
});

test("defaults release asset URLs to GitHub Releases", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codata-release-manifest-"));
  const artifacts = path.join(tmp, "artifacts");
  const releaseSite = path.join(tmp, "release-site");
  createArtifacts(artifacts);

  const env = { ...process.env };
  delete env.CODATA_SITE_BASE_URL;
  delete env.CODATA_RELEASE_ASSET_BASE_URL;

  const result = spawnSync(process.execPath, [scriptPath, artifacts], {
    env: {
      ...env,
      // Code repo is private; assets are published to the public release repo.
      GITHUB_REPOSITORY: "FlowGPT/Codata",
      GITHUB_REF_NAME: "v9.9.9",
      RELEASE_SITE_DIR: releaseSite,
    },
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);

  const downloadManifest = JSON.parse(fs.readFileSync(path.join(releaseSite, "downloads/latest.json"), "utf8"));
  const updateManifest = JSON.parse(fs.readFileSync(path.join(releaseSite, "update/latest.json"), "utf8"));
  const githubUpdaterManifest = JSON.parse(fs.readFileSync(path.join(releaseSite, "latest.json"), "utf8"));
  const githubDownloadManifest = JSON.parse(fs.readFileSync(path.join(releaseSite, "downloads-latest.json"), "utf8"));
  const urls = [
    ...Object.values(downloadManifest.downloads).map((item) => item.url),
    ...Object.values(updateManifest.platforms).map((item) => item.url),
  ];

  assert.deepEqual(githubUpdaterManifest, updateManifest);
  assert.deepEqual(githubDownloadManifest, downloadManifest);
  assert.equal(downloadManifest.source, "https://github.com/Mlilion/Codata-releases/releases/tag/v9.9.9");
  assert(urls.length > 0);
  assert(
    urls.every((url) => url.startsWith("https://github.com/Mlilion/Codata-releases/releases/download/v9.9.9/")),
  );
});

test("keeps website release paths when a site base URL is configured", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codata-release-manifest-"));
  const artifacts = path.join(tmp, "artifacts");
  const releaseSite = path.join(tmp, "release-site");
  createArtifacts(artifacts);

  const result = spawnSync(process.execPath, [scriptPath, artifacts], {
    env: {
      ...process.env,
      GITHUB_REPOSITORY: "FlowGPT/Codata",
      GITHUB_REF_NAME: "v9.9.9",
      RELEASE_SITE_DIR: releaseSite,
      CODATA_SITE_BASE_URL: "https://oss.codata.test",
    },
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);

  const downloadManifest = JSON.parse(fs.readFileSync(path.join(releaseSite, "downloads/latest.json"), "utf8"));
  const updateManifest = JSON.parse(fs.readFileSync(path.join(releaseSite, "update/latest.json"), "utf8"));
  const urls = [
    ...Object.values(downloadManifest.downloads).map((item) => item.url),
    ...Object.values(updateManifest.platforms).map((item) => item.url),
  ];

  assert(urls.length > 0);
  assert(
    urls.every((url) => url.startsWith("https://oss.codata.test/downloads/releases/v9.9.9/")),
  );
});
