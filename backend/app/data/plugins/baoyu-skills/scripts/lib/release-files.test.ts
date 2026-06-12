import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  listReleaseFiles,
  readSkillFrontmatterVersion,
  readSkillMetadataVersion,
  validateSkillMetadataVersion,
  validateSelfContainedRelease,
} from "./release-files.mjs";

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeFile(filePath: string, contents = ""): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents);
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

test("listReleaseFiles skips generated paths and returns sorted relative paths", async (t) => {
  const root = await makeTempDir("baoyu-release-files-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await writeFile(path.join(root, "b.txt"), "b");
  await writeFile(path.join(root, "a.txt"), "a");
  await writeFile(path.join(root, "nested", "keep.txt"), "keep");
  await writeFile(path.join(root, "node_modules", "skip.js"), "skip");
  await writeFile(path.join(root, ".git", "config"), "skip");
  await writeFile(path.join(root, "dist", "artifact.txt"), "skip");
  await writeFile(path.join(root, "out", "artifact.txt"), "skip");
  await writeFile(path.join(root, "build", "artifact.txt"), "skip");
  await writeFile(path.join(root, ".DS_Store"), "skip");
  await writeFile(path.join(root, "bun.lockb"), "skip");

  const files = await listReleaseFiles(root);

  assert.deepEqual(
    files.map((file) => file.relPath),
    ["a.txt", "b.txt", "nested/keep.txt"],
  );
});

test("readSkillFrontmatterVersion reads quoted and unquoted versions", () => {
  assert.equal(readSkillFrontmatterVersion("---\nname: demo\nversion: 1.2.3\n---\n"), "1.2.3");
  assert.equal(readSkillFrontmatterVersion("---\nversion: \"2.0.0\"\n---\n"), "2.0.0");
  assert.equal(readSkillFrontmatterVersion("# Missing frontmatter\n"), null);
});

test("validateSkillMetadataVersion accepts matching SKILL.md version", async (t) => {
  const root = await makeTempDir("baoyu-release-version-ok-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await writeFile(path.join(root, "SKILL.md"), "---\nname: demo\nversion: 1.2.3\n---\n");

  assert.equal(await readSkillMetadataVersion(root), "1.2.3");
  await assert.doesNotReject(() => validateSkillMetadataVersion(root, "1.2.3"));
});

test("validateSkillMetadataVersion rejects mismatched SKILL.md version", async (t) => {
  const root = await makeTempDir("baoyu-release-version-mismatch-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await writeFile(path.join(root, "SKILL.md"), "---\nname: demo\nversion: 1.2.3\n---\n");

  await assert.rejects(
    () => validateSkillMetadataVersion(root, "1.2.4"),
    /SKILL\.md version mismatch/,
  );
});

test("validateSelfContainedRelease accepts file dependencies that stay within the release root", async (t) => {
  const root = await makeTempDir("baoyu-release-ok-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await writeJson(path.join(root, "shared", "package.json"), {
    name: "shared-package",
    version: "1.0.0",
  });
  await writeFile(path.join(root, "shared", "index.js"), "export const shared = true;\n");
  await writeJson(path.join(root, "skill", "package.json"), {
    name: "test-skill",
    version: "1.0.0",
    dependencies: {
      "shared-package": "file:../shared",
    },
  });

  await assert.doesNotReject(() => validateSelfContainedRelease(root));
});

test("validateSelfContainedRelease accepts package bin targets inside the release root", async (t) => {
  const root = await makeTempDir("baoyu-release-bin-ok-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await writeJson(path.join(root, "scripts", "package.json"), {
    name: "test-skill-scripts",
    version: "1.0.0",
    bin: {
      "test-skill": "./test-skill",
    },
  });
  await writeFile(path.join(root, "scripts", "test-skill"), "#!/usr/bin/env sh\n");

  await assert.doesNotReject(() => validateSelfContainedRelease(root));
});

test("validateSelfContainedRelease rejects missing package bin targets", async (t) => {
  const root = await makeTempDir("baoyu-release-bin-missing-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await writeJson(path.join(root, "scripts", "package.json"), {
    name: "test-skill-scripts",
    version: "1.0.0",
    bin: {
      "test-skill": "./missing",
    },
  });

  await assert.rejects(
    () => validateSelfContainedRelease(root),
    /Missing package bin target for release/,
  );
});

test("validateSelfContainedRelease rejects missing local file dependencies", async (t) => {
  const root = await makeTempDir("baoyu-release-missing-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await writeJson(path.join(root, "skill", "package.json"), {
    name: "test-skill",
    version: "1.0.0",
    dependencies: {
      "shared-package": "file:../shared",
    },
  });

  await assert.rejects(
    () => validateSelfContainedRelease(root),
    /Missing local dependency for release/,
  );
});

test("validateSelfContainedRelease rejects file dependencies outside the release root", async (t) => {
  const root = await makeTempDir("baoyu-release-root-");
  const outside = await makeTempDir("baoyu-release-outside-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));

  const skillDir = path.join(root, "skill");
  const externalSpec = path
    .relative(skillDir, outside)
    .split(path.sep)
    .join("/");

  await writeJson(path.join(skillDir, "package.json"), {
    name: "test-skill",
    version: "1.0.0",
    dependencies: {
      "outside-package": `file:${externalSpec}`,
    },
  });

  await assert.rejects(
    () => validateSelfContainedRelease(root),
    /Release target is not self-contained/,
  );
});
