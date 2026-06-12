import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const defaultSiteBaseUrl = "https://work-craft.com";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeBaseUrl(url) {
  return url.replace(/\/$/, "");
}

function assertJsonResponse(url, res) {
  const type = res.headers.get("content-type") || "";
  if (!type.includes("application/json")) {
    throw new Error(`${url} returned unexpected content-type: ${type}`);
  }
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`${url} returned ${res.status}`);
  }
  assertJsonResponse(url, res);
  return res.json();
}

function assertRemoteManifestMatches(name, local, remote) {
  if (remote.version !== local.version) {
    throw new Error(`remote ${name} manifest version mismatch: expected ${local.version}, got ${remote.version}`);
  }

  if (!sameJson(remote, local)) {
    throw new Error(`remote ${name} manifest does not match generated release-site/${name}/latest.json`);
  }
}

function cacheBustedUrl(url, nonce) {
  const parsed = new URL(url);
  parsed.searchParams.set("verify", nonce);
  return parsed.toString();
}

async function checkUrl(url, { nonce }) {
  const checkUrl = url.endsWith(".json") ? url : cacheBustedUrl(url, nonce);
  const res = await fetch(checkUrl, { method: "HEAD", cache: "no-store" });
  if (!res.ok) {
    throw new Error(`${url} returned ${res.status}`);
  }

  if (url.endsWith(".json")) {
    assertJsonResponse(url, res);
  }
}

async function checkPublicUrl(url) {
  const res = await fetch(url, { method: "HEAD", cache: "no-store" });
  if (!res.ok) {
    throw new Error(`public endpoint ${url} returned ${res.status}`);
  }
}

function manifestUrls(downloadManifest, updateManifest) {
  return [
    ...Object.values(downloadManifest.downloads || {}).map((item) => item.url),
    ...Object.values(updateManifest.platforms || {}).map((item) => item.url),
  ];
}

async function retry(action, { attempts, delayMs }) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await action(attempt);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        console.log(`[verify-release-site] attempt ${attempt}/${attempts} failed: ${error.message}`);
        await sleep(delayMs);
      }
    }
  }

  throw lastError;
}

export async function verifyReleaseSite({
  releaseSiteDir = "release-site",
  siteBaseUrl = defaultSiteBaseUrl,
  attempts = Number(process.env.RELEASE_SITE_VERIFY_ATTEMPTS || 12),
  delayMs = Number(process.env.RELEASE_SITE_VERIFY_DELAY_MS || 30_000),
} = {}) {
  const baseUrl = normalizeBaseUrl(siteBaseUrl);
  const releaseSiteRoot = path.resolve(releaseSiteDir);
  const localDownloadManifest = readJson(path.join(releaseSiteRoot, "downloads/latest.json"));
  const localUpdateManifest = readJson(path.join(releaseSiteRoot, "update/latest.json"));
  const nonce = `${localDownloadManifest.version || "release"}-${Date.now()}`;

  await retry(async () => {
    const [remoteDownloadManifest, remoteUpdateManifest] = await Promise.all([
      fetchJson(`${baseUrl}/downloads/latest.json`),
      fetchJson(`${baseUrl}/update/latest.json`),
    ]);

    assertRemoteManifestMatches("downloads", localDownloadManifest, remoteDownloadManifest);
    assertRemoteManifestMatches("update", localUpdateManifest, remoteUpdateManifest);
  }, { attempts, delayMs });

  const urls = manifestUrls(localDownloadManifest, localUpdateManifest);
  await retry(async (attempt) => {
    await Promise.all(urls.map((url) => checkUrl(url, { nonce: `${nonce}-${attempt}` })));
  }, { attempts, delayMs });
  await Promise.all(urls.map(checkPublicUrl));

  console.log(`[verify-release-site] verified ${urls.length} release asset URLs at ${baseUrl}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyReleaseSite({
    releaseSiteDir: process.argv[2] || "release-site",
    siteBaseUrl: process.env.WORKCRAFT_SITE_BASE_URL || defaultSiteBaseUrl,
  }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
