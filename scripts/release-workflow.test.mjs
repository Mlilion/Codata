import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { sourcePresetFiles } from "./verify-bundle.mjs";

const workflow = fs.readFileSync(".github/workflows/release.yml", "utf8");
const tauriConfig = JSON.parse(fs.readFileSync("desktop-tauri/src-tauri/tauri.conf.json", "utf8"));
const pyinstallerSpec = fs.readFileSync("backend/codata.spec", "utf8");
const verifyBundleScript = fs.readFileSync("scripts/verify-bundle.mjs", "utf8");

function jobBlock(name) {
  const header = `  ${name}:\n`;
  const start = workflow.indexOf(header);
  assert.notEqual(start, -1, `${name} job should exist`);

  const afterHeader = workflow.slice(start + header.length);
  const nextJob = afterHeader.search(/\n  [A-Za-z0-9_-]+:\n/);
  return nextJob === -1 ? workflow.slice(start) : workflow.slice(start, start + header.length + nextJob);
}

test("release workflow temporarily skips macOS packaging", () => {
  const macosJob = jobBlock("build-macos");
  const publishJob = jobBlock("publish");

  assert.match(macosJob, /if:\s+\$\{\{\s*false\s*\}\}/);
  assert.match(publishJob, /needs:\s+\[build-windows\]/);
  assert.doesNotMatch(publishJob, /build-macos/);
});

test("release workflow publishes Windows-only manifests while macOS packaging is disabled", () => {
  const publishJob = jobBlock("publish");

  assert.match(publishJob, /CODATA_RELEASE_PLATFORMS:\s+windows/);
  assert.match(publishJob, /artifacts\/windows-bundle/);
  assert.doesNotMatch(publishJob, /macos-aarch64-bundle/);
  assert.doesNotMatch(publishJob, /macos-x64-bundle/);
});

test("macOS release workflow requires Apple signing and notarization credentials", () => {
  for (const name of ["APPLE_CERTIFICATE", "APPLE_CERTIFICATE_PASSWORD", "APPLE_SIGNING_IDENTITY"]) {
    assert.match(workflow, new RegExp(name));
  }

  assert.match(workflow, /Require Apple signing and notarization credentials/);
  assert.match(workflow, /APPLE_ID/);
  assert.match(workflow, /APPLE_PASSWORD/);
  assert.match(workflow, /APPLE_TEAM_ID/);
  assert.match(workflow, /APPLE_API_ISSUER/);
  assert.match(workflow, /APPLE_API_KEY/);
  assert.match(workflow, /APPLE_API_KEY_PATH/);
});

test("macOS release workflow manually fixes, signs, notarizes, and regenerates artifacts", () => {
  assert.match(workflow, /Build Tauri \(no notarization\)/);
  assert.match(workflow, /Fix PyInstaller framework links in app bundle/);
  assert.match(workflow, /Sign bundled resource binaries/);
  assert.match(workflow, /Re-sign app bundle/);
  assert.match(workflow, /Notarize app/);
  assert.match(workflow, /Regenerate notarized macOS artifacts/);
  assert.match(workflow, /hdiutil create/);
  assert.match(workflow, /codesign --verify --deep --strict/);
  assert.match(workflow, /spctl --assess/);
  assert.match(workflow, /xcrun stapler validate/);
  assert.match(
    workflow,
    /Build Tauri \(no notarization\)[\s\S]*?Fix PyInstaller framework links in app bundle[\s\S]*?Sign bundled resource binaries[\s\S]*?Re-sign app bundle[\s\S]*?Notarize app[\s\S]*?Verify backend inside signed \.app[\s\S]*?Regenerate notarized macOS artifacts/,
  );
});

test("macOS release workflow imports the Apple certificate before custom codesign steps", () => {
  assert.match(workflow, /Import Apple Developer Certificate/);
  assert.match(workflow, /base64 -D > "\$CERTIFICATE_PATH"/);
  assert.match(workflow, /security import "\$CERTIFICATE_PATH"/);
  assert.match(workflow, /security set-key-partition-list/);
  assert.match(workflow, /Import Apple Developer Certificate[\s\S]*?Sign backend native binaries/);
});

test("macOS release workflow signs PyInstaller native binaries before Tauri packaging", () => {
  assert.match(workflow, /Sign backend native binaries/);
  assert.match(workflow, /scripts\/sign-macos-bundle\.sh backend\/dist\/codata-backend "\$APPLE_SIGNING_IDENTITY"/);
  assert.match(workflow, /Verify backend bundle[\s\S]*?Build Tauri \(no notarization\)/);
});

test("macOS release workflow signs bundled Node.js runtime before Tauri packaging", () => {
  assert.match(workflow, /Sign Node\.js runtime/);
  assert.match(
    workflow,
    /scripts\/sign-macos-bundle\.sh backend\/resources\/nodejs "\$APPLE_SIGNING_IDENTITY" desktop-tauri\/src-tauri\/node\.entitlements\.plist/,
  );
  assert.match(workflow, /Download Node\.js runtime[\s\S]*?Sign Node\.js runtime[\s\S]*?Build Tauri \(no notarization\)/);
});

test("macOS Tauri build unsets notarization credentials instead of passing empty env values", () => {
  const buildStep = workflow.match(/- name: Build Tauri \(no notarization\)[\s\S]*?(?=\n      - name: Fix PyInstaller framework links in app bundle)/)?.[0] ?? "";
  assert.ok(buildStep, "Build Tauri (no notarization) step should exist");

  assert.doesNotMatch(buildStep, /\n        env:\n[\s\S]*?APPLE_TEAM_ID: ""/);
  assert.match(buildStep, /unset APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID/);
  assert.match(buildStep, /unset APPLE_API_ISSUER APPLE_API_KEY APPLE_API_KEY_PATH APPLE_API_KEY_PRIVATE_KEY/);
});

test("macOS release workflow repairs PyInstaller Python.framework symlinks after Tauri resource copy", () => {
  assert.match(workflow, /scripts\/fix-macos-pyinstaller-frameworks\.sh "\$APP_BACKEND"/);
  assert.match(workflow, /Python\.framework/);
  assert.match(workflow, /Codata\.app\/Contents\/Resources\/backend/);

  const repairScript = fs.readFileSync("scripts/fix-macos-pyinstaller-frameworks.sh", "utf8");
  assert.match(repairScript, /Python\.framework/);
  assert.match(repairScript, /Versions\/Current/);
  assert.match(repairScript, /ln -s/);
  assert.match(repairScript, /_CodeSignature/);
});

test("macOS manual notarization supports Apple ID and App Store Connect API credentials", () => {
  assert.match(workflow, /xcrun notarytool submit/);
  assert.match(workflow, /--apple-id "\$APPLE_ID"/);
  assert.match(workflow, /--key "\$APPLE_API_KEY_PATH"/);
  assert.match(workflow, /xcrun stapler staple "\$APP_PATH"/);
});

test("release workflow verifies exported frontend image assets before packaging", () => {
  assert.equal(workflow.match(/Verify frontend assets/g)?.length, 2);
  assert.equal(workflow.match(/FRONTEND_ASSET_ROOT: frontend\/out/g)?.length, 2);
  assert.match(workflow, /Build frontend[\s\S]*?Verify frontend assets[\s\S]*?Build backend \(PyInstaller\)/);
});

test("backend bundle includes expert team presets", () => {
  assert.match(pyinstallerSpec, /app['"], ['"]expert['"], ['"]presets/);
  assert.match(verifyBundleScript, /app", "expert", "presets"/);
  // verify-bundle derives the required presets from the source tree rather
  // than a hardcoded list (a hardcoded copy silently drifts — see 1.1.13).
  // Assert that source has presets and they're all .yaml, so the guard has
  // something real to check.
  const presets = sourcePresetFiles();
  assert.ok(presets.length > 0, "expected at least one expert-team preset in the source tree");
  assert.ok(presets.every((f) => f.endsWith(".yaml")), "presets should be .yaml files");
});

test("macOS Node.js runtime signing keeps hardened runtime JIT entitlements", () => {
  const entitlementsPath = "desktop-tauri/src-tauri/node.entitlements.plist";
  assert.ok(fs.existsSync(entitlementsPath), `${entitlementsPath} should exist`);

  const entitlements = fs.readFileSync(entitlementsPath, "utf8");
  assert.match(entitlements, /com\.apple\.security\.cs\.allow-jit/);
  assert.match(entitlements, /com\.apple\.security\.cs\.allow-unsigned-executable-memory/);
  assert.match(entitlements, /com\.apple\.security\.cs\.disable-library-validation/);

  const signingScript = fs.readFileSync("scripts/sign-macos-bundle.sh", "utf8");
  assert.match(signingScript, /--entitlements "\$entitlements"/);
});

test("open-source release workflow publishes updater files only to GitHub Releases", () => {
  assert.match(workflow, /release-site\/latest\.json/);
  assert.match(workflow, /release-site\/downloads-latest\.json/);
  assert.match(workflow, /Mlilion\/Codata-releases/);
  assert.doesNotMatch(workflow, /renyichao-cyber\/Codata-releases/);
  assert.doesNotMatch(workflow, /draft:\s+true/);
  assert.doesNotMatch(workflow, /Require website deploy secrets/);
  assert.doesNotMatch(workflow, /easingthemes\/ssh-deploy/);
  assert.doesNotMatch(workflow, /CODATA_WEB_/);
  assert.doesNotMatch(workflow, /\/opt\/codata/);
  assert.doesNotMatch(workflow, /Verify website download and updater endpoints/);
});

test("release workflow bypasses Actions artifact storage quota", () => {
  assert.doesNotMatch(workflow, /actions\/upload-artifact@/);
  assert.doesNotMatch(workflow, /actions\/download-artifact@/);
  assert.match(workflow, /prepare-release:/);
  assert.match(workflow, /gh release create "\$GITHUB_REF_NAME"/);
  assert.match(workflow, /gh release upload "\$GITHUB_REF_NAME"/);
  assert.match(workflow, /gh release download "\$GITHUB_REF_NAME"/);
  assert.match(workflow, /gh release edit "\$GITHUB_REF_NAME"[\s\S]*--draft=false/);
  assert.match(workflow, /GH_TOKEN: \$\{\{ secrets\.RELEASE_TOKEN \}\}/);
});

test("open-source desktop updater checks the GitHub latest.json release asset", () => {
  assert.deepEqual(tauriConfig.plugins.updater.endpoints, [
    "https://github.com/Mlilion/Codata-releases/releases/latest/download/latest.json",
  ]);
});
