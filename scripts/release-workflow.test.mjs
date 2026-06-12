import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

const workflow = fs.readFileSync(".github/workflows/release.yml", "utf8");
const pyinstallerSpec = fs.readFileSync("backend/workcraft.spec", "utf8");
const verifyBundleScript = fs.readFileSync("scripts/verify-bundle.mjs", "utf8");
const expectedPresetFiles = [
  "video_production.yaml",
  "data_analysis_report.yaml",
  "meeting_notes_actions.yaml",
  "weekly_monthly_report.yaml",
  "document_review_polish.yaml",
  "presentation_briefing.yaml",
  "research_competitive_analysis.yaml",
  "sales_proposal.yaml",
  "project_plan_risk.yaml",
];

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
  assert.match(workflow, /scripts\/sign-macos-bundle\.sh backend\/dist\/workcraft-backend "\$APPLE_SIGNING_IDENTITY"/);
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
  assert.match(workflow, /WorkCraft\.app\/Contents\/Resources\/backend/);

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
  for (const filename of expectedPresetFiles) {
    assert.match(verifyBundleScript, new RegExp(filename.replace(".", "\\.")));
  }
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
