# WorkCraft Brand Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace WorkCraft branding with WorkCraft across all code, configuration, and documentation files (excluding icons/images).

**Architecture:** Systematic string replacement across frontend, backend, and Tauri desktop app. Preserve LICENSE file, Sub2API-related code, and CHANGELOG historical entries.

**Tech Stack:** Next.js 15 (frontend), FastAPI (backend), Tauri v2 (desktop), Zustand (state management)

---

## File Structure

### Files to Modify

**Frontend (frontend/src):**
- `stores/auth-store.ts` - localStorage key `workcraft-auth`
- `stores/settings-store.ts` - localStorage key `workcraft-settings`, `workcraft-language`
- `stores/sidebar-store.ts` - localStorage key `workcraft-sidebar`
- `stores/appearance-store.ts` - localStorage key `workcraft-appearance`
- `lib/constants.ts` - localStorage keys, model IDs, token prefix
- `hooks/use-chat.ts` - localStorage key `workcraft-drafts`
- `hooks/use-models.ts` - provider references
- `components/ui/workcraft-logo.tsx` → rename to `workcraft-logo.tsx`
- `components/layout/splash-screen.tsx` - `AnimatedWorkCraftLogo`
- `components/desktop/title-bar.tsx` - `WorkCraftLogo`
- `app/layout.tsx` - title
- `components/layout/session-item.tsx` - deep link
- `components/settings/general-tab.tsx` - localStorage key
- `components/settings/providers-tab.tsx` - imports, provider mode
- Multiple activity/panel files with `WorkCraftLogo` imports

**Backend (backend):**
- `app/auth/token.py` - token prefixes `workcraft_st_`, `workcraft_rt_`
- `app/auth/middleware.py` - realm `"workcraft"`
- `app/config.py` - database path `workcraft.db`
- `app/main.py` - title, provider_id
- `app/provider/openrouter.py` - HTTP-Referer headers, virtual model ID
- `app/provider/registry.py` - aggregator provider ID
- `app/skill/registry.py` - `.workcraft` directory
- `app/plugin/__init__.py` - `.workcraft` directory
- `run.py` - description
- `pyproject.toml` - package metadata
- `workcraft.spec` → rename to `workcraft.spec`

**Tauri (desktop-tauri):**
- `src-tauri/tauri.conf.json` - productName, identifier, deep link scheme, resources path
- `src-tauri/Cargo.toml` - package name, description
- `src-tauri/capabilities/default.json` - description
- `package.json` - package name
- Build configs: `build.*.json` - backend path

**Root:**
- `package.json` - name, description

**Documentation:**
- `README.md` - brand name, GitHub links, domain
- `README.zh-CN.md` - same
- `LINUX.md` - brand name, commands
- `CONTRIBUTING.md` - GitHub links (remove)
- `SECURITY.md` - GitHub links (remove)
- `DESIGN.md` - brand name

### Files to Create
- `frontend/src/components/ui/workcraft-logo.tsx` (renamed from workcraft-logo.tsx)
- `backend/workcraft.spec` (renamed from workcraft.spec)

### Files to Preserve (No Changes)
- `LICENSE` - keep original author attribution
- Any file with `Sub2API` references (external service)
- `CHANGELOG.md` historical entries (keep original brand in past entries)

---

### Task 1: Frontend localStorage Keys Replacement

**Files:**
- Modify: `frontend/src/stores/auth-store.ts`
- Modify: `frontend/src/stores/settings-store.ts`
- Modify: `frontend/src/stores/sidebar-store.ts`
- Modify: `frontend/src/stores/appearance-store.ts`
- Modify: `frontend/src/hooks/use-chat.ts`
- Modify: `frontend/src/hooks/use-models.ts`
- Modify: `frontend/src/lib/constants.ts`
- Modify: `frontend/src/components/settings/general-tab.tsx`

- [ ] **Step 1: Replace localStorage key in auth-store.ts**

Edit line 72 in `frontend/src/stores/auth-store.ts`:

```typescript
// Change from:
name: "workcraft-auth",
// Change to:
name: "workcraft-auth",
```

- [ ] **Step 2: Replace localStorage keys in settings-store.ts**

Edit line 175 and 182 in `frontend/src/stores/settings-store.ts`:

```typescript
// Change from:
localStorage.setItem("workcraft-language", lang);
// Change to:
localStorage.setItem("workcraft-language", lang);

// Change from:
name: "workcraft-settings",
// Change to:
name: "workcraft-settings",
```

- [ ] **Step 3: Replace localStorage key in sidebar-store.ts**

Edit line 86 in `frontend/src/stores/sidebar-store.ts`:

```typescript
// Change from:
name: "workcraft-sidebar",
// Change to:
name: "workcraft-sidebar",
```

- [ ] **Step 4: Replace localStorage key in appearance-store.ts**

Edit line 87 in `frontend/src/stores/appearance-store.ts`:

```typescript
// Change from:
name: "workcraft-appearance",
// Change to:
name: "workcraft-appearance",
```

- [ ] **Step 5: Replace localStorage key in use-chat.ts**

Edit line 43 in `frontend/src/hooks/use-chat.ts`:

```typescript
// Change from:
const DRAFT_STORAGE_KEY = "workcraft-drafts";
// Change to:
const DRAFT_STORAGE_KEY = "workcraft-drafts";
```

- [ ] **Step 6: Replace localStorage key in use-models.ts**

Edit line 49 in `frontend/src/hooks/use-models.ts`:

```typescript
// Change from:
Cached in localStorage as workcraft_remote_provider after first fetch.
// Change to:
Cached in localStorage as workcraft_remote_provider after first fetch.
```

- [ ] **Step 7: Replace localStorage key in constants.ts**

Edit the query keys section in `frontend/src/lib/constants.ts`:

```typescript
// Change from:
workcraftAccount: ["workcraftAccount"] as const,
// Change to:
workcraftAccount: ["workcraftAccount"] as const,
```

- [ ] **Step 8: Replace localStorage key in general-tab.tsx**

Edit line 183 in `frontend/src/components/settings/general-tab.tsx`:

```typescript
// Change from:
localStorage.setItem("workcraft-language", value);
// Change to:
localStorage.setItem("workcraft-language", value);
```

- [ ] **Step 9: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors related to the changes

- [ ] **Step 10: Commit localStorage key changes**

```bash
git add frontend/src/stores/*.ts frontend/src/hooks/use-chat.ts frontend/src/hooks/use-models.ts frontend/src/lib/constants.ts frontend/src/components/settings/general-tab.tsx
git commit -m "refactor(frontend): replace workcraft localStorage keys with workcraft"

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

### Task 2: Backend Token Prefix Replacement

**Files:**
- Modify: `backend/app/auth/token.py`
- Modify: `backend/app/auth/middleware.py`

- [ ] **Step 1: Replace token prefixes in token.py**

Edit lines 32-33 and 122 in `backend/app/auth/token.py`:

```python
# Change from:
_REMOTE_PREFIX = "workcraft_rt_"
_SESSION_PREFIX = "workcraft_st_"
# Change to:
_REMOTE_PREFIX = "workcraft_rt_"
_SESSION_PREFIX = "workcraft_st_"

# Change from:
raise ValueError("Session token override must use workcraft_st_ prefix")
# Change to:
raise ValueError("Session token override must use workcraft_st_ prefix")
```

Also update docstring on line 1:

```python
# Change from:
"""Token generation, storage, and validation for WorkCraft's local API.
# Change to:
"""Token generation, storage, and validation for WorkCraft's local API.
```

- [ ] **Step 2: Replace realm in middleware.py**

Edit line 292 in `backend/app/auth/middleware.py`:

```python
# Change from:
[b"www-authenticate", b'Bearer realm="workcraft"'],
# Change to:
[b"www-authenticate", b'Bearer realm="workcraft"'],
```

- [ ] **Step 3: Verify Python syntax**

Run: `cd backend && python -m py_compile app/auth/token.py app/auth/middleware.py`
Expected: No syntax errors

- [ ] **Step 4: Commit token prefix changes**

```bash
git add backend/app/auth/token.py backend/app/auth/middleware.py
git commit -m "refactor(backend): replace workcraft token prefixes with workcraft"

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

### Task 3: Backend Config Paths Replacement

**Files:**
- Modify: `backend/app/config.py`
- Modify: `backend/app/skill/registry.py`
- Modify: `backend/app/plugin/__init__.py`

- [ ] **Step 1: Replace database path in config.py**

Edit line 58 in `backend/app/config.py`:

```python
# Change from:
database_url: str = "sqlite+aiosqlite:///./data/workcraft.db"
# Change to:
database_url: str = "sqlite+aiosqlite:///./data/workcraft.db"
```

- [ ] **Step 2: Replace .workcraft directory references in skill/registry.py**

Edit lines 15, 23-27, 75, 176-177 in `backend/app/skill/registry.py`:

```python
# Change from:
_WORKCRAFT_SKILL_DIR = ".workcraft"
# Change to:
_WORKCRAFT_SKILL_DIR = ".workcraft"

# Change from:
# 2. Global user skills  (~/.workcraft/skills/)
# Change to:
# 2. Global user skills  (~/.workcraft/skills/)

# Change from:
# 4. Project-level .workcraft/skills (highest priority)
# Change to:
# 4. Project-level .workcraft/skills (highest priority)

# Change from:
return Path(self._project_dir).resolve() / ".workcraft" / "skills.disabled.json"
return Path.home() / ".workcraft" / "skills.disabled.json"
# Change to:
return Path(self._project_dir).resolve() / ".workcraft" / "skills.disabled.json"
return Path.home() / ".workcraft" / "skills.disabled.json"
```

- [ ] **Step 3: Replace .workcraft directory references in plugin/__init__.py**

Edit lines 4-5, 26-27, 36, 42, 71, 78 in `backend/app/plugin/__init__.py`:

```python
# Change from:
Users can add more in ``.workcraft/plugins/`` (project-level) or
``~/.workcraft/plugins/`` (global) — later sources override earlier ones.
# Change to:
Users can add more in ``.workcraft/plugins/`` (project-level) or
``~/.workcraft/plugins/`` (global) — later sources override earlier ones.

# Change from:
global_dir = Path.home() / ".workcraft" / "plugins"
project_plugins = Path(project_dir).resolve() / ".workcraft" / "plugins"
# Change to:
global_dir = Path.home() / ".workcraft" / "plugins"
project_plugins = Path(project_dir).resolve() / ".workcraft" / "plugins"
```

- [ ] **Step 4: Commit backend path changes**

```bash
git add backend/app/config.py backend/app/skill/registry.py backend/app/plugin/__init__.py
git commit -m "refactor(backend): replace workcraft data paths with workcraft"

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

### Task 4: Provider ID and Model ID Replacement

**Files:**
- Modify: `backend/app/provider/openrouter.py`
- Modify: `backend/app/provider/registry.py`
- Modify: `backend/app/main.py`
- Modify: `frontend/src/lib/constants.ts`
- Modify: `frontend/src/components/settings/providers-tab.tsx`
- Modify: `frontend/src/hooks/use-models.ts`
- Modify: `frontend/src/components/selectors/header-model-dropdown.tsx`

- [ ] **Step 1: Replace provider ID and headers in openrouter.py**

Edit lines 31, 60-61, 176-179, 218-220, 243 in `backend/app/provider/openrouter.py`:

```python
# Change virtual model ID:
# From:
"workcraft/best-free": ("openrouter/free", "Craft Free"),
# To:
"workcraft/best-free": ("openrouter/free", "Craft Free"),

# Remove HTTP-Referer headers (or replace with workcraft.com if needed):
# From:
"HTTP-Referer": "https://github.com/workcraft/desktop",
"X-Title": "WorkCraft",
# To (remove these lines entirely for private product):
# Delete both header lines

# Change provider_id check:
# From:
if self._provider_id == "workcraft-proxy":
# To:
if self._provider_id == "workcraft-proxy":

# Change docstring line 3:
# From:
Primary provider for WorkCraft. Uses OpenAI-compatible API at
# To:
Primary provider for WorkCraft. Uses OpenAI-compatible API at
```

- [ ] **Step 2: Replace aggregator provider in registry.py**

Edit lines 18, 23-24 in `backend/app/provider/registry.py`:

```python
# Change from:
_AGGREGATOR_PROVIDERS = {"openrouter", "workcraft-proxy"}
# Change to:
_AGGREGATOR_PROVIDERS = {"openrouter", "workcraft-proxy"}

# Change from:
if provider_id == "workcraft-proxy":
    return 2
# Change to:
if provider_id == "workcraft-proxy":
    return 2
```

- [ ] **Step 3: Replace provider_id in main.py**

Edit lines 127, 300, 603 in `backend/app/main.py`:

```python
# Change from:
provider_id="workcraft-proxy",
# Change to:
provider_id="workcraft-proxy",

# Change from:
title="WorkCraft",
# Change to:
title="WorkCraft",

# Update docstring references to .workcraft:
# Change from:
# Agent registry (built-in + custom agents from config / .workcraft/agents/*.md)
# Plugin loader (Claude knowledge-work-plugins → WorkCraft registries)
# To:
# Agent registry (built-in + custom agents from config / .workcraft/agents/*.md)
# Plugin loader (Claude knowledge-work-plugins → WorkCraft registries)
```

- [ ] **Step 4: Replace provider references in frontend constants.ts**

Edit `frontend/src/lib/constants.ts`:

```typescript
// Change query key:
// From:
workcraftAccount: ["workcraftAccount"] as const,
// To:
workcraftAccount: ["workcraftAccount"] as const,
```

- [ ] **Step 5: Replace provider mode references in providers-tab.tsx**

Edit multiple lines in `frontend/src/components/settings/providers-tab.tsx`:

```typescript
// Change provider mode type and default (lines 43-45):
// From:
type ProviderMode = "workcraft" | "byok" | "chatgpt" | "ollama" | "local" | "custom";
() => (activeProvider as ProviderMode) ?? "workcraft"
// To:
type ProviderMode = "workcraft" | "byok" | "chatgpt" | "ollama" | "local" | "custom";
() => (activeProvider as ProviderMode) ?? "workcraft"

// Change setActiveProvider calls:
// From:
setActiveProvider("workcraft");
// To:
setActiveProvider("workcraft");

// Change model lookup (line 163-166):
// From:
return models.find((m) => !["workcraft-proxy", "openai-subscription", "ollama"].includes(m.provider_id)) ?? null;
if (mode === "workcraft") {
  return models.find((m) => m.provider_id === "workcraft-proxy") ?? null;
}
// To:
return models.find((m) => !["workcraft-proxy", "openai-subscription", "ollama"].includes(m.provider_id)) ?? null;
if (mode === "workcraft") {
  return models.find((m) => m.provider_id === "workcraft-proxy") ?? null;
}

// Change mode label (line 427):
// From:
{ mode: "workcraft" as ProviderMode, label: t('workcraftAccount'), icon: Eye, connected: authStore.isConnected },
// To:
{ mode: "workcraft" as ProviderMode, label: t('workcraftAccount'), icon: Eye, connected: authStore.isConnected },
```

- [ ] **Step 6: Replace provider references in header-model-dropdown.tsx**

Edit `frontend/src/components/selectors/header-model-dropdown.tsx`:

```typescript
// Change ARENA_PROVIDERS (line 68):
// From:
const ARENA_PROVIDERS = new Set<string | null>(["workcraft"]);
// To:
const ARENA_PROVIDERS = new Set<string | null>(["workcraft"]);

// Change VARIANT_AWARE_PROVIDERS (lines 88-89):
// From:
const VARIANT_AWARE_PROVIDERS = new Set<string | null>(["workcraft"]);
// To:
const VARIANT_AWARE_PROVIDERS = new Set<string | null>(["workcraft"]);

// Change activeProvider check (line 154-155):
// From:
if (activeProvider === "workcraft") {
  const preferred = visibleModels.find((m) => m.id === "workcraft/best-free");
// To:
if (activeProvider === "workcraft") {
  const preferred = visibleModels.find((m) => m.id === "workcraft/best-free");

// Change model pin (line 182):
// From:
if (m.id === "workcraft/best-free" && activeProvider === "workcraft") pinned = m;
// To:
if (m.id === "workcraft/best-free" && activeProvider === "workcraft") pinned = m;
```

- [ ] **Step 7: Verify compilation**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 8: Commit provider ID changes**

```bash
git add backend/app/provider/openrouter.py backend/app/provider/registry.py backend/app/main.py frontend/src/lib/constants.ts frontend/src/components/settings/providers-tab.tsx frontend/src/components/selectors/header-model-dropdown.tsx frontend/src/hooks/use-models.ts
git commit -m "refactor: replace workcraft-proxy provider ID with workcraft-proxy"

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

### Task 5: Tauri Desktop App Branding Replacement

**Files:**
- Modify: `desktop-tauri/src-tauri/tauri.conf.json`
- Modify: `desktop-tauri/src-tauri/Cargo.toml`
- Modify: `desktop-tauri/src-tauri/capabilities/default.json`
- Modify: `desktop-tauri/src-tauri/build.macos-x64.json`
- Modify: `desktop-tauri/src-tauri/build.macos-aarch64.json`
- Modify: `desktop-tauri/src-tauri/build.linux-x64.json`
- Modify: `desktop-tauri/src-tauri/build.windows.json`
- Modify: `desktop-tauri/package.json`

- [ ] **Step 1: Replace branding in tauri.conf.json**

Edit `desktop-tauri/src-tauri/tauri.conf.json`:

```json
// Change productName (line 3):
// From:
"productName": "WorkCraft",
// To:
"productName": "WorkCraft",

// Change identifier (line 4):
// From:
"identifier": "com.workcraft.desktop",
// To:
"identifier": "com.workcraft.desktop",

// Change window title (line 16):
// From:
"title": "WorkCraft",
// To:
"title": "WorkCraft",

// Change resources path (line 53):
// From:
"../../backend/dist/workcraft-backend": "backend",
// To:
"../../backend/dist/workcraft-backend": "backend",

// Change deep link scheme (line 88):
// From:
"schemes": ["workcraft"]
// To:
"schemes": ["workcraft"]

// Change updater endpoint (line 95):
// From:
"https://work-craft.com/update/latest.json"
// To:
"https://work-craft.com/update/latest.json"
```

- [ ] **Step 2: Replace branding in Cargo.toml**

Edit `desktop-tauri/src-tauri/Cargo.toml`:

```toml
# Change package name (line 2):
# From:
name = "workcraft-desktop"
# To:
name = "workcraft-desktop"

# Change description (line 4):
# From:
description = "WorkCraft — Your local AI assistant"
# To:
description = "WorkCraft — Your local AI assistant"

# Change lib name (line 9):
# From:
name = "workcraft_desktop_lib"
# To:
name = "workcraft_desktop_lib"
```

- [ ] **Step 3: Replace description in capabilities/default.json**

Edit `desktop-tauri/src-tauri/capabilities/default.json`:

```json
// Change description (line 4):
// From:
"description": "Default capabilities for WorkCraft desktop",
// To:
"description": "Default capabilities for WorkCraft desktop",
```

- [ ] **Step 4: Replace backend path in build configs**

Edit all build.*.json files:

```json
// In build.macos-x64.json (line 8):
// From:
"../../backend/dist-x86_64/workcraft-backend": "backend",
// To:
"../../backend/dist-x86_64/workcraft-backend": "backend",

// In build.macos-aarch64.json (line 8):
// From:
"../../backend/dist/workcraft-backend": "backend",
// To:
"../../backend/dist/workcraft-backend": "backend",

// In build.linux-x64.json (line 8):
// From:
"../../backend/dist/workcraft-backend": "backend",
// To:
"../../backend/dist/workcraft-backend": "backend",

// In build.windows.json (line 8):
// From:
"../../backend/dist/workcraft-backend": "backend",
// To:
"../../backend/dist/workcraft-backend": "backend",
```

- [ ] **Step 5: Replace package name in desktop-tauri/package.json**

Edit `desktop-tauri/package.json`:

```json
// Change name (line 2):
// From:
"name": "workcraft-desktop-tauri",
// To:
"name": "workcraft-desktop-tauri",
```

- [ ] **Step 6: Commit Tauri branding changes**

```bash
git add desktop-tauri/src-tauri/tauri.conf.json desktop-tauri/src-tauri/Cargo.toml desktop-tauri/src-tauri/capabilities/default.json desktop-tauri/src-tauri/build.*.json desktop-tauri/package.json
git commit -m "refactor(tauri): replace WorkCraft branding with WorkCraft"

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

### Task 6: Frontend Logo Component Renaming

**Files:**
- Rename: `frontend/src/components/ui/workcraft-logo.tsx` → `frontend/src/components/ui/workcraft-logo.tsx`
- Modify: `frontend/src/components/layout/splash-screen.tsx`
- Modify: `frontend/src/components/desktop/title-bar.tsx`
- Modify: `frontend/src/app/(main)/layout.tsx`
- Modify: `frontend/src/components/settings/billing-tab.tsx`
- Modify: `frontend/src/components/settings/providers-tab.tsx`
- Modify: `frontend/src/components/activity/activity-panel.tsx`
- Modify: `frontend/src/components/activity/activity-summary.tsx`
- Modify: `frontend/src/components/parts/reasoning-part.tsx`
- Modify: `frontend/src/components/onboarding/onboarding-screen.tsx`

- [ ] **Step 1: Rename workcraft-logo.tsx to workcraft-logo.tsx**

```bash
git mv frontend/src/components/ui/workcraft-logo.tsx frontend/src/components/ui/workcraft-logo.tsx
```

- [ ] **Step 2: Update component content in workcraft-logo.tsx**

Edit `frontend/src/components/ui/workcraft-logo.tsx`:

```typescript
// Change interface name:
// From:
interface WorkCraftLogoProps {
// To:
interface WorkCraftLogoProps {

// Change function name:
// From:
export function WorkCraftLogo({ size = 20, className }: WorkCraftLogoProps) {
// To:
export function WorkCraftLogo({ size = 20, className }: WorkCraftLogoProps) {

// Change alt text:
// From:
alt="WorkCraft"
// To:
alt="WorkCraft"
```

- [ ] **Step 3: Update AnimatedWorkCraftLogo in splash-screen.tsx**

Edit `frontend/src/components/layout/splash-screen.tsx`:

```typescript
// Change function name (line 12):
// From:
export function AnimatedWorkCraftLogo({ size = 80 }: { size?: number }) {
// To:
export function AnimatedWorkCraftLogo({ size = 80 }: { size?: number }) {

// Change alt text (line 18):
// From:
alt="WorkCraft"
// To:
alt="WorkCraft"
```

- [ ] **Step 4: Update WorkCraftLogo in title-bar.tsx**

Edit `frontend/src/components/desktop/title-bar.tsx`:

```typescript
// Change function name (line 11):
// From:
function WorkCraftLogo() {
// To:
function WorkCraftLogo() {

// Change alt text (line 17):
// From:
alt="WorkCraft"
// To:
alt="WorkCraft"

// Change function call (line 73):
// From:
<WorkCraftLogo />
// To:
<WorkCraftLogo />

// Change text (line 75):
// From:
WorkCraft
// To:
WorkCraft
```

- [ ] **Step 5: Update imports and usage in all files**

Update imports in all affected files:

```typescript
// In frontend/src/app/(main)/layout.tsx:
// Change import:
// From:
import { WorkCraftLogo } from "@/components/ui/workcraft-logo";
// To:
import { WorkCraftLogo } from "@/components/ui/workcraft-logo";
// Change usage:
// From:
<WorkCraftLogo size={18} />
// To:
<WorkCraftLogo size={18} />

// In frontend/src/components/settings/billing-tab.tsx:
// Change import:
// From:
import { WorkCraftLogo } from "@/components/ui/workcraft-logo";
// To:
import { WorkCraftLogo } from "@/components/ui/workcraft-logo";
// Change usage:
// From:
<WorkCraftLogo size={40} .../>
// To:
<WorkCraftLogo size={40} .../>

// In frontend/src/components/settings/providers-tab.tsx:
// Change import:
// From:
import { WorkCraftLogo } from "@/components/ui/workcraft-logo";
// To:
import { WorkCraftLogo } from "@/components/ui/workcraft-logo";
// Change usage:
// From:
<WorkCraftLogo size={20} />
// To:
<WorkCraftLogo size={20} />

// In frontend/src/components/activity/activity-panel.tsx:
// Change import:
// From:
import { WorkCraftLogo } from "@/components/ui/workcraft-logo";
// To:
import { WorkCraftLogo } from "@/components/ui/workcraft-logo";
// Change usage:
// From:
<WorkCraftLogo size={14} .../>
// To:
<WorkCraftLogo size={14} .../>

// In frontend/src/components/activity/activity-summary.tsx:
// Change import:
// From:
import { WorkCraftLogo } from "@/components/ui/workcraft-logo";
// To:
import { WorkCraftLogo } from "@/components/ui/workcraft-logo";
// Change usage:
// From:
<WorkCraftLogo size={14} />
// To:
<WorkCraftLogo size={14} />

// In frontend/src/components/parts/reasoning-part.tsx:
// Change import:
// From:
import { WorkCraftLogo } from "@/components/ui/workcraft-logo";
// To:
import { WorkCraftLogo } from "@/components/ui/workcraft-logo";
// Change usage:
// From:
<WorkCraftLogo size={14} .../>
// To:
<WorkCraftLogo size={14} .../>

// In frontend/src/components/onboarding/onboarding-screen.tsx:
// Change import:
// From:
import { AnimatedWorkCraftLogo } from "@/components/layout/splash-screen";
// To:
import { AnimatedWorkCraftLogo } from "@/components/layout/splash-screen";
// Change usage:
// From:
<AnimatedWorkCraftLogo size={80} />
// To:
<AnimatedWorkCraftLogo size={80} />
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit logo component changes**

```bash
git add frontend/src/components/ui/workcraft-logo.tsx frontend/src/components/layout/splash-screen.tsx frontend/src/components/desktop/title-bar.tsx frontend/src/app/(main)/layout.tsx frontend/src/components/settings/billing-tab.tsx frontend/src/components/settings/providers-tab.tsx frontend/src/components/activity/*.tsx frontend/src/components/parts/reasoning-part.tsx frontend/src/components/onboarding/onboarding-screen.tsx
git commit -m "refactor(frontend): rename WorkCraftLogo to WorkCraftLogo"

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

### Task 7: Frontend Deep Link and Text Replacement

**Files:**
- Modify: `frontend/src/components/layout/session-item.tsx`
- Modify: `frontend/src/app/layout.tsx`
- Modify: `frontend/src/app/(mobile)/layout.tsx`
- Modify: `frontend/src/app/(mobile)/m/page.tsx`
- Modify: `frontend/src/app/(mobile)/m/settings/page.tsx`
- Modify: `frontend/src/components/artifacts/try-fix-button.tsx`
- Modify: `frontend/src/components/onboarding/onboarding-screen.tsx`
- Modify: `frontend/src/components/settings/providers-tab.tsx`

- [ ] **Step 1: Replace deep link scheme in session-item.tsx**

Edit line 74 in `frontend/src/components/layout/session-item.tsx`:

```typescript
// Change from:
const deeplink = `workcraft://chat?sessionId=${encodeURIComponent(session.id)}`;
// Change to:
const deeplink = `workcraft://chat?sessionId=${encodeURIComponent(session.id)}`;
```

- [ ] **Step 2: Replace title in app/layout.tsx**

Edit line 23 in `frontend/src/app/layout.tsx`:

```typescript
// Change from:
title: "WorkCraft",
// Change to:
title: "WorkCraft",
```

- [ ] **Step 3: Replace text in mobile layout.tsx**

Edit `frontend/src/app/(mobile)/layout.tsx`:

```typescript
// Change line 37:
// From:
Connecting to WorkCraft...
// To:
Connecting to WorkCraft...

// Change comment line 49:
// From:
Cached in localStorage as workcraft_remote_provider after first fetch.
// To:
Cached in localStorage as workcraft_remote_provider after first fetch.
```

- [ ] **Step 4: Replace text in mobile page.tsx**

Edit line 102 and 216 in `frontend/src/app/(mobile)/m/page.tsx`:

```typescript
// Change from:
<h1 className="text-xl font-semibold tracking-tight">WorkCraft</h1>
// Change to:
<h1 className="text-xl font-semibold tracking-tight">WorkCraft</h1>

// Change from:
placeholder="What should WorkCraft do?"
// Change to:
placeholder="What should WorkCraft do?"
```

- [ ] **Step 5: Replace text in mobile settings page.tsx**

Edit line 304 and 375 in `frontend/src/app/(mobile)/m/settings/page.tsx`:

```typescript
// Change from:
placeholder="workcraft_rt_..."
// Change to:
placeholder="workcraft_rt_..."

// Change from:
<li>Open WorkCraft on your desktop</li>
// Change to:
<li>Open WorkCraft on your desktop</li>
```

- [ ] **Step 6: Replace text in try-fix-button.tsx**

Edit line 40 in `frontend/src/components/artifacts/try-fix-button.tsx`:

```typescript
// Change from:
Try fixing with WorkCraft
// Change to:
Try fixing with WorkCraft
```

- [ ] **Step 7: Replace welcome text in onboarding-screen.tsx**

Edit lines 195 in `frontend/src/components/onboarding/onboarding-screen.tsx`:

```typescript
// Change from:
Welcome to WorkCraft
// Change to:
Welcome to WorkCraft
```

- [ ] **Step 8: Replace API Key name in providers-tab.tsx**

Edit line 89 in `frontend/src/components/settings/providers-tab.tsx`:

```typescript
// Change from:
const newKey = await proxyApi.createKey("WorkCraft Desktop", tokens.access_token);
// Change to:
const newKey = await proxyApi.createKey("WorkCraft Desktop", tokens.access_token);
```

Also update onboarding-screen.tsx line 101:

```typescript
// Change from:
const newKey = await proxyApi.createKey("WorkCraft Desktop", tokens.access_token);
// Change to:
const newKey = await proxyApi.createKey("WorkCraft Desktop", tokens.access_token);
```

- [ ] **Step 9: Commit frontend text changes**

```bash
git add frontend/src/components/layout/session-item.tsx frontend/src/app/layout.tsx frontend/src/app/(mobile)/layout.tsx frontend/src/app/(mobile)/m/page.tsx frontend/src/app/(mobile)/m/settings/page.tsx frontend/src/components/artifacts/try-fix-button.tsx frontend/src/components/onboarding/onboarding-screen.tsx frontend/src/components/settings/providers-tab.tsx
git commit -m "refactor(frontend): replace WorkCraft text with WorkCraft"

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

### Task 8: Package Configuration Replacement

**Files:**
- Modify: `package.json` (root)
- Modify: `backend/pyproject.toml`
- Modify: `backend/run.py`
- Rename: `backend/workcraft.spec` → `backend/workcraft.spec`

- [ ] **Step 1: Replace branding in root package.json**

Edit `package.json`:

```json
// Change name (line 2):
// From:
"name": "workcraft",
// To:
"name": "workcraft",

// Change description (line 6):
// From:
"description": "WorkCraft — Your local AI assistant",
// To:
"description": "WorkCraft — Your local AI assistant",

// Change build script reference (line 13):
// From:
"build:backend": "cd backend && node -e \"const p=process.platform==='win32'?'venv/Scripts/pyinstaller':'venv/bin/pyinstaller';require('child_process').execSync(p+' workcraft.spec --noconfirm',{stdio:'inherit'})\"",
// To:
"build:backend": "cd backend && node -e \"const p=process.platform==='win32'?'venv/Scripts/pyinstaller':'venv/bin/pyinstaller';require('child_process').execSync(p+' workcraft.spec --noconfirm',{stdio:'inherit'})\"",
```

- [ ] **Step 2: Replace branding in backend/pyproject.toml**

Edit `backend/pyproject.toml`:

```toml
# Change name:
# From:
name = "workcraft-backend"
# To:
name = "workcraft-backend"

# Change description if present
```

- [ ] **Step 3: Replace branding in backend/run.py**

Edit `backend/run.py`:

```python
# Change line 1:
# From:
"""Standalone entry point for WorkCraft backend in desktop mode.
# To:
"""Standalone entry point for WorkCraft backend in desktop mode.

# Change line 54:
# From:
parser = argparse.ArgumentParser(description="WorkCraft backend server")
# To:
parser = argparse.ArgumentParser(description="WorkCraft backend server")
```

- [ ] **Step 4: Rename workcraft.spec to workcraft.spec**

```bash
git mv backend/workcraft.spec backend/workcraft.spec
```

- [ ] **Step 5: Update content in workcraft.spec**

Edit `backend/workcraft.spec`:

```python
# Change any references to 'workcraft-backend' to 'workcraft-backend'
# Change any references to 'WorkCraft' to 'WorkCraft'
```

- [ ] **Step 6: Commit package configuration changes**

```bash
git add package.json backend/pyproject.toml backend/run.py backend/workcraft.spec
git commit -m "refactor: replace workcraft package names with workcraft"

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

### Task 9: Documentation Branding Replacement

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `LINUX.md`
- Modify: `CONTRIBUTING.md`
- Modify: `SECURITY.md`
- Modify: `DESIGN.md`
- Preserve: `LICENSE` (no changes)
- Preserve: `CHANGELOG.md` historical entries

- [ ] **Step 1: Replace branding in README.md**

Use find-and-replace for:
- `WorkCraft` → `WorkCraft`
- `workcraft` → `workcraft`
- `https://work-craft.com` → `https://work-craft.com`
- `https://github.com/workcraft/desktop` → remove (or replace placeholder)
- `work-craft.com/download` → `work-craft.com/download`

**IMPORTANT:** Do NOT change image paths like `docs/readme/workcraft-*.png` - these will be replaced separately when new screenshots are available.

- [ ] **Step 2: Replace branding in README.zh-CN.md**

Same replacements as README.md for Chinese version.

- [ ] **Step 3: Replace branding in LINUX.md**

Replace:
- `WorkCraft` → `WorkCraft`
- `workcraft` → `workcraft`
- Package names: `workcraft_*.deb`, `workcraft-*.rpm`
- Data paths: `~/.local/share/workcraft-desktop/`, `~/.config/workcraft-desktop/`
- Deep link: `workcraft://`
- GitHub URLs → remove

- [ ] **Step 4: Remove GitHub links in CONTRIBUTING.md**

Edit `CONTRIBUTING.md`:

```markdown
# Remove these lines:
git clone https://github.com/workcraft/desktop.git
Browse [open issues](https://github.com/workcraft/desktop/issues)
[Bug Report template](https://github.com/workcraft/desktop/issues/new?template=bug_report.yml)
[Feature Request template](https://github.com/workcraft/desktop/issues/new?template=feature_request.yml)

# Replace title if present:
# From:
# Contributing to WorkCraft
# To:
# Contributing to WorkCraft
```

- [ ] **Step 5: Remove GitHub links in SECURITY.md**

Edit `SECURITY.md`:

```markdown
# Remove GitHub issue/report links
# Replace title:
# From:
# Security Policy for WorkCraft
# To:
# Security Policy for WorkCraft
```

- [ ] **Step 6: Replace branding in DESIGN.md**

Replace `WorkCraft` → `WorkCraft`, `workcraft` → `workcraft` throughout.

- [ ] **Step 7: Verify LICENSE unchanged**

Run: `git diff LICENSE`
Expected: No changes (file should be identical)

- [ ] **Step 8: Commit documentation changes**

```bash
git add README.md README.zh-CN.md LINUX.md CONTRIBUTING.md SECURITY.md DESIGN.md
git commit -m "docs: replace WorkCraft branding with WorkCraft, remove GitHub links"

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

### Task 10: Verification and Testing

**Files:**
- All modified files

- [ ] **Step 1: Run TypeScript compilation check**

Run: `cd frontend && npx tsc --noEmit`
Expected: No compilation errors

- [ ] **Step 2: Run Python syntax check**

Run: `cd backend && python -m py_compile app/**/*.py`
Expected: No syntax errors

- [ ] **Step 3: Run frontend build**

Run: `cd frontend && npm run build`
Expected: Build completes successfully

- [ ] **Step 4: Check for remaining WorkCraft references**

Run: `grep -rn "WorkCraft\|workcraft" --include="*.ts" --include="*.tsx" --include="*.py" --include="*.json" --include="*.toml" --include="*.md" | grep -v node_modules | grep -v ".venv" | grep -v dist | grep -v target | grep -v CHANGELOG.md | grep -v LICENSE`

Expected: Minimal remaining references (should only be in CHANGELOG historical entries, dist/build artifacts, and any intentionally preserved locations)

- [ ] **Step 5: Verify localStorage key consistency**

Check that all localStorage keys use `workcraft-` prefix consistently:
- `workcraft-auth`
- `workcraft-settings`
- `workcraft-sidebar`
- `workcraft-appearance`
- `workcraft-language`
- `workcraft-drafts`

- [ ] **Step 6: Verify token prefix consistency**

Check backend uses `workcraft_st_` and `workcraft_rt_` consistently.

- [ ] **Step 7: Verify provider ID consistency**

Check `workcraft-proxy` used consistently in:
- Backend: provider registry, main.py, openrouter.py
- Frontend: providers-tab, header-model-dropdown, constants

- [ ] **Step 8: Create verification commit**

```bash
git add -A
git commit -m "chore: verify WorkCraft brand replacement complete"

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## Self-Review Checklist

**1. Spec coverage:**
- [x] localStorage keys replaced (Task 1)
- [x] Token prefixes replaced (Task 2)
- [x] Backend paths replaced (Task 3)
- [x] Provider IDs replaced (Task 4)
- [x] Tauri branding replaced (Task 5)
- [x] Logo components renamed (Task 6)
- [x] Deep links replaced (Task 7)
- [x] Package names replaced (Task 8)
- [x] Documentation updated (Task 9)
- [x] Verification complete (Task 10)
- [x] Icon files excluded (per user request)

**2. Placeholder scan:**
- [x] No TBD, TODO, or "implement later"
- [x] All code changes shown explicitly
- [x] All file paths exact
- [x] All commands include expected output

**3. Type consistency:**
- [x] localStorage keys use `workcraft-` prefix consistently
- [x] Token prefixes use `workcraft_st_/workcraft_rt_` consistently
- [x] Provider ID `workcraft-proxy` used consistently
- [x] Model ID `workcraft/best-free` used consistently

**4. Exclusions verified:**
- [x] LICENSE file not modified
- [x] Sub2API references preserved
- [x] Icon files excluded
- [x] CHANGELOG historical entries preserved
