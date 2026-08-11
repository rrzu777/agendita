# Track E final remediation report

## Outcome

Closed the five final product/security findings on base `219f55a`. Push
activation now shares one strict, exact-boundary eligibility contract; guest
authorization is revalidated transactionally; accounts with no eligible target
cannot request permission; browser endpoint deactivation removes every server
scope carried by that endpoint; and public booking consent linearizes against
Business settings without lock upgrades or public/dashboard deadlocks.

## Remediation

- Central activation eligibility requires usable push configuration, an enabled
  business toggle, an allowed future booking, a positive required or paid
  deposit, a positive snapshot/fallback cutoff, safe integer arithmetic, and
  `now < startDateTime - cutoffHours`. Equality is closed. Guest confirmation,
  `/mi`, account preflight, status and subscribe use this contract.
- Guest subscribe rechecks booking identity, state, business toggle, deposit and
  the open cutoff after endpoint and Customer locks, immediately before any
  subscription/entitlement write. Guest status hides stale associations. Guest
  unsubscribe intentionally rechecks ownership only, so a stale grant can still
  remove its endpoint.
- `/notificaciones` server-renders `canActivateAccount`. An authenticated account
  with zero targets never exposes activation or requests browser permission, but
  still discovers, verifies and removes an existing local subscription. Account
  subscribe performs a provisional target read, takes deterministic Customer
  locks, then repeats the authoritative read with a fresh post-lock time. A new
  unlocked target fails safely instead of bypassing the device cap.
- Browser deactivation sends endpoint-possession cleanup for the exact endpoint,
  removing all guest and account scopes across key generations before the local
  capability is invalidated. If remote cleanup fails after local unsubscribe,
  the endpoint is retained only for server retry; local `unsubscribe()` is not
  repeated.
- Public booking creation reads cutoff, additional policy and the push toggle
  under `Business FOR UPDATE`, compares the submitted revision, and uses the
  locked values through commit. The stronger lock is the safe equivalent of
  `FOR SHARE`: it prevents a later `bookingNumberSeq` lock upgrade. Dashboard
  creation remains exempt from consent revision, but allocates its booking
  number before the slot lock so every create path follows Business → slot →
  Customer. Notifications and other external work remain after commit.
- The design document now records the final eligibility, cleanup, preflight,
  policy-lock and lock-order contracts.

## TDD and review evidence

- Initial focused RED: 14 expected failures across exact cutoff, stale guest
  eligibility/status, zero-target account UI, global endpoint cleanup and policy
  locking/snapshots. Focused GREEN: 165 tests.
- Post-lock clock RED: two requests that waited across the exact cutoff still
  activated. Guest and account clocks now evaluate after their required locks;
  focused subscription GREEN: 56 tests.
- Caller/toggle RED: the auth route forced a pre-transaction clock and a stale
  outer Business read emitted a guest grant after the locked toggle was off.
  Route/booking GREEN: 84 tests.
- PostgreSQL RED reproduced the real lock inversion as `40P01 deadlock detected`
  between dashboard slot ownership and the public Business lock. `FOR UPDATE`
  plus the unified lock order removed the cycle.
- Real PostgreSQL concurrency coverage proves update-first rejection, lock-first
  snapshot linearization, public/public serialization on different days,
  public/dashboard serialization on one day, and idempotent retry after later
  policy changes.
- First independent review findings were all remediated. The blocking re-review
  returned READY with zero CRITICAL, HIGH, MEDIUM or LOW findings; its focused
  PostgreSQL verification passed 10/10 and typecheck/diff-check were clean.

## Final verification

- `npm run test:unit`: 323 files, 2,907 tests passed.
- `npm run test:integration`: 52 files, 313 tests passed against PostgreSQL 16
  after all 36 migrations.
- Focused Playwright push E2E: 3/3 passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed with 0 errors and 35 existing repository warnings,
  none introduced by Track E.
- `npx prisma validate` and `npx prisma generate`: passed.
- CI-equivalent VAPID-enabled `npm run build`: passed; 50 static pages generated.
- `git diff --check`: passed.

## Residual deployment gate

Automated browser mocks cannot prove vendor delivery or installed-iOS behavior.
A deployed Web Push subscribe/delivery/unsubscribe smoke with the production
VAPID configuration and a physical installed iOS PWA remains the rollout gate;
it is not a code blocker for this remediation.
