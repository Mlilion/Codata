import assert from "node:assert/strict";
import test from "node:test";

import {
  changedSkillsForPaths,
  formatSkillReleaseFailures,
  parseConventionalCommitSubject,
  validateSkillReleaseCommit,
} from "./skill-release-guard.mjs";

test("parseConventionalCommitSubject accepts scoped, unscoped, and breaking subjects", () => {
  assert.deepEqual(parseConventionalCommitSubject("fix(baoyu-post-to-wechat): repair editor paste"), {
    type: "fix",
    scope: "baoyu-post-to-wechat",
    breaking: false,
    description: "repair editor paste",
  });
  assert.deepEqual(parseConventionalCommitSubject("feat!: change skill metadata format"), {
    type: "feat",
    scope: "",
    breaking: true,
    description: "change skill metadata format",
  });
  assert.equal(parseConventionalCommitSubject("Fix WeChat browser article publishing"), null);
});

test("changedSkillsForPaths returns sorted unique skills", () => {
  assert.deepEqual(
    changedSkillsForPaths([
      "README.md",
      "skills/baoyu-post-to-wechat/scripts/wechat-article.ts",
      "skills/baoyu-post-to-wechat/SKILL.md",
      "skills/baoyu-url-to-markdown/SKILL.md",
    ]),
    ["baoyu-post-to-wechat", "baoyu-url-to-markdown"],
  );
});

test("validateSkillReleaseCommit ignores non-skill changes", () => {
  assert.deepEqual(
    validateSkillReleaseCommit({
      subject: "Fix test workflow",
      paths: [".github/workflows/test.yml"],
    }),
    [],
  );
});

test("validateSkillReleaseCommit rejects non-conventional skill commit subjects", () => {
  const failures = validateSkillReleaseCommit({
    commit: "81377416b4a7",
    subject: "Fix WeChat browser article publishing",
    paths: ["skills/baoyu-post-to-wechat/scripts/wechat-article.ts"],
  });

  assert.equal(failures.length, 1);
  assert.match(failures[0]!.message, /Conventional Commit/);
  assert.match(formatSkillReleaseFailures(failures), /fix\(baoyu-post-to-wechat\):/);
});

test("validateSkillReleaseCommit accepts conventional skill commit subjects", () => {
  assert.deepEqual(
    validateSkillReleaseCommit({
      subject: "fix(browser): ensure tab activation before copy/paste in WeChat editor",
      paths: ["skills/baoyu-post-to-wechat/scripts/wechat-article.ts"],
    }),
    [],
  );
});
