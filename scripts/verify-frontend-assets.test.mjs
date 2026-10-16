import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const assetRoot = path.resolve(process.env.FRONTEND_ASSET_ROOT ?? "frontend/public");
const providerIconSourcePath = path.resolve("frontend/src/components/icons/provider-icon.tsx");

const requiredPublicAssets = [
  "favicon.svg",
  "logo-512.png",
  "logo.svg",
];

test("frontend public image assets referenced by the UI are present", () => {
  const missing = requiredPublicAssets.filter((asset) => !isNonEmptyFile(path.join(assetRoot, asset)));

  assert.deepEqual(missing, []);
});

test("provider icon images referenced by ProviderIcon are present", () => {
  const iconDir = path.join(assetRoot, "llm-icons");
  const requiredProviderIcons = readReferencedProviderIcons();
  const missing = requiredProviderIcons.filter((asset) => !isNonEmptyFile(path.join(iconDir, asset)));

  assert.deepEqual(missing, []);
});

function isNonEmptyFile(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

function readReferencedProviderIcons() {
  const source = fs.readFileSync(providerIconSourcePath, "utf8");
  const icons = new Set();

  for (const match of source.matchAll(/:\s*"([a-z0-9-]+)"/g)) {
    icons.add(`${match[1]}.png`);
  }

  for (const match of source.matchAll(/icon:\s*"([a-z0-9-]+)"/g)) {
    icons.add(`${match[1]}.png`);
  }

  return [...icons].sort();
}
