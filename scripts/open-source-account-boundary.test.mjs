import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

const deletedAccountPaths = [
  "backend/app/api/openai_auth.py",
  "backend/app/provider/openai_oauth.py",
  "backend/app/provider/openai_subscription.py",
  "backend/app/provider/proxy_auth.py",
  "backend/tests/test_api/test_codata_account.py",
  "backend/tests/test_provider/test_openai_oauth.py",
  "backend/tests/test_provider/test_proxy_auth.py",
];

const forbiddenFragments = [
  "/api/config/openai-subscription",
  "/api/config/codata-account",
  "/api/proxy-auth/",
  "/api/proxy-keys/",
  "/api/proxy-subscriptions/",
  "openai-subscription",
  "openai_oauth_",
  "CODATA_OPENAI_OAUTH",
  "CODATA_PROXY_URL",
  "CODATA_PROXY_TOKEN",
  "CODATA_PROXY_REFRESH_TOKEN",
  "codata-proxy",
  "Codata account",
  "Codata 账号",
  "Sub2API",
  "SUB2API_URL",
];

const scannedExtensions = /\.(py|ts|tsx|js|jsx|json|md)$/;
const scannedRoots = [
  "backend/",
  "frontend/src/",
  "frontend/tests/",
  "README.md",
  "README.zh-CN.md",
  "backend/README.md",
  "backend/README.zh-CN.md",
];

function trackedFiles() {
  return execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

function isScannedFile(file) {
  if (!scannedExtensions.test(file)) return false;
  return scannedRoots.some((root) =>
    root.endsWith("/") ? file.startsWith(root) : file === root
  );
}

function read(file) {
  return fs.readFileSync(path.resolve(file), "utf8");
}

test("open source repository does not track account login implementation files", () => {
  const files = new Set(trackedFiles());
  assert.deepEqual(deletedAccountPaths.filter((file) => files.has(file)), []);
});

test("open source repository does not expose account login or cloud proxy routes", () => {
  const offenders = [];

  for (const file of trackedFiles().filter(isScannedFile)) {
    const source = read(file);
    for (const fragment of forbiddenFragments) {
      if (source.includes(fragment)) {
        offenders.push(`${file}: ${fragment}`);
      }
    }
  }

  assert.deepEqual(offenders, []);
});
