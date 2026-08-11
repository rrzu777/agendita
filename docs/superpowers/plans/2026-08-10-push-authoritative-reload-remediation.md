# Push Authoritative Reload Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make notification reload state authoritative across browser and server, and guarantee invalid guest grants cannot trap cleanup in a 401 loop.

**Architecture:** The server-rendered page exposes the public VAPID key only when the complete runtime configuration is usable. A canonical-origin POST status route validates the bounded endpoint, rate-limits both the caller and hashed endpoint, resolves guest/account/endpoint scopes, and returns one privacy-safe boolean. The client keeps every discovered local subscription but treats it as active only when its VAPID key matches and the server confirms a live association; all replacement remains behind an explicit gesture.

**Tech Stack:** Next.js 16 Route Handlers and Server/Client Components, React 19, Prisma, Vitest, Playwright.

## Global Constraints

- Mount must never request notification permission, register a worker, subscribe, unsubscribe, or replace a subscription.
- Status and cleanup routes require exact canonical `Origin`, bounded JSON, endpoint validation, and generic boolean/error DTOs without counts or identity.
- A guest scope checks the exact active booking entitlement; an account checks `authorizedUserId`; endpoint possession checks only whether the exact endpoint hash has any active association.
- A mismatched or missing browser application-server key is never reported active.
- An invalid/expired grant cleanup retries exactly once without the grant and with explicit endpoint-possession scope, even when an account session exists; browser unsubscribe runs exactly once and activation is never invoked.
- Public key exposure requires `hasUsablePushConfig()`.

---

### Task 1: Authoritative status route and server page configuration

**Files:**
- Create: `src/app/api/push/status/route.ts`
- Modify: `src/lib/push/routes.ts`
- Modify: `src/lib/push/subscription.ts`
- Modify: `src/app/notificaciones/page.tsx`
- Modify: `tests/unit/push-routes.test.ts`
- Modify: `tests/unit/push-subscription.test.ts`
- Modify: `tests/unit/notifications-page.test.tsx`

**Interfaces:**
- Consumes: `readBoundedJson`, `validPushEndpoint`, `resolvePushStatusScope`, `hashPushEndpoint`, `getCurrentUser`, `verifyPushGrant`.
- Produces: `POST /api/push/status` with `{ endpoint, grant? } -> { associated: boolean }` and `hasActivePushAssociation({ endpoint, scope }): Promise<boolean>`.

- [x] **Step 1: Write failing route, storage and page tests**

Add tests proving canonical-Origin rejection, generic and hashed-target rate limits, bounded/valid endpoint validation, exact guest entitlement, exact account authorization, endpoint-possession boolean-only lookup, and public-key suppression for partial/invalid runtime configuration.

- [x] **Step 2: Run the RED tests**

Run: `npx vitest run tests/unit/push-routes.test.ts tests/unit/push-subscription.test.ts tests/unit/notifications-page.test.tsx`

Expected: failures because the status route/scope/query do not exist and the page still exposes a lone public key.

- [x] **Step 3: Implement the minimal server contract**

Use a scope union of guest target, authenticated user, or endpoint possession. Query `PushSubscription` with `endpointHash`, `revokedAt: null`, and exactly one of: the guest booking entitlement and customer/business binding; `authorizedUserId`; or any remaining user/booking authorization for endpoint possession. Return only `Boolean(row)` from storage and `{ associated }` from the route. Pass `hasUsablePushConfig() ? NEXT_PUBLIC_VAPID_PUBLIC_KEY : null` from the page.

- [x] **Step 4: Run the GREEN server tests**

Run: `npx vitest run tests/unit/push-routes.test.ts tests/unit/push-subscription.test.ts tests/unit/notifications-page.test.tsx`

Expected: all selected tests pass.

---

### Task 2: Authoritative browser reload and cleanup fallback

**Files:**
- Modify: `src/components/push/push-manager.tsx`
- Modify: `tests/unit/push-manager.test.tsx`
- Modify: `tests/e2e/self-service.spec.ts`
- Modify: `.superpowers/sdd/2026-08-09-push-cancellation-warning/remediation-ux-report.md`

**Interfaces:**
- Consumes: `POST /api/push/status`, `POST /api/push/subscribe`, `POST /api/push/unsubscribe`.
- Produces: truthful reload states `active`, `update-required`, `association-error`, `missing-scope`, and cleanup retry with at most one grant-to-possession fallback.

- [x] **Step 1: Write failing manager tests**

Cover matching VAPID plus associated true, matching VAPID plus associated false/revoked, mismatched/missing VAPID with allowed scope (`Actualizar recordatorios`), mismatched/missing VAPID without scope (cleanup only), prior failed association after reload, and discovered subscription plus invalid grant where unsubscribe returns 401 then endpoint-only succeeds. Assert zero mount-time permission/register/subscribe/unsubscribe calls.

- [x] **Step 2: Run the RED manager tests**

Run: `npx vitest run tests/unit/push-manager.test.tsx`

Expected: reload is incorrectly reported active and cleanup does not retry without the invalid grant.

- [x] **Step 3: Implement minimal client state transitions**

Keep the discovered local subscription in `subscriptionRef`. Compare `options.applicationServerKey` to the configured key before status lookup. Fetch status only for matching keys, parse exactly `{ associated: boolean }`, render active only for `true`, and keep transport/auth failures in a separate unverifiable state. Replacement calls the existing gesture-driven activation path; cleanup retains local unsubscribe exactly once. Centralize server cleanup so a non-OK response made with a grant clears it and retries once with `{ endpoint, endpointPossession: true }`, including `retryCleanup`.

- [x] **Step 4: Run GREEN unit and E2E tests**

Run: `npx vitest run tests/unit/push-manager.test.tsx tests/unit/push-routes.test.ts tests/unit/push-subscription.test.ts tests/unit/notifications-page.test.tsx`

Run: `npm run test:e2e -- --grep 'self-service: recordatorios push'`

Expected: all selected unit and E2E tests pass.

- [x] **Step 5: Review, verify and commit**

Request independent code review and a second post-fix review. Then run `npm run typecheck`, `npm run lint`, production `npm run build`, and `git diff --check`. Update the remediation report with RED/GREEN counts and the review disposition, then commit the complete round in one follow-up commit.
