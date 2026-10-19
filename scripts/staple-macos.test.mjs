import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const bash = process.platform === "win32"
  ? path.resolve(path.dirname(execFileSync("where.exe", ["git"], { encoding: "utf8" }).trim().split(/\r?\n/)[0]), "..", "bin", "bash.exe")
  : "bash";
const script = path.resolve("scripts/staple-macos.sh");
const shellPath = (value) => value.replaceAll("\\", "/");

function runStapling({
  artifactType = "dmg",
  stapleFailures = 0,
  validateFailures = 0,
  failureMessage = 'Error Domain=NSURLErrorDomain Code=-1005 "The network connection was lost."',
  failureStatus = 68,
  missingArtifact = false,
  missingArgument = false,
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codata staple test-"));
  try {
    const artifact = path.join(root, `Codata.${artifactType}`);
    const calls = path.join(root, "calls.txt");
    const sleeps = path.join(root, "sleeps.txt");
    const mock = path.join(root, "mock.bash");
    if (!missingArtifact) {
      if (artifactType === "app") fs.mkdirSync(artifact);
      else fs.writeFileSync(artifact, "test artifact");
    }
    fs.writeFileSync(mock, `
sleep() { printf '%s\\n' "$*" >> "$MOCK_SLEEPS"; }
xcrun() {
  if [ "$#" -ne 3 ] || [ "$1" != "stapler" ] || [ "$3" != "$MOCK_ARTIFACT" ]; then
    echo "Unexpected xcrun arguments: $*" >&2
    return 99
  fi
  printf '%s\\n' "$2" >> "$MOCK_CALLS"
  local failures
  case "$2" in
    staple) failures="$MOCK_STAPLE_FAILURES" ;;
    validate) failures="$MOCK_VALIDATE_FAILURES" ;;
    *) return 99 ;;
  esac
  if [ "$(grep -c "^$2$" "$MOCK_CALLS")" -le "$failures" ]; then
    printf '%s\\n' "$MOCK_FAILURE_MESSAGE" >&2
    return "$MOCK_FAILURE_STATUS"
  fi
  printf 'The %s action worked!\\n' "$2"
}
`);
    const result = spawnSync(bash, [shellPath(script), ...(missingArgument ? [] : [shellPath(artifact)])], {
      encoding: "utf8",
      timeout: 20000,
      env: {
        ...process.env,
        BASH_ENV: shellPath(mock),
        MOCK_ARTIFACT: shellPath(artifact),
        MOCK_CALLS: shellPath(calls),
        MOCK_SLEEPS: shellPath(sleeps),
        MOCK_STAPLE_FAILURES: String(stapleFailures),
        MOCK_VALIDATE_FAILURES: String(validateFailures),
        MOCK_FAILURE_MESSAGE: failureMessage,
        MOCK_FAILURE_STATUS: String(failureStatus),
      },
    });
    assert.ifError(result.error);
    const readLines = (file) => fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split(/\r?\n/) : [];
    return { ...result, calls: readLines(calls), sleeps: readLines(sleeps) };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

for (const artifactType of ["app", "dmg"]) {
  test(`${artifactType}: staples before validation without unnecessary retries`, () => {
    const result = runStapling({ artifactType });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.calls, ["staple", "validate"]);
    assert.deepEqual(result.sleeps, []);
  });

  test(`${artifactType}: recovers from network loss while stapling and validating`, () => {
    const result = runStapling({ artifactType, stapleFailures: 2, validateFailures: 1 });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.calls, ["staple", "staple", "staple", "validate", "validate"]);
    assert.deepEqual(result.sleeps, ["10", "20", "10"]);
    assert.match(result.stderr, /stapler staple hit a transient network error/);
    assert.match(result.stderr, /stapler validate hit a transient network error/);
  });
}

for (const operation of ["staple", "validate"]) {
  const failures = (count) => operation === "staple" ? { stapleFailures: count } : { validateFailures: count };
  const expectedCalls = (count) => [...(operation === "validate" ? ["staple"] : []), ...Array(count).fill(operation)];

  test(`${operation}: stops after six network failures with capped backoff and original exit status`, () => {
    const result = runStapling(failures(6));
    assert.equal(result.status, 68);
    assert.deepEqual(result.calls, expectedCalls(6));
    assert.deepEqual(result.sleeps, ["10", "20", "40", "60", "60"]);
    assert.match(result.stderr, new RegExp(`stapler ${operation} failed after 6 attempts`));
  });

  test(`${operation}: accepts success on the final allowed attempt`, () => {
    const result = runStapling(failures(5));
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.calls, [...expectedCalls(6), ...(operation === "staple" ? ["validate"] : [])]);
    assert.deepEqual(result.sleeps, ["10", "20", "40", "60", "60"]);
  });

  for (const [failureStatus, failureMessage] of [
    [65, "The ticket data is invalid."],
    [77, "The ticket has been revoked."],
    [68, "CloudKit's response is inconsistent with expections: (null)\nThe staple and validate action failed! Error 68."],
    [68, "Error Domain=NSURLErrorDomain Code=-1202 certificate is untrusted"],
  ]) {
    test(`${operation}: fails immediately without network evidence (${failureStatus}: ${failureMessage.split("\n")[0]})`, () => {
      const result = runStapling({ ...failures(1), failureStatus, failureMessage });
      assert.equal(result.status, failureStatus);
      assert.deepEqual(result.calls, expectedCalls(1));
      assert.deepEqual(result.sleeps, []);
      assert.match(result.stderr, /not a recognized transient network failure/);
    });
  }
}

test("retries an explicit network timeout even without error 68", () => {
  const result = runStapling({
    stapleFailures: 1,
    failureMessage: 'Error Domain=NSURLErrorDomain Code=-1001 "The request timed out."',
    failureStatus: 1,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, ["staple", "staple", "validate"]);
});

test("rejects missing artifact paths and arguments before invoking Apple tools", () => {
  for (const options of [{ missingArtifact: true }, { missingArgument: true }]) {
    const result = runStapling(options);
    assert.equal(result.status, 2);
    assert.deepEqual(result.calls, []);
    assert.deepEqual(result.sleeps, []);
    assert.match(result.stderr, /Usage:/);
  }
});
