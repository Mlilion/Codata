# Sub2API Integration Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace WorkCraft account system with Sub2API integration for auth, billing, and API key management.

**Architecture:** Backend proxy endpoints avoid CORS issues. Frontend calls local backend which forwards to Sub2API. API Key get-or-create pattern ensures seamless `/v1/models` calls.

**Tech Stack:** FastAPI (backend proxy), Zustand (frontend auth store), Tauri v2 (desktop), Next.js 15 (frontend)

---

## 1. Sub2API Endpoints Summary

### Auth Endpoints
| Endpoint | Method | Request | Response |
|----------|--------|---------|----------|
| `/api/v1/auth/login` | POST | `{email, password}` | `{access_token, refresh_token, expires_in, user}` or `{requires_2fa, temp_token, user_email_masked}` |
| `/api/v1/auth/register` | POST | `{email, password, verify_code?}` | `{message, email}` (verify_code optional, Sub2API disabled it) |
| `/api/v1/auth/refresh` | POST | `{refresh_token}` | `{access_token, refresh_token, expires_in}` |
| `/api/v1/auth/me` | GET | - (Bearer token) | `{id, email, username, role, balance, status, ...}` |

### API Key Endpoints (for /v1/models calls)
| Endpoint | Method | Request | Response |
|----------|--------|---------|----------|
| `/api/v1/keys` | GET | - (Bearer token) | Paginated `{items: [{id, key, name, status, ...}], total, page, ...}` |
| `/api/v1/keys` | POST | `{name?, group_id?, ...}` | `{id, key, name, status, ...}` |

### Response Format (all endpoints)
```json
{
  "code": 0,
  "message": "success",
  "data": { ... }
}
```

---

## 2. Backend Proxy Endpoints

All endpoints under `/proxy-auth/` and `/proxy-keys/` to avoid CORS.

### Auth Proxy
| WorkCraft Endpoint | Sub2API Target |
|------------------|-----------------|
| `POST /proxy-auth/login` | `POST https://aihub2.top/api/v1/auth/login` |
| `POST /proxy-auth/register` | `POST https://aihub2.top/api/v1/auth/register` |
| `POST /proxy-auth/refresh` | `POST https://aihub2.top/api/v1/auth/refresh` |
| `GET /proxy-auth/me` | `GET https://aihub2.top/api/v1/auth/me` |

### API Key Proxy
| WorkCraft Endpoint | Sub2API Target |
|------------------|-----------------|
| `GET /proxy-keys/list` | `GET https://aihub2.top/api/v1/keys` |
| `POST /proxy-keys/create` | `POST https://aihub2.top/api/v1/keys` |

### Response Transformation
Backend unwraps Sub2API nested response `{code, message, data}` → returns only `data` to frontend.

---

## 3. Frontend Auth Flow

### Login Flow
1. User enters email + password
2. Frontend calls `POST /proxy-auth/login`
3. Backend forwards to Sub2API, unwraps response
4. If `requires_2fa` → Show message "您的账号已启用两步验证，请在网页端登录" + link to `https://aihub2.top/login`
5. If success → Store `{access_token, refresh_token, user}` in Zustand, get-or-create API Key
6. Navigate to chat

### API Key Get-or-Create
After successful login:
1. Call `GET /proxy-keys/list` to check existing keys
2. If active key exists (status = "active") → use it
3. If no active key → Call `POST /proxy-keys/create` with `{name: "WorkCraft Desktop"}`
4. Store `api_key` (sk-xxx format) in auth store for `/v1/models` calls

### Registration Flow
1. User enters email + password (no verification code required)
2. Frontend calls `POST /proxy-auth/register`
3. Backend forwards to Sub2API
4. If success → Same as login flow (store tokens, get-or-create API Key)

---

## 4. Frontend Store Changes

### `auth-store.ts`
```typescript
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
  // Fixed config
  proxyUrl: string; // Always "https://aihub2.top"

  // JWT tokens
  accessToken: string;
  refreshToken: string;

  // User profile
  user: Sub2APIUser | null;

  // API Key for /v1/models
  apiKey: string | null; // sk-xxx format

  // Connection status
  isConnected: boolean;

  // Actions
  setAuth: (params: { accessToken, refreshToken, user, apiKey }) => void;
  updateUser: (user: Sub2APIUser) => void;
  logout: () => void;
}
```

### Removed Fields
- `billing_mode` (free/credits)
- `credit_balance`
- `daily_free_tokens_used`
- `daily_free_token_limit`

---

## 5. UI Component Changes

### Onboarding Screen (`onboarding-screen.tsx`)
- Remove proxy URL input (fixed to `https://aihub2.top`)
- Remove email verification code step
- Add 2FA guidance message when detected
- Add API Key get-or-create after auth success

### Billing Tab (`billing-tab.tsx`)
- Balance display: Fetch from `/proxy-auth/me` → `user.balance`
- Recharge button: Opens `https://aihub2.top/purchase` in external browser
- Remove credit packs UI (Sub2API handles payment)
- Remove transaction history (can add later via `/api/v1/orders` proxy)

### Providers Tab (`providers-tab.tsx`)
- "WorkCraft Account" section shows user info from Sub2API
- Balance displayed as `$X.XX`
- "Add Balance" button opens external payment page

---

## 6. API Key Usage

The `apiKey` (sk-xxx) is used when calling `/v1/models` through the backend:

```typescript
// Backend adds Authorization header when forwarding to Sub2API
headers: {
  "Authorization": `Bearer ${apiKey}` // sk-xxx format
}
```

---

## 7. Error Handling

### Sub2API Error Response
```json
{
  "code": 1001,
  "message": "Invalid credentials",
  "data": null
}
```

Frontend receives unwrapped error from backend proxy:
```json
{
  "error": "Invalid credentials",
  "code": 1001
}
```

### 2FA Detection
When login returns `{requires_2fa: true}`:
- Show: "您的账号已启用两步验证，请在网页端登录"
- Link: `https://aihub2.top/login`

---

## 8. Fixed Configuration

- **Sub2API URL**: `https://aihub2.top` (hardcoded, no user input)
- **API Key Name**: `WorkCraft Desktop` (when creating new key)

---

## 9. Payment Flow (External)

User clicks "充值" / "Add Balance":
1. Desktop: `desktopAPI.openExternal("https://aihub2.top/purchase")`
2. Web: `window.open("https://aihub2.top/purchase", "_blank")`
3. User logs in on Sub2API website (may need to re-login)
4. User completes payment
5. User returns to WorkCraft, clicks refresh to update balance

---

## 10. Files to Modify

### Backend
- `backend/app/api/config.py` - Add proxy endpoints

### Frontend
- `frontend/src/stores/auth-store.ts` - Update user type, add apiKey
- `frontend/src/lib/proxy-api.ts` - Adapt for Sub2API response format
- `frontend/src/components/onboarding/onboarding-screen.tsx` - Simplify auth flow
- `frontend/src/components/settings/billing-tab.tsx` - External payment redirect
- `frontend/src/components/settings/providers-tab.tsx` - Update account section