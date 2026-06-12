# WorkCraft

[简体中文](README.zh-CN.md)

WorkCraft is a desktop AI workspace for file-grounded work. It combines a Tauri desktop shell, a Next.js user interface, and a FastAPI backend so users can bring local files, long conversations, model providers, tools, and generated artifacts into one local application.

## Scope

The repository contains the application code and release tooling for the WorkCraft desktop product:

- Desktop packaging and native integration through Tauri v2.
- Chat, settings, artifact, provider, plugin, automation, and workspace UI through Next.js.
- Agent orchestration, streaming, file processing, storage, tool execution, provider routing, memory, MCP connectors, plugins, and automation support through FastAPI.
- Build and verification utilities used for the desktop app.

WorkCraft is intended to be a local workbench, not a thin hosted chat wrapper. Files, conversations, settings, memory, and generated artifacts are stored locally by default. Cloud model calls are sent only to the selected provider path.

## Architecture

```text
User
  -> Tauri desktop shell
  -> Next.js frontend
  -> FastAPI backend
  -> agent runtime, tools, storage, providers, connectors
```

The desktop shell owns native installation, desktop permissions, updater integration, bundled resources, and platform-specific behavior. The frontend owns the interactive product surface: chat, artifacts, activity, settings, model/provider selection, memory, plugins, automations, remote access, and workspace panels. The backend owns the agent loop, resumable SSE streaming, file parsing, tool execution, local persistence, provider adapters, MCP integration, memory extraction, and scheduled jobs.

## Repository Layout

```text
desktop-tauri/    Tauri v2 desktop shell, Rust integration, updater config
frontend/         Next.js UI for chat, settings, artifacts, and desktop screens
backend/          FastAPI backend, agent runtime, storage, model/provider layer
scripts/          Build, release, verification, signing, and version utilities
docs/             Internal product, release, and implementation documentation
design-system/    Product design references and internal design assets
```

## Runtime Capabilities

WorkCraft supports these product surfaces when configured:

- File understanding for DOCX, XLSX, PPTX, PDF, CSV, local project files, and generated artifacts.
- Multi-step agent workflows with tool calls, permission gates, planning, context compression, and resumable streaming.
- Provider routing for BYOK providers, OpenAI-compatible endpoints, and local Ollama models.
- Local SQLite-backed persistence for sessions, messages, memory, settings, usage data, and workflow metadata.
- Artifact rendering for structured outputs such as Markdown, code, diagrams, tables, office documents, and previews.
- MCP connectors, bundled skills, plugins, messaging channels, remote access, and scheduled automations where enabled.

## Data Boundary

WorkCraft stores user data locally by default. This includes conversations, files, generated artifacts, settings, memory, and workflow metadata. When a cloud model or external connector is selected, WorkCraft sends the prompt context and required payload to that provider or connector. Users and operators are responsible for choosing provider routes and deployment settings that match their security, privacy, and compliance requirements.

## Prerequisites

Use versions compatible with the current application stack:

- Node.js compatible with Next.js 15. Node.js 20 or newer is recommended.
- Python 3.12 or newer for the backend.
- Rust and Cargo for Tauri desktop builds.
- Platform-specific Tauri build prerequisites for macOS, Windows, or Linux.
- Signing and notarization credentials when producing signed release artifacts.

## Setup

Install root and frontend dependencies:

```bash
npm install
cd frontend && npm install --legacy-peer-deps
```

Create the backend virtual environment expected by the root scripts:

```bash
cd backend
python3.12 -m venv venv
./venv/bin/pip install -e ".[dev]"
cd ..
```

Configure environment files and provider credentials as needed. Local development can run without every provider configured, but model calls require a configured provider route or a local Ollama model.

## Development

Run the full development stack from the repository root:

```bash
npm run dev:all
```

Useful commands:

```bash
npm run dev:frontend
npm run dev:backend
npm run dev:desktop
```

The frontend development server uses port `3000`. The backend development server uses port `8000`. Desktop development starts the Tauri shell against the local frontend and backend stack.

## Build and Verification

Common build and verification commands:

```bash
npm run build:frontend
npm run build:backend
npm run sync:desktop-meta
npm run build:desktop
npm run verify:frontend-assets
npm run preflight:ui
```

The desktop release build expects the exported frontend in `frontend/out` and the bundled backend in `backend/dist/workcraft-backend`. Run `npm run sync:desktop-meta` before desktop builds so Tauri metadata matches the root package version.

## Release Checklist

Before publishing a desktop build:

- Verify frontend static assets are present and referenced correctly.
- Verify the PyInstaller backend bundle is complete and executable.
- Verify Tauri metadata, application version, updater metadata, and release manifests are synchronized.
- Verify macOS signing and notarization credentials before producing signed macOS artifacts.
- Verify Windows and Linux artifacts use the expected installer formats and architecture targets.
- Verify download and updater manifests point to the intended public artifacts.

## Contribution Policy

Contribution rules are still being prepared for the open-source repository. Do not publish this repository until `CONTRIBUTING.md` and the public contribution policy are updated.

## Third-Party Components

This repository includes third-party dependencies, plugins, bundled skills, generated assets, and provider SDKs that may be governed by their own license terms. Review and document those terms before publishing a public release.

## License

A final open-source license has not been selected yet. See [LICENSE](LICENSE).
