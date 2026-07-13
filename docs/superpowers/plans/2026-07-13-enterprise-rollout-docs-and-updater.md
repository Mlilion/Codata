# Enterprise Rollout: Docs + Desktop Updater Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a full HTML config/usage guide, publish it plus a download page via GitHub Pages, and document the (already-working) desktop auto-update chain — without standing up any self-hosted service.

**Architecture:** Three independently-deliverable components. (A) A new single-file HTML guide `docs/codata-guide.html` reusing the existing guide's visual system. (B) A GitHub Pages static site (`site/`) with a download landing page that fetches the latest `downloads-latest.json` from GitHub Releases at runtime, plus the published guide. (C) Documentation of the existing updater chain inside the guide + README download entry. No changes to the desktop update logic or the release CI build/sign/notarize steps.

**Tech Stack:** Static HTML/CSS/JS (no framework, no build step for the doc/site), GitHub Actions (`actions/deploy-pages`), existing Tauri v2 updater + `release.yml` (unchanged).

## Global Constraints

- Repository: `Mlilion/Codata`. Current app version: `1.1.12` (from `desktop-tauri/src-tauri/tauri.conf.json`).
- Updater endpoint stays GitHub Releases: `https://github.com/Mlilion/Codata/releases/latest/download/latest.json` — do NOT change it.
- Do NOT modify `.github/workflows/release.yml`, `scripts/generate-release-manifests.mjs`, `frontend/src/hooks/use-update-check.ts`, or `desktop-tauri/**` update logic. This plan is docs + Pages only.
- HTML docs must be single-file, inline CSS/JS, openable offline by double-click. No external runtime dependencies except the one runtime `fetch` in the download page (with a fallback link).
- Reuse the existing guide's design tokens verbatim (`:root` custom properties from `docs/codata-office-user-guide.html`) so the new doc reads as one system.
- Keep the existing `docs/codata-office-user-guide.html` (小白版) intact — the new guide is additive.
- Content must reflect verified current behavior only (no invented features). Config facts are grounded in: providers/API key = Settings「模型」(providers-tab), MCP = Settings「插件」tab, datasage connector seed → get MCP Key at `https://datasage.flow.chat/mcp-access`, permissions = Settings「权限」tab, software update = Settings「关于」tab (auto-check 5s after launch + every 4h).
- Language: Chinese (zh-CN), matching existing docs.

---

## Task 1: Full HTML guide — scaffold + design system + navigation shell

**Files:**
- Create: `docs/codata-guide.html`
- Reference (read, do not modify): `docs/codata-office-user-guide.html`

**Interfaces:**
- Consumes: design tokens and layout markup patterns from `docs/codata-office-user-guide.html` (`:root` variables; `.navbar`, `.docs-sidebar`/`#docsSidebar`, `.docs-content`/`#docsContent`, `#docsArticle`, `#docsToc`; the TOC-build/scroll-spy/copy-button `<script>` at end of file).
- Produces: a working doc shell with a left sidebar nav and empty `<section>` anchors that Tasks 2–4 fill in. Section anchor IDs (later tasks depend on these exact IDs): `#intro`, `#install`, `#config`, `#quickstart`, `#interface`, `#prompts`, `#files`, `#automations`, `#updates`, `#faq`, `#admin`.

- [ ] **Step 1: Copy the existing guide as the starting skeleton**

Copy `docs/codata-office-user-guide.html` to `docs/codata-guide.html`. Keep the entire `<style>` block and the end-of-body `<script>` (TOC builder, scroll-spy, copy buttons, print button, mobile nav toggle) verbatim — they are the reusable engine.

- [ ] **Step 2: Update document head**

Set `<title>` to `Codata 使用与配置文档` and the `<meta name="description">` to: `Codata 完整文档:安装、模型与 API Key 配置、MCP 与 datasage 接入、使用、自动更新与管理员发布手册。` Keep the `<link rel="icon">`.

- [ ] **Step 3: Replace the sidebar nav items with the new section list**

In `<aside class="docs-sidebar">`, replace the `.docs-nav-item` anchors with entries pointing to the 11 section IDs listed in Interfaces above. Reuse the existing `<svg class="docs-nav-icon">` markup pattern (pick any icon from the source file per item — visual only). Labels (in order): 产品简介、安装、配置详解、快速上手、界面导览、提示词写法、文件与工作区、自动化任务、软件更新、常见问题、管理员/发布手册. Keep the `#docsToc` "目录" block untouched — it is populated by the existing `buildToc()` script.

- [ ] **Step 4: Replace the article body with empty section anchors**

Inside `<article class="docs-article" id="docsArticle">`, keep the `<header class="doc-hero" id="intro">` hero but update its `<h1>` to `Codata 使用与配置文档` and its intro `<p>` to one sentence describing a complete install→config→use→update guide. After the hero, add 10 empty `<section>` elements, each with one of the remaining IDs (`#install` … `#admin`) and a single `<h2>` placeholder heading matching the sidebar label. Leave section bodies empty (filled by Tasks 2–4).

- [ ] **Step 5: Verify the shell renders and navigation works**

Open `docs/codata-guide.html` in a browser (`open docs/codata-guide.html` on macOS).
Expected: sidebar shows 11 items; clicking each scrolls to its section; the auto-built "目录" (TOC) populates from the `<h2>`s; no console errors; page renders with the same visual style as the 小白版.

- [ ] **Step 6: Commit**

```bash
git add docs/codata-guide.html
git commit -m "docs: scaffold full Codata guide shell with navigation"
```

---

## Task 2: Guide content — product intro, install, quickstart, interface, prompts, files, automations

**Files:**
- Modify: `docs/codata-guide.html` (fill sections `#intro` hero context, `#install`, `#quickstart`, `#interface`, `#prompts`, `#files`, `#automations`)
- Reference (read for accurate copy): `docs/codata-office-user-guide.html`, `README.zh-CN.md`

**Interfaces:**
- Consumes: the section anchors and design classes from Task 1. Reuse existing content components from the 小白版 where equivalent (callout boxes, step lists, `.stat-card`, tables) — copy their class names so styling applies.
- Produces: finished non-config chapters. Task 4's FAQ links back to `#config` and `#updates`; no other cross-task dependency.

- [ ] **Step 1: Fill 产品简介 (`#intro` body after hero)**

Write 2–3 short paragraphs: what Codata is (本地优先的桌面 Data Agent:自然语言问数 → 发现表/指标 → 生成/复用 SQL → 执行 → 结果卡片/图表 → 钉看板/专家团), who it's for, and the analytics loop. Source the loop wording from `README.zh-CN.md` lines under 「Data Agent 工作流」. Use the existing `.callout`/`.stat-card` classes for the highlight.

- [ ] **Step 2: Fill 安装 (`#install`)**

Two subsections with `<h3>`: Windows 与 macOS. State: download from the company download page (link placeholder `站点下载页` → will point to Pages site, Task 3), platforms are Windows (x86_64, NSIS installer `.exe`), macOS Apple Silicon (aarch64) and Intel (x86_64) DMG. Add a callout for macOS first-launch: the app is signed and notarized (per `release.yml`), so it opens normally; if Gatekeeper still warns, right-click → 打开. Minimum macOS 10.15 (from `tauri.conf.json`).

- [ ] **Step 3: Fill 快速上手 (`#quickstart`)**

A numbered `<ol>` "十分钟第一个任务": 打开应用 → 首页输入一个数据问题 → 观察 Agent 发现表/生成 SQL/执行 → 查看结果卡片与图表 → 钉到看板或导出. Reuse the step-list markup from the 小白版's equivalent section. Note that model/API Key must be configured first (link to `#config`).

- [ ] **Step 4: Fill 界面导览 (`#interface`)**

Describe: 左侧会话栏、问答首页/对话页、右侧工作栏与产物面板、设置中心入口. Reuse the 小白版's "界面导览" copy where accurate. Add a compact table of setting tabs matching the real tabs: 模型(providers)、插件/MCP、渠道、权限、记忆、用量、关于. (Verified against `frontend/src/components/settings/` and zh settings i18n.)

- [ ] **Step 5: Fill 提示词写法 (`#prompts`)**

Port the 小白版's "好提示词的四个组成部分"(目标/材料/格式/限制/受众) with a 不推荐 vs 推荐 example pair. Reuse existing example-block markup.

- [ ] **Step 6: Fill 文件与工作区 (`#files`)**

Explain 上传文件 vs 工作区 的使用时机,以及工作区记忆(每个工作区独立、自动从对话生成 — verified from settings memory i18n). Reuse 小白版 copy.

- [ ] **Step 7: Fill 自动化任务 (`#automations`)**

Explain 定时执行 与 循环执行,及创建自动化的推荐流程. Reuse 小白版's automations section copy.

- [ ] **Step 8: Verify all filled sections render**

Open `docs/codata-guide.html`. Expected: each of the 7 sections has real content, TOC shows the `<h3>` subheadings, callouts/tables/step-lists are styled (not unstyled), no broken layout, no console errors.

- [ ] **Step 9: Commit**

```bash
git add docs/codata-guide.html
git commit -m "docs: write intro, install, usage, prompts, files, automations chapters"
```

---

## Task 3: Guide content — 配置详解 (the补齐重点)

**Files:**
- Modify: `docs/codata-guide.html` (fill section `#config`)
- Reference (read for accurate facts): `backend/app/data/connectors.json`, `frontend/src/components/settings/providers-tab.tsx`, `frontend/src/i18n/locales/zh/settings.json`

**Interfaces:**
- Consumes: `#config` anchor from Task 1.
- Produces: the configuration chapter that `#quickstart` and `#faq` link to.

- [ ] **Step 1: Write 模型来源与 API Key subsection**

`<h3>模型来源与 API Key</h3>`. Explain: 在 设置 →「模型」(providers) 配置模型来源;支持配置 API Key 的云端 Provider 与本地 Ollama(verified: `providers-tab.tsx`, `ollama-panel.tsx` exist). Steps: 打开设置 → 模型 → 选择/填写 Provider 与 API Key → 保存。State that this must be done before first query. Use a numbered step list.

- [ ] **Step 2: Write MCP 接入 subsection**

`<h3>MCP 接入</h3>`. Explain MCP 在 设置 →「插件」tab 管理(verified: `tabPlugins` i18n keyword includes "MCP"). Generic steps to add an MCP server (name, URL, optional token) and enable it via toggle.

- [ ] **Step 3: Write datasage 授权 subsection (grounded in connectors.json)**

`<h3>datasage 数据平台授权</h3>`. State the seed connector: 名称「datasage 数据平台」, URL `https://datasage.flow.chat/mcp`. Steps copied faithfully from the connector description: 打开开关后,前往 `https://datasage.flow.chat/mcp-access` 获取你的 MCP Key,填入 Token 输入框完成连接. Add a callout that datasage 走的是 mcp-access 领取 Key 的流程(not the old knowledge-base token flow).

- [ ] **Step 4: Write 权限与工作模式 subsection**

`<h3>权限与工作模式</h3>`. Explain the permission popup (工具执行/文件修改需授权) and 设置 →「权限」tab shows 已记住的权限, 可撤销 (verified from permissions i18n). Describe how to read a permission prompt and the "记住此选择" behavior.

- [ ] **Step 5: Verify config chapter**

Open `docs/codata-guide.html`, jump to 配置详解. Expected: 4 subsections render with correct URLs (`datasage.flow.chat/mcp`, `.../mcp-access`), step lists styled, callouts visible, no console errors.

- [ ] **Step 6: Commit**

```bash
git add docs/codata-guide.html
git commit -m "docs: write configuration chapter (models, MCP, datasage, permissions)"
```

---

## Task 4: Guide content — 软件更新, FAQ, 管理员/发布手册

**Files:**
- Modify: `docs/codata-guide.html` (fill sections `#updates`, `#faq`, `#admin`)
- Reference (read for accurate facts): `frontend/src/hooks/use-update-check.ts`, `desktop-tauri/src-tauri/tauri.conf.json`, `.github/workflows/release.yml`, `scripts/generate-release-manifests.mjs`

**Interfaces:**
- Consumes: `#updates`, `#faq`, `#admin` anchors from Task 1; links to `#config`.
- Produces: the updater/admin documentation that satisfies the spec's "升级链路文档化" requirement.

- [ ] **Step 1: Write 软件更新 (`#updates`)**

State the verified behavior: 自动检查 = 启动后 5 秒 + 每 4 小时(from `use-update-check.ts` constants); 手动检查 = 托盘/菜单「Check for Updates」或 设置 →「关于」tab; 有新版时弹出提示,可下载(带进度)并自动重启安装,或「忽略此版本」. Note updates are signature-verified. Add a callout: 更新来自 GitHub Releases,请确保能访问 github.com.

- [ ] **Step 2: Write 常见问题 (`#faq`)**

An accordion or definition list of at least 6 Q&As (reuse the 小白版's排错 markup if present, else a `<dl>`): (1) 装不上/打不开(macOS 右键打开;Windows WebView2 自动引导); (2) 连不上模型(检查「模型」Provider 与 API Key,link `#config`); (3) datasage 查询失败(检查 mcp-access Key 是否已填,link `#config`); (4) 更新检查失败(需能访问 github.com;可手动去下载页); (5) macOS 提示未验证开发者(应用已公证,右键打开;若仍失败见下载页说明); (6) 忘记/想改已授权权限(设置 →「权限」→ 撤销).

- [ ] **Step 3: Write 管理员/发布手册 (`#admin`)**

Document the real release flow from `release.yml` + `generate-release-manifests.mjs`:
- 发版:推送 `v*` tag → CI 自动构建 Windows(NSIS)与 macOS(arm64/x64,签名+公证)→ 生成 `latest.json`(升级用)与 `downloads-latest.json`(下载页用)→ 发布到 GitHub Release。
- 客户端如何感知:updater 端点 `.../releases/latest/download/latest.json` 永远指向最新 release,发版后客户端自动检查到。
- 清单格式:贴出 `latest.json` 与 `downloads-latest.json` 的字段结构(from spec §四).
- 回滚思路:删除/标记该 release 或重新发布上一个 tag,使 `latest` 指回旧版本。
- 未来迁自有域名(演进,非本次):设置 CI 环境变量 `CODATA_SITE_BASE_URL`(或 `CODATA_RELEASE_ASSET_BASE_URL`)让 manifest 指向自有地址,并同步修改 `tauri.conf.json` 的 `plugins.updater.endpoints`;脚本会额外产出 `release-site/` 目录可直接发布。

- [ ] **Step 4: Verify final guide end-to-end**

Open `docs/codata-guide.html`. Expected: all 11 sections filled; sidebar + TOC navigate correctly; internal links (`#config` from FAQ) jump correctly; `latest.json`/`downloads-latest.json` code blocks render with copy buttons; no console errors; print/PDF still works.

- [ ] **Step 5: Commit**

```bash
git add docs/codata-guide.html
git commit -m "docs: write software-update, FAQ, and admin/release chapters"
```

---

## Task 5: Download landing page (fetches latest release manifest at runtime)

**Files:**
- Create: `site/index.html`
- Reference (read for schema): `scripts/generate-release-manifests.mjs` (the `downloadManifest` shape)

**Interfaces:**
- Consumes: nothing from earlier tasks (standalone page). Reads at runtime: `https://github.com/Mlilion/Codata/releases/latest/download/downloads-latest.json`.
- Produces: `site/index.html`, deployed by Task 6. Links to `guide.html` (published from the guide in Task 6).

- [ ] **Step 1: Create the download page skeleton with inline styles**

Create `site/index.html`: single file, inline `<style>` reusing the same design tokens (`--color-primary: #d97757` etc.) and font stack from `docs/codata-office-user-guide.html`'s `:root`. Layout: centered hero with Codata logo/title, a version line (`#version`), a row of three download cards (`#dl-macos-aarch64`, `#dl-macos-x86_64`, `#dl-windows-x86_64`), a "查看完整文档" button linking to `guide.html`, and a hidden fallback note (`#fallback`).

- [ ] **Step 2: Add runtime fetch script**

Add an inline `<script>` that, on `DOMContentLoaded`, fetches `https://github.com/Mlilion/Codata/releases/latest/download/downloads-latest.json`. On success: set `#version` to `版本 v{version}` and, for each key in `downloads`, set the matching card's link `href = downloads[key].url`, label text = `downloads[key].label`, and filename subtext = `downloads[key].filename`. On failure (network/parse): hide the cards, show `#fallback` with a direct link to `https://github.com/Mlilion/Codata/releases/latest`.

```js
document.addEventListener("DOMContentLoaded", async () => {
  const MANIFEST = "https://github.com/Mlilion/Codata/releases/latest/download/downloads-latest.json";
  const RELEASES = "https://github.com/Mlilion/Codata/releases/latest";
  const map = {
    "macos-aarch64": "dl-macos-aarch64",
    "macos-x86_64": "dl-macos-x86_64",
    "windows-x86_64": "dl-windows-x86_64",
  };
  try {
    const res = await fetch(MANIFEST, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    document.getElementById("version").textContent = `版本 v${data.version}`;
    for (const [key, id] of Object.entries(map)) {
      const d = data.downloads?.[key];
      const el = document.getElementById(id);
      if (d && el) {
        el.href = d.url;
        el.querySelector(".dl-label").textContent = d.label;
        el.querySelector(".dl-file").textContent = d.filename;
      } else if (el) {
        el.remove();
      }
    }
  } catch (e) {
    document.getElementById("cards").style.display = "none";
    const fb = document.getElementById("fallback");
    fb.style.display = "block";
    fb.querySelector("a").href = RELEASES;
  }
});
```

- [ ] **Step 3: Verify locally against the real manifest**

Serve the folder and open the page: `cd site && python3 -m http.server 8099` then open `http://localhost:8099/`.
Expected (if a `downloads-latest.json` exists on the latest release): version line and three download links populate. If no release exists yet OR fetch is blocked, expected: cards hide and the fallback link to the Releases page shows. Confirm no uncaught console errors in either branch.

- [ ] **Step 4: Commit**

```bash
git add site/index.html
git commit -m "feat: download landing page fetching latest release manifest"
```

---

## Task 6: GitHub Pages workflow (publish site + guide)

**Files:**
- Create: `.github/workflows/pages.yml`

**Interfaces:**
- Consumes: `site/index.html` (Task 5) and `docs/codata-guide.html` (Tasks 1–4).
- Produces: a deployed Pages site with `/` (download page) and `/guide.html` (full doc).

- [ ] **Step 1: Write the Pages workflow**

Create `.github/workflows/pages.yml`. Trigger on push to `main` when `site/**` or `docs/codata-guide.html` change, plus `workflow_dispatch`. Build step: assemble a publish dir by copying `site/` contents to the artifact root and copying `docs/codata-guide.html` to `guide.html`. Use official Pages actions.

```yaml
name: Deploy Pages

on:
  push:
    branches: ["main"]
    paths:
      - "site/**"
      - "docs/codata-guide.html"
      - ".github/workflows/pages.yml"
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - name: Assemble publish directory
        run: |
          mkdir -p _site
          cp -R site/. _site/
          cp docs/codata-guide.html _site/guide.html
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: _site
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Validate the workflow YAML**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/pages.yml')); print('valid yaml')"`
Expected: `valid yaml`.

- [ ] **Step 3: Verify assembly logic locally (dry run of the copy step)**

Run:
```bash
rm -rf /tmp/_site && mkdir -p /tmp/_site && cp -R site/. /tmp/_site/ && cp docs/codata-guide.html /tmp/_site/guide.html && ls /tmp/_site
```
Expected: `/tmp/_site` contains `index.html` and `guide.html`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/pages.yml
git commit -m "ci: publish docs and download page to GitHub Pages"
```

- [ ] **Step 5: Note manual enablement (no code)**

Add nothing to code. Record in the PR description that a repo admin must enable Pages with source = "GitHub Actions" (Settings → Pages) once, and that the site URL becomes `https://mlilion.github.io/Codata/` (or the custom domain if configured). The download page's `guide.html` link is relative, so it works under any base path.

---

## Task 7: README download/docs entry

**Files:**
- Modify: `README.zh-CN.md` (add section before `## 快速开始`, line ~145)
- Modify: `README.md` (add section before `## Quick Start`, line ~145)

**Interfaces:**
- Consumes: the Pages site URL from Task 6.
- Produces: discoverable download/docs entry for users landing on the repo.

- [ ] **Step 1: Add 下载与文档 section to README.zh-CN.md**

Insert before `## 快速开始`:
```markdown
## 下载与文档

- 桌面端下载(Windows / macOS):<下载页,GitHub Pages>
- 完整使用与配置文档:<下载页>/guide.html
- 版本发布:https://github.com/Mlilion/Codata/releases

> 桌面端内置自动更新:启动后与每 4 小时自动检查 GitHub Releases 上的新版本,也可在「设置 → 关于」手动检查。
```
Replace `<下载页,GitHub Pages>` with the actual Pages URL once known (e.g. `https://mlilion.github.io/Codata/`).

- [ ] **Step 2: Add Download & Docs section to README.md**

Insert the English equivalent before `## Quick Start` (same three links + the auto-update note).

- [ ] **Step 3: Verify markdown renders**

Run: `grep -n "下载与文档" README.zh-CN.md && grep -n "Download & Docs\|## Download" README.md`
Expected: both sections found. Visually confirm links are well-formed.

- [ ] **Step 4: Commit**

```bash
git add README.md README.zh-CN.md
git commit -m "docs: add download and documentation entry to READMEs"
```

---

## Self-Review Notes

- **Spec coverage:** §3.1 全量文档 → Tasks 1–4. §3.2 Pages 发布 + 下载页方案A → Tasks 5–6. §3.3 升级链路文档化 → Task 4 Step 1/3 + Task 7 note. §四 数据契约 → surfaced verbatim in Task 4 Step 3. README 入口 → Task 7. Verification standards (§5) → each task's verify step.
- **No self-hosting service:** honored — Pages + Releases only; endpoint unchanged (Global Constraints).
- **Type/name consistency:** manifest keys `macos-aarch64` / `macos-x86_64` / `windows-x86_64` and fields `downloads[key].{url,label,filename}` and top-level `version` match `generate-release-manifests.mjs` exactly and are used identically in Task 5's script. Section anchor IDs defined in Task 1 are the same IDs filled in Tasks 2–4.
- **Placeholders:** the Pages URL is a genuine deploy-time unknown (Task 6 Step 5 explains it), not a content gap; Task 7 says how to fill it.
