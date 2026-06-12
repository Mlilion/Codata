# ClawHub / OpenClaw Publishing

## OpenClaw Metadata

Skills include `metadata.openclaw` in YAML front matter:

```yaml
metadata:
  openclaw:
    homepage: https://github.com/JimLiu/baoyu-skills#<skill-name>
    requires:          # only for skills with scripts
      anyBins:
        - bun
        - npx
```

## Publishing Commands

```bash
bash scripts/sync-clawhub.sh           # sync all skills
bash scripts/sync-clawhub.sh <skill>   # sync one skill
```

Release hooks are configured via `.releaserc.yml`. This repo does not stage a separate release directory: publish reads the skill directory directly and validates that local package references and CLI bin targets are self-contained.

Every skill release must keep the `version:` in that skill's `SKILL.md` aligned with the version being published. `publish-skill.mjs` and `sync-clawhub.mjs` both reject mismatches so a registry payload cannot ship with stale skill metadata.

Commits that touch `skills/<name>/**` must use Conventional Commit subjects, for example `fix(baoyu-post-to-wechat): handle WeChat editor focus`. CI runs `npm run verify:skill-release-commits` against the pushed or PR commit range so bare subjects like `Fix WeChat browser article publishing` cannot bypass per-skill release versioning silently.

## Shared Workspace Packages

`packages/` is the source of truth for shared runtime code. Most skills consume shared packages from npm with semver ranges. `baoyu-url-to-markdown` is the exception: it vendors the `baoyu-fetch` runtime into `skills/baoyu-url-to-markdown/scripts/lib/` so the published skill is self-contained and does not depend on the `baoyu-fetch` npm package.

Current packages:
- `baoyu-chrome-cdp` (Chrome CDP utilities), consumed by 5 skills (`baoyu-danger-gemini-web`, `baoyu-danger-x-to-markdown`, `baoyu-post-to-wechat`, `baoyu-post-to-weibo`, `baoyu-post-to-x`)
- `baoyu-md` (shared Markdown rendering and placeholder pipeline), consumed by 3 skills (`baoyu-markdown-to-html`, `baoyu-post-to-wechat`, `baoyu-post-to-weibo`)
- `baoyu-fetch` (URL-to-Markdown CLI), vendored into 1 skill (`baoyu-url-to-markdown`)

**How it works**: npm packages are built from `packages/` and published to the public npm registry. Skills normally depend on those packages with `^<version>` specs. Release prep runs `node scripts/verify-shared-package-deps.mjs` so accidental `file:` dependencies cannot slip back in. For vendored skill runtimes, keep the copied code under the skill directory and run `node scripts/publish-skill.mjs --skill-dir <skill> --version <version> --dry-run` before publishing.

**Update workflow**:
1. Edit package under `packages/`
2. Run the package build, e.g. `bun run --cwd packages/baoyu-md build`
3. Publish the changed npm package with `npm publish --access public`
4. Update consuming skill `package.json` semver ranges if the package version changed
5. Run `node scripts/verify-shared-package-deps.mjs`

**Git hook**: Run `node scripts/install-git-hooks.mjs` once to enable the `pre-push` hook. It blocks pushes when a skill uses a local `file:` dependency or a vendored workspace package.
