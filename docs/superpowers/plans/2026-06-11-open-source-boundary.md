# Open Source Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reviewed, machine-checkable boundary file that classifies current repository files as open source core, commercial/private, removable, or requiring license review before the larger split begins.

**Architecture:** This first implementation slice does not remove product code. It adds `OPEN_SOURCE_BOUNDARY.md` as the human-readable source of truth, a small Node.js verifier that reports known commercial/private paths and fails in strict mode, and npm scripts for maintainers to run that verifier. Later plans will use this boundary to remove or extract code by subsystem.

**Tech Stack:** Markdown, Node.js ESM scripts, npm scripts, Git.

---

## File Structure

Create:

- `OPEN_SOURCE_BOUNDARY.md`  
  Human-readable classification of files and directories into `core`, `commercial`, `remove`, and `needs-license-review`.

- `scripts/check-open-source-boundary.mjs`  
  Node.js verifier that reads tracked files with `git ls-files`, checks explicit commercial/remove/license-review path groups, and reports the current split status. By default it reports all findings and exits 0. With `--strict`, it fails if any commercial/remove/license-review path is still tracked.

Modify:

- `package.json`  
  Add `audit:open-source-boundary` and `audit:open-source-boundary:strict` scripts.

No production code changes happen in this plan.

## Boundary Categories

Use these categories consistently:

- `core`: can remain in the public repository.
- `commercial`: move to `workcraft-commercial`.
- `remove`: delete from the public repository and only keep privately if there is a concrete business need.
- `needs-license-review`: block public release until source, license, and notice obligations are resolved.

## Task 1: Add Boundary Document

**Files:**

- Create: `OPEN_SOURCE_BOUNDARY.md`

- [ ] **Step 1: Create the boundary document**

Create `OPEN_SOURCE_BOUNDARY.md` with this exact content:

```markdown
# WorkCraft Open Source Boundary

Status: Draft
Last updated: 2026-06-11

This file classifies the current repository for the open source / commercial
split. It is intentionally conservative: if a path contains commercial service
logic, private release infrastructure, private branding, or third-party content
whose redistribution rights are not clear, it is not classified as public core.

Categories:

- `core`: keep in the public open source repository.
- `commercial`: move to the private `workcraft-commercial` repository.
- `remove`: remove from the public repository; keep privately only if needed.
- `needs-license-review`: block public release until source, license, and notice
  obligations are resolved.

## Core

These areas are intended to remain public after commercial references inside
them are removed or refactored:

```text
backend/app/agent/
backend/app/api/
backend/app/auth/
backend/app/connector/
backend/app/expert/
backend/app/fts/
backend/app/mcp/
backend/app/memory/
backend/app/models/
backend/app/ollama/
backend/app/plugin/
backend/app/provider/
backend/app/scheduler/
backend/app/schemas/
backend/app/session/
backend/app/skill/
backend/app/storage/
backend/app/streaming/
backend/app/tool/
backend/app/utils/
backend/tests/
frontend/src/app/
frontend/src/components/
frontend/src/hooks/
frontend/src/i18n/
frontend/src/lib/
frontend/src/stores/
frontend/src/types/
frontend/tests/
desktop-tauri/
scripts/
docs/
README.md
README.zh-CN.md
CONTRIBUTING.md
SECURITY.md
```

Core code must not import commercial-only modules or require private services to
run.

## Commercial

Move these paths or their commercial behavior to `workcraft-commercial`:

```text
frontend/src/stores/billing-store.ts
frontend/src/lib/workcraft-billing.ts
frontend/src/lib/proxy-api.ts
frontend/src/components/settings/account-tab.tsx
frontend/src/components/settings/recharge-panel.tsx
frontend/src/components/billing/
frontend/src/i18n/locales/en/billing.json
frontend/src/i18n/locales/zh/billing.json
backend/app/provider/proxy_auth.py
backend/app/tool/builtin/vimax_generate_video.py
backend/app/api/vimax.py
backend/app/session/vimax_task_run.py
backend/app/models/vimax_task_run.py
backend/app/tool/builtin/baoyu_common.py
backend/app/tool/builtin/baoyu_image_generate.py
backend/app/tool/builtin/baoyu_publish.py
backend/app/data/plugins/baoyu-skills/
```

Commercial references that remain inside otherwise-core files must be refactored
before public release:

```text
frontend/src/stores/auth-store.ts
frontend/src/components/onboarding/onboarding-screen.tsx
frontend/src/components/settings/providers-tab.tsx
frontend/src/components/layout/sidebar-footer.tsx
backend/app/api/config.py
backend/app/main.py
backend/app/session/processor.py
backend/app/tool/builtin/web_search.py
desktop-tauri/src-tauri/src/lib.rs
```

## Remove From Public

Remove these from the public repository. They are private release, website,
brand, internal planning, or generated-release concerns:

```text
.github/workflows/release.yml
scripts/generate-release-manifests.mjs
scripts/generate-release-manifests.test.mjs
scripts/verify-release-site.mjs
scripts/verify-release-site.test.mjs
scripts/release-workflow.test.mjs
scripts/sign-macos-bundle.sh
docs/release-download-update.md
docs/superpowers/
backend/visual-assets/
design-system/
frontend/public/feedback-wechat.jpg
```

Replace these rather than publishing current branded assets:

```text
frontend/src/components/ui/workcraft-logo.tsx
frontend/public/logo.svg
frontend/public/logo-512.png
frontend/public/favicon.svg
desktop-tauri/src-tauri/icons/
```

## Needs License Review

Do not publish these until redistribution terms and notice obligations are clear:

```text
backend/app/data/plugins/
backend/app/data/skills/
backend/app/data/agency-agents-zh/
backend/app/data/skills_catalog.json
frontend/public/llm-icons/
frontend/public/cmaps/
frontend/public/standard_fonts/
frontend/public/pdf.worker.min.mjs
```

Known plugin directories currently missing a package-level license file:

```text
backend/app/data/plugins/baoyu-skills/
backend/app/data/plugins/design/
backend/app/data/plugins/engineering/
backend/app/data/plugins/human-resources/
backend/app/data/plugins/operations/
```

## Public Release Blockers

Before creating a public repository:

- Pick an open source license and update `LICENSE`, package metadata, and
  README files.
- Remove commercial account, billing, Sub2API, WorkCraft Cloud, and proxy
  provider code from the public tree.
- Disable private updater configuration and remove private release workflows.
- Replace or trademark-restrict brand assets.
- Remove or document all third-party bundled content.
- Add `THIRD_PARTY_NOTICES.md`, `.github/dependabot.yml`, `.github/CODEOWNERS`,
  `CODE_OF_CONDUCT.md`, `GOVERNANCE.md`, and `SUPPORT.md`.
- Publish from a clean Git history or a fully filtered and audited history.

## Verification

Run:

```bash
npm run audit:open-source-boundary
```

For a release candidate tree, run:

```bash
npm run audit:open-source-boundary:strict
```

The non-strict command reports current blockers. The strict command must pass
before a public open source repository is created.
```

- [ ] **Step 2: Verify the file is present**

Run:

```bash
test -f OPEN_SOURCE_BOUNDARY.md && sed -n '1,40p' OPEN_SOURCE_BOUNDARY.md
```

Expected: command exits 0 and prints the heading plus category definitions.

- [ ] **Step 3: Commit**

Do not commit yet if Task 2 will be done in the same changeset. If committing
per task, run:

```bash
git add OPEN_SOURCE_BOUNDARY.md
git commit -m "docs: add open source boundary classification"
```

## Task 2: Add Boundary Audit Script

**Files:**

- Create: `scripts/check-open-source-boundary.mjs`

- [ ] **Step 1: Create the audit script**

Create `scripts/check-open-source-boundary.mjs` with this exact content:

```javascript
#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const strict = process.argv.includes("--strict");

const groups = [
  {
    name: "commercial",
    description: "Move to workcraft-commercial before public release",
    paths: [
      "frontend/src/stores/billing-store.ts",
      "frontend/src/lib/workcraft-billing.ts",
      "frontend/src/lib/proxy-api.ts",
      "frontend/src/components/settings/account-tab.tsx",
      "frontend/src/components/settings/recharge-panel.tsx",
      "frontend/src/components/billing/",
      "frontend/src/i18n/locales/en/billing.json",
      "frontend/src/i18n/locales/zh/billing.json",
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
```

- [ ] **Step 2: Run the script directly**

Run:

```bash
node scripts/check-open-source-boundary.mjs
```

Expected: exit 0. Output starts with:

```text
Open source boundary audit (report mode)
Tracked files:
```

It should report current commercial/remove/license-review/brand-replace matches.

- [ ] **Step 3: Verify strict mode fails on current tree**

Run:

```bash
node scripts/check-open-source-boundary.mjs --strict
```

Expected: exit 1 with:

```text
Strict mode failed: public release blockers are still tracked.
```

- [ ] **Step 4: Commit**

If committing this task separately, run:

```bash
git add scripts/check-open-source-boundary.mjs
git commit -m "chore: add open source boundary audit"
```

## Task 3: Add npm Scripts

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Update root package scripts**

Modify the `scripts` object in `package.json` so it includes these two entries:

```json
{
  "audit:open-source-boundary": "node scripts/check-open-source-boundary.mjs",
  "audit:open-source-boundary:strict": "node scripts/check-open-source-boundary.mjs --strict"
}
```

The resulting `scripts` block should be:

```json
"scripts": {
  "dev:frontend": "cd frontend && npm run dev",
  "dev:backend": "cd backend && ./venv/bin/python -m uvicorn app.main:create_app --factory --reload --reload-dir app --host 0.0.0.0 --port 8000",
  "dev:all": "node scripts/dev-all.mjs",
  "dev:desktop": "node scripts/dev-desktop.mjs",
  "build:frontend": "cd frontend && cross-env DESKTOP_BUILD=true NEXT_PUBLIC_DESKTOP_BUILD=true npm run build",
  "build:backend": "cd backend && node -e \"const p=process.platform==='win32'?'venv/Scripts/pyinstaller':'venv/bin/pyinstaller';require('child_process').execSync(p+' workcraft.spec --noconfirm',{stdio:'inherit'})\"",
  "sync:desktop-meta": "node scripts/sync-desktop-meta.mjs",
  "build:desktop": "npm run sync:desktop-meta && cd desktop-tauri && cargo tauri build",
  "verify:frontend-assets": "node --test scripts/verify-frontend-assets.test.mjs",
  "preflight": "npm run preflight:ui",
  "preflight:ui": "cd frontend && npm run preflight:ui",
  "audit:open-source-boundary": "node scripts/check-open-source-boundary.mjs",
  "audit:open-source-boundary:strict": "node scripts/check-open-source-boundary.mjs --strict"
}
```

- [ ] **Step 2: Run the non-strict npm script**

Run:

```bash
npm run audit:open-source-boundary
```

Expected: exit 0 and print the same report as the direct script.

- [ ] **Step 3: Run the strict npm script**

Run:

```bash
npm run audit:open-source-boundary:strict
```

Expected: exit 1 and print:

```text
Strict mode failed: public release blockers are still tracked.
```

- [ ] **Step 4: Commit**

If committing this task separately, run:

```bash
git add package.json package-lock.json
git commit -m "chore: expose open source boundary audit"
```

If `package-lock.json` did not change, omit it from `git add`.

## Task 4: Final Verification and Single Commit Option

**Files:**

- Verify: `OPEN_SOURCE_BOUNDARY.md`
- Verify: `scripts/check-open-source-boundary.mjs`
- Verify: `package.json`

- [ ] **Step 1: Check working tree**

Run:

```bash
git status --short
```

Expected if using one commit for the whole plan:

```text
 M package.json
?? OPEN_SOURCE_BOUNDARY.md
?? scripts/check-open-source-boundary.mjs
```

Expected if tasks were committed separately: no output.

- [ ] **Step 2: Run boundary audit**

Run:

```bash
npm run audit:open-source-boundary
```

Expected: exit 0 and report current blockers.

- [ ] **Step 3: Run strict audit and confirm it blocks release**

Run:

```bash
npm run audit:open-source-boundary:strict
```

Expected: exit 1 because the current tree still contains commercial/private and
license-review paths. This failure is intentional for this first slice.

- [ ] **Step 4: Commit if not already committed**

Run:

```bash
git add OPEN_SOURCE_BOUNDARY.md scripts/check-open-source-boundary.mjs package.json
git commit -m "chore: add open source boundary audit"
```

- [ ] **Step 5: Confirm final status**

Run:

```bash
git status --short
git log --oneline -n 3
```

Expected: `git status --short` prints no output. The latest commit is:

```text
chore: add open source boundary audit
```

## Follow-Up Plans

After this boundary slice lands, create separate implementation plans for:

1. Removing commercial account/billing/proxy UI and backend routes from public
   core.
2. Moving private release/updater infrastructure to `workcraft-commercial`.
3. Replacing or trademark-restricting brand assets.
4. Auditing and pruning bundled plugins, skills, generated assets, and notices.
5. Creating the private commercial overlay repository and apply script.
