import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { sourcePresetFiles } from "./verify-bundle.mjs";

const workflow = fs.readFileSync(".github/workflows/release.yml", "utf8").replace(/\r\n/g, "\n");
const ciWorkflow = fs.readFileSync(".github/workflows/ci.yml", "utf8").replace(/\r\n/g, "\n");
const tauriConfig = JSON.parse(fs.readFileSync("desktop-tauri/src-tauri/tauri.conf.json", "utf8"));
const pyinstallerSpec = fs.readFileSync("backend/codata.spec", "utf8");
const backendRequirements = fs.readFileSync("backend/requirements.txt", "utf8");
const backendPyproject = fs.readFileSync("backend/pyproject.toml", "utf8");
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
  assert.doesNotMatch(workflow, /TAURI_SIGNING|\.exe\.sig|(?:^|[ /"])latest\.json|\/update\/latest\.json|signer sign/);
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
});

test("macOS release requires Developer ID signing and notarizes both app and DMG", () => {
  assert.match(workflow, /Require and import Apple signing credentials[\s\S]*?actions\/setup-python/);
  for (const name of [
    "APPLE_CERTIFICATE", "APPLE_CERTIFICATE_PASSWORD", "APPLE_SIGNING_IDENTITY",
    "APPLE_ID", "APPLE_PASSWORD", "APPLE_TEAM_ID",
    "APPLE_API_ISSUER", "APPLE_API_KEY", "APPLE_API_KEY_PRIVATE_KEY",
  ]) {
    assert.ok(workflow.includes(`secrets.${name}`), `missing secret binding: ${name}`);
  }
  assert.doesNotMatch(workflow, /vars\.APPLE_|signingIdentity":"-"|--sign -|--timestamp=none|ad-hoc/);
  assert.match(workflow, /security import[\s\S]*?security set-key-partition-list/);
  assert.match(workflow, /Sign macOS native dependencies[\s\S]*?Build macOS application/);
  assert.match(workflow, /unset APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID/);
  assert.match(workflow, /fix-macos-pyinstaller-frameworks\.sh[\s\S]*?sign-macos-bundle\.sh "\$app\/Contents\/Resources\/backend"[\s\S]*?sign-macos-bundle\.sh "\$app\/Contents\/Resources\/nodejs"/);
  assert.match(workflow, /Notarize and staple macOS application[\s\S]*?notarize-macos\.sh "\$archive"[\s\S]*?staple-macos\.sh "\$app"[\s\S]*?spctl --assess --type execute/);
  assert.match(workflow, /Package macOS DMG[\s\S]*?codesign --force --timestamp[\s\S]*?notarize-macos\.sh "\$dmg"[\s\S]*?staple-macos\.sh "\$dmg"[\s\S]*?spctl --assess --type open/);
  assert.doesNotMatch(workflow, /xcrun stapler|validate-macos-staple/);
  assert.equal((workflow.match(/bash scripts\/staple-macos\.sh/g) || []).length, 2);
  assert.match(workflow, /Clean up Apple signing material\s+if: always\(\) && runner\.os == 'macOS'/);
  assert.match(workflow, /security delete-keychain/);
  const signingScript = fs.readFileSync("scripts/sign-macos-bundle.sh", "utf8");
  assert.match(signingScript, /--options runtime --timestamp/);
  assert.match(signingScript, /find "\$bundle_dir" -depth -type d/);
  assert.match(workflow, /VERIFY_BUNDLE_SKIP_SMOKE: "1"/);
  assert.match(ciWorkflow, /scripts\/notarize-macos\.test\.mjs scripts\/staple-macos\.test\.mjs/);
});

test("Intel macOS freezes cryptography from a compatible universal2 wheel", () => {
  assert.match(
    backendRequirements,
    /cryptography==48\.0\.1;\s*sys_platform\s*==\s*"darwin"\s+and\s+platform_machine\s*==\s*"x86_64"/,
  );
  assert.match(
    backendPyproject,
    /cryptography==48\.0\.1;\s*sys_platform\s*==\s*'darwin'\s+and\s+platform_machine\s*==\s*'x86_64'/,
  );
  assert.match(
    workflow,
    /"\$\{\{ matrix\.platform \}\}" == "macos-x86_64"[\s\S]*?--force-reinstall --no-deps --only-binary=:all: "cryptography==48\.0\.1"[\s\S]*?cryptography\.__version__ == '48\.0\.1'[\s\S]*?PyInstaller codata\.spec/,
  );
  assert.match(verifyBundleScript, /smoke: launching/);
});

test("CI gates releases on strict open-source boundary and release policy tests", () => {
  assert.match(ciWorkflow, /npm run audit:open-source-boundary:strict/);
  assert.match(ciWorkflow, /node --test scripts\/release-workflow\.test\.mjs scripts\/generate-release-manifests\.test\.mjs scripts\/open-source-licenses\.test\.mjs scripts\/verify-bundle\.test\.mjs[\s\S]*?scripts\/staple-macos\.test\.mjs/);
  assert.match(workflow, /node --test scripts\/release-workflow\.test\.mjs[\s\S]*?scripts\/staple-macos\.test\.mjs/);
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
