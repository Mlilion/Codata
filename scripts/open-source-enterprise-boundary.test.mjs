import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { enterpriseFindings } from "./enterprise-boundary.mjs";

test("source snapshot contains no enterprise integration defaults or references", () => {
  assert.deepEqual(enterpriseFindings(), []);
});

test("enterprise audit detects company defaults without Git metadata", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codata-boundary-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "provider.py"), 'proxy = "http://zscaler.cn.schneider-electric.com:9480"\n');
  assert.deepEqual(enterpriseFindings(root), ["provider.py:1"]);
});

test("enterprise audit rejects new preconfigured service URLs", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codata-boundary-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "backend", "app", "data"), { recursive: true });
  fs.writeFileSync(path.join(root, "backend", "app", "data", "connectors.json"),
    JSON.stringify({ preset: { url: "https://data.example.test/mcp" } }));
  assert.equal(enterpriseFindings(root).length, 1);
});
