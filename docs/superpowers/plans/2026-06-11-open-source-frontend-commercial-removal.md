# Open Source Frontend Commercial Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the public frontend dependency chain for WorkCraft Cloud account, Sub2API proxy auth, billing, recharge, subscriptions, credits, and paid upgrade prompts.

**Architecture:** The public frontend keeps provider setup, model selection, chat, settings, and desktop shell behavior, but removes the commercial account/billing provider source. Commercial modules are deleted from the public tree, shared provider helpers exclude `workcraft-proxy`, and UI routes that used to open account/billing now route to provider setup.

**Tech Stack:** Next.js, React, TypeScript, Zustand, TanStack Query, Node.js test runner, npm scripts.

---

## File Structure

Create:

- `frontend/src/lib/public-provider-boundary.ts`  
  Public frontend provider boundary helper that hides transitional commercial
  provider ids from selectors without making them selectable.

- `scripts/open-source-frontend-boundary.test.mjs`  
  Node.js boundary test that fails if frontend commercial account/billing files,
  imports, constants, or user-facing provider paths remain.

Modify:

- `frontend/src/stores/settings-store.ts`  
  Remove `workcraft` from the public `ActiveProvider` type and normalize
  persisted `workcraft` state to `null`.

- `frontend/src/lib/model-selection.ts`  
  Remove public `workcraft` active-provider mapping and automatic model
  preference.

- `frontend/src/lib/public-provider-boundary.ts`  
  Centralize public frontend filtering for hidden commercial provider IDs.

- `frontend/src/hooks/use-provider-models.ts`  
  Keep `workcraft-proxy` in a private denylist so backend transition data is
  hidden from public selectors, but remove it as a selectable active provider.

- `frontend/src/hooks/use-auto-detect-provider.ts`  
  Remove WorkCraft account dependency and never auto-select `workcraft`.

- `frontend/src/hooks/use-models.ts`  
  Remove desktop WorkCraft account sync before model loading.

- `frontend/src/hooks/use-chat.ts`  
  Remove billing upgrade prompt handling for 402/429 responses.

- `frontend/src/lib/session-stream-registry.ts`  
  Remove proxy account balance refresh after generation.

- `frontend/src/lib/constants.ts`  
  Remove frontend WorkCraft account and Sub2API proxy endpoint constants.

- `frontend/src/i18n/config.ts`  
  Remove billing locale namespace imports and registration.

- `frontend/next.config.ts`  
  Remove frontend rewrites for Sub2API proxy endpoints.

- `frontend/src/components/settings/settings-tabs.ts`  
  Remove the Account tab.

- `frontend/src/components/settings/settings-layout.tsx`  
  Remove `AccountTab` import/rendering and route legacy account/billing tabs to
  provider settings.

- `frontend/src/components/settings/settings-sidebar.tsx`  
  Route legacy account/billing tabs to provider settings.

- `frontend/src/app/(main)/layout.tsx`  
  Remove onboarding account gate, WorkCraft account sync, auth store usage, and
  upgrade prompt rendering.

- `frontend/src/components/layout/sidebar-footer.tsx`  
  Remove account, credits, subscription, recharge, and sign-out UI. Keep local
  user display, settings, theme, user guide, and update actions.

- `frontend/src/lib/expert-team-access.ts`  
  Make frontend expert team creation gating depend on any active provider
  instead of WorkCraft account state.

- `frontend/src/app/(main)/experts/page.tsx`  
  Remove WorkCraft account dependency and use the selected provider directly.

- `frontend/src/components/parts/expert-team-draft-card.tsx`  
  Remove WorkCraft account dependency and use the selected provider directly.

- `frontend/src/components/settings/providers-tab.tsx`  
  Remove official WorkCraft provider card and `workcraft-proxy` active-provider
  handling.

- `frontend/src/components/selectors/header-model-dropdown.tsx`  
  Remove WorkCraft-specific arena/variant/pinned model handling.

- `scripts/verify-frontend-assets.test.mjs`  
  Stop requiring `feedback-wechat.jpg` because the public frontend no longer
  references private feedback QR imagery.

- `scripts/check-open-source-boundary.mjs`  
  Remove frontend account/billing paths from the `commercial` group once the
  files are deleted.

- `OPEN_SOURCE_BOUNDARY.md`  
  Remove deleted frontend account/billing paths from the current tracked
  commercial blocker list after they are gone.

Delete:

- `frontend/src/stores/auth-store.ts`
- `frontend/src/stores/billing-store.ts`
- `frontend/src/lib/proxy-api.ts`
- `frontend/src/lib/workcraft-billing.ts`
- `frontend/src/components/settings/account-tab.tsx`
- `frontend/src/components/settings/recharge-panel.tsx`
- `frontend/src/components/billing/upgrade-prompt.tsx`
- `frontend/src/components/layout/sidebar-footer-credit-display.ts`
- `frontend/src/components/onboarding/onboarding-screen.tsx`
- `frontend/src/i18n/locales/en/billing.json`
- `frontend/src/i18n/locales/zh/billing.json`
- `scripts/sidebar-footer-credits.test.mjs`

Do not modify backend commercial routes, ViMax/Baoyu files, release workflows,
or brand assets in this plan.

## Task 1: Add Frontend Boundary Guard Test

**Files:**

- Create: `scripts/open-source-frontend-boundary.test.mjs`

- [ ] **Step 1: Create the failing boundary test**

Create `scripts/open-source-frontend-boundary.test.mjs` with this content:

```javascript
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

const deletedFrontendPaths = [
  "frontend/src/stores/auth-store.ts",
  "frontend/src/stores/billing-store.ts",
  "frontend/src/lib/proxy-api.ts",
  "frontend/src/lib/workcraft-billing.ts",
  "frontend/src/components/settings/account-tab.tsx",
  "frontend/src/components/settings/recharge-panel.tsx",
  "frontend/src/components/billing/upgrade-prompt.tsx",
  "frontend/src/components/layout/sidebar-footer-credit-display.ts",
  "frontend/src/components/onboarding/onboarding-screen.tsx",
  "frontend/src/i18n/locales/en/billing.json",
  "frontend/src/i18n/locales/zh/billing.json",
];

const forbiddenImportFragments = [
  "@/stores/auth-store",
  "@/stores/billing-store",
  "@/lib/proxy-api",
  "@/lib/workcraft-billing",
  "@/components/billing/upgrade-prompt",
  "@/components/settings/account-tab",
  "@/components/settings/recharge-panel",
  "@/components/onboarding/onboarding-screen",
];

const forbiddenConstantFragments = [
  "WORKCRAFT_ACCOUNT",
  "PROXY_AUTH_",
  "PROXY_KEYS_",
  "PROXY_PAYMENT_",
  "PROXY_SUBSCRIPTIONS_",
];

const allowedWorkcraftProxyFiles = new Set([
  "frontend/src/lib/public-provider-boundary.ts",
]);

const moduleExtensions = ["", ".ts", ".tsx", ".js", ".jsx", ".json"];

function trackedFiles() {
  return execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

function frontendSourceFiles(files) {
  return files.filter((file) =>
    file.startsWith("frontend/src/") &&
    /\.(ts|tsx)$/.test(file)
  );
}

function read(file) {
  return fs.readFileSync(path.resolve(file), "utf8");
}

function toRepoPath(file) {
  return file.split(path.sep).join("/");
}

function importedModuleSpecifiers(source) {
  const specifiers = new Set();
  const staticImportPattern = /\b(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s*)?["']([^"']+)["']/g;
  const dynamicImportPattern = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

  for (const pattern of [staticImportPattern, dynamicImportPattern]) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      specifiers.add(match[1]);
    }
  }

  return [...specifiers];
}

function modulePathCandidates(importer, specifier) {
  if (!specifier.startsWith(".") && !specifier.startsWith("@/")) return [];

  const base = specifier.startsWith("@/")
    ? path.join("frontend/src", specifier.slice(2))
    : path.join(path.dirname(importer), specifier);
  const normalizedBase = toRepoPath(path.normalize(base));

  return [
    ...moduleExtensions.map((extension) => `${normalizedBase}${extension}`),
    ...moduleExtensions.map((extension) => `${normalizedBase}/index${extension}`),
  ];
}

test("open source frontend does not track commercial account or billing modules", () => {
  const files = new Set(trackedFiles());
  const stillTracked = deletedFrontendPaths.filter((file) => files.has(file));

  assert.deepEqual(stillTracked, []);
});

test("open source frontend does not import commercial account or billing modules", () => {
  const deletedFiles = new Set(deletedFrontendPaths);
  const offenders = new Set();

  for (const file of frontendSourceFiles(trackedFiles())) {
    const source = read(file);
    for (const specifier of importedModuleSpecifiers(source)) {
      for (const fragment of forbiddenImportFragments) {
        if (specifier.includes(fragment)) {
          offenders.add(`${file}: ${specifier}`);
        }
      }
      for (const candidate of modulePathCandidates(file, specifier)) {
        if (deletedFiles.has(candidate)) {
          offenders.add(`${file}: ${specifier}`);
        }
      }
    }
  }

  assert.deepEqual([...offenders], []);
});

test("open source frontend removes commercial proxy constants", () => {
  const offenders = [];
  for (const file of frontendSourceFiles(trackedFiles())) {
    const source = read(file);
    for (const fragment of forbiddenConstantFragments) {
      if (source.includes(fragment)) {
        offenders.push(`${file}: ${fragment}`);
      }
    }
  }

  assert.deepEqual(offenders, []);
});

test("workcraft-proxy is only retained as a hidden provider denylist", () => {
  const offenders = [];
  for (const file of frontendSourceFiles(trackedFiles())) {
    const source = read(file);
    if (source.includes("workcraft-proxy") && !allowedWorkcraftProxyFiles.has(file)) {
      offenders.push(file);
    }
  }

  assert.deepEqual(offenders, []);
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```bash
node --test scripts/open-source-frontend-boundary.test.mjs
```

Expected: exit 1. It must report currently tracked commercial frontend files,
imports, constants, and `workcraft-proxy` references.

- [ ] **Step 3: Commit**

```bash
git add scripts/open-source-frontend-boundary.test.mjs
git commit -m "test: guard open source frontend boundary"
```

## Task 2: Remove Commercial Frontend State and API Helpers

**Files:**

- Modify: `frontend/src/stores/settings-store.ts`
- Create: `frontend/src/lib/public-provider-boundary.ts`
- Modify: `frontend/src/lib/model-selection.ts`
- Modify: `frontend/src/hooks/use-provider-models.ts`
- Modify: `frontend/src/hooks/use-auto-detect-provider.ts`
- Modify: `frontend/src/hooks/use-models.ts`
- Modify: `frontend/src/hooks/use-chat.ts`
- Modify: `frontend/src/lib/session-stream-registry.ts`
- Modify: `frontend/src/lib/constants.ts`
- Modify: `frontend/src/i18n/config.ts`
- Modify: `frontend/next.config.ts`
- Do not delete commercial files yet. Task 3 deletes them after UI imports are
  removed, keeping this intermediate commit lintable.

- [ ] **Step 1: Remove `workcraft` from active provider state**

In `frontend/src/stores/settings-store.ts`, change the `ActiveProvider` type to:

```typescript
export type ActiveProvider = "byok" | "chatgpt" | "ollama" | "local" | "custom" | null;
```

Add this helper after the `ActiveProvider` type:

```typescript
type PersistedActiveProvider = ActiveProvider | "workcraft" | undefined | null;

function normalizeActiveProvider(provider: PersistedActiveProvider): ActiveProvider {
  return provider === "workcraft" ? null : provider ?? null;
}
```

Change `setActiveProvider` to normalize incoming values:

```typescript
      setActiveProvider: (provider) => set({ activeProvider: normalizeActiveProvider(provider) }),
```

Change the persist options at the bottom to normalize existing persisted
`workcraft` values to `null` during state merge:

```typescript
    {
      name: "workcraft-settings",
      merge: (persisted, current) => {
        if (!persisted || typeof persisted !== "object") return current;
        const state = persisted as Partial<SettingsStore> & {
          activeProvider?: PersistedActiveProvider;
        };
        return {
          ...current,
          ...state,
          activeProvider: normalizeActiveProvider(state.activeProvider),
        };
      },
    },
```

- [ ] **Step 2: Add the public provider boundary helper**

Create `frontend/src/lib/public-provider-boundary.ts` with this content:

```typescript
const HIDDEN_PUBLIC_PROVIDER_IDS = new Set(["workcraft-proxy"]);

export function isHiddenPublicProvider(providerId: string | null | undefined): boolean {
  return Boolean(providerId && HIDDEN_PUBLIC_PROVIDER_IDS.has(providerId));
}
```

- [ ] **Step 3: Simplify provider selection helpers**

In `frontend/src/lib/model-selection.ts`, replace `activeProviderForProviderId`
with:

```typescript
export function activeProviderForProviderId(providerId: string): ActiveProvider {
  if (isHiddenPublicProvider(providerId)) return null;
  if (providerId === "openai-subscription") return "chatgpt";
  if (providerId === "ollama") return "ollama";
  if (providerId === "local") return "local";
  if (providerId.startsWith("custom_")) return "custom";
  return "byok";
}
```

Add this import:

```typescript
import { isHiddenPublicProvider } from "@/lib/public-provider-boundary";
```

Remove the `activeProvider === "workcraft"` branch from `chooseAutomaticModel`.
The function should fall through to the existing `chatgpt` branch and final
`return models[0];`.

- [ ] **Step 4: Keep `workcraft-proxy` hidden, not selectable**

In `frontend/src/hooks/use-provider-models.ts`, add:

```typescript
import { isHiddenPublicProvider } from "@/lib/public-provider-boundary";
```

Replace `NON_BYOK_PROVIDERS` with:

```typescript
const NON_BYOK_PROVIDERS = new Set(["openai-subscription", "ollama", "local"]);
```

Replace `PROVIDER_ID_MAP` with:

```typescript
const PROVIDER_ID_MAP: Record<NonNullable<ActiveProvider>, string | null> = {
  byok: null,
  chatgpt: "openai-subscription",
  ollama: "ollama",
  local: "local",
  custom: "custom_",
};
```

Update the BYOK filter to exclude hidden public providers:

```typescript
      return allModels.filter(
        (m) => !NON_BYOK_PROVIDERS.has(m.provider_id) &&
          !m.provider_id?.startsWith("custom_") &&
          !isHiddenPublicProvider(m.provider_id),
      );
```

- [ ] **Step 5: Remove account-based auto-detection**

In `frontend/src/hooks/use-auto-detect-provider.ts`:

- Remove the import of `useAuthHasHydrated` and `useAuthStore`.
- Remove `const isConnected = ...`.
- Remove `const authHydrated = ...`.
- Remove the `else if (isConnected) setActiveProvider("workcraft");` branch.
- Change the first guard to:

```typescript
    if (!settingsHydrated) return;
```

- Remove `isConnected` and `authHydrated` from the dependency array and return
  expression.

- [ ] **Step 6: Remove desktop WorkCraft account model sync**

In `frontend/src/hooks/use-models.ts`:

- Remove the import of `IS_DESKTOP`.
- Remove the import of `useAuthStore`.
- Delete `desktopModelSyncPromise` and `ensureDesktopWorkCraftAccountSynced`.
- Remove `await ensureDesktopWorkCraftAccountSynced();` from the query function.

- [ ] **Step 7: Remove billing upgrade handling from chat**

In `frontend/src/hooks/use-chat.ts`:

- Remove `useBillingStore` import.
- Delete `handleBillingError`.
- Remove the two `if (handleBillingError(err)) return false;` calls.

Keep normal `ApiError` toast handling.

- [ ] **Step 8: Remove billing refresh from stream registry**

In `frontend/src/lib/session-stream-registry.ts`:

- Remove imports of `useAuthStore` and `proxyApi`.
- Remove the call to `refreshBillingBalance();`.
- Delete the `refreshBillingBalance` function.

- [ ] **Step 9: Remove commercial frontend constants**

In `frontend/src/lib/constants.ts`, delete these `API.CONFIG` entries:

```typescript
    WORKCRAFT_ACCOUNT: "/api/config/workcraft-account",
    PROXY_AUTH_LOGIN: "/proxy-auth/login",
    PROXY_AUTH_REGISTER: "/proxy-auth/register",
    PROXY_AUTH_SEND_VERIFY_CODE: "/proxy-auth/send-verify-code",
    PROXY_AUTH_FORGOT_PASSWORD: "/proxy-auth/forgot-password",
    PROXY_AUTH_RESET_PASSWORD: "/proxy-auth/reset-password",
    PROXY_AUTH_REFRESH: "/proxy-auth/refresh",
    PROXY_AUTH_ME: "/proxy-auth/me",
    PROXY_KEYS_LIST: "/proxy-keys/list",
    PROXY_KEYS_CREATE: "/proxy-keys/create",
    PROXY_KEYS_AVAILABLE_GROUPS: "/proxy-keys/groups/available",
    PROXY_SUBSCRIPTIONS_ACTIVE: "/proxy-subscriptions/active",
    PROXY_PAYMENT_CHECKOUT_INFO: "/proxy-payment/checkout-info",
    PROXY_PAYMENT_CREATE_ORDER: "/proxy-payment/orders",
    PROXY_PAYMENT_MY_ORDERS: "/proxy-payment/orders/my",
    PROXY_PAYMENT_ORDER_DETAIL: (id: number) => `/proxy-payment/orders/${id}` as const,
    PROXY_PAYMENT_VERIFY_ORDER: "/proxy-payment/orders/verify",
```

Also delete:

```typescript
  workcraftAccount: ["workcraftAccount"] as const,
```

- [ ] **Step 10: Remove billing i18n namespace**

In `frontend/src/i18n/config.ts`:

- Remove imports for `enBilling` and `zhBilling`.
- Remove `billing: enBilling` and `billing: zhBilling` from resources.
- Remove `"billing"` from the `ns` array.

- [ ] **Step 11: Remove Sub2API rewrites**

In `frontend/next.config.ts`, delete these rewrite entries:

```typescript
        // Sub2API proxy auth endpoints
        {
          source: "/proxy-auth/:path*",
          destination: `${backendUrl}/api/proxy-auth/:path*`,
        },
        // Sub2API proxy keys endpoints
        {
          source: "/proxy-keys/:path*",
          destination: `${backendUrl}/api/proxy-keys/:path*`,
        },
```

- [ ] **Step 12: Verify Task 2**

Run:

```bash
node --test scripts/open-source-frontend-boundary.test.mjs
```

Expected: still exit 1 because commercial files and UI references remain, but
commercial proxy constant failures and `workcraft-proxy` references should be
reduced.

Run:

```bash
cd frontend && npm run lint
```

Expected: exit 0.

- [ ] **Step 13: Commit**

```bash
git add frontend/src/stores/settings-store.ts frontend/src/lib/public-provider-boundary.ts frontend/src/lib/model-selection.ts frontend/src/hooks/use-provider-models.ts frontend/src/hooks/use-auto-detect-provider.ts frontend/src/hooks/use-models.ts frontend/src/hooks/use-chat.ts frontend/src/lib/session-stream-registry.ts frontend/src/lib/constants.ts frontend/src/i18n/config.ts frontend/next.config.ts
git commit -m "refactor: remove frontend commercial state helpers"
```

## Task 3: Remove Commercial Account, Billing, and Onboarding UI

**Files:**

- Modify: `frontend/src/app/(main)/layout.tsx`
- Modify: `frontend/src/components/settings/settings-tabs.ts`
- Modify: `frontend/src/components/settings/settings-layout.tsx`
- Modify: `frontend/src/components/settings/settings-sidebar.tsx`
- Modify: `frontend/src/components/layout/sidebar-footer.tsx`
- Modify: `frontend/src/lib/expert-team-access.ts`
- Modify: `frontend/src/app/(main)/experts/page.tsx`
- Modify: `frontend/src/components/parts/expert-team-draft-card.tsx`
- Modify: `frontend/src/components/settings/providers-tab.tsx`
- Modify: `frontend/src/components/selectors/header-model-dropdown.tsx`
- Delete:
  - `frontend/src/stores/auth-store.ts`
  - `frontend/src/stores/billing-store.ts`
  - `frontend/src/lib/proxy-api.ts`
  - `frontend/src/lib/workcraft-billing.ts`
  - `frontend/src/components/settings/account-tab.tsx`
  - `frontend/src/components/settings/recharge-panel.tsx`
  - `frontend/src/components/billing/upgrade-prompt.tsx`
  - `frontend/src/components/layout/sidebar-footer-credit-display.ts`
  - `frontend/src/components/onboarding/onboarding-screen.tsx`
  - `frontend/src/i18n/locales/en/billing.json`
  - `frontend/src/i18n/locales/zh/billing.json`
  - `scripts/sidebar-footer-credits.test.mjs`

- [ ] **Step 1: Remove account tab metadata**

In `frontend/src/components/settings/settings-tabs.ts`:

- Remove `UserRound` from the lucide import.
- Remove the Account tab entry:

```typescript
  { id: "account", icon: UserRound, labelKey: "tabAccount", descKey: "tabAccountDesc", group: "core", keywordsKey: "tabAccountKeywords" },
```

- [ ] **Step 2: Redirect legacy account/billing routes to providers**

In `frontend/src/components/settings/settings-layout.tsx`:

- Remove `AccountTab` import.
- Change `toSettingsTabId` to:

```typescript
function toSettingsTabId(value: string | null | undefined): SettingsTabId {
  if (value === "billing" || value === "account") return "providers";
  return SETTINGS_TAB_IDS.has(value ?? "") ? (value as SettingsTabId) : "general";
}
```

- Remove the render branch:

```tsx
          {activeTab === "account" && <AccountTab onNavigateTab={navigateTab} />}
```

In `frontend/src/components/settings/settings-sidebar.tsx`, change active tab
normalization to:

```typescript
  const activeTab: SettingsTabId =
    rawActiveTab === "billing" || rawActiveTab === "account"
      ? "providers"
      : ((rawActiveTab as SettingsTabId) || "general");
```

- [ ] **Step 3: Remove onboarding and account sync from main layout**

In `frontend/src/app/(main)/layout.tsx`:

- Remove imports of `useQueryClient`, `UpgradePrompt`, `OnboardingScreen`,
  `useAuthStore`, `useAuthHasHydrated`, `queryKeys`,
  `selectWorkCraftBillingRoute`, and `syncWorkCraftAccountToBackend`.
- Remove `const qc = useQueryClient();`.
- Remove `const authHydrated = useAuthHasHydrated();`.
- Remove all `useAuthStore` selectors.
- Remove `requiresAuth`.
- Remove `lastSyncedWorkCraftKey` state and the account-sync `useEffect`.
- Change the hydration guard to:

```typescript
  if (!settingsHydrated) {
```

- Delete the `if (requiresAuth) { ... <OnboardingScreen /> ... }` block.
- Delete the final `<UpgradePrompt />` render block.

- [ ] **Step 4: Simplify sidebar footer**

In `frontend/src/components/layout/sidebar-footer.tsx`:

- Remove imports: `Copy`, `LogOut`, `Wallet`, `Repeat2`, `Calendar`, `Coins`,
  `useMutation`, `useQueryClient`, `WorkCraftLogo`, `useAuthStore`, `api`,
  `API`, `queryKeys`, `getActiveSubscription`, and
  `getSidebarCreditDisplay`.
- Keep `UserRound`, settings/theme/update/user-guide imports.
- Remove all account, credit, subscription, billing, sign-out, and copy account
  state/functions.
- Set:

```typescript
  const displayName = t("common:localUser");
```

- The dropdown trigger avatar should always render:

```tsx
<UserRound className="h-3.5 w-3.5" />
```

- The dropdown header avatar should always render:

```tsx
<UserRound className="h-5 w-5" />
```

- Remove account and recharge menu items. Keep only:
  - Settings link to `/settings`
  - Dark theme switch
  - User guide
  - Check for updates

Use existing classes and structure where possible.

- [ ] **Step 5: Remove WorkCraft frontend gate from expert team helpers**

Replace `frontend/src/lib/expert-team-access.ts` with:

```typescript
import type { ActiveProvider } from "@/stores/settings-store";

export const EXPERT_TEAM_ACCOUNT_ROUTE = "/settings?tab=providers";
export const EXPERT_TEAM_REQUIRED_PROVIDER_ID = "";
export const EXPERT_TEAM_CREATION_ACCESS_CODE = "expert_team_creation_requires_provider";
export const EXPERT_TEAM_CREATION_ACCESS_MESSAGE =
  "Create an expert team after selecting a model provider in Settings.";

export function canCreateExpertTeamWithProvider(
  activeProvider: ActiveProvider,
  selectedProviderId?: string | null,
): boolean {
  if (!activeProvider) return false;
  if (activeProvider === "byok" || activeProvider === "custom") return Boolean(selectedProviderId);
  return true;
}

export function expertTeamAccessRedirectFromError(err: unknown): string | null {
  if (!err || typeof err !== "object" || !("body" in err)) return null;
  const body = (err as { body: unknown }).body;
  if (!body || typeof body !== "object" || !("detail" in body)) return null;
  const detail = (body as { detail: unknown }).detail;
  if (!detail || typeof detail !== "object") return null;
  const code = (detail as { code?: unknown }).code;
  if (code !== EXPERT_TEAM_CREATION_ACCESS_CODE) return null;
  const redirect = (detail as { redirect?: unknown }).redirect;
  return typeof redirect === "string" && redirect ? redirect : EXPERT_TEAM_ACCOUNT_ROUTE;
}
```

- [ ] **Step 6: Update expert team creation call sites**

In `frontend/src/app/(main)/experts/page.tsx`:

- Remove `useAuthStore` import.
- Remove `const isWorkCraftAccountConnected = ...`.
- Replace `creationProviderId` and `creationModel` with:

```typescript
  const creationProviderId = settings.selectedProviderId;
  const creationModel = settings.selectedModel;
```

- Replace `canCreateExpertTeam` call with:

```typescript
  const canCreateExpertTeam = canCreateExpertTeamWithProvider(settings.activeProvider, creationProviderId);
```

- In `redirectToExpertTeamAccount`, change action label from `去账号页` to
  `去模型设置`.

In `frontend/src/components/parts/expert-team-draft-card.tsx`:

- Remove `useAuthStore` import.
- Remove `isWorkCraftAccountConnected`.
- Replace `creationProviderId` and `creationModel` with selected provider/model:

```typescript
  const creationProviderId = selectedProviderId;
  const creationModel = selectedModel;
```

- Replace `canSave` call with:

```typescript
  const canSave = canCreateExpertTeamWithProvider(activeProvider, creationProviderId);
```

- [ ] **Step 7: Remove official WorkCraft provider card**

In `frontend/src/components/settings/providers-tab.tsx`:

- Remove imports of `ShieldCheck` and `WorkCraftLogo` if no longer used.
- Remove the import of `useAuthStore`.
- Change `type ActiveModelSource` to:

```typescript
type ActiveModelSource = "byok" | "custom" | null;
```

- Replace `ActivationRequest` with:

```typescript
type ActivationRequest = { type: "configured"; provider: ProviderInfo; enabled: boolean };
```

- Delete `const WORKCRAFT_PROVIDER_ID = "workcraft-proxy";`.
- Remove `"workcraft-proxy": "WorkCraft",` from `PROVIDER_LABELS`.
- Delete `officialModels` memo.
- Delete `const isAccountConnected = useAuthStore((s) => s.isConnected);`.
- Delete the `request.type === "official"` branch from the `selectModelSource`
  mutation.
- Remove the `if (activeProvider === "workcraft")` effect block.
- Simplify `displayedOfficialActive` removal by deleting the variable and all
  `OfficialProviderCard` render usage.
- Delete the official `ModelSummaryTable` block for `officialModels`.
- Delete the `OfficialProviderCard` function.
- In `getActiveConfiguredProviderId`, remove the `activeProvider === "workcraft"`
  condition so it becomes:

```typescript
  if (providers.length === 0) return null;
```

- [ ] **Step 8: Remove WorkCraft-specific model dropdown handling**

In `frontend/src/components/selectors/header-model-dropdown.tsx`:

- Change:

```typescript
const ARENA_PROVIDERS = new Set<string | null>();
```

- Change:

```typescript
const VARIANT_AWARE_PROVIDERS = new Set<string | null>();
```

- Remove this pinned-model branch:

```typescript
      if (m.id === "workcraft/best-free" && activeProvider === "workcraft") pinned = m;
```

Simplify the loop so free models still collect correctly:

```typescript
      if (isFreeModel(m)) free.push(m);
      else paid.push(m);
```

There should be no `workcraft` string left in this file.

- [ ] **Step 9: Delete commercial state, helper, UI files, and obsolete test**

Delete:

```text
frontend/src/stores/auth-store.ts
frontend/src/stores/billing-store.ts
frontend/src/lib/proxy-api.ts
frontend/src/lib/workcraft-billing.ts
frontend/src/components/settings/account-tab.tsx
frontend/src/components/settings/recharge-panel.tsx
frontend/src/components/billing/upgrade-prompt.tsx
frontend/src/components/layout/sidebar-footer-credit-display.ts
frontend/src/components/onboarding/onboarding-screen.tsx
frontend/src/i18n/locales/en/billing.json
frontend/src/i18n/locales/zh/billing.json
scripts/sidebar-footer-credits.test.mjs
```

- [ ] **Step 10: Verify Task 3**

Run:

```bash
node --test scripts/open-source-frontend-boundary.test.mjs
```

Expected: exit 0.

Run:

```bash
cd frontend && npm run lint
```

Expected: exit 0.

- [ ] **Step 11: Commit**

```bash
git add frontend/src/app/\(main\)/layout.tsx frontend/src/components/settings/settings-tabs.ts frontend/src/components/settings/settings-layout.tsx frontend/src/components/settings/settings-sidebar.tsx frontend/src/components/layout/sidebar-footer.tsx frontend/src/lib/expert-team-access.ts frontend/src/app/\(main\)/experts/page.tsx frontend/src/components/parts/expert-team-draft-card.tsx frontend/src/components/settings/providers-tab.tsx frontend/src/components/selectors/header-model-dropdown.tsx frontend/src/stores/auth-store.ts frontend/src/stores/billing-store.ts frontend/src/lib/proxy-api.ts frontend/src/lib/workcraft-billing.ts frontend/src/components/settings/account-tab.tsx frontend/src/components/settings/recharge-panel.tsx frontend/src/components/billing/upgrade-prompt.tsx frontend/src/components/layout/sidebar-footer-credit-display.ts frontend/src/components/onboarding/onboarding-screen.tsx frontend/src/i18n/locales/en/billing.json frontend/src/i18n/locales/zh/billing.json scripts/sidebar-footer-credits.test.mjs
git commit -m "refactor: remove frontend commercial account ui"
```

## Task 4: Update Boundary Audit and Asset Tests

**Files:**

- Modify: `OPEN_SOURCE_BOUNDARY.md`
- Modify: `scripts/check-open-source-boundary.mjs`
- Modify: `scripts/verify-frontend-assets.test.mjs`

- [ ] **Step 1: Remove deleted frontend commercial paths from boundary document**

In `OPEN_SOURCE_BOUNDARY.md`, remove these entries from the first `Commercial`
path list:

```text
frontend/src/stores/billing-store.ts
frontend/src/lib/workcraft-billing.ts
frontend/src/lib/proxy-api.ts
frontend/src/components/settings/account-tab.tsx
frontend/src/components/settings/recharge-panel.tsx
frontend/src/components/billing/
frontend/src/i18n/locales/en/billing.json
frontend/src/i18n/locales/zh/billing.json
```

Also remove these entries from the "Commercial references that remain inside
otherwise-core files" list after Task 3 has refactored them:

```text
frontend/src/stores/auth-store.ts
frontend/src/components/onboarding/onboarding-screen.tsx
frontend/src/components/settings/providers-tab.tsx
frontend/src/components/layout/sidebar-footer.tsx
```

- [ ] **Step 2: Remove deleted frontend commercial paths from audit script**

In `scripts/check-open-source-boundary.mjs`, remove these entries from the
`commercial` group:

```javascript
      "frontend/src/stores/billing-store.ts",
      "frontend/src/lib/workcraft-billing.ts",
      "frontend/src/lib/proxy-api.ts",
      "frontend/src/components/settings/account-tab.tsx",
      "frontend/src/components/settings/recharge-panel.tsx",
      "frontend/src/components/billing/",
      "frontend/src/i18n/locales/en/billing.json",
      "frontend/src/i18n/locales/zh/billing.json",
```

Keep backend commercial and plugin paths unchanged.

- [ ] **Step 3: Stop requiring private feedback QR asset**

In `scripts/verify-frontend-assets.test.mjs`, remove this entry from
`requiredPublicAssets`:

```javascript
  "feedback-wechat.jpg",
```

- [ ] **Step 4: Verify audit and root tests**

Run:

```bash
npm run audit:open-source-boundary
```

Expected: exit 0. It should no longer report the deleted frontend
account/billing paths in the `commercial` group.

Run:

```bash
node --test scripts/*.test.mjs
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add OPEN_SOURCE_BOUNDARY.md scripts/check-open-source-boundary.mjs scripts/verify-frontend-assets.test.mjs
git commit -m "chore: update frontend commercial boundary checks"
```

## Task 5: Final Verification

**Files:**

- Verify: frontend and scripts touched by Tasks 1-4.

- [ ] **Step 1: Verify no commercial frontend modules remain tracked**

Run:

```bash
node --test scripts/open-source-frontend-boundary.test.mjs
```

Expected: exit 0.

- [ ] **Step 2: Verify root script tests**

Run:

```bash
node --test scripts/*.test.mjs
```

Expected: all tests pass.

- [ ] **Step 3: Verify frontend lint**

Run:

```bash
cd frontend && npm run lint
```

Expected: exit 0.

- [ ] **Step 4: Verify boundary report**

Run:

```bash
npm run audit:open-source-boundary
```

Expected: exit 0. The report still contains backend commercial/private,
release, brand, and license-review blockers, but no deleted frontend
account/billing paths.

- [ ] **Step 5: Confirm strict audit still blocks release**

Run:

```bash
npm run audit:open-source-boundary:strict
```

Expected: exit 1 because backend commercial/private, release, brand, and
license-review paths still remain.

- [ ] **Step 6: Confirm git status and log**

Run:

```bash
git status --short
git log --oneline -n 6
```

Expected: clean working tree. Latest commits are this plan's implementation
commits.

## Follow-Up Plans

After this frontend slice lands, create separate implementation plans for:

1. Backend WorkCraft proxy and `/proxy-*` route removal.
2. ViMax and Baoyu commercial tool extraction.
3. Private release/updater/signing removal.
4. Brand asset replacement or trademark restriction.
5. Third-party bundle audit and notices.
