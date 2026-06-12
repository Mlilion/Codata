# Sub2API Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace WorkCraft account system with Sub2API integration for auth, billing, and API key management.

**Architecture:** Backend proxy endpoints forward requests to Sub2API at `https://aihub2.top`, unwrap nested responses. Frontend stores JWT tokens and API Key (sk-xxx) in Zustand. Payment is external redirect to Sub2API purchase page.

**Tech Stack:** FastAPI (backend proxy), Zustand (frontend auth store), Next.js 15 (frontend), Tauri v2 (desktop)

---

## File Structure

### Backend
- `backend/app/api/config.py` - Add Sub2API proxy endpoints (auth + keys)

### Frontend
- `frontend/src/stores/auth-store.ts` - Update user type, add apiKey field
- `frontend/src/lib/proxy-api.ts` - Adapt for Sub2API response format, change endpoints
- `frontend/src/components/onboarding/onboarding-screen.tsx` - Simplify auth flow (no verification, 2FA guidance)
- `frontend/src/components/settings/billing-tab.tsx` - External payment redirect, simplify balance display
- `frontend/src/components/settings/providers-tab.tsx` - Update WorkCraft account section UI

---

### Task 1: Backend - Add Sub2API Proxy Endpoints

**Files:**
- Modify: `backend/app/api/config.py` (add after line 380)

**Endpoints to add:**

```python
# ── Sub2API Proxy Endpoints ──────────────────────────────────────────────

SUB2API_URL = "https://aihub2.top"

class Sub2APIResponse(BaseModel):
    code: int
    message: str
    data: Any | None = None

class Sub2APIError(HTTPException):
    def __init__(self, code: int, message: str):
        super().__init__(status_code=400, detail=message)
        self.sub2api_code = code

def _unwrap_sub2api_response(resp: httpx.Response) -> Any:
    """Unwrap Sub2API nested response {code, message, data} -> data."""
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, f"Sub2API error: {resp.text[:200]}")
    body = resp.json()
    if body.get("code", 0) != 0:
        raise Sub2APIError(body["code"], body.get("message", "Unknown error"))
    return body.get("data")

class Sub2APILoginRequest(BaseModel):
    email: str
    password: str

class Sub2APIRegisterRequest(BaseModel):
    email: str
    password: str

class Sub2APITokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    expires_in: int
    user: dict

class Sub2API2FAResponse(BaseModel):
    requires_2fa: bool = True
    temp_token: str
    user_email_masked: str

class Sub2APIKeyResponse(BaseModel):
    id: int
    key: str
    name: str
    status: str

class Sub2APIKeysListResponse(BaseModel):
    items: list[dict]
    total: int

@router.post("/proxy-auth/login")
async def proxy_auth_login(body: Sub2APILoginRequest) -> Sub2APITokenResponse | Sub2API2FAResponse:
    """Proxy login to Sub2API."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{SUB2API_URL}/api/v1/auth/login",
            json={"email": body.email, "password": body.password},
            timeout=15.0,
        )
    data = _unwrap_sub2api_response(resp)
    if data.get("requires_2fa"):
        return Sub2API2FAResponse(
            requires_2fa=True,
            temp_token=data.get("temp_token", ""),
            user_email_masked=data.get("user_email_masked", ""),
        )
    return Sub2APITokenResponse(
        access_token=data["access_token"],
        refresh_token=data["refresh_token"],
        expires_in=data.get("expires_in", 3600),
        user=data.get("user", {}),
    )

@router.post("/proxy-auth/register")
async def proxy_auth_register(body: Sub2APIRegisterRequest) -> dict:
    """Proxy register to Sub2API (no verification code required)."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{SUB2API_URL}/api/v1/auth/register",
            json={"email": body.email, "password": body.password},
            timeout=15.0,
        )
    return _unwrap_sub2api_response(resp)

@router.post("/proxy-auth/refresh")
async def proxy_auth_refresh(body: dict) -> Sub2APITokenResponse:
    """Proxy token refresh to Sub2API."""
    refresh_token = body.get("refresh_token")
    if not refresh_token:
        raise HTTPException(400, "refresh_token required")
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{SUB2API_URL}/api/v1/auth/refresh",
            json={"refresh_token": refresh_token},
            timeout=15.0,
        )
    data = _unwrap_sub2api_response(resp)
    return Sub2APITokenResponse(
        access_token=data["access_token"],
        refresh_token=data["refresh_token"],
        expires_in=data.get("expires_in", 3600),
        user={},
    )

@router.get("/proxy-auth/me")
async def proxy_auth_me(token: str) -> dict:
    """Proxy user profile fetch to Sub2API."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{SUB2API_URL}/api/v1/auth/me",
            headers={"Authorization": f"Bearer {token}"},
            timeout=15.0,
        )
    return _unwrap_sub2api_response(resp)

@router.get("/proxy-keys/list")
async def proxy_keys_list(token: str) -> Sub2APIKeysListResponse:
    """List user's API keys from Sub2API."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{SUB2API_URL}/api/v1/keys",
            headers={"Authorization": f"Bearer {token}"},
            timeout=15.0,
        )
    data = _unwrap_sub2api_response(resp)
    return Sub2APIKeysListResponse(items=data.get("items", []), total=data.get("total", 0))

@router.post("/proxy-keys/create")
async def proxy_keys_create(token: str, body: dict = {}) -> Sub2APIKeyResponse:
    """Create a new API key in Sub2API."""
    name = body.get("name", "WorkCraft Desktop")
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{SUB2API_URL}/api/v1/keys",
            json={"name": name},
            headers={"Authorization": f"Bearer {token}"},
            timeout=15.0,
        )
    data = _unwrap_sub2api_response(resp)
    return Sub2APIKeyResponse(
        id=data["id"],
        key=data["key"],
        name=data.get("name", name),
        status=data.get("status", "active"),
    )
```

- [ ] **Step 1: Add Sub2API proxy endpoints to backend**

Edit `backend/app/api/config.py`, add the above code after line 380 (after `disconnect_workcraft_account`).

- [ ] **Step 2: Verify backend compiles**

Run: `cd backend && python -c "from app.api.config import router; print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit backend changes**

```bash
git add backend/app/api/config.py
git commit -m "feat: add Sub2API proxy endpoints for auth and API keys

- /proxy-auth/login, register, refresh, me
- /proxy-keys/list, create
- Unwrap Sub2API nested response format

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: Frontend - Update Auth Store

**Files:**
- Modify: `frontend/src/stores/auth-store.ts`

**New user type and store structure:**

```typescript
"use client";

import { useState, useEffect } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Sub2APIUser {
  id: number;
  email: string;
  username: string;
  role: string;
  balance: number;
  status: string;
  concurrency: number;
  total_recharged: number;
}

interface AuthStore {
  /** Fixed Sub2API URL */
  proxyUrl: string;
  /** JWT access token */
  accessToken: string;
  /** JWT refresh token */
  refreshToken: string;
  /** User profile */
  user: Sub2APIUser | null;
  /** API Key for /v1/models (sk-xxx format) */
  apiKey: string | null;
  /** Connection status */
  isConnected: boolean;

  setAuth: (params: {
    proxyUrl: string;
    accessToken: string;
    refreshToken: string;
    user: Sub2APIUser;
    apiKey: string;
  }) => void;
  updateUser: (user: Sub2APIUser) => void;
  updateApiKey: (apiKey: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      proxyUrl: "",
      accessToken: "",
      refreshToken: "",
      user: null,
      apiKey: null,
      isConnected: false,

      setAuth: ({ proxyUrl, accessToken, refreshToken, user, apiKey }) =>
        set({ proxyUrl, accessToken, refreshToken, user, apiKey, isConnected: true }),

      updateUser: (user) => set({ user }),

      updateApiKey: (apiKey) => set({ apiKey }),

      logout: () =>
        set({
          proxyUrl: "",
          accessToken: "",
          refreshToken: "",
          user: null,
          apiKey: null,
          isConnected: false,
        }),
    }),
    {
      name: "workcraft-auth",
    },
  ),
);

// Hydration tracking
const useAuthHasHydrated = () => {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (!useAuthStore.persist) {
      setHydrated(true);
      return;
    }
    if (useAuthStore.persist.hasHydrated()) {
      setHydrated(true);
    }
    const unsub = useAuthStore.persist.onFinishHydration(() => setHydrated(true));
    return () => {
      unsub();
    };
  }, []);
  return hydrated;
};

export { useAuthHasHydrated };
```

- [ ] **Step 1: Replace auth-store.ts content**

Replace entire file content with the new structure above.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit src/stores/auth-store.ts`
Expected: No errors

- [ ] **Step 3: Commit auth store changes**

```bash
git add frontend/src/stores/auth-store.ts
git commit -m "refactor: update auth store for Sub2API integration

- Replace WorkCraftUser with Sub2APIUser (balance-based)
- Add apiKey field for /v1/models calls
- Remove free tier quota fields

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: Frontend - Update Proxy API Client

**Files:**
- Modify: `frontend/src/lib/proxy-api.ts`

**Updated proxy-api.ts:**

```typescript
/**
 * API client for Sub2API backend proxy.
 *
 * All calls go through local backend proxy endpoints to avoid CORS.
 */

import { useAuthStore } from "@/stores/auth-store";
import { api } from "@/lib/api";
import { API } from "@/lib/constants";

const SUB2API_URL = "https://aihub2.top";

class Sub2APIError extends Error {
  constructor(
    public code: number,
    public message: string,
  ) {
    super(`Sub2API error ${code}: ${message}`);
    this.name = "Sub2APIError";
  }
}

let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const data = await api.post<{ access_token: string; refresh_token: string }>(
        API.CONFIG.PROXY_AUTH_REFRESH,
        { refresh_token: refreshToken },
      );

      const current = useAuthStore.getState();
      useAuthStore.setState({
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        isConnected: current.isConnected,
      });

      // Sync to backend
      if (current.isConnected && current.proxyUrl) {
        try {
          await api.post(API.CONFIG.WORKCRAFT_ACCOUNT, {
            proxy_url: current.proxyUrl,
            token: data.access_token,
            refresh_token: data.refresh_token,
          });
        } catch {
          // Keep local auth usable even if backend sync fails
        }
      }

      return data.access_token;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

async function proxyRequest<T>(
  endpoint: string,
  options?: RequestInit & { noAuth?: boolean; params?: Record<string, string> },
): Promise<T> {
  const { accessToken, refreshToken } = useAuthStore.getState();

  const buildUrl = (endpoint: string, params?: Record<string, string>) => {
    const url = new URL(endpoint, window.location.origin);
    if (params) {
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    }
    return url.toString();
  };

  const buildHeaders = (token: string | null): Record<string, string> => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options?.headers as Record<string, string>),
    };
    if (!options?.noAuth && token) {
      headers["X-Auth-Token"] = token;
    }
    return headers;
  };

  let res = await fetch(buildUrl(endpoint, options?.params), {
    ...options,
    headers: buildHeaders(accessToken || null),
  });

  if (res.status === 401 && !options?.noAuth && refreshToken) {
    const refreshedAccess = await refreshAccessToken(refreshToken);
    if (refreshedAccess) {
      res = await fetch(buildUrl(endpoint, options?.params), {
        ...options,
        headers: buildHeaders(refreshedAccess),
      });
    } else {
      useAuthStore.getState().logout();
    }
  }

  if (!res.ok) {
    const body = await res.text();
    let parsed: { error?: string; message?: string };
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = { message: body };
    }
    throw new Sub2APIError(res.status, parsed.message || parsed.error || "Request failed");
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const proxyApi = {
  // Auth endpoints (no auth header needed for login/register)
  login: (email: string, password: string) =>
    proxyRequest<{ access_token: string; refresh_token: string; expires_in: number; user: Record<string, unknown> } | { requires_2fa: boolean; temp_token: string; user_email_masked: string }>(
      API.CONFIG.PROXY_AUTH_LOGIN,
      { method: "POST", body: JSON.stringify({ email, password }), noAuth: true },
    ),

  register: (email: string, password: string) =>
    proxyRequest<{ message: string; email: string }>(
      API.CONFIG.PROXY_AUTH_REGISTER,
      { method: "POST", body: JSON.stringify({ email, password }), noAuth: true },
    ),

  refresh: (refreshToken: string) =>
    proxyRequest<{ access_token: string; refresh_token: string; expires_in: number }>(
      API.CONFIG.PROXY_AUTH_REFRESH,
      { method: "POST", body: JSON.stringify({ refresh_token: refreshToken }), noAuth: true },
    ),

  me: (token?: string) =>
    proxyRequest<Record<string, unknown>>(
      API.CONFIG.PROXY_AUTH_ME,
      { params: token ? { token } : undefined },
    ),

  // API Key endpoints
  listKeys: (token?: string) =>
    proxyRequest<{ items: Array<{ id: number; key: string; name: string; status: string }>; total: number }>(
      API.CONFIG.PROXY_KEYS_LIST,
      { params: token ? { token } : undefined },
    ),

  createKey: (name: string = "WorkCraft Desktop", token?: string) =>
    proxyRequest<{ id: number; key: string; name: string; status: string }>(
      API.CONFIG.PROXY_KEYS_CREATE,
      { method: "POST", body: JSON.stringify({ name }), params: token ? { token } : undefined },
    ),
};

export { Sub2APIError };
```

- [ ] **Step 1: Replace proxy-api.ts content**

Replace entire file with the updated version above.

- [ ] **Step 2: Add new API constants**

Read `frontend/src/lib/constants.ts` and add the new endpoint constants:

```typescript
// Add to API.CONFIG object
PROXY_AUTH_LOGIN: "/proxy-auth/login",
PROXY_AUTH_REGISTER: "/proxy-auth/register",
PROXY_AUTH_REFRESH: "/proxy-auth/refresh",
PROXY_AUTH_ME: "/proxy-auth/me",
PROXY_KEYS_LIST: "/proxy-keys/list",
PROXY_KEYS_CREATE: "/proxy-keys/create",
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit src/lib/proxy-api.ts`
Expected: No errors

- [ ] **Step 4: Commit proxy-api changes**

```bash
git add frontend/src/lib/proxy-api.ts frontend/src/lib/constants.ts
git commit -m "refactor: update proxy-api for Sub2API backend endpoints

- Change to local backend proxy endpoints
- Add auth and API key methods
- Support 2FA response detection

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: Frontend - Update Onboarding Screen

**Files:**
- Modify: `frontend/src/components/onboarding/onboarding-screen.tsx`

Key changes:
1. Remove proxy URL input (hardcode `https://aihub2.top`)
2. Remove email verification code step
3. Add 2FA detection and guidance message
4. Add API Key get-or-create after auth success

- [ ] **Step 1: Update PROXY_URL constant**

Change line 27-28 from:
```typescript
const PROXY_URL =
  process.env.NEXT_PUBLIC_DEFAULT_PROXY_URL || "https://api.work-craft.com";
```
To:
```typescript
const PROXY_URL = "https://aihub2.top";
```

- [ ] **Step 2: Remove verification step logic**

Remove:
- `verificationStep` state
- `codeInput` state
- `codeCountdown` state
- `resendSuccess` state
- The verification code UI section (lines 308-374)
- `handleVerify` and `handleResend` functions

- [ ] **Step 3: Add 2FA detection**

In `handleAuthSubmit`, after login response:

```typescript
const handleAuthSubmit = async () => {
  setError(null);
  setIsSubmitting(true);
  try {
    if (authMode === "login") {
      const result = await proxyApi.login(emailInput, passwordInput);
      // Check for 2FA requirement
      if ("requires_2fa" in result && result.requires_2fa) {
        setError("您的账号已启用两步验证，请在网页端登录: https://aihub2.top/login");
        setIsSubmitting(false);
        return;
      }
      await completeAuth(result);
      goTo("done");
    } else {
      // Register - no verification needed
      await proxyApi.register(emailInput, passwordInput);
      // Sub2API returns tokens directly after register (verification disabled)
      // Re-login to get tokens
      const loginResult = await proxyApi.login(emailInput, passwordInput);
      if ("requires_2fa" in loginResult && loginResult.requires_2fa) {
        setError("注册成功，但账号已启用两步验证。请在网页端登录: https://aihub2.top/login");
        setIsSubmitting(false);
        return;
      }
      await completeAuth(loginResult);
      goTo("done");
    }
  } catch (err) {
    if (err instanceof Sub2APIError) {
      setError(err.message);
    } else {
      setError(err instanceof Error ? err.message : "连接失败，请检查网络");
    }
  } finally {
    setIsSubmitting(false);
  }
};
```

- [ ] **Step 4: Add API Key get-or-create in completeAuth**

```typescript
const completeAuth = async (tokens: {
  access_token: string;
  refresh_token: string;
}) => {
  // Fetch user profile
  const user = await proxyApi.me(tokens.access_token) as Sub2APIUser;

  // Get or create API Key
  let apiKey: string | null = null;
  try {
    const keysResult = await proxyApi.listKeys(tokens.access_token);
    const activeKey = keysResult.items.find(k => k.status === "active");
    if (activeKey) {
      apiKey = activeKey.key;
    } else {
      const newKey = await proxyApi.createKey("WorkCraft Desktop", tokens.access_token);
      apiKey = newKey.key;
    }
  } catch (err) {
    console.error("Failed to get/create API key:", err);
    // Continue without API key - user can retry later
  }

  // Sync to backend
  await syncWorkCraftAccountToBackend(PROXY_URL, tokens.access_token, tokens.refresh_token);

  // Update store
  authStore.setAuth({
    proxyUrl: PROXY_URL,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    user,
    apiKey: apiKey || "",
  });
  useSettingsStore.getState().setActiveProvider("workcraft");
  qc.invalidateQueries({ queryKey: queryKeys.models });
  qc.invalidateQueries({ queryKey: queryKeys.workcraftAccount });
};
```

- [ ] **Step 5: Remove verification UI completely**

Remove the `verificationStep ? (...) : (...)` conditional block and keep only the email+password form.

- [ ] **Step 6: Update imports**

Add `Sub2APIError` import and `Sub2APIUser` type import:

```typescript
import { proxyApi, Sub2APIError } from "@/lib/proxy-api";
import { useAuthStore, type Sub2APIUser } from "@/stores/auth-store";
```

Remove unused imports: `Mail`, `RotateCw`.

- [ ] **Step 7: Verify component works**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 8: Commit onboarding changes**

```bash
git add frontend/src/components/onboarding/onboarding-screen.tsx
git commit -m "feat: simplify onboarding for Sub2API integration

- Hardcode Sub2API URL (https://aihub2.top)
- Remove email verification step
- Add 2FA detection with guidance message
- Add API Key get-or-create after auth

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: Frontend - Update Billing Tab

**Files:**
- Modify: `frontend/src/components/settings/billing-tab.tsx`

Key changes:
1. Simplify balance display (from `user.balance`)
2. Replace credit packs with external payment link
3. Remove transaction history section

- [ ] **Step 1: Simplify imports**

Remove unused imports: `ArrowUpRight`, `ArrowDownRight`, `Gift`, `RotateCcw`, `ChevronLeft`, `ChevronRight`, `useMutation`, `Skeleton`.

Add: `ExternalLink` from lucide-react.

```typescript
import {
  CreditCard,
  Loader2,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
```

- [ ] **Step 2: Remove old types**

Remove: `BalanceData`, `CreditPack`, `TransactionItem`, `TransactionsData`, `GroupedTransaction`, `PaymentChannel`.
Remove: `TX_PAGE_SIZE`, `GROUP_WINDOW_MS`.
Remove: helper functions `formatUsd`, `formatWholeUsd`, `formatSignedUsd`, `transactionIcon`, `transactionColor`, `mergeGroup`, `groupTransactions`.

- [ ] **Step 3: Simplify balance query**

```typescript
const { data: user, isLoading } = useQuery({
  queryKey: ["auth", "me"],
  queryFn: () => proxyApi.me(),
  enabled: isConnected,
  refetchInterval: 30_000,
});
```

- [ ] **Step 4: Replace billing UI with simplified version**

Replace the entire component body after "Not connected" section:

```typescript
// Not connected — inline prompt
if (!isConnected) {
  return (
    <div className="text-center py-20">
      <WorkCraftLogo size={40} className="text-[var(--text-tertiary)] mx-auto mb-3" />
      <p className="text-sm text-[var(--text-secondary)] mb-4">
        {t('connectPrompt')}
      </p>
      <Button variant="outline" size="sm" onClick={() => onNavigateTab?.("providers")}>
        {t('goToSettings')}
      </Button>
    </div>
  );
}

return (
  <div className="space-y-8">
    {/* Balance Overview */}
    <section>
      <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">{t('balance')}</h2>
      {isLoading ? (
        <div className="rounded-xl border border-[var(--border-default)] p-4">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--text-tertiary)]" />
        </div>
      ) : user ? (
        <div className="rounded-xl border border-[var(--border-default)] p-4">
          <div className="flex items-center gap-2 mb-1">
            <CreditCard className="h-4 w-4 text-[var(--text-tertiary)]" />
            <span className="text-xs text-[var(--text-tertiary)] uppercase tracking-wider">
              {t('credits')}
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-semibold text-[var(--text-primary)] font-mono">
              ${(user.balance ?? 0).toFixed(2)}
            </span>
          </div>
        </div>
      ) : null}
    </section>

    <Separator />

    {/* Add Balance */}
    <section>
      <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">{t('addBalance')}</h2>
      <p className="text-xs text-[var(--text-secondary)] mb-3">
        {t('addBalanceDesc')}
      </p>
      <Button
        onClick={() => {
          const url = "https://aihub2.top/purchase";
          if (IS_DESKTOP) {
            desktopAPI.openExternal(url);
          } else {
            window.open(url, "_blank", "noopener,noreferrer");
          }
        }}
        className="w-full"
      >
        <ExternalLink className="h-4 w-4 mr-2" />
        {t('openPaymentPage')}
      </Button>
    </section>
  </div>
);
```

- [ ] **Step 5: Add i18n keys for new text**

Ensure billing translations include:
- `addBalance`: "充值"
- `addBalanceDesc`: "点击下方按钮跳转到 Sub2API 充值页面"
- `openPaymentPage`: "打开充值页面"

- [ ] **Step 6: Verify component compiles**

Run: `cd frontend && npx tsc --noEmit src/components/settings/billing-tab.tsx`
Expected: No errors

- [ ] **Step 7: Commit billing changes**

```bash
git add frontend/src/components/settings/billing-tab.tsx frontend/src/i18n/locales/*/billing.json
git commit -m "feat: simplify billing tab for Sub2API integration

- Remove credit packs, transaction history
- Show balance from user.balance
- External payment link to aihub2.top/purchase

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 6: Frontend - Update Providers Tab

**Files:**
- Modify: `frontend/src/components/settings/providers-tab.tsx`

Key changes:
1. Update WorkCraft account section to show Sub2API user info
2. Use `user.balance` for balance display
3. "Add Balance" button opens external payment page

- [ ] **Step 1: Find WorkCraft account section**

Locate the section that displays connected WorkCraft account info (likely around lines 200-300).

- [ ] **Step 2: Update balance display**

Change from credits/free tokens to simple balance:

```typescript
<span className="text-lg font-semibold text-[var(--text-primary)] font-mono">
  ${(user?.balance ?? 0).toFixed(2)}
</span>
```

- [ ] **Step 3: Update "Add Balance" button**

```typescript
<Button
  onClick={() => {
    const url = "https://aihub2.top/purchase";
    if (IS_DESKTOP) {
      desktopAPI.openExternal(url);
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }}
  variant="outline"
  size="sm"
>
  <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
  充值
</Button>
```

- [ ] **Step 4: Remove free tier display**

Remove any display of `daily_free_tokens_used`, `daily_free_token_limit`, `billing_mode`.

- [ ] **Step 5: Verify component compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit providers tab changes**

```bash
git add frontend/src/components/settings/providers-tab.tsx
git commit -m "feat: update providers tab for Sub2API integration

- Show balance from user.balance
- External payment link for Add Balance
- Remove free tier quota display

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 7: Integration Test - Verify Auth Flow

- [ ] **Step 1: Start backend**

Run: `cd backend && python run.py`
Expected: Backend starts on port 8000

- [ ] **Step 2: Start frontend dev server**

Run: `cd frontend && npm run dev`
Expected: Frontend starts on port 3000

- [ ] **Step 3: Test login flow**

1. Open http://localhost:3000
2. Go through onboarding
3. Enter email + password
4. Verify login works (check console for API calls)
5. Verify user info is stored in localStorage `workcraft-auth`

- [ ] **Step 4: Test API Key creation**

1. After login, check that `apiKey` is stored
2. Verify it has `sk-xxx` format

- [ ] **Step 5: Test billing redirect**

1. Go to Settings > Billing
2. Click "打开充值页面"
3. Verify it opens https://aihub2.top/purchase in external browser

- [ ] **Step 6: Commit integration test notes**

Document any issues found and fix them in subsequent commits.

---

## Self-Review Checklist

**1. Spec coverage:**
- [x] Backend proxy endpoints (Task 1)
- [x] Auth store update (Task 2)
- [x] Proxy API client (Task 3)
- [x] Onboarding simplification (Task 4)
- [x] Billing external redirect (Task 5)
- [x] Providers tab update (Task 6)
- [x] API Key get-or-create (Task 4)
- [x] 2FA detection (Task 4)

**2. Placeholder scan:**
- No "TBD" or "TODO" found
- All code blocks contain actual implementation code
- No "implement later" patterns

**3. Type consistency:**
- `Sub2APIUser` used consistently in auth-store, onboarding, proxy-api
- `apiKey: string | null` in auth-store matches usage in onboarding
- Backend response types match frontend expectations
