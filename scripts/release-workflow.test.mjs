import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { sourcePresetFiles } from "./verify-bundle.mjs";

const workflow = fs.readFileSync(".github/workflows/release.yml", "utf8").replace(/\r\n/g, "\n");
const ciWorkflow = fs.readFileSync(".github/workflows/ci.yml", "utf8").replace(/\r\n/g, "\n");
const tauriConfig = JSON.parse(fs.readFileSync("desktop-tauri/src-tauri/tauri.conf.json", "utf8"));
const pyinstallerSpec = fs.readFileSync("backend/codata.spec", "utf8");
const verifyBundleScript = fs.readFileSync("scripts/verify-bundle.mjs", "utf8");
const nodeDownloadScript = fs.readFileSync("backend/scripts/download_node.py", "utf8");
const updateHook = fs.readFileSync("frontend/src/hooks/use-update-check.ts", "utf8");
const aboutTab = fs.readFileSync("frontend/src/components/settings/about-tab.tsx", "utf8");
const tauriCargo = fs.readFileSync("desktop-tauri/src-tauri/Cargo.toml", "utf8");

test("release builds and validates desktop installers before publishing to the source repository", () => {
  assert.match(workflow, /runner: windows-latest/);
  assert.match(workflow, /permissions:\s+contents: write/);
  assert.match(workflow, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(workflow, /--repo "\$GITHUB_REPOSITORY"/);
  assert.doesNotMatch(workflow, /RELEASE_TOKEN|RELEASE_REPOSITORY|Codata-releases|renyichao/);
  assert.match(
    workflow,
    /Build Windows installer[\s\S]*?Verify Windows installer[\s\S]*?needs: build[\s\S]*?Generate release download manifest[\s\S]*?Publish release to this repository/,
  );
  assert.match(workflow, /gh release create[\s\S]*?--verify-tag/);
  assert.match(workflow, /gh release upload[\s\S]*?--clobber/);
});

test("release workflow does not require updater signing or publish updater manifests", () => {
  assert.doesNotMatch(workflow, /TAURI_SIGNING|\.exe\.sig|(?:^|[ /"])latest\.json|\/update\/latest\.json|signer sign|--key/);
  assert.match(workflow, /downloads-latest\.json/);
  assert.equal(tauriConfig.bundle.createUpdaterArtifacts, undefined);
  assert.equal("updater" in tauriConfig.plugins, false);
  assert.doesNotMatch(tauriCargo, /tauri-plugin-updater/);
});

test("open-source builds disable automatic updates and About links to manual downloads", () => {
  assert.match(updateHook, /Automatic updates are disabled/);
  assert.match(aboutTab, /https:\/\/github\.com\/Mlilion\/Codata\/releases\/latest/);
  assert.match(aboutTab, /manualDownload/);
  assert.doesNotMatch(aboutTab, /checkForUpdates|upToDate|updateFailed/);
});

test("release workflow packages native macOS architectures and validates frontend assets", () => {
  assert.match(workflow, /FRONTEND_ASSET_ROOT: frontend\/out/);
  assert.match(workflow, /Verify frontend assets[\s\S]*?Build backend \(PyInstaller\)/);
  assert.match(workflow, /runner: macos-15\n/);
  assert.match(workflow, /runner: macos-15-intel/);
  assert.match(workflow, /artifact: macos-aarch64-bundle/);
  assert.match(workflow, /artifact: macos-x64-bundle/);
  assert.match(workflow, /CODATA_RELEASE_PLATFORMS: windows,macos/);
  assert.match(workflow, /tauri build --bundles app/);
  assert.match(workflow, /fix-macos-pyinstaller-frameworks\.sh/);
  assert.match(workflow, /codesign --verify --deep --strict/);
  assert.match(workflow, /hdiutil verify/);
  assert.match(workflow, /not notarized/);
  assert.doesNotMatch(workflow, /APPLE_CERTIFICATE|APPLE_PASSWORD|APPLE_ID/);
});

test("CI gates releases on strict open-source boundary and release policy tests", () => {
  assert.match(ciWorkflow, /npm run audit:open-source-boundary:strict/);
  assert.match(ciWorkflow, /node --test scripts\/release-workflow\.test\.mjs scripts\/generate-release-manifests\.test\.mjs scripts\/open-source-licenses\.test\.mjs scripts\/verify-bundle\.test\.mjs/);
  assert.match(ciWorkflow, /python scripts\/test_download_node\.py/);
});

test("backend bundle includes expert team presets", () => {
  assert.match(pyinstallerSpec, /app['"], ['"]expert['"], ['"]presets/);
  assert.match(verifyBundleScript, /app", "expert", "presets"/);
  const presets = sourcePresetFiles();
  assert.ok(presets.length > 0, "expected at least one expert-team preset in the source tree");
  assert.ok(presets.every((file) => file.endsWith(".yaml")), "presets should be .yaml files");
});

test("backend bundle verification requires license and ECharts notices", () => {
  assert.match(verifyBundleScript, /join\(internal, "licenses", "LICENSE"\)/);
  assert.match(verifyBundleScript, /join\(internal, "licenses", "THIRD_PARTY_NOTICES\.md"\)/);
  assert.match(verifyBundleScript, /join\(internal, "app", "report", "assets", "NOTICE"\)/);
});

test("downloaded Node.js runtime retains and verifies its LICENSE", () => {
  assert.match(nodeDownloadScript, /_KEEP_PREFIXES_WIN = \{"LICENSE"/);
  assert.match(nodeDownloadScript, /_KEEP_PREFIXES_UNIX = \{"LICENSE"/);
  assert.match(nodeDownloadScript, /\(output \/ "LICENSE"\)\.is_file\(\)/);
});
