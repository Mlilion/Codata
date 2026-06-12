import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

const tauriConfig = JSON.parse(fs.readFileSync("desktop-tauri/src-tauri/tauri.conf.json", "utf8"));
const tauriLib = fs.readFileSync("desktop-tauri/src-tauri/src/lib.rs", "utf8");
const sessionItem = fs.readFileSync("frontend/src/components/layout/session-item.tsx", "utf8");

test("open-source desktop app uses an isolated application identifier", () => {
  assert.equal(tauriConfig.identifier, "com.workcraft.opensource");
});

test("open-source desktop deep links use an isolated URL scheme", () => {
  assert.deepEqual(tauriConfig.plugins["deep-link"].desktop.schemes, ["workcraft-oss"]);
  assert.match(tauriLib, /url\.scheme\(\) != "workcraft-oss"/);
  assert.match(sessionItem, /workcraft-oss:\/\/chat\?sessionId=/);
});
