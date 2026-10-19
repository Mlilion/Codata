import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const bash = process.platform === "win32"
  ? path.resolve(path.dirname(execFileSync("where.exe", ["git"], { encoding: "utf8" }).trim().split(/\r?\n/)[0]), "..", "bin", "bash.exe")
  : "bash";
const script = path.resolve("scripts/notarize-macos.sh");
const shellPath = (value) => value.replaceAll("\\", "/");

function runNotarization(extraEnv = {}, { missingArtifact = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codata-notary-test-"));
  try {
    const artifact = path.join(root, "Codata.dmg");
    const key = path.join(root, "AuthKey.p8");
    const calls = path.join(root, "calls.txt");
    const mock = path.join(root, "mock.bash");
    fs.writeFileSync(key, "test key");
    if (!missingArtifact) fs.writeFileSync(artifact, "test dmg");
    fs.writeFileSync(mock, `
xcrun() {
  printf '%s\\n' "$*" >> "$MOCK_CALLS"
  if [ "$2" = "submit" ]; then
    printf '{"id":"test-submission","status":"%s"}\\n' "\${MOCK_STATUS:-Accepted}"
    return "\${MOCK_EXIT:-0}"
  fi
  printf 'Mock notarization log\\n'
}
`);
    const env = { ...process.env };
    for (const name of Object.keys(env)) {
      if (name.startsWith("APPLE_")) delete env[name];
    }
    const result = spawnSync(bash, [shellPath(script), shellPath(artifact)], {
      encoding: "utf8",
      timeout: 15000,
      env: {
        ...env,
        BASH_ENV: shellPath(mock),
        MOCK_CALLS: shellPath(calls),
        APPLE_API_KEY_PATH: shellPath(key),
        ...extraEnv,
      },
    });
    assert.ifError(result.error);
    return { ...result, calls: fs.existsSync(calls) ? fs.readFileSync(calls, "utf8") : "" };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const appleId = { APPLE_ID: "test@example.invalid", APPLE_PASSWORD: "test-password", APPLE_TEAM_ID: "TESTTEAM" };
const apiKey = { APPLE_API_ISSUER: "test-issuer", APPLE_API_KEY: "TESTKEY" };

test("notarization accepts Apple ID credentials and waits for Accepted", () => {
  const result = runNotarization(appleId);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.calls, /--apple-id test@example\.invalid.*--wait --output-format json/);
  assert.doesNotMatch(result.calls, /notarytool log/);
});

test("notarization accepts App Store Connect API credentials", () => {
  const result = runNotarization(apiKey);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.calls, /--key .*AuthKey\.p8 --key-id TESTKEY --issuer test-issuer/);
});

test("notarization fails closed when credentials or artifact are missing", () => {
  for (const result of [runNotarization(), runNotarization({ APPLE_ID: "incomplete" }), runNotarization(appleId, { missingArtifact: true })]) {
    assert.notEqual(result.status, 0);
    assert.equal(result.calls, "");
  }
});

test("rejected notarization fetches the submission log and fails", () => {
  const result = runNotarization({ ...appleId, MOCK_STATUS: "Invalid" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Notarization rejected: Invalid/);
  assert.match(result.calls, /notarytool log test-submission/);
});

test("notarytool transport or authentication failures cannot report success", () => {
  const result = runNotarization({ ...appleId, MOCK_EXIT: "17" });
  assert.equal(result.status, 17);
  assert.match(result.stderr, /Notarization submission failed/);
});
