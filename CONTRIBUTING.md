# Contributing to WorkCraft

Thanks for your interest in improving WorkCraft. This repository is the Apache-2.0 open-source edition of WorkCraft, and focused contributions are welcome.

Please keep contributions aligned with the open-source product boundary:

- Local-first desktop runtime.
- Bring-your-own-model provider setup.
- OpenAI-compatible endpoints, custom endpoints, direct provider adapters, and local Ollama models.
- No hosted account, billing, subscription-only, or cloud proxy assumptions in the open-source flow.

## Development Setup

```bash
git clone https://github.com/Mlilion/workcraft.git
cd workcraft

npm install
cd frontend && npm install --legacy-peer-deps
cd ..

cd backend
python3.12 -m venv venv
./venv/bin/pip install -e ".[dev]"
cd ..
```

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
5. OS, WorkCraft version, provider route, and whether you are using desktop or browser development mode.
6. Relevant logs or screenshots.

Do not include secrets, API keys, private documents, or sensitive customer data in public issues.

## Requesting Features

Use the feature request template. Explain the problem first, then the proposed solution. For expert-team workflows, include an example task, expected members, expected deliverable, and any provider/tool constraints.

## Project Structure

```text
workcraft/
├── backend/        FastAPI backend, agent runtime, expert teams, providers, tools
├── frontend/       Next.js 15 desktop UI
├── desktop-tauri/  Tauri v2 desktop shell
├── docs/           User manuals
├── scripts/        Build, release, and verification utilities
└── .github/        Issue templates, PR template, labels, workflows
```

## License

By contributing, you agree that your contribution is submitted under the Apache License, Version 2.0. See [LICENSE](LICENSE).
