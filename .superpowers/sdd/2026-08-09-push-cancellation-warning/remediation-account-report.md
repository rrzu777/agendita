# Track D remediation — account eligibility and policy consent

## Outcome

Implemented the final account/policy/security remediation on base `bf49fd5`.
Authenticated Web Push now uses one server-authoritative eligibility contract,
account authorization takes precedence over guest capabilities, policy consent
is revision-bound before new booking creation, scheduler success is guarded by
the live booking/account authorization, and VAPID replacement retires the old
endpoint server-side without making cleanup availability a replacement blocker.

## TDD evidence

- Eligibility/auth scope RED: 10 expected failures covered session precedence,
  full account coverage, deposit/cutoff filtering, `/mi` CTA visibility and old
  VAPID cleanup. GREEN: 4 focused files, 123 tests.
- Policy/mode RED: 7 expected failures covered server-rendered revision handoff,
  stale consent rejection, wizard/confirmation modes and public confirmation.
  GREEN: 7 focused files, 68 tests.
- Scheduler authorization RED: 2 stale-success cases were counted after guest
  entitlement/account authorization detachment. GREEN: scheduler file, 60 tests.
- Adversarial RED/GREEN: a rejected local unsubscribe blocked VAPID replacement;
  it now remains best effort (PushManager, 25 tests). A signed-in but unlinked
  Customer incorrectly received a guest grant; it now returns mode `null`
  (createBooking file, 14 tests).
- Typecheck RED exposed one nullable scheduler read plus required revision props
  missing from legacy fixtures. All were made explicit; typecheck is green.
- First real-Postgres integration run passed 290/305; all 15 failures were
  existing public-booking fixtures correctly rejected for omitting the new
  policy revision. The fixtures now derive the real revision and the complete
  rerun passes 305/305.

## Implementation

- Added `src/lib/push/eligibility.ts`. Activation requires usable VAPID and
  encryption configuration, business toggle enabled, a future non-terminal
  booking, positive effective snapshot/fallback cutoff, and a required or paid
  deposit. Delivery remains stricter: confirmed and paid only.
- `/mi`, authenticated subscribe target resolution and authenticated status use
  that contract. Status is true only when the active endpoint covers every
  currently eligible Customer; an empty or partial set is false. Subscribe
  associates the complete current set in one serialized transaction.
- Subscribe/status/unsubscribe resolve an explicit authenticated session before
  any supplied guest grant. Endpoint-possession cleanup remains an explicit,
  independent scope.
- Booking action results carry `pushMode: account | guest | null`. A matching
  authenticated Customer gets account mode and no grant; anonymous eligible
  bookings get guest mode; signed-in unlinked/mismatched and ineligible bookings
  get neither. Normal, idempotent, P2002 and Mercado Pago handoffs are covered.
- Added a deterministic SHA-256 cancellation-policy revision over business,
  cutoff and additional policy. The server-rendered booking page passes it
  through wizard/payment to `createBooking`; new creation rejects stale,
  missing or tampered consent before the insert, while an idempotent existing
  booking still returns its stored snapshots after later settings changes.
  Dashboard creation is unchanged and exempt.
- A successful provider delivery now updates subscription success state only
  when the delivered generation still has the exact booking entitlement or the
  revalidated non-null account authorization. A stale success does not mark the
  booking sent and retries against the current generation without touching
  another scope.
- VAPID mismatch replacement first attempts endpoint-possession cleanup, then
  local unsubscribe, then browser resubscribe. Both cleanup operations are best
  effort; available server cleanup prevents stale rows from consuming device
  caps.
- Settings copy now names Web Push and states the activation/delivery
  conditions. The design document records the final contracts.

## Verification

- `npm test`: 322 files, 2,888 tests passed.
- `npm run test:integration`: 51 files, 305 tests passed against a fresh
  PostgreSQL 16 database after all 36 migrations.
- Targeted Playwright push describe: 3/3 passed on the production build.
- `npm run typecheck`: passed.
- `npm run lint`: passed with 0 errors and 35 existing warnings.
- `npx prisma validate`: passed with explicit test URLs.
- `npx prisma generate`: passed.
- VAPID-enabled `npm run build`: passed; 50 static pages generated.
- `git diff --check`: passed.

## Residual deployment gate

No automated test can prove vendor delivery or installed-iOS behavior. A real
Web Push subscribe/delivery/unsubscribe smoke with deployed VAPID secrets and a
physical installed iOS PWA remains the rollout gate. No schema migration was
needed for this remediation.
