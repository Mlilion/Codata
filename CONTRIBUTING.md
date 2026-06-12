# Contributing to WorkCraft

WorkCraft is proprietary software. Contributions are accepted only from authorized WorkCraft Inc. employees, contractors, vendors, or other contributors covered by a written agreement with WorkCraft Inc.

If you are not an authorized contributor, do not submit code, patches, pull requests, issues containing confidential material, or derivative work.

## Authorized Development Setup

```bash
# Clone and install
git clone https://github.com/workcraft/desktop.git
cd desktop
npm install
cd backend && pip install -e ".[dev]" && cd ..

# Run full stack
npm run dev:all
```

See [README.md](README.md) for detailed setup instructions.

## Development Workflow

### 1. Pick an Assigned Issue

- Use the internal tracker or repository issue assigned to you.
- Confirm the expected scope before starting broad changes.
- Keep confidential customer, provider, and release material out of public text.

### 2. Create a Branch

```bash
git checkout -b fix/short-description    # for bug fixes
git checkout -b feat/short-description   # for features
git checkout -b refactor/short-description
```

### 3. Make Changes

- Keep changes focused — one issue per PR
- Follow existing code patterns and conventions
- Add tests for bug fixes when possible

### 4. Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Types:**

| Type | When to use |
|------|-------------|
| `fix` | Bug fix |
| `feat` | New feature |
| `refactor` | Code change that doesn't fix a bug or add a feature |
| `docs` | Documentation only |
| `test` | Adding or updating tests |
| `chore` | Build, CI, tooling changes |
| `perf` | Performance improvement |

**Scopes:** `frontend`, `backend`, `desktop`, `ollama`, `mcp`

**Examples:**

```
fix(frontend): prevent duplicate sends on rapid double-click
feat(backend): add per-connector error isolation in MCP startup
refactor(frontend): extract draft persistence into module-level cache
docs: add contributing guide and issue templates
```

**Footer — link issues:**

```
fix(frontend): abort generation when switching sessions

Previously, navigating to a different session during active generation
left the backend agent loop running. Now ChatView calls stopGeneration()
in its cleanup effect.

Fixes #42
```

### 5. Submit a Pull Request

- Fill out the [PR template](.github/pull_request_template.md)
- Link the assigned issue with `Fixes #N` where applicable
- Ensure checks pass:
  - `npx tsc --noEmit` (TypeScript)
  - `pytest` (Backend tests)

### 6. Code Review

- Respond to review comments
- Keep the PR up to date with `main` via rebase
- Once approved, a maintainer will merge

## Code Conventions

### Frontend (TypeScript / React)

- Functional components with hooks
- Zustand for client state, TanStack Query for server state
- Tailwind CSS for styling (no CSS modules)
- `useRef` for synchronous guards (not `useState`)
- Module-level state for cross-mount persistence (not localStorage for ephemeral data)

### Backend (Python / FastAPI)

- Async everywhere (aiosqlite, async sessions)
- Pydantic for schemas and settings
- Follow existing error handling patterns (try/catch per operation, log + continue)
- ULID primary keys
- SQLAlchemy async ORM

### General

- No over-engineering — solve the problem at hand
- Prefer editing existing files over creating new ones
- Keep PRs small and focused
- Comments only where the logic isn't self-evident

## Reporting Bugs

Authorized contributors should use the Bug Report template. A good bug report includes:

1. Clear description of what happened
2. Steps to reproduce
3. Expected vs actual behavior
4. Environment info (OS, version, provider)

## Requesting Features

Authorized contributors should use the Feature Request template. Explain the problem before the solution — understanding *why* helps us design the right approach.

## Project Structure

```
desktop/
├── backend/        Python FastAPI — agent engine
├── frontend/       Next.js 15 — chat UI
├── desktop-tauri/  Tauri v2 (Rust) — desktop shell
├── .github/        Issue templates, PR template, labels
├── ISSUES.md       Internal issue tracker (being migrated to GitHub Issues)
├── CLAUDE.md       AI assistant context
└── CONTRIBUTING.md This file
```

## License

By contributing, you agree that your contribution is submitted under your written agreement with WorkCraft Inc. and may be used, modified, sublicensed, commercialized, and redistributed by WorkCraft Inc. without restriction.

No contribution grants you rights to WorkCraft proprietary software except as separately agreed in writing. See [LICENSE](LICENSE) for the project terms.
