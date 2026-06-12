#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const strict = process.argv.includes("--strict");

const groups = [
  {
    name: "account-login",
    description: "Remove WorkCraft account login, cloud proxy, and subscription account modules from the open-source repository",
    paths: [
      "backend/app/api/openai_auth.py",
      "backend/app/provider/openai_oauth.py",
      "backend/app/provider/openai_subscription.py",
      "backend/app/provider/proxy_auth.py",
      "backend/tests/test_api/test_workcraft_account.py",
      "backend/tests/test_provider/test_openai_oauth.py",
      "backend/tests/test_provider/test_proxy_auth.py",
      "frontend/src/stores/auth-store.ts",
      "frontend/src/stores/billing-store.ts",
      "frontend/src/lib/proxy-api.ts",
      "frontend/src/lib/workcraft-billing.ts",
      "frontend/src/components/settings/account-tab.tsx",
      "frontend/src/components/settings/recharge-panel.tsx",
      "frontend/src/components/billing/upgrade-prompt.tsx",
      "frontend/src/components/onboarding/onboarding-screen.tsx",
      "frontend/src/i18n/locales/en/billing.json",
      "frontend/src/i18n/locales/zh/billing.json",
    ],
  },
];

function trackedFiles() {
  const out = execFileSync("git", ["ls-files"], { encoding: "utf8" });
  return out.split("\n").filter(Boolean).sort();
}

function matchesPath(file, path) {
  return path.endsWith("/") ? file.startsWith(path) : file === path;
}

function groupMatches(files, paths) {
  return paths.flatMap((path) => {
    const matches = files.filter((file) => matchesPath(file, path));
    return matches.length === 0 ? [] : [{ path, matches }];
  });
}

const files = trackedFiles();
let totalFindings = 0;

console.log(`Open source boundary audit (${strict ? "strict" : "report"} mode)`);
console.log(`Tracked files: ${files.length}`);

for (const group of groups) {
  const findings = groupMatches(files, group.paths);
  totalFindings += findings.reduce((sum, item) => sum + item.matches.length, 0);

  console.log("");
  console.log(`## ${group.name}`);
  console.log(group.description);

  if (findings.length === 0) {
    console.log("No tracked files matched this group.");
    continue;
  }

  for (const finding of findings) {
    const suffix = finding.matches.length === 1 ? "file" : "files";
    console.log(`- ${finding.path} (${finding.matches.length} tracked ${suffix})`);
    for (const file of finding.matches.slice(0, 8)) {
      console.log(`  - ${file}`);
    }
    if (finding.matches.length > 8) {
      console.log(`  - ... ${finding.matches.length - 8} more`);
    }
  }
}

console.log("");
console.log(`Total matched tracked files: ${totalFindings}`);

if (strict && totalFindings > 0) {
  console.error("Strict mode failed: public release blockers are still tracked.");
  process.exit(1);
}
