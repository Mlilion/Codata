# Contributing to Codata

Thanks for your interest in improving Codata. This repository is the Apache-2.0 open-source edition of Codata, and focused contributions are welcome.

Please keep contributions aligned with the open-source product boundary:

- Local-first desktop runtime.
- Bring-your-own-model provider setup.
- OpenAI-compatible endpoints, custom endpoints, direct provider adapters, and local Ollama models.
- No hosted account, billing, subscription-only, or cloud proxy assumptions in the open-source flow.

## Development Setup

Follow the Windows PowerShell or macOS/Linux installation commands in
[Quick Start](README.en.md#quick-start). Use the checked-in npm lockfiles (`npm ci`)
and install the Python `dev` extra; add `build` for desktop packaging.

Run the full development stack:

```bash
npm run dev:all
```

See [README.md](README.md) for the full setup and architecture overview.

## Development Workflow

### 1. Pick an Issue

- Check existing issues before opening a new one.
- Keep one pull request focused on one bug, feature, or documentation improvement.
- For broad changes, open an issue first so the design can be discussed.

### 2. Create a Branch

```bash
git checkout -b fix/short-description
git checkout -b feat/short-description
git checkout -b docs/short-description
```

### 3. Make Changes

- Follow the existing frontend, backend, and desktop patterns.
- Keep changes scoped to the area you are improving.
- Add or update tests when behavior changes.
- Update documentation when user-facing behavior changes.
- Do not commit generated local data, virtual environments, secrets, or machine-specific files.

### 4. Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```text
<type>(<scope>): <description>
```

Common types:

| Type | When to use |
| --- | --- |
| `fix` | Bug fix |
| `feat` | New feature |
| `refactor` | Code change that does not fix a bug or add a feature |
| `docs` | Documentation only |
| `test` | Adding or updating tests |
| `chore` | Build, CI, tooling, repository maintenance |
| `perf` | Performance improvement |

Common scopes: `frontend`, `backend`, `desktop`, `experts`, `providers`, `ollama`, `mcp`, `docs`.

Examples:

```bash
git commit -m "fix(frontend): keep selected expert team after refresh"
git commit -m "feat(backend): add expert-team validation for loops"
git commit -m "docs: clarify BYOK provider setup"
```

## Pull Requests

Before opening a pull request:

- Rebase or merge the latest `main`.
- Self-review the diff.
- Remove unrelated edits.
- Run the relevant checks for the files you changed.
- Fill out the pull request template.

Recommended checks:

```bash
npm run verify:open-source-boundary
cd frontend && npm run lint
cd backend && ./venv/bin/pytest
```

On Windows, run `.\backend\venv\Scripts\python.exe -m pytest` from the
repository root instead. Run `npm run audit:open-source-boundary:strict` before
publishing. Changes to release scripts must also pass their Node test suite.

For UI changes, run or update the Playwright tests that cover the changed workflow.

## Code Conventions

### Frontend

- Use TypeScript and functional React components.
- Use Zustand for client state and TanStack Query for server state.
- Follow the existing component and hook structure.
- Keep UI text in the i18n locale files when the surrounding feature is localized.
- Keep open-source provider flows BYOK-oriented.

### Backend

- Use async FastAPI patterns.
- Use Pydantic schemas for API contracts and settings.
- Keep persistence compatible with the existing SQLite-backed local runtime.
- Validate expert-team config changes with focused tests.
- Keep provider routing explicit and user-configured.

### Desktop

- Keep Tauri changes platform-aware.
- Verify desktop metadata synchronization before release builds.
- Do not introduce release signing requirements into normal local development.

## Reporting Bugs

Use the bug report template and include:

1. What happened.
2. Steps to reproduce.
3. Expected behavior.
4. Actual behavior.
5. OS, Codata version, provider route, and whether you are using desktop or browser development mode.
6. Relevant logs or screenshots.

Do not include secrets, API keys, private documents, or sensitive customer data in public issues.

## Requesting Features

Use the feature request template. Explain the problem first, then the proposed solution. For expert-team workflows, include an example task, expected members, expected deliverable, and any provider/tool constraints.

## Project Structure

```text
codata/
├── backend/        FastAPI backend, agent runtime, expert teams, providers, tools
├── frontend/       Next.js 15 desktop UI
├── desktop-tauri/  Tauri v2 desktop shell
├── THIRD_PARTY_NOTICES.md  Bundled component attribution and release checklist
├── scripts/        Build, release, and verification utilities
└── .github/        Issue templates, PR template, labels, workflows
```

## License

By contributing, you agree that your contribution is submitted under the Apache License, Version 2.0. See [LICENSE](LICENSE).

Only contribute code and assets you are authorized to publish. Obtain employer
approval where applicable. Preserve upstream attribution, record dependency and
asset sources, and review [third-party notices](THIRD_PARTY_NOTICES.md).
Do not add proprietary or unlicensed dependencies without a redistribution
grant. A package being downloadable is not permission to redistribute it.

## Release checklist

- Confirm code ownership, employer authorization where applicable, and rights
  to icons, screenshots, templates, and bundled third-party materials.
- Scan the source and Git history for credentials and private data. Rotate
  previously exposed credentials; deleting the latest file is not sufficient.
- Run boundary checks, frontend checks, backend tests, release-script tests, and
  clean Windows and native macOS installer builds. Record any unverified platform.
- Check the installed app's first launch, BYOK setup, user-configured MCP flow,
  downloads, and uninstall behavior without relying on maintainer-local state.
- Inspect the installer for required licenses and notices. Record the actual
  packaged dependency versions, not only development version ranges.
- Keep SQLAlchemy explicitly collected in `backend/codata.spec`, including its
  Python files: platform wheels may omit C extensions, but the bundle verifier
  requires an extracted package directory on every platform.
- The dependency manifests pin Intel macOS to `cryptography==48.0.1`: newer
  releases lack x86_64 wheels, causing source-built OpenSSL to conflict with
  PyInstaller's collected `libssl`. Keep the release-time version assertion and
  backend smoke test when changing this workaround.
- Publish source, Windows, and macOS installers to `Mlilion/Codata`. macOS apps
  and DMGs must be Developer ID signed, notarized, and stapled. Windows installers
  remain unsigned; state this in release notes. The default
  open-source build uses manual updates; do not enable automatic updates until
  maintainers control and verify the endpoint and signing keys.
- Verify the private security-report mailbox is monitored. Do not publish
  support promises that the maintainers cannot meet.

## macOS release signing and notarization

Tag-triggered releases build natively for Apple Silicon and Intel. Both require
the following repository **Actions secrets** (Settings > Secrets and variables >
Actions). Secrets are not copied when a source folder or repository is copied;
configure them in `Mlilion/Codata`. Do not store private keys or passwords in
repository variables, source files, or public logs.

| Secret | Value |
| --- | --- |
| `APPLE_CERTIFICATE` | Base64-encoded `.p12` containing the Developer ID Application certificate and its private key. |
| `APPLE_CERTIFICATE_PASSWORD` | Password used when exporting the `.p12`. |
| `APPLE_SIGNING_IDENTITY` | Full identity, such as `Developer ID Application: Your Name (TEAMID)`. |

Export the certificate and private key from macOS Keychain Access. Obtain the
identity with `security find-identity -v -p codesigning`. Encode the exported file
with `openssl base64 -A -in DeveloperID.p12`; treat the output as a secret.

Also configure **one** notarization credential set:

| Apple ID method | Value |
| --- | --- |
| `APPLE_ID` | Apple Developer account email. |
| `APPLE_PASSWORD` | App-specific password, not the account login password. |
| `APPLE_TEAM_ID` | Developer team ID. |

| App Store Connect API method | Value |
| --- | --- |
| `APPLE_API_ISSUER` | API issuer ID. |
| `APPLE_API_KEY` | API key ID. |
| `APPLE_API_KEY_PRIVATE_KEY` | Full contents of the matching `.p8` private key, including PEM headers and line breaks. |

When both sets are complete, Apple ID credentials take precedence. The workflow
writes the API private key to a temporary file and sets `APPLE_API_KEY_PATH`
itself; do not configure a path to a maintainer's local file on a hosted runner.

The workflow imports the certificate into a temporary keychain, signs bundled
Python/Node native binaries and the app with hardened runtime and timestamps,
submits the app to Apple, staples and validates its ticket, then packages, signs,
notarizes, and staples the DMG. It checks notarization status explicitly and runs
Gatekeeper assessments before uploading artifacts. Signing material is removed
even when a build fails. Missing credentials or rejected notarization fail the
release; there is no unsigned/ad-hoc fallback.

Local development does not require these secrets. Automatic updater signing is
separate and remains disabled. Real signing, Apple submission, and Gatekeeper
validation require macOS and valid credentials; policy and mocked notarization
tests alone do not prove an installer has passed these checks.
