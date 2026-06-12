import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const constantsSource = readFileSync("frontend/src/lib/constants.ts", "utf8");
const providersTabSource = readFileSync(
  "frontend/src/components/settings/providers-tab.tsx",
  "utf8",
);

test("model settings exposes a backend refresh endpoint constant", () => {
  assert.match(constantsSource, /MODELS_REFRESH:\s*"\/api\/models\/refresh"/);
});

test("model settings refresh button calls refresh endpoint and reloads model query", () => {
  assert.match(providersTabSource, /api\.post<[^>]+>\(API\.MODELS_REFRESH\)/);
  assert.match(providersTabSource, /invalidateQueries\(\{\s*queryKey:\s*queryKeys\.models\s*\}\)/s);
  assert.match(providersTabSource, /onRefresh=\{[^}]*refreshModels\.mutate[^}]*\}/s);
});

test("model summary refresh icon is rendered as an accessible button", () => {
  assert.match(providersTabSource, /aria-label=\{t\("refreshModels"\)\}/);
  assert.match(providersTabSource, /<RefreshCw[^>]+animate-spin/);
});
