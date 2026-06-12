#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const strict = process.argv.includes("--strict");

const groups = [
  {
    name: "commercial",
    description: "Move to workcraft-commercial before public release",
    paths: [
      "backend/app/provider/proxy_auth.py",
      "backend/app/tool/builtin/vimax_generate_video.py",
      "backend/app/api/vimax.py",
      "backend/app/session/vimax_task_run.py",
      "backend/app/models/vimax_task_run.py",
      "backend/app/tool/builtin/baoyu_common.py",
      "backend/app/tool/builtin/baoyu_image_generate.py",
      "backend/app/tool/builtin/baoyu_publish.py",
      "backend/app/data/plugins/baoyu-skills/",
    ],
  },
  {
    name: "remove",
    description: "Remove from public repository",
    paths: [
      ".github/workflows/release.yml",
      "scripts/generate-release-manifests.mjs",
      "scripts/generate-release-manifests.test.mjs",
      "scripts/verify-release-site.mjs",
      "scripts/verify-release-site.test.mjs",
      "scripts/release-workflow.test.mjs",
      "scripts/sign-macos-bundle.sh",
      "docs/release-download-update.md",
      "docs/superpowers/",
      "backend/visual-assets/",
      "design-system/",
      "frontend/public/feedback-wechat.jpg",
    ],
  },
  {
    name: "needs-license-review",
    description: "Do not publish until license and notice obligations are resolved",
    paths: [
      "backend/app/data/plugins/",
      "backend/app/data/skills/",
      "backend/app/data/agency-agents-zh/",
      "backend/app/data/skills_catalog.json",
      "frontend/public/llm-icons/",
      "frontend/public/cmaps/",
      "frontend/public/standard_fonts/",
      "frontend/public/pdf.worker.min.mjs",
    ],
  },
  {
    name: "brand-replace",
    description: "Replace or trademark-restrict before public release",
    paths: [
      "frontend/src/components/ui/workcraft-logo.tsx",
      "frontend/public/logo.svg",
      "frontend/public/logo-512.png",
      "frontend/public/favicon.svg",
      "desktop-tauri/src-tauri/icons/",
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
