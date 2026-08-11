# Remediation Track C: customer push journeys

## Scope

Completed the remaining customer-facing cancellation-policy and Web Push
lifecycle contracts. This track keeps offline navigation out of scope and
preserves real-device delivery as an explicit rollout gate.

## TDD evidence

- Legal/confirmation RED: 7 failures proved the exact cutoff warning was
  missing or ordered incorrectly across payment, wizard and public
  confirmation paths. GREEN: 17 focused tests.
- Push lifecycle/routes RED: 8 failures proved missing server auth state,
  reload discovery, endpoint-possession cleanup, safe local unsubscribe,
  iPadOS detection and streamed body bounding. GREEN: 78 focused tests.
- Grant/config RED: 6 failures proved grants were still issued without the
  full eligibility and valid VAPID contract. GREEN: 54 focused tests.
- Integration RED: Playwright exposed missing guest-safe Supabase placeholders
  after `/notificaciones` became session-aware. The self-contained E2E server
  was fixed, then all 3 permission/no-auth/reload/deactivate journeys passed.
- Expanded regression suite: 321 files and 2,844 tests passed. A stale cron
  test fixture that used fake VAPID strings was updated to the shared matching
  test keypair; its 58 cases pass under strict runtime validation.

## Implementation

- Payment review shows the exact `cancellationWarningText` before any
  additional policy only when the effective deposit is positive, in all three
  payment branches. Wizard and public confirmation use the snapshotted cutoff
  and policy, retaining legacy fallback behavior.
- `/notificaciones` resolves the server session. Without a session, eligible
  grant or existing browser subscription, it explains how to continue and
  never exposes an activation/permission action.
- Mount-time discovery reads an existing service-worker registration and push
  subscription without registering, requesting permission or subscribing.
  Existing subscriptions remain locally removable after reload, including for
  logged-out guests.
- Logged-out cleanup treats the canonical endpoint as a possession capability,
  applies canonical-Origin and hashed-target rate limits, revokes every local
  generation/entitlement, and returns no row count. Local browser unsubscribe
  still executes when server cleanup fails; the UI exposes a cleanup-only
  retry that cannot re-subscribe.
- Runtime push availability validates the complete matching VAPID pair,
  subject and encryption key. A guest grant is issued only when that config is
  usable, the business reminder toggle is enabled, the snapshotted cutoff is
  positive and the persisted booking has a positive deposit required or paid.
  Ineligible or unavailable push never invalidates the booking.
- iPadOS desktop user agents are recognized through `Macintosh` plus touch
  points. JSON route bodies are bounded from the request stream before full
  buffering and use Edge-safe platform APIs.
- Go/no-go docs no longer freeze test/lint/migration counts, describe the
  actual hourly hold cron, and keep Chromium/iOS real-device QA pending.

## Verification

- Focused UI/routes/bookings/push delivery: 14 files, 207 tests passed.
- Full unit suite: 321 files, 2,844 tests passed.
- Push Playwright E2E: 3 tests passed.
- `npm run typecheck`: passed.
- `npm run lint`: 0 errors; 35 existing warnings outside Track C.
- Production `npm run build` with non-secret build fixtures: passed, including
  environment validation, Prisma generation, TypeScript and 49 static pages.
- `git diff --check`: passed.
- Independent code review and post-fix re-review: READY, no remaining blockers.

## Review fixes

- Review RED proved possession cleanup used an endpoint lock that neither
  subscribe path shared. Both guest/single-target and authenticated-batch
  subscribe transactions now acquire that endpoint lock first, so cleanup
  cannot return before an earlier overlapping subscribe is revoked.
- Review RED also proved that a browser subscription created before a rejected
  or zero-target server association was not locally removable until reload.
  The manager now retains the browser effect immediately and offers an
  explicit deactivation/cleanup action for both cases; it never claims the
  recordatorios are active.
- Re-review RED used the real unauthorized-guest contract and proved that
  resending its rejected grant made every cleanup retry return 401. Failed
  grants are now discarded before endpoint-possession cleanup; an account
  session remains independently eligible, while a guest returns to sign-in.

## External review round 1

- Server RED failed five assertions plus the missing status-route import; it
  proved the page exposed a public key from an unusable VAPID configuration
  and that no privacy-safe authoritative association lookup existed. Client
  RED failed seven reload/rotation/revocation/cleanup assertions, followed by
  one focused RED for an unavailable status check. GREEN is 102 tests across
  the four focused route, storage, page and manager suites.
- `/api/push/status` now requires canonical Origin, bounded JSON and a valid
  browser endpoint, applies generic plus endpoint-hash rate limits, and returns
  only `{ associated: boolean }`. Guest grants check the exact booking
  entitlement, sessions check `authorizedUserId`, and endpoint possession
  checks only whether that high-entropy endpoint retains any authorization.
- Reload preserves the local subscription but reports active only when its
  application-server key matches current VAPID and the server returns the
  exact associated boolean. Old keys and confirmed missing associations offer
  gesture-driven update only with an eligible scope; otherwise they offer
  cleanup. A 401, 429, 5xx, malformed response or network failure remains a
  separate “no pudimos verificar” state and never claims active or inactive.
- Review RED then failed four assertions proving two subtler gaps: a signed-in
  browser could turn a stale-grant fallback into user-scoped cleanup, and an
  unavailable status response was described as a confirmed inactive
  association. The retry now explicitly selects endpoint possession without
  the grant even when a session exists; verification failure has truthful copy
  and a status-only retry. Browser unsubscribe still executes exactly once.
- Fresh focused verification: 102 unit tests and all three Web Push Playwright
  journeys pass. Typecheck, production build and diff checks pass; lint remains
  at zero errors and the same 35 warnings outside this remediation. Real-device
  delivery remains pending as stated below.

## Remaining rollout gate

Provider delivery, installed-PWA behavior and unsubscribe must still be
validated on real Chromium and iOS/iPadOS 16.4+ devices. The go/no-go checklist
keeps those checks pending; this implementation does not claim device delivery
from mocked browser coverage.
