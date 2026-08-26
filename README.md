# Codata

<div align="center">
  <img src="frontend/public/logo.svg" width="96" alt="Codata" />

  <h3>Local-first Data Agent for natural-language analytics, SQL, charts, dashboards, and expert-team workflows</h3>

  <p>
    <a href="README.zh-CN.md">简体中文</a>
  </p>

  <p><sub>Ask data questions. Inspect the SQL. Pin charts. Turn analysis into reusable work.</sub></p>
</div>

Codata is a company-internal desktop Data Agent workspace. It connects a local desktop app, a Next.js interface, and a FastAPI agent backend so analysts and business teams can ask questions in natural language, let the agent discover tables and metric definitions, run SQL, render result cards, create charts, and pin useful outputs into dashboards.

The product is designed around a practical analytics loop:

```text
Ask a data question
  -> discover tables / metrics
  -> generate or reuse SQL
  -> execute against the connected data platform
  -> inspect results, SQL, and charts
  -> pin charts to dashboards or escalate to an expert team
```

## Highlights

- **Natural-language data analysis**: ask questions such as "compare paid conversion by channel" or "find the biggest drop this week".
- **Data-source aware agent flow**: the Data Agent is prompted to inspect schemas, search registered metrics, avoid invented tables or columns, run SQL, and fix query errors.
- **SQL result cards**: query results render as structured artifacts with table, SQL, and chart-ready metadata.
- **Metric caliber discipline**: core business metrics should prefer registered indicator definitions; custom SQL caliber is made explicit when no verified metric exists.
- **Dashboards**: pin chart results into named dashboards, rename items, reorder layouts, and refresh pinned SQL-backed cards.
- **Expert teams for deeper analysis**: reusable multi-agent teams can split work across data discovery, SQL, attribution, visualization, and reporting specialists.
- **Local-first desktop runtime**: conversations, settings, dashboards, memory, artifacts, and workflow metadata are stored locally by default.
- **Bring your own models**: configure OpenAI-compatible providers, custom endpoints, direct provider adapters, or local Ollama models.
- **Extensible tools and connectors**: MCP, skills, plugins, file tools, report generation, and desktop integrations are available where configured.

<details>
<summary><kbd>Table of Contents</kbd></summary>

- [Data Agent Workflow](#data-agent-workflow)
- [Core Capabilities](#core-capabilities)
- [Dashboards and Artifacts](#dashboards-and-artifacts)
- [Expert Teams](#expert-teams)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Development Commands](#development-commands)
- [Repository Layout](#repository-layout)
- [Data Boundary](#data-boundary)
- [Internal Development Notes](#internal-development-notes)

</details>

## Data Agent Workflow

Codata is focused on data work rather than generic chat. In Codata mode, the assistant is expected to:

1. Understand the user's analytical intent.
2. Discover available tables, fields, and metric definitions through the connected data platform.
3. Prefer registered metric calculation rules for core business indicators.
4. Write SQL only after schema and caliber are clear.
5. Run the query through the data execution tool.
6. Repair SQL when the data platform returns errors.
7. Explain results with concrete numbers, caveats, and the SQL behind the answer.
8. Produce charts, dashboards, or reports when the result should be reused.

The current data platform integration is built around a datasage-compatible MCP connection. When no data source is connected, Codata guides the user to connect a data source before attempting live analysis.

## Core Capabilities

### Natural-language querying

Users can describe the question in business language. Codata turns that request into a data workflow: schema inspection, metric lookup, SQL generation, execution, and explanation.

### SQL and result inspection

SQL-backed outputs are not hidden behind prose. Result cards preserve the query result, SQL text, columns, rows, and chart metadata so users can inspect how the answer was produced.

### Metric and caliber awareness

For core metrics such as DAU, GMV, conversion rate, retention, revenue, or cost, Codata is designed to look for registered indicator definitions before hand-writing SQL. If no registered metric exists, the answer should label the calculation as a custom caliber.

### Charts and dashboards

Codata can render chart-ready data artifacts and pin useful results into dashboards. Dashboard items store a snapshot of the SQL result and can refresh through the connected data execution path when possible.

### Analysis memory

Codata stores structured analysis memory locally so recurring topics, metric preferences, and user conventions can inform later data sessions.

### Files and reports

The desktop runtime can read local files such as CSV, Excel, PDFs, documents, and workspace files. Data analysis can be turned into Markdown, HTML, office files, code artifacts, or dashboard panels depending on the selected workflow.

## Dashboards and Artifacts

Codata separates daily analytical Q&A from reusable outputs:

- **Inline result cards** are useful for one-off exploration.
- **Pinned dashboard charts** are useful for repeat monitoring and comparison.
- **Generated reports** are useful when an analysis needs to be shared or preserved as a snapshot.
- **Artifact panels** make generated files, HTML, code, and previews visible alongside the conversation.

## Expert Teams

Expert teams are Codata's orchestration layer for complex analysis. A team is a structured configuration with members, tasks, dependencies, context policies, tools, and a finalization rule.

For data work, an expert team can divide a complex request into roles such as:

- data discovery and schema inspection
- metric caliber verification
- SQL execution and correction
- attribution or anomaly analysis
- chart specification
- report writing and final delivery

Codata supports three execution modes:

| Mode | Best for | How it works |
| --- | --- | --- |
| `sequential` | Linear analysis workflows | Runs tasks in order. |
| `workflow` | Fixed dependency graphs | Builds a DAG and runs dependency-ready tasks. |
| `hierarchical` | Open-ended investigations | A manager agent delegates work to specialists and synthesizes the final answer. |

## Architecture

```text
User
  -> Tauri desktop shell
  -> Next.js frontend
  -> FastAPI backend
  -> agent runtime, data tools, dashboards, expert teams, storage, providers, MCP
```

- **Tauri desktop shell**: native packaging, desktop permissions, updater integration, bundled resources, and platform-specific behavior.
- **Next.js frontend**: Codata workspace, chat, data result cards, dashboards, expert teams, artifacts, settings, plugins, and activity panels.
- **FastAPI backend**: agent loop, resumable streaming, datasage/MCP tool integration, SQL execution wrapper, dashboard refresh, expert-team orchestration, file parsing, SQLite persistence, provider routing, and scheduled jobs.

## Download & Docs

- Desktop download (Windows / macOS): https://github.com/Mlilion/Codata-releases/releases/latest
- Releases: https://github.com/Mlilion/Codata-releases/releases

> The desktop app auto-updates: it checks GitHub Releases for new versions on launch and every 4 hours, and you can also check manually from Settings → About.

## Quick Start

### Prerequisites

- Node.js 20 or newer.
- Python 3.12 or newer.
- Rust and Cargo for Tauri desktop builds.
- Platform-specific Tauri prerequisites for macOS, Windows, or Linux.
- A configured model provider, OpenAI-compatible endpoint, custom endpoint, or local Ollama model.
- A datasage-compatible MCP data source for live database analysis.

### Install dependencies

```bash
git clone <internal-repository-url>
cd codata

npm install
cd frontend && npm install --legacy-peer-deps
cd ..

cd backend
python3.12 -m venv venv
./venv/bin/pip install -e ".[dev]"
cd ..
```

### Run the development stack

```bash
npm run dev:all
```

The frontend development server uses port `3000`. The backend development server uses port `8000`. Desktop development starts the Tauri shell against the local frontend and backend stack.

## Development Commands

```bash
npm run dev:frontend
npm run dev:backend
npm run dev:desktop

npm run build:frontend
npm run build:backend
npm run sync:desktop-meta
npm run build:desktop
```

Verification commands:

```bash
npm run verify:open-source-boundary
npm run verify:frontend-assets
npm run preflight:ui
```

The desktop release build expects the exported frontend in `frontend/out` and the bundled backend in `backend/dist/codata-backend`. Run `npm run sync:desktop-meta` before desktop builds so Tauri metadata matches the root package version.

## Repository Layout

```text
desktop-tauri/    Tauri v2 desktop shell and Rust integration
frontend/         Next.js UI for Codata workspace, chat, dashboards, expert teams, settings, and artifacts
backend/          FastAPI backend, agent runtime, data tools, expert orchestration, storage, and providers
scripts/          Build, release, verification, signing, and version utilities
docs/             Internal design notes and project documentation
design-system/    Product design references and visual assets
```

## Data Boundary

Codata stores conversations, dashboard state, generated artifacts, settings, memories, and workflow metadata locally by default. When users choose a cloud model or external connector, the relevant prompt context and payload are sent to that configured provider or connector.

For database work, Codata depends on the connected data platform and its permissions. Users are responsible for choosing provider routes, model access, data-source permissions, SQL safety rules, connector scopes, and deployment settings that fit their privacy and compliance requirements.

## Internal Development Notes

Use the internal issue, branch, review, and release process for changes. Before merging, run the verification commands that match the area you changed, and pay special attention to data-source permissions, model-provider routing, SQL safety, and what context may leave the local machine. See [Security Policy](SECURITY.md) for security handling expectations.
