import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const bash = process.platform === "win32"
  ? path.resolve(path.dirname(execFileSync("where.exe", ["git"], { encoding: "utf8" }).trim().split(/\r?\n/)[0]), "..", "bin", "bash.exe")
  : "bash";
const script = path.resolve("scripts/validate-macos-staple.sh");
const shellPath = (value) => value.replaceAll("\\", "/");

function runValidation({ failCount = 0, failure = "network", artifactExists = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codata-staple-test-"));
  try {
    const artifact = path.join(root, "Codata.dmg");
    const calls = path.join(root, "calls.txt");
    const mock = path.join(root, "mock.bash");
    if (artifactExists) fs.writeFileSync(artifact, "test artifact");
    fs.writeFileSync(mock, `
sleep() { :; }
xcrun() {
  printf '%s\\n' "$*" >> "$MOCK_CALLS"
  if [ "$(wc -l < "$MOCK_CALLS")" -le "$MOCK_FAIL_COUNT" ]; then
    if [ "$MOCK_FAILURE" = "network" ]; then
      echo 'Error Domain=NSURLErrorDomain Code=-1005 "The network connection was lost."' >&2
      echo "CloudKit's response is inconsistent with expections: (null)" >&2
      return 68
    fi
    echo "The staple ticket is invalid." >&2
    return 65
  fi
  echo "The validate action worked!"
}
`);
    const env = {
      ...process.env,
      BASH_ENV: shellPath(mock),
      MOCK_CALLS: shellPath(calls),
      MOCK_FAIL_COUNT: String(failCount),
      MOCK_FAILURE: failure,
    };
    const result = spawnSync(bash, [shellPath(script), shellPath(artifact)], {
      encoding: "utf8",
      timeout: 15000,
      env,
    });
    assert.ifError(result.error);
    return { ...result, calls: fs.existsSync(calls) ? fs.readFileSync(calls, "utf8") : "" };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("staple validation succeeds without retry when Apple accepts the ticket", () => {
  const result = runValidation();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.calls.trim().split(/\r?\n/).length, 1);
});

test("staple validation retries transient CloudKit network errors", () => {
  const result = runValidation({ failCount: 2 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.calls.trim().split(/\r?\n/).length, 3);
  assert.match(result.stderr, /transient network error/);
});

test("staple validation fails after exhausting transient network retries", () => {
  const result = runValidation({ failCount: 5 });
  assert.equal(result.status, 68);
  assert.match(result.stderr, /failed after 5 attempts/);
  assert.equal(result.calls.trim().split(/\r?\n/).length, 5);
});

test("staple validation fails immediately for non-network errors", () => {
  const result = runValidation({ failCount: 1, failure: "invalid" });
  assert.equal(result.status, 65);
  assert.match(result.stderr, /not a recognized transient network failure/);
  assert.equal(result.calls.trim().split(/\r?\n/).length, 1);
});

test("staple validation rejects a missing artifact argument", () => {
  const result = spawnSync(bash, [shellPath(script)], { encoding: "utf8", timeout: 15000 });
  assert.ifError(result.error);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage:/);
});
