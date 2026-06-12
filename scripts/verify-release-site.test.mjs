import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { verifyReleaseSite } from "./verify-release-site.mjs";

let server;
let baseUrl;
let handler;

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

before(async () => {
  server = http.createServer((req, res) => {
    handler(req, res);
  });

  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test("fails before checking assets when the remote manifest is still on an older version", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "workcraft-release-site-"));
  writeJson(path.join(tmp, "downloads/latest.json"), {
    version: "1.1.6",
    downloads: {
      "macos-x86_64": {
        filename: "WorkCraft_1.1.6_x64.dmg",
        url: `${baseUrl}/downloads/releases/v1.1.6/WorkCraft_1.1.6_x64.dmg`,
        size: 10,
        sha256: "abc",
      },
    },
  });
  writeJson(path.join(tmp, "update/latest.json"), {
    version: "1.1.6",
    platforms: {
      "darwin-x86_64": {
        url: `${baseUrl}/downloads/releases/v1.1.6/WorkCraft_1.1.6_x64.app.tar.gz`,
      },
    },
  });
  handler = (req, res) => {
    if (req.url === "/downloads/latest.json") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ version: "1.1.5", downloads: {} }));
      return;
    }

    if (req.url === "/update/latest.json") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ version: "1.1.5", platforms: {} }));
      return;
    }

    res.statusCode = 404;
    res.end("missing");
  };

  await assert.rejects(
    () => verifyReleaseSite({ releaseSiteDir: tmp, siteBaseUrl: baseUrl, attempts: 1, delayMs: 1 }),
    /remote downloads manifest version mismatch: expected 1\.1\.6, got 1\.1\.5/,
  );
});

test("uses a cache-busting query string when checking release assets", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "workcraft-release-site-"));
  const downloadManifest = {
    version: "1.1.6",
    downloads: {
      "macos-x86_64": {
        filename: "WorkCraft_1.1.6_x64.dmg",
        url: `${baseUrl}/downloads/releases/v1.1.6/WorkCraft_1.1.6_x64.dmg`,
        size: 10,
        sha256: "abc",
      },
    },
  };
  const updateManifest = {
    version: "1.1.6",
    platforms: {
      "darwin-x86_64": {
        url: `${baseUrl}/downloads/releases/v1.1.6/WorkCraft_1.1.6_x64.app.tar.gz`,
      },
    },
  };
  const assetRequests = [];

  writeJson(path.join(tmp, "downloads/latest.json"), downloadManifest);
  writeJson(path.join(tmp, "update/latest.json"), updateManifest);

  handler = (req, res) => {
    if (req.url === "/downloads/latest.json") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(downloadManifest));
      return;
    }

    if (req.url === "/update/latest.json") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(updateManifest));
      return;
    }

    const url = new URL(req.url, baseUrl);
    assetRequests.push(req.url);
    if (url.searchParams.has("verify") || url.search === "") {
      res.end();
      return;
    }

    res.statusCode = 404;
    res.end("missing");
  };

  await verifyReleaseSite({ releaseSiteDir: tmp, siteBaseUrl: baseUrl, attempts: 1, delayMs: 1 });

  assert.equal(assetRequests.length, 4);
  assert(assetRequests.slice(0, 2).every((url) => new URL(url, baseUrl).searchParams.has("verify")));
  assert(assetRequests.slice(2).every((url) => new URL(url, baseUrl).search === ""));
});

test("changes the cache-busting query string between asset check retries", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "workcraft-release-site-"));
  const downloadManifest = {
    version: "1.1.6",
    downloads: {
      "macos-x86_64": {
        filename: "WorkCraft_1.1.6_x64.dmg",
        url: `${baseUrl}/downloads/releases/v1.1.6/WorkCraft_1.1.6_x64.dmg`,
        size: 10,
        sha256: "abc",
      },
    },
  };
  const updateManifest = {
    version: "1.1.6",
    platforms: {},
  };
  const verifyParams = [];

  writeJson(path.join(tmp, "downloads/latest.json"), downloadManifest);
  writeJson(path.join(tmp, "update/latest.json"), updateManifest);

  handler = (req, res) => {
    if (req.url === "/downloads/latest.json") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(downloadManifest));
      return;
    }

    if (req.url === "/update/latest.json") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(updateManifest));
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

  await verifyReleaseSite({ releaseSiteDir: tmp, siteBaseUrl: baseUrl, attempts: 2, delayMs: 1 });

  assert.equal(verifyParams.length, 2);
  assert.notEqual(verifyParams[0], verifyParams[1]);
});

test("fails when the public asset URL is still returning a cached 404", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "workcraft-release-site-"));
  const downloadManifest = {
    version: "1.1.6",
    downloads: {
      "macos-x86_64": {
        filename: "WorkCraft_1.1.6_x64.dmg",
        url: `${baseUrl}/downloads/releases/v1.1.6/WorkCraft_1.1.6_x64.dmg`,
        size: 10,
        sha256: "abc",
      },
    },
  };
  const updateManifest = {
    version: "1.1.6",
    platforms: {},
  };

  writeJson(path.join(tmp, "downloads/latest.json"), downloadManifest);
  writeJson(path.join(tmp, "update/latest.json"), updateManifest);

  handler = (req, res) => {
    if (req.url === "/downloads/latest.json") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(downloadManifest));
      return;
    }

    if (req.url === "/update/latest.json") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(updateManifest));
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
    () => verifyReleaseSite({ releaseSiteDir: tmp, siteBaseUrl: baseUrl, attempts: 1, delayMs: 1 }),
    /public endpoint .*WorkCraft_1\.1\.6_x64\.dmg returned 404/,
  );
});
