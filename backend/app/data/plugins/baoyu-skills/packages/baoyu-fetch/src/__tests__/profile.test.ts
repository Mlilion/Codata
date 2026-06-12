import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  ensureChromeProfileDir,
  hasChromeLockArtifacts,
  resolveChromeProfileDir,
  shouldRetryChromeLaunchRecovery,
} from "../browser/profile";

const originalProfile = process.env.BAOYU_CHROME_PROFILE_DIR;

afterEach(() => {
  if (originalProfile === undefined) {
    delete process.env.BAOYU_CHROME_PROFILE_DIR;
  } else {
    process.env.BAOYU_CHROME_PROFILE_DIR = originalProfile;
  }
});

describe("resolveChromeProfileDir", () => {
  test("uses BAOYU_CHROME_PROFILE_DIR when set", () => {
    process.env.BAOYU_CHROME_PROFILE_DIR = "/tmp/baoyu-profile";
    expect(resolveChromeProfileDir()).toBe("/tmp/baoyu-profile");
  });

  test("falls back to shared baoyu-skills profile path", () => {
    delete process.env.BAOYU_CHROME_PROFILE_DIR;
    const resolved = resolveChromeProfileDir();
    if (process.platform === "darwin") {
      expect(resolved).toBe(path.join(os.homedir(), "Library", "Application Support", "baoyu-skills", "chrome-profile"));
    } else if (process.platform === "win32") {
      expect(resolved.endsWith(path.join("baoyu-skills", "chrome-profile"))).toBe(true);
    } else {
      expect(resolved.endsWith(path.join("baoyu-skills", "chrome-profile"))).toBe(true);
    }
  });
});

describe("ensureChromeProfileDir", () => {
  test("creates the profile directory when missing", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "baoyu-fetch-profile-"));
    const profileDir = path.join(tempRoot, "nested", "chrome-profile");

    try {
      expect(fs.existsSync(profileDir)).toBe(false);
      expect(ensureChromeProfileDir(profileDir)).toBe(profileDir);
      expect(fs.statSync(profileDir).isDirectory()).toBe(true);
    } finally {
      fs.rmSync(tempRoot, { force: true, recursive: true });
    }
  });
});

describe("stale lock recovery helpers", () => {
  test("detects Chrome singleton lock artifacts", () => {
    expect(hasChromeLockArtifacts(["Cookies", "SingletonLock"])).toBe(true);
    expect(hasChromeLockArtifacts(["chrome.pid"])).toBe(true);
    expect(hasChromeLockArtifacts(["Preferences", "Cookies"])).toBe(false);
  });

  test("only retries stale-lock recovery when no live owner exists", () => {
    expect(shouldRetryChromeLaunchRecovery({ hasLockArtifacts: true, hasLiveOwner: false })).toBe(true);
    expect(shouldRetryChromeLaunchRecovery({ hasLockArtifacts: true, hasLiveOwner: true })).toBe(false);
    expect(shouldRetryChromeLaunchRecovery({ hasLockArtifacts: false, hasLiveOwner: false })).toBe(false);
  });
});
