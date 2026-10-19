import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { sourcePresetFiles } from "./verify-bundle.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const presetsDir = path.join(repoRoot, "backend", "app", "expert", "presets");

function actualPresetYamlFiles() {
  return fs
    .readdirSync(presetsDir)
    .filter((name) => name.endsWith(".yaml"))
    .sort();
}

test("verify-bundle requires exactly the preset yaml files that exist in the repo", () => {
  const required = [...sourcePresetFiles()].sort();
  const actual = actualPresetYamlFiles();

  // The required list must be derived from reality, not a stale hardcoded
  // copy: it should match the source presets dir exactly. This guards
  // against the drift that blocked the 1.1.13 release, where the list
  // demanded 8 presets that had been removed.
  assert.deepEqual(required, actual);
});

test("verify-bundle finds at least one expert preset to require", () => {
  // A dynamic list that silently reads an empty/missing dir would make the
  // guard vacuous. Ensure it actually found presets.
  assert.ok(sourcePresetFiles().length > 0, "expected at least one preset yaml");
});

test("backend spec collects SQLAlchemy source, binaries, and hidden imports on every platform", () => {
  const spec = fs.readFileSync(path.join(repoRoot, "backend", "codata.spec"), "utf8");
  assert.match(
    spec,
    /sqlalchemy_datas,\s*sqlalchemy_binaries,\s*sqlalchemy_hiddenimports\s*=\s*collect_all\('sqlalchemy',\s*include_py_files=True\)/,
  );
  for (const [argument, collected] of [
    ["datas", "sqlalchemy_datas"],
    ["binaries", "sqlalchemy_binaries"],
    ["hiddenimports", "sqlalchemy_hiddenimports"],
  ]) {
    assert.match(spec, new RegExp(`${argument}=\\([^)]*\\+ ${collected}\\b`));
  }
});
