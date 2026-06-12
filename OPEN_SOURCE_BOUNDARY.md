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
