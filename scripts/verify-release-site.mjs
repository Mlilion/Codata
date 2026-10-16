import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const defaultSiteBaseUrl = "https://example.com";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
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

function assertRemoteManifestMatches(local, remote) {
  if (remote.version !== local.version) {
    throw new Error(`remote downloads manifest version mismatch: expected ${local.version}, got ${remote.version}`);
  }

  if (!sameJson(remote, local)) {
    throw new Error("remote downloads manifest does not match generated release-site/downloads-latest.json");
  }
}

function cacheBustedUrl(url, nonce) {
  const parsed = new URL(url);
  parsed.searchParams.set("verify", nonce);
  return parsed.toString();
}

async function checkAsset(url, { nonce }) {
  const res = await fetch(cacheBustedUrl(url, nonce), { method: "HEAD", cache: "no-store" });
  if (!res.ok) {
    throw new Error(`${url} returned ${res.status}`);
  }
}

async function checkPublicUrl(url) {
  const res = await fetch(url, { method: "HEAD", cache: "no-store" });
  if (!res.ok) {
    throw new Error(`public endpoint ${url} returned ${res.status}`);
  }
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
  const baseUrl = siteBaseUrl.replace(/\/$/, "");
  const releaseSiteRoot = path.resolve(releaseSiteDir);
  const localDownloadManifest = readJson(path.join(releaseSiteRoot, "downloads-latest.json"));
  const nonce = `${localDownloadManifest.version || "release"}-${Date.now()}`;

  await retry(async () => {
    const remoteDownloadManifest = await fetchJson(`${baseUrl}/downloads-latest.json`);
    assertRemoteManifestMatches(localDownloadManifest, remoteDownloadManifest);
  }, { attempts, delayMs });

  const urls = Object.values(localDownloadManifest.downloads || {}).map((item) => item.url);
  await retry(async (attempt) => {
    await Promise.all(urls.map((url) => checkAsset(url, { nonce: `${nonce}-${attempt}` })));
  }, { attempts, delayMs });
  await Promise.all(urls.map(checkPublicUrl));

  console.log(`[verify-release-site] verified ${urls.length} release asset URLs at ${baseUrl}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyReleaseSite({
    releaseSiteDir: process.argv[2] || "release-site",
    siteBaseUrl: process.env.CODATA_SITE_BASE_URL || defaultSiteBaseUrl,
  }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
