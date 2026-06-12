# WorkCraft Open Source / Commercial Split Design

Date: 2026-06-11
Status: Draft for review

## Goal

Split the current WorkCraft codebase into a clean open source core and a private
commercial layer without leaking commercial code, release infrastructure, private
branding, or third-party content whose redistribution rights are not yet clear.

The open source repository must be independently useful. A contributor should be
able to clone it, install dependencies, run the backend, run the frontend, and
build a local desktop app without any WorkCraft Cloud account, Sub2API account,
private website, private updater endpoint, or commercial plugin.

The commercial repository should layer on top of the open source core to produce
the branded WorkCraft desktop product with account, billing, updater, signing,
private deployment, and commercial integrations.

## Non-Goals

- Do not make the commercial service itself open source.
- Do not keep commercial code in a public branch and rely on developers to avoid
  merging it.
- Do not publish the current full Git history until commercial and proprietary
  files have been removed from history.
- Do not redesign the product UI beyond removing or replacing commercial-only
  surfaces required for a clean open source release.

## Recommended Approach

Use two repositories:

```text
workcraft/              public open source core
workcraft-commercial/   private commercial extensions, branding, and release
```

The public repository is the source of truth for core app development. The
private repository consumes the public repository and applies commercial
extensions during commercial development and release builds.

This is preferred over long-lived `open-source` and `commercial` branches in one
repository because branch-based separation makes accidental leakage much easier:
commercial files remain in one Git object database, tags can point to the wrong
tree, and merges/rebases become high-risk operational steps.

## Repository Roles

### Public `workcraft`

The public repository contains:

- Tauri desktop shell for local development and unsigned community builds.
- Next.js frontend for local-first chat, settings, artifacts, plugins, skills,
  MCP, automations, and provider configuration.
- FastAPI backend for sessions, agent runtime, tools, storage, providers,
  Ollama, MCP, memory, scheduler, plugins, and local auth.
- BYOK and local providers only.
- Generic release/build scripts that do not deploy to private infrastructure.
- Public docs, contribution guide, security policy, third-party notices, and
  governance files.

The public repository must not require:

- WorkCraft Cloud.
- Sub2API.
- WorkCraft account login.
- Paid credits, subscriptions, or recharge flows.
- `work-craft.com`.
- Private update manifests.
- Apple signing or website SSH deploy secrets.
- Proprietary brand assets whose use is not licensed to downstream users.

### Private `workcraft-commercial`

The private repository contains:

- WorkCraft Cloud account and billing integration.
- Sub2API auth/key proxy integration, if still used commercially.
- WorkCraft proxy provider and commercial routing policy.
- Recharge, credits, subscription, checkout, account status, and upgrade UI.
- Branded logo, icons, feedback QR/image, trademark docs, and marketing assets.
- Private updater endpoint, signing settings, release manifest generation, and
  website deploy workflow.
- Commercial-only tools and integrations such as ViMax and Baoyu wrappers.
- Overlay scripts that apply commercial files to a checked-out public core.

## Public Core Boundary

Keep these areas in the public repository, after removing commercial branches
inside them:

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
frontend/src/app/
frontend/src/components/
frontend/src/hooks/
frontend/src/i18n/
frontend/src/lib/
frontend/src/stores/
frontend/src/types/
desktop-tauri/
scripts/
docs/
```

Core code can reference extension points, but it must not import private modules
or fail when private modules are absent.

## Commercial / Private Boundary

Move these files and features to the private repository, or delete them from the
public core if they are not needed commercially anymore.

### Account, Billing, Credits, and Cloud Proxy

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
```

Also remove or refactor commercial logic from:

```text
frontend/src/stores/auth-store.ts
frontend/src/components/onboarding/onboarding-screen.tsx
frontend/src/components/settings/providers-tab.tsx
frontend/src/components/layout/sidebar-footer.tsx
backend/app/api/config.py
backend/app/main.py
backend/app/session/processor.py
backend/app/tool/builtin/web_search.py
```

Open source behavior:

- No WorkCraft account login.
- No Sub2API auth proxy.
- No `/proxy-auth/*` or `/proxy-keys/*` routes.
- No `workcraft-proxy` provider.
- No credits, recharge, subscription, checkout, or paid upgrade prompts.
- Official model routing is replaced by BYOK provider setup and local Ollama.

Commercial behavior:

- Reintroduce account, billing, subscription, credits, and proxy routes through a
  commercial plugin or overlay.
- Commercial provider registration happens only when the commercial extension is
  installed.

### Private Release and Updater Infrastructure

Move to the private repository:

```text
.github/workflows/release.yml
scripts/generate-release-manifests.mjs
scripts/generate-release-manifests.test.mjs
scripts/verify-release-site.mjs
scripts/verify-release-site.test.mjs
scripts/release-workflow.test.mjs
scripts/sign-macos-bundle.sh
docs/release-download-update.md
```

Refactor public files:

```text
desktop-tauri/src-tauri/tauri.conf.json
frontend/src/hooks/use-update-check.ts
frontend/src/components/desktop/update-banner.tsx
docs/workcraft-user-manual.html
docs/workcraft-office-user-guide.html
```

Open source behavior:

- Disable Tauri updater by default.
- About/update UI points to GitHub Releases, or hides update checks.
- GitHub Actions build and test code only.
- No SSH deploy to `/opt/workcraft`.
- No `work-craft.com` release, download, or update endpoint.
- No required Apple notarization secrets in public workflows.

Commercial behavior:

- Commercial overlay injects updater endpoint, public key, signing scripts, and
  release workflow.
- Commercial releases publish signed artifacts and manifests to private
  infrastructure.

### Branding and Product Assets

Move or replace:

```text
frontend/src/components/ui/workcraft-logo.tsx
frontend/public/logo.svg
frontend/public/logo-512.png
frontend/public/favicon.svg
frontend/public/feedback-wechat.jpg
desktop-tauri/src-tauri/icons/
backend/visual-assets/
design-system/
```

Refactor docs and source strings containing:

```text
WorkCraft Inc.
work-craft.com
api.work-craft.com
support@waxis.org
```

Open source behavior:

- Use neutral default logo and desktop icons, or keep the name with explicit
  trademark restrictions.
- Delete private feedback QR/image.
- Use GitHub Issues/Discussions for support links.
- Add `TRADEMARKS.md` if the WorkCraft name/logo are retained but not freely
  licensed as trademarks.

Commercial behavior:

- Commercial overlay restores official brand assets and support/contact links.

### Commercial Tools and Third-Party Bundles

Move to the private repository until license and service terms are reviewed:

```text
backend/app/tool/builtin/vimax_generate_video.py
backend/app/api/vimax.py
backend/app/session/vimax_task_run.py
backend/app/models/vimax_task_run.py
backend/app/tool/builtin/baoyu_common.py
backend/app/tool/builtin/baoyu_image_generate.py
backend/app/tool/builtin/baoyu_publish.py
backend/app/data/plugins/baoyu-skills/
```

Review before keeping public:

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

Open source behavior:

- Only ship third-party skills/plugins with clear redistributable licenses.
- Generate PDF.js worker/CMaps/fonts during install/build rather than tracking
  generated copies, unless the license and notice obligations are documented.
- Add `THIRD_PARTY_NOTICES.md` and keep it current.

Commercial behavior:

- Commercial-only skill bundles can remain private.
- Commercial product can include additional notices and attribution files.

## Extension Mechanism

The public core should expose small extension points rather than hard-coding
commercial imports.

Recommended extension points:

1. Provider extension registration.
   - Public core registers built-in BYOK/local providers.
   - Commercial plugin registers `workcraft-proxy` and account-aware routing.

2. Settings navigation extension.
   - Public core owns `General`, `Providers`, `Ollama`, `Memory`, `Plugins`,
     `About`.
   - Commercial plugin adds `Account`, `Billing`, and `Recharge`.

3. Backend router extension.
   - Public core mounts built-in routers.
   - Commercial plugin can mount `/api/commercial/*` or explicitly named cloud
     routes.

4. Tool registry extension.
   - Public core registers safe built-in tools.
   - Commercial plugin registers ViMax/Baoyu tools.

5. Branding extension.
   - Public core has neutral assets.
   - Commercial overlay replaces `frontend/public` and Tauri icons at build
     time.

Short-term implementation can use overlay file copies. Long-term implementation
should prefer explicit plugin APIs where the extension surface is stable.

## Private Repository Layout

```text
workcraft-commercial/
  README.md
  package.json
  plugins/
    workcraft-cloud/
      backend/
      frontend/
      manifest.json
    billing/
      backend/
      frontend/
      manifest.json
    vimax/
      backend/
      manifest.json
    baoyu-tools/
      backend/
      data/
      manifest.json
  branding/
    workcraft/
      frontend-public/
      tauri-icons/
      docs/
      TRADEMARKS.md
  release/
    github-actions/
      release.yml
    scripts/
      generate-release-manifests.mjs
      verify-release-site.mjs
      sign-macos-bundle.sh
  overlays/
    backend/
    frontend/
    desktop-tauri/
  scripts/
    apply-overlay.mjs
    check-core-version.mjs
```

Commercial build flow:

```bash
git clone git@github.com:your-org/workcraft.git
git clone git@github.com:your-org/workcraft-commercial.git
cd workcraft-commercial
npm run apply-overlay ../workcraft
cd ../workcraft
npm run build:desktop
```

The overlay script must fail if it would overwrite a public-core file that has
changed incompatibly since the commercial overlay was last updated.

## Git Strategy

### Public Repository

Create a new public repository with clean history:

```bash
git init workcraft
cd workcraft
git remote add origin git@github.com:your-org/workcraft.git
git branch -M main
```

Do not push the current full repository history publicly unless it has been
filtered and audited. Deleted files remain recoverable from Git history.

Recommended public branch policy:

- `main` protected.
- Pull requests required.
- CI required before merge.
- No force-push.
- Secret scanning enabled.
- Dependabot enabled.
- CODEOWNERS enforced for sensitive areas.

### Private Commercial Repository

```bash
git init workcraft-commercial
cd workcraft-commercial
git remote add origin git@github.com:your-org/workcraft-commercial.git
git branch -M main
```

The private repository may consume the public repository in one of three ways:

1. Clone sibling checkout and apply overlay. Recommended for the first phase.
2. Git submodule pointing at the public repository. Useful if commercial CI
   needs to pin exact core commits.
3. Package-based consumption after core APIs stabilize.

Use explicit core version tracking in the private repository:

```text
CORE_COMMIT
```

or:

```json
{
  "workcraftCore": "github:your-org/workcraft#<commit>"
}
```

## Public `.gitignore` Additions

Add these patterns to the public repository:

```gitignore
# Commercial overlays
commercial/
workcraft-commercial/
.overlays/
.branding/
.private-release/

# Local secrets and credentials
.env
.env.*
!.env.example
*.pem
*.key
*.p12
*.mobileprovision
session_token.json
backend/session_token.json
backend/.workcraft/
.workcraft/

# Generated release assets
release-site/
artifacts/
*.sig
*.dmg
*.exe
*.msi
*.AppImage
*.deb
*.rpm
*.tar.gz

# Generated vendor assets
frontend/public/pdf.worker.min.mjs
frontend/public/cmaps/
frontend/public/standard_fonts/
backend/resources/nodejs/
```

If generated assets are already tracked, remove them from Git while keeping the
ignore rules:

```bash
git rm -r --cached frontend/public/cmaps frontend/public/standard_fonts
git rm --cached frontend/public/pdf.worker.min.mjs
```

Only do this after confirming the build or postinstall step regenerates them.

## CI and Release

### Public CI

Run on pull requests and pushes to `main`:

- Backend tests.
- Frontend type check.
- Frontend lint.
- Frontend production dependency audit.
- Rust `cargo check`.
- Secret scan.
- License/notice check for bundled third-party content.
- Build smoke for frontend export and desktop config.

Public release:

- Draft GitHub Release only.
- Upload unsigned or community-signed artifacts if desired.
- No website deploy.
- No private update manifest.
- No Apple certificate requirement.

### Commercial CI

Run in the private repository:

- Check out pinned public core.
- Apply commercial overlay.
- Run full public test suite plus commercial tests.
- Build signed desktop artifacts.
- Generate updater manifests.
- Deploy to private website/update infrastructure.
- Verify public download/update endpoints if commercial release is public.

## Migration Plan

### Phase 0: Freeze and Audit

- Freeze non-critical product changes while the split is planned.
- Tag the current private state as an internal reference.
- Run a full secret scan on the full history.
- Decide the open source license.
- Produce an `OPEN_SOURCE_BOUNDARY.md` with file-level classification:
  `core`, `commercial`, `remove`, `needs-license-review`.

### Phase 1: Create Public Core Branch Locally

- Remove commercial UI entry points.
- Remove commercial backend routes and provider registration.
- Disable updater by default.
- Replace brand assets with neutral assets or add trademark restrictions.
- Remove private release workflows and private docs.
- Move unclear third-party bundles to `needs-license-review` or private repo.
- Ensure the app runs without private services.

### Phase 2: Create Commercial Repository

- Move removed commercial files into `workcraft-commercial`.
- Add overlay/apply scripts.
- Add commercial tests for account, billing, proxy provider, updater, and branded
  build.
- Add `CORE_COMMIT` tracking.

### Phase 3: Stabilize Public Developer Experience

- Update README and setup docs.
- Add `CODE_OF_CONDUCT.md`, `GOVERNANCE.md`, `SUPPORT.md`,
  `THIRD_PARTY_NOTICES.md`, `.github/dependabot.yml`, and `.github/CODEOWNERS`.
- Verify a clean clone can install, test, and run.
- Fix dependency audit issues that block public release.

### Phase 4: Publish

- Create a new public repository with clean history.
- Push the cleaned public tree.
- Enable branch protection and GitHub security settings.
- Publish the first open source release.
- Keep commercial release tags in the private repository unless the artifact is
  intentionally public.

## Verification Gates

Before publishing the public repository:

```bash
git status --short
npm audit --omit=dev
cd frontend && npm ci --legacy-peer-deps && npx tsc --noEmit && npm run lint && npm audit --omit=dev
cd ../backend && python3.12 -m venv .venv && .venv/bin/pip install -e ".[dev,mcp]" && .venv/bin/python -m pytest -q && .venv/bin/python -m pip check
cd ../desktop-tauri/src-tauri && cargo check
rg -n "work-craft\\.com|api\\.work-craft\\.com|Sub2API|billing|recharge|TAURI_SIGNING_PRIVATE_KEY|APPLE_CERTIFICATE|support@waxis\\.org"
```

Any remaining matches in the final `rg` command must be either intentional
documentation in a migration note or removed before publication.

Before commercial release:

```bash
git -C ../workcraft rev-parse HEAD
npm run check-core-version
npm run apply-overlay ../workcraft
npm run test
npm run build:desktop
```

## Risks and Mitigations

### Git History Leakage

Risk: deleting a file does not remove it from history.

Mitigation: publish a new clean-history public repository. If preserving history
is required, use `git filter-repo` and run an independent secret/proprietary
content audit before pushing.

### Commercial Drift

Risk: commercial overlay breaks as public core evolves.

Mitigation: pin `CORE_COMMIT`, run private CI on every core update, and keep
extension points small and explicit.

### License Gaps

Risk: bundled plugins, skills, fonts, icons, generated assets, or copied JS have
unclear redistribution terms.

Mitigation: classify all bundled third-party files before publishing. Remove or
privatize anything without a clear license. Maintain `THIRD_PARTY_NOTICES.md`.

### Community Confusion

Risk: users see account/billing docs or dead commercial references in the public
repository.

Mitigation: remove commercial UI, docs, and routes from public core. Document
commercial extensions separately in the private repository.

### Security Boundary Confusion

Risk: tools such as `bash` and `code_execute` are mistaken for sandboxed
execution.

Mitigation: document that the app is a local trusted assistant. Keep permission
gates visible. Avoid describing in-process Python execution as a security
sandbox.

## First Implementation Slice

The first implementation slice should not delete business logic immediately.
Instead, add `OPEN_SOURCE_BOUNDARY.md` and classify files. That reduces the
chance of accidental removal and gives maintainers one shared checklist.

Recommended classifications:

- `core`: keep in public repository.
- `commercial`: move to private repository.
- `remove`: delete from both public and commercial outputs.
- `needs-license-review`: block public release until license/source is resolved.

After the boundary file is reviewed, proceed with code removal and commercial
repository creation in separate commits.
