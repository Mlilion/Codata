import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";

import { verifyReleaseSite } from "./verify-release-site.mjs";

let server;
let baseUrl;
let handler;
const scratchRoot = path.resolve(`.test-verify-release-site-${process.pid}-${randomUUID()}`);

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function createReleaseSite(version = "1.1.6") {
  const directory = path.join(scratchRoot, `case-${randomUUID()}`);
  const manifest = {
    version,
    downloads: {
      "windows-x86_64": {
        filename: `Codata_${version}_x64.exe`,
        url: `${baseUrl}/releases/${version}/Codata_${version}_x64.exe`,
        size: 10,
        sha256: "abc",
      },
    },
  };
  writeJson(path.join(directory, "downloads-latest.json"), manifest);
  return { directory, manifest };
}

before(async () => {
  server = http.createServer((req, res) => handler(req, res));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(scratchRoot, { recursive: true, force: true });
});

test("fails when the published download manifest has an older version", async () => {
  const { directory } = createReleaseSite();
  let assetRequests = 0;
  handler = (req, res) => {
    if (req.url === "/downloads-latest.json") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ version: "1.1.5", downloads: {} }));
      return;
    }
    assetRequests += 1;
    res.statusCode = 404;
    res.end("missing");
  };

  await assert.rejects(
    () => verifyReleaseSite({ releaseSiteDir: directory, siteBaseUrl: baseUrl, attempts: 1, delayMs: 1 }),
    /remote downloads manifest version mismatch: expected 1\.1\.6, got 1\.1\.5/,
  );
  assert.equal(assetRequests, 0);
});

test("checks the single-repository manifest and cache-busted release asset URL", async () => {
  const { directory, manifest } = createReleaseSite();
  const assetRequests = [];
  handler = (req, res) => {
    if (req.url === "/downloads-latest.json") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(manifest));
      return;
    }
    assetRequests.push(req.url);
    const url = new URL(req.url, baseUrl);
    if (url.searchParams.has("verify") || url.search === "") {
      res.end();
      return;
    }
    res.statusCode = 404;
    res.end("missing");
  };

  await verifyReleaseSite({ releaseSiteDir: directory, siteBaseUrl: baseUrl, attempts: 1, delayMs: 1 });
  assert.equal(assetRequests.length, 2);
  assert(new URL(assetRequests[0], baseUrl).searchParams.has("verify"));
  assert.equal(new URL(assetRequests[1], baseUrl).search, "");
});

test("changes the cache-busting query string between asset retries", async () => {
  const { directory, manifest } = createReleaseSite();
  const verifyParams = [];
  handler = (req, res) => {
    if (req.url === "/downloads-latest.json") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(manifest));
      return;
    }
    const verify = new URL(req.url, baseUrl).searchParams.get("verify");
    if (!verify) {
      res.end();
      return;
    }
    verifyParams.push(verify);
    if (verifyParams.length === 1) {
      res.statusCode = 404;
      res.end("missing");
      return;
    }
    res.end();
  };

  await verifyReleaseSite({ releaseSiteDir: directory, siteBaseUrl: baseUrl, attempts: 2, delayMs: 1 });
  assert.equal(verifyParams.length, 2);
  assert.notEqual(verifyParams[0], verifyParams[1]);
});

test("fails when the public release asset URL returns a cached 404", async () => {
  const { directory, manifest } = createReleaseSite();
  handler = (req, res) => {
    if (req.url === "/downloads-latest.json") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(manifest));
      return;
    }
    if (new URL(req.url, baseUrl).searchParams.has("verify")) {
      res.end();
      return;
    }
    res.statusCode = 404;
    res.end("cached missing");
  };

  await assert.rejects(
    () => verifyReleaseSite({ releaseSiteDir: directory, siteBaseUrl: baseUrl, attempts: 1, delayMs: 1 }),
    /public endpoint .*Codata_1\.1\.6_x64\.exe returned 404/,
  );
});
