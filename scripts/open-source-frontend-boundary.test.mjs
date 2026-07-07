import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

const deletedFrontendPaths = [
  "frontend/src/stores/auth-store.ts",
  "frontend/src/stores/billing-store.ts",
  "frontend/src/lib/proxy-api.ts",
  "frontend/src/lib/codata-billing.ts",
  "frontend/src/components/settings/account-tab.tsx",
  "frontend/src/components/settings/recharge-panel.tsx",
  "frontend/src/components/billing/upgrade-prompt.tsx",
  "frontend/src/components/layout/sidebar-footer-credit-display.ts",
  "frontend/src/components/onboarding/onboarding-screen.tsx",
  "frontend/src/i18n/locales/en/billing.json",
  "frontend/src/i18n/locales/zh/billing.json",
];

const forbiddenImportFragments = [
  "@/stores/auth-store",
  "@/stores/billing-store",
  "@/lib/proxy-api",
  "@/lib/codata-billing",
  "@/components/billing/upgrade-prompt",
  "@/components/settings/account-tab",
  "@/components/settings/recharge-panel",
  "@/components/onboarding/onboarding-screen",
];

const forbiddenConstantFragments = [
  "CODATA_ACCOUNT",
  "PROXY_AUTH_",
  "PROXY_KEYS_",
  "PROXY_PAYMENT_",
  "PROXY_SUBSCRIPTIONS_",
];

const forbiddenAccountFrontendFragments = [
  "Codata account",
  "Codata 账号",
  "Codata Account",
  "codata-auth",
  "/api/config/codata-account",
  "/api/config/openai-subscription",
  "openai-subscription",
  "ChatGPT Subscription",
  "ChatGPT 订阅",
  "chatgptSubscription",
];

const moduleExtensions = ["", ".ts", ".tsx", ".js", ".jsx", ".json"];

function trackedFiles() {
  return execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

function frontendSourceFiles(files) {
  return files.filter((file) =>
    file.startsWith("frontend/src/") &&
    /\.(ts|tsx)$/.test(file)
  );
}

function frontendBoundaryFiles(files) {
  return files.filter((file) =>
    file.startsWith("frontend/src/") &&
    /\.(ts|tsx|json)$/.test(file)
  );
}

function read(file) {
  return fs.readFileSync(path.resolve(file), "utf8");
}

function toRepoPath(file) {
  return file.split(path.sep).join("/");
}

function importedModuleSpecifiers(source) {
  const specifiers = new Set();
  const staticImportPattern = /\b(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s*)?["']([^"']+)["']/g;
  const dynamicImportPattern = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

  for (const pattern of [staticImportPattern, dynamicImportPattern]) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      specifiers.add(match[1]);
    }
  }

  return [...specifiers];
}

function modulePathCandidates(importer, specifier) {
  if (!specifier.startsWith(".") && !specifier.startsWith("@/")) return [];

  const base = specifier.startsWith("@/")
    ? path.join("frontend/src", specifier.slice(2))
    : path.join(path.dirname(importer), specifier);
  const normalizedBase = toRepoPath(path.normalize(base));

  return [
    ...moduleExtensions.map((extension) => `${normalizedBase}${extension}`),
    ...moduleExtensions.map((extension) => `${normalizedBase}/index${extension}`),
  ];
}

test("open source frontend does not track commercial account or billing modules", () => {
  const files = new Set(trackedFiles());
  const stillTracked = deletedFrontendPaths.filter((file) => files.has(file));

  assert.deepEqual(stillTracked, []);
});

test("open source frontend does not import commercial account or billing modules", () => {
  const deletedFiles = new Set(deletedFrontendPaths);
  const offenders = new Set();

  for (const file of frontendSourceFiles(trackedFiles())) {
    const source = read(file);
    for (const specifier of importedModuleSpecifiers(source)) {
      for (const fragment of forbiddenImportFragments) {
        if (specifier.includes(fragment)) {
          offenders.add(`${file}: ${specifier}`);
        }
      }
      for (const candidate of modulePathCandidates(file, specifier)) {
        if (deletedFiles.has(candidate)) {
          offenders.add(`${file}: ${specifier}`);
        }
      }
    }
  }

  assert.deepEqual([...offenders], []);
});

test("open source frontend removes commercial proxy constants", () => {
  const offenders = [];
  for (const file of frontendSourceFiles(trackedFiles())) {
    const source = read(file);
    for (const fragment of forbiddenConstantFragments) {
      if (source.includes(fragment)) {
        offenders.push(`${file}: ${fragment}`);
      }
    }
  }

  assert.deepEqual(offenders, []);
});

test("open source frontend removes Codata cloud proxy provider references", () => {
  const offenders = [];
  for (const file of frontendSourceFiles(trackedFiles())) {
    const source = read(file);
    if (source.includes("codata-proxy")) {
      offenders.push(file);
    }
  }

  assert.deepEqual(offenders, []);
});

test("open source frontend removes account login and subscription UI text", () => {
  const offenders = [];
  for (const file of frontendBoundaryFiles(trackedFiles())) {
    const source = read(file);
    for (const fragment of forbiddenAccountFrontendFragments) {
      if (source.includes(fragment)) {
        offenders.push(`${file}: ${fragment}`);
      }
    }
  }

  assert.deepEqual(offenders, []);
});
