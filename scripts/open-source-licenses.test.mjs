import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

function json(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

test("first-party package metadata consistently uses Apache-2.0", () => {
  for (const directory of ["", "frontend/", "desktop-tauri/"]) {
    assert.equal(json(`${directory}package.json`).license, "Apache-2.0");
    assert.equal(json(`${directory}package-lock.json`).packages[""].license, "Apache-2.0");
  }
});

test("proprietary presentation renderer is not included in the frontend dependency graph", () => {
  const manifest = json("frontend/package.json");
  const lock = json("frontend/package-lock.json");
  const packageName = "@kandiforge/pptx-renderer";
  assert.equal(manifest.dependencies[packageName], undefined);
  assert.equal(lock.packages[`node_modules/${packageName}`], undefined);
});

test("bundled third-party resources retain license and notice files", () => {
  for (const file of [
    "LICENSE",
    "THIRD_PARTY_NOTICES.md",
    "backend/app/data/agency-agents-zh/LICENSE",
    "backend/app/data/plugins/data/LICENSE",
    "backend/app/data/skills/skill-creator/LICENSE.txt",
    "backend/app/report/assets/NOTICE",
  ]) {
    assert.ok(fs.readFileSync(file, "utf8").trim().length > 0, file);
  }
  const spec = fs.readFileSync("backend/codata.spec", "utf8");
  assert.match(spec, /repo_root, 'LICENSE'/);
  assert.match(spec, /repo_root, 'THIRD_PARTY_NOTICES\.md'/);
});
