# Open Source Frontend Commercial Removal Design

Date: 2026-06-11
Status: Draft for implementation

## Goal

Remove the public frontend dependency chain for WorkCraft Cloud account, Sub2API
proxy auth, billing, recharge, subscriptions, credits, and paid upgrade prompts.

This is the first extraction slice after the boundary audit. It makes the
frontend usable as an open source local/BYOK app without requiring a WorkCraft
account or commercial proxy. Backend commercial tools, private release
infrastructure, brand assets, and bundled third-party content are left for later
slices.

## Scope

This slice includes:

- Removing the account tab and first-run WorkCraft account onboarding from the
  public frontend.
- Removing Sub2API API clients and WorkCraft billing helpers from the public
  frontend.
- Removing Sub2API frontend proxy rewrites from `frontend/next.config.ts`.
- Removing recharge, subscription, credits, and upgrade prompt UI.
- Removing `workcraft-proxy` as a selectable or auto-detected frontend model
  provider.
- Keeping BYOK, custom endpoint, ChatGPT subscription, Ollama, and local
  provider flows available.
- Updating tests so commercial account/billing frontend paths cannot reappear
  silently.

This slice does not include:

- Removing backend `workcraft-proxy` registration or `/proxy-*` routes.
- Removing ViMax, Baoyu, or commercial media tooling.
- Removing private release workflows and updater infrastructure.
- Replacing WorkCraft logos, desktop icons, or trademarked assets.
- Auditing bundled plugins, skills, PDF assets, or third-party notices.

## Public Frontend Behavior

The public frontend opens directly into the app after normal settings hydration.
It does not block on WorkCraft account auth. The settings sidebar has no Account
tab and redirects legacy `?tab=account` or `?tab=billing` links to provider
configuration.

Model selection is provider-driven:

- BYOK providers are configured in Settings -> Providers.
- Custom endpoints remain available.
- ChatGPT subscription, Ollama, and local providers remain available if the
  backend exposes them.
- `workcraft-proxy` models are hidden in public frontend selectors even if a
  backend still returns them during the backend extraction transition.

Quota, payment, and billing failures are shown as normal backend errors. The
public frontend does not display a paid upgrade dialog or link to a purchase
page.

## Commercial Overlay Behavior

The private commercial repository can reintroduce these features by overlaying
commercial modules:

- `frontend/src/lib/proxy-api.ts`
- `frontend/src/lib/workcraft-billing.ts`
- `frontend/src/stores/auth-store.ts`
- `frontend/src/stores/billing-store.ts`
- `frontend/src/components/settings/account-tab.tsx`
- `frontend/src/components/settings/recharge-panel.tsx`
- `frontend/src/components/billing/`
- billing locale namespaces

The public code should not import these modules or depend on them being present.

## Architecture

The public frontend keeps the existing provider architecture and removes only
the commercial provider source. `ActiveProvider` no longer includes
`workcraft`. Helpers that map provider IDs to active provider groups treat
`workcraft-proxy` as non-public and exclude it from BYOK results.

The main layout no longer contains account sync logic, onboarding auth gates, or
upgrade prompts. It continues to render the shell, sidebars, update banner, chat
content, and provider auto-detection.

The sidebar footer becomes a local profile and settings menu. It keeps theme,
update, user guide, and settings actions, but removes account IDs, sign out,
credits, subscriptions, recharge links, and WorkCraft account balance displays.

Expert team creation is no longer gated on WorkCraft account state in the
frontend. It requires an active model provider selection. Backend authorization
errors still surface through existing API error handling until backend policy is
cleaned in a later slice.

## Verification

This slice is complete when:

- The public frontend has no tracked commercial account/billing files:
  - `frontend/src/stores/billing-store.ts`
  - `frontend/src/lib/workcraft-billing.ts`
  - `frontend/src/lib/proxy-api.ts`
  - `frontend/src/components/settings/account-tab.tsx`
  - `frontend/src/components/settings/recharge-panel.tsx`
  - `frontend/src/components/billing/`
  - `frontend/src/i18n/locales/en/billing.json`
  - `frontend/src/i18n/locales/zh/billing.json`
- `frontend/src` has no imports of the deleted commercial modules.
- `frontend/src` has no `WORKCRAFT_ACCOUNT` or `PROXY_*` frontend constants.
- `workcraft-proxy` is not selectable or user-facing. During the backend
  extraction transition, the literal provider id may appear only in a public
  provider denylist helper and tests that verify it stays hidden.
- `frontend/next.config.ts` no longer rewrites `/proxy-auth/*`,
  `/proxy-keys/*`, `/proxy-payment/*`, or `/proxy-subscriptions/*`.
- `OPEN_SOURCE_BOUNDARY.md` and `scripts/check-open-source-boundary.mjs` no
  longer list the deleted frontend account/billing paths as tracked commercial
  blockers.
- `npm run audit:open-source-boundary` no longer reports the removed frontend
  account/billing paths.
- Existing root script tests pass with `node --test scripts/*.test.mjs`.
- Frontend static checks pass with `cd frontend && npm run lint`.

## Known Follow-Up

After this slice lands, continue with backend commercial extraction:

1. Remove WorkCraft proxy provider registration and `/proxy-*` backend routes.
2. Remove ViMax and Baoyu commercial tools and data.
3. Remove private release, updater, and signing infrastructure.
4. Replace or trademark-restrict brand assets.
5. Audit bundled third-party content and notices.
