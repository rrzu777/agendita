# Cancellation Warning Web Push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver opt-in Web Push cancellation warnings for authenticated and guest customers, backed by immutable booking policy snapshots and recoverable scheduled delivery.

**Architecture:** All browser subscriptions live on the canonical app origin, while tenant booking pages transfer a short-lived signed grant through a URL fragment. A lease-based cron delivers one privacy-safe warning shortly before each booking’s snapshotted cancellation cutoff; screen and email remain the durable policy channels.

**Tech Stack:** Next.js App Router, React, Prisma/PostgreSQL, Web Push/VAPID, service workers, Vitest, GitHub Actions.

## Global Constraints

- Start only after the TypeScript Baseline PR is merged and this branch is rebased.
- Follow the repository’s installed Next.js documentation in `node_modules/next/dist/docs/`; do not use remembered APIs.
- `Business.selfServiceCutoffHours` configures future bookings; each booking uses its immutable snapshot afterward.
- No automatic refunds and no copy that promises one.
- No offline navigation, fetch handler, cache, background sync or precache.
- Push permission is requested only after a customer gesture on the canonical origin.
- Never log grants, endpoints, VAPID secrets, encrypted payloads or customer data.
- Every production behavior starts with a failing test and every task passes Build → Review → Fix → Re-review → Verify → Commit.

---

### Task 1: Persist contractual policy snapshots and push delivery state

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260809120000_add_cancellation_push/migration.sql`
- Modify: `src/lib/business/schema.ts`
- Modify: `src/server/actions/business-settings.ts`
- Modify: `src/components/dashboard/settings-form.tsx`
- Modify: `src/server/actions/bookings.ts`
- Test: `tests/unit/business-settings-schema.test.ts`
- Test: `tests/unit/business-settings-action.test.ts`
- Test: `tests/unit/create-booking-no-deposit.test.ts`

**Interfaces:**
- Produces: `Business.cancellationReminderEnabled: boolean`.
- Produces: `Booking.cancellationCutoffHours: number | null`, `cancellationPolicySnapshot: string | null`, `cancellationReminderClaimedAt: Date | null`, `cancellationReminderSentAt: Date | null`.
- Produces: `PushSubscription` related to `Business` and `Customer`, unique on `(customerId, endpointHash)`.

- [ ] **Step 1: Write failing schema/action tests**

Add assertions that settings default `cancellationReminderEnabled` to true,
persist false when submitted, and that `createBooking` writes:

```ts
expect(mockPrisma.booking.create).toHaveBeenCalledWith(expect.objectContaining({
  data: expect.objectContaining({
    cancellationCutoffHours: 24,
    cancellationPolicySnapshot: 'Condiciones originales',
  }),
}))
```

Run the three focused files and confirm failures are caused by absent fields.

- [ ] **Step 2: Add Prisma fields, relations and indexes**

Add to `Business`:

```prisma
cancellationReminderEnabled Boolean @default(true)
pushSubscriptions           PushSubscription[]
```

Add to `Booking`:

```prisma
cancellationCutoffHours       Int?
cancellationPolicySnapshot    String?
cancellationReminderClaimedAt DateTime?
cancellationReminderSentAt    DateTime?
```

Add to `Customer`:

```prisma
pushSubscriptions PushSubscription[]
```

Add the model:

```prisma
model PushSubscription {
  id                    String    @id @default(cuid())
  businessId            String
  customerId            String
  endpointHash          String
  subscriptionEncrypted String
  failureCount          Int       @default(0)
  lastFailureAt         DateTime?
  lastSuccessAt         DateTime?
  revokedAt             DateTime?
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt
  business              Business  @relation(fields: [businessId], references: [id], onDelete: Cascade)
  customer              Customer  @relation(fields: [customerId], references: [id], onDelete: Cascade)

  @@unique([customerId, endpointHash])
  @@index([businessId, revokedAt])
  @@index([endpointHash, revokedAt])
}
```

Add an index supporting the sweep:

```prisma
@@index([status, cancellationReminderSentAt, startDateTime])
```

Mirror these changes in the SQL migration with foreign keys and indexes; do not
use `prisma migrate dev`.

- [ ] **Step 3: Wire Settings validation and UI**

Add to `updateBusinessSchema`:

```ts
cancellationReminderEnabled: z.boolean().default(true),
```

Persist it in `updateBusinessSettings`, add it to form defaults and render a
controlled `Switch`. Relabel `cancellationPolicy` to “Condiciones adicionales”
with help text stating the structured hour limit takes precedence.

- [ ] **Step 4: Snapshot settings during booking creation**

Select `selfServiceCutoffHours` in `_createBooking` and write:

```ts
cancellationCutoffHours: business.selfServiceCutoffHours,
cancellationPolicySnapshot: business.cancellationPolicy,
```

Idempotent retry returns the already stored snapshots unchanged.

- [ ] **Step 5: Generate and verify**

```bash
npx prisma generate
npm test -- tests/unit/business-settings-schema.test.ts tests/unit/business-settings-action.test.ts tests/unit/create-booking-no-deposit.test.ts
npm run typecheck
```

- [ ] **Step 6: Review, fix, re-review and commit**

Review migration safety, relation ownership, indexes and setting defaults. After
re-review has no blocking findings:

```bash
git add prisma src/lib/business/schema.ts src/server/actions/business-settings.ts src/components/dashboard/settings-form.tsx src/server/actions/bookings.ts tests/unit/business-settings-schema.test.ts tests/unit/business-settings-action.test.ts tests/unit/create-booking-no-deposit.test.ts
git commit -m "feat: snapshot cancellation policy for bookings"
```

### Task 2: Make the snapshot authoritative across cancellation, confirmation and email

**Files:**
- Create: `src/lib/bookings/cancellation-policy.ts`
- Modify: `src/lib/bookings/self-service.ts`
- Modify: `src/server/actions/my-bookings.ts`
- Modify: `src/app/mi/[slug]/page.tsx`
- Modify: `src/app/mi/[slug]/reservas/[bookingId]/reprogramar/page.tsx`
- Modify: `src/lib/notifications/types.ts`
- Modify: `src/lib/notifications/templates.ts`
- Modify: `src/lib/bookings/notifications.ts`
- Modify: `src/lib/notifications/email-provider.ts`
- Modify: `src/components/booking/step-confirmation.tsx`
- Modify: `src/app/book/confirmation/page.tsx`
- Test: `tests/unit/cancellation-policy.test.ts`
- Test: `tests/unit/my-bookings-cancel.test.ts`
- Test: `tests/unit/my-bookings-reschedule.test.ts`
- Test: `tests/unit/notifications.test.ts`
- Test: `tests/unit/step-confirmation-cancellation-warning.test.tsx`

**Interfaces:**
- Produces: `resolveCancellationPolicy(booking, business): { cutoffHours: number; additionalPolicy: string | null }`.
- Produces: `cancellationWarningText(cutoffHours): string | null`.
- Extends `BookingCreated` with `cancellationCutoffHours: number` and
  `cancellationPolicySnapshot: string | null`, both copied from the persisted
  booking returned by the server.
- Consumes: booking snapshots from Task 1, with business fallback only for legacy nulls.

- [ ] **Step 1: Write failing pure-policy tests**

Cover snapshot precedence, legacy fallback, zero cutoff and exact copy:

```ts
expect(cancellationWarningText(24)).toBe(
  'Podés cancelar o reprogramar hasta 24 horas antes. Con menos anticipación, el abono no se devuelve. Para cancelaciones anteriores aplica la política del negocio.',
)
expect(cancellationWarningText(0)).toBeNull()
```

- [ ] **Step 2: Implement the pure policy module**

Export typed helpers with no database or clock dependency. Use singular
“1 hora” and plural for all other positive integers.

- [ ] **Step 3: Enforce snapshot ownership in self-service**

Select both booking snapshots in cancel/reschedule/page queries. Replace direct
reads of `business.selfServiceCutoffHours` with
`booking.cancellationCutoffHours ?? business.selfServiceCutoffHours`.

- [ ] **Step 4: Wire durable warning copy**

Extend `BookingEmailData` with required `cancellationCutoffHours: number` and
pass the snapshotted policy from both initial and later confirmation email
paths. Render the generated warning before the additional policy in HTML/text.

Pass the same cutoff into `StepConfirmation` and the server confirmation page;
show an amber, non-modal warning only when `depositRequired > 0` or
`depositPaid > 0` and cutoff is positive.

- [ ] **Step 5: Verify and commit through the review gate**

```bash
npm test -- tests/unit/cancellation-policy.test.ts tests/unit/my-bookings-cancel.test.ts tests/unit/my-bookings-reschedule.test.ts tests/unit/notifications.test.ts tests/unit/step-confirmation-cancellation-warning.test.tsx
npm run typecheck
```

After review/fix/re-review:

```bash
git add src/lib/bookings src/server/actions/my-bookings.ts 'src/app/mi/[slug]' src/lib/notifications src/components/booking/step-confirmation.tsx src/app/book/confirmation/page.tsx tests/unit
git commit -m "feat: show contractual cancellation warning"
```

### Task 3: Issue and validate short-lived guest push grants

**Files:**
- Create: `src/lib/push/grant.ts`
- Modify: `src/server/actions/bookings.ts`
- Modify: `src/components/booking/step-payment.tsx`
- Modify: `src/components/booking/wizard.tsx`
- Modify: `src/app/book/confirmation/page.tsx`
- Create: `src/components/push/guest-push-link.tsx`
- Test: `tests/unit/push-grant.test.ts`
- Test: `tests/unit/step-payment-push-grant.test.tsx`
- Test: `tests/unit/guest-push-link.test.tsx`

**Interfaces:**
- Produces: `issuePushGrant({ bookingId, customerId, businessId }, now?): string`.
- Produces: `verifyPushGrant(token, now?): PushGrantClaims | null`.
- Extends `BookingCreated` with `pushGrant: string`.
- Uses session key `agendita:push-grant:<bookingId>`.

```ts
export interface PushGrantClaims {
  version: 1
  bookingId: string
  customerId: string
  businessId: string
  expiresAt: number
}
```

- [ ] **Step 1: Write failing grant tests**

Cover valid claims, 24-hour expiry, tampering, wrong domain prefix and malformed
payload. Freeze the clock; never assert on a logged token.

- [ ] **Step 2: Implement a domain-separated HMAC grant**

Derive the key with SHA-256 over `push-grant-hmac:${ENCRYPTION_KEY}`. Encode a
versioned base64url payload and hex HMAC. Compare fixed-length hashes with
`timingSafeEqual`, mirroring `oauth-state.ts` without sharing its domain.

- [ ] **Step 3: Return the grant from createBooking**

Issue it after both normal creation and idempotent resume, using the persisted
booking/customer/business IDs. Extend the client result mapping without
accepting any ID from browser input.

- [ ] **Step 4: Persist across payment redirects and build the canonical link**

Before assigning `window.location.href`, write the grant to sessionStorage. On
direct confirmation retain it in `BookingCreated`. `GuestPushLink` reads and
removes the matching session value, then constructs:

```ts
`${canonicalOrigin}/notificaciones#grant=${encodeURIComponent(pushGrant)}`
```

Do not place it in a query string.

- [ ] **Step 5: Verify and commit through review**

```bash
npm test -- tests/unit/push-grant.test.ts tests/unit/step-payment-push-grant.test.tsx tests/unit/guest-push-link.test.tsx
npm run typecheck
```

After review/fix/re-review:

```bash
git add src/lib/push/grant.ts src/server/actions/bookings.ts src/components/booking src/app/book/confirmation/page.tsx src/components/push tests/unit
git commit -m "feat: authorize guest push subscriptions"
```

### Task 4: Implement canonical-origin subscription lifecycle and service worker

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/lib/push/subscription.ts`
- Create: `src/lib/push/web-push.ts`
- Create: `src/app/api/push/subscribe/route.ts`
- Create: `src/app/api/push/unsubscribe/route.ts`
- Create: `src/app/notificaciones/page.tsx`
- Create: `src/components/push/push-manager.tsx`
- Create: `src/app/sw.js/route.ts`
- Modify: `src/lib/env.ts`
- Test: `tests/unit/push-subscription.test.ts`
- Test: `tests/unit/push-routes.test.ts`
- Test: `tests/unit/push-manager.test.tsx`
- Test: `tests/unit/service-worker-route.test.ts`
- Test: `tests/unit/env-validation.test.ts`

**Interfaces:**
- Consumes: guest grants from Task 3 or authenticated `Customer.userId` ownership.
- Produces: `POST /api/push/subscribe` and `POST /api/push/unsubscribe`.
- Produces: canonical `/sw.js` with push and notificationclick listeners only.
- Produces: `sendWebPush(subscription, payload): Promise<{ ok: boolean; statusCode?: number }>`.

- [ ] **Step 1: Add the dependency and failing tests**

Install `web-push` and its types with npm so lockfile versions are resolved by
the package manager. Tests must fail because routes, manager and worker do not exist.

- [ ] **Step 2: Implement encrypted subscription storage**

Normalize the browser JSON to `{ endpoint, keys: { p256dh, auth } }`, enforce
maximum lengths, hash endpoint with SHA-256 and encrypt the normalized JSON with
`encryptSecret`. Upsert by `(customerId, endpointHash)`, clear revocation/failure
state on resubscribe and never return encrypted contents.

- [ ] **Step 3: Implement authorization and route defenses**

`subscribe` accepts either `grant` or authenticated session, validates canonical
`Origin`, rate-limits, rechecks database ownership and writes one row per target
Customer. `unsubscribe` hashes the submitted endpoint and applies the scope from
the spec. Return only `{ subscribed: number }` or `{ unsubscribed: number }`.

For authenticated calls, the exact target set is every Customer with
`userId === session.user.id` and at least one future non-terminal booking in a
business with reminders enabled. Guest calls target only the Customer in the
verified grant.

- [ ] **Step 4: Implement canonical permission UI**

The client component reads `location.hash`, immediately clears it with
`history.replaceState`, then waits for the explicit button click. Register
`/sw.js` with `{ scope: '/', updateViaCache: 'none' }`, subscribe with the public
VAPID key and POST the serialized subscription. Show explicit iOS install help
when `PushManager` is unavailable.

- [ ] **Step 5: Implement a minimal route-served worker**

Return JavaScript with headers:

```ts
{
  'Content-Type': 'application/javascript; charset=utf-8',
  'Cache-Control': 'no-cache, no-store, must-revalidate',
  'Service-Worker-Allowed': '/',
}
```

The script parses a server-created payload, calls `showNotification`, and on
click validates the URL against the configured apex/subdomain allowlist before
`clients.openWindow`. It contains no `fetch` listener.

- [ ] **Step 6: Validate VAPID env combinations**

In `validateEnv`, treat zero VAPID vars as disabled, one/two as an error, all
three as enabled, and require `ENCRYPTION_KEY` when enabled. Validate
`VAPID_SUBJECT` as `mailto:` or HTTPS.

- [ ] **Step 7: Verify and commit through review**

```bash
npm test -- tests/unit/push-subscription.test.ts tests/unit/push-routes.test.ts tests/unit/push-manager.test.tsx tests/unit/service-worker-route.test.ts tests/unit/env-validation.test.ts
npm run typecheck
npm run lint
```

After security-focused review/fix/re-review:

```bash
git add package.json package-lock.json src/lib/push src/app/api/push src/app/notificaciones src/components/push src/app/sw.js src/lib/env.ts tests/unit
git commit -m "feat: add canonical web push subscriptions"
```

### Task 5: Deliver cancellation warnings with a recoverable lease

**Files:**
- Create: `src/lib/cron/send-cancellation-warnings.ts`
- Create: `src/app/api/cron/cancellation-warnings/route.ts`
- Create: `tests/unit/send-cancellation-warnings.test.ts`
- Modify: `src/lib/bookings/mutate.ts`
- Modify: `tests/unit/my-bookings-reschedule.test.ts`

**Interfaces:**
- Produces: `sendCancellationWarnings(now?: Date): Promise<{ sent: number; skipped: number; errors: number }>`.
- Consumes: `sendWebPush` and encrypted subscriptions from Task 4.

- [ ] **Step 1: Write failing scheduling and lease tests**

Cover target/open boundaries, cutoff zero, deposit zero, wrong status, disabled
business, no subscription, concurrent claim, ten-minute stale-lease recovery,
partial device success, all-device failure, `404/410`, transient errors and
success reset.

- [ ] **Step 2: Implement eligibility as a pure helper**

Export:

```ts
export function cancellationWarningWindow(
  startDateTime: Date,
  cutoffHours: number,
): { targetAt: Date; closesAt: Date }
```

Use integer millisecond arithmetic and strict `now < closesAt`.

- [ ] **Step 3: Implement batched query and atomic lease**

Fetch a bounded future range with Prisma, then filter variable cutoff arithmetic
in TypeScript. Use `booking.cancellationCutoffHours ??
booking.business.selfServiceCutoffHours` only for legacy null snapshots. For each
candidate, claim using `updateMany` guarded on sent null and claim null/stale.
Decrypt active subscriptions only after winning the claim.

- [ ] **Step 4: Implement delivery dispositions**

Use `Promise.allSettled`. Mark `404/410` revoked; count/revoke permanent failures;
retain transient subscriptions. If at least one succeeds, set `SentAt` and clear
claim. Otherwise clear claim so the next 15-minute run retries. Logs contain IDs,
status classes and counts only.

- [ ] **Step 5: Clear delivery timestamps on reschedule**

Inside the guarded booking update, include:

```ts
cancellationReminderClaimedAt: null,
cancellationReminderSentAt: null,
```

Do not change snapshots.

- [ ] **Step 6: Add the authenticated cron route**

Mirror existing cron routes with `hasValidBearerSecret`, GET/POST aliases and a
sanitized structured log. Unauthorized requests return 401 before any DB call.

- [ ] **Step 7: Verify and commit through review**

```bash
npm test -- tests/unit/send-cancellation-warnings.test.ts tests/unit/my-bookings-reschedule.test.ts
npm run typecheck
```

After concurrency/security review/fix/re-review:

```bash
git add src/lib/cron/send-cancellation-warnings.ts src/app/api/cron/cancellation-warnings src/lib/bookings/mutate.ts tests/unit
git commit -m "feat: send cancellation warning pushes"
```

### Task 6: Fail cron workflows on application-level errors

**Files:**
- Create: `scripts/run-json-cron.sh`
- Modify: `.github/workflows/cron.yml`
- Create: `.github/workflows/cancellation-warnings.yml`
- Create: `tests/unit/cron-workflow-contract.test.ts`
- Modify: `docs/production-incident-recovery.md`

**Interfaces:**
- Produces: `scripts/run-json-cron.sh <url>` using `CRON_SECRET` from environment.
- Produces: 15-minute cancellation workflow and hardened hourly workflow.

- [ ] **Step 1: Write a failing workflow contract test**

Assert both workflows call the helper and the new workflow contains:

```yaml
schedule:
  - cron: '*/15 * * * *'
```

The test must also execute the helper against fixture HTTP responses and prove
that `{"errors":1}` exits non-zero while `{"errors":0}` succeeds.

- [ ] **Step 2: Implement the strict helper**

Use `curl -fsS --max-time 60`, capture the body, parse with the runner’s `jq -e`
and require `.errors` to be a number equal to zero. Do not echo authorization
headers or secrets.

- [ ] **Step 3: Harden existing and add new workflows**

Replace each direct curl in `cron.yml` with the helper. The new workflow checks
out the repository, exports `BASE_URL` and `CRON_SECRET`, and calls only
`/api/cron/cancellation-warnings` every 15 minutes with concurrency protection.

- [ ] **Step 4: Update operations documentation**

Document the new endpoint, cadence, VAPID-disabled skip behavior and the fact
that `errors > 0` now fails Actions.

- [ ] **Step 5: Verify and commit through review**

```bash
npm test -- tests/unit/cron-workflow-contract.test.ts
bash -n scripts/run-json-cron.sh
npm run typecheck
```

After review/fix/re-review:

```bash
git add scripts/run-json-cron.sh .github/workflows/cron.yml .github/workflows/cancellation-warnings.yml tests/unit/cron-workflow-contract.test.ts docs/production-incident-recovery.md
git commit -m "ci: fail crons on application errors"
```

### Task 7: Integrate authenticated management and complete verification

**Files:**
- Modify: `src/app/mi/[slug]/page.tsx`
- Create: `src/components/push/account-push-link.tsx`
- Modify: `docs/deployment/env.md`
- Modify: `docs/go-no-go-checklist.md`
- Test: `tests/unit/mi-business-detail-page.test.tsx`
- Test: `tests/e2e/self-service.spec.ts`

**Interfaces:**
- Consumes: canonical subscription manager and authenticated ownership.
- Produces: customer-facing management entry and deployment checklist.

- [ ] **Step 1: Write failing account UI tests**

Assert an authenticated customer with an upcoming booking sees “Administrar
recordatorios”; no customer context means no control. Assert the link uses the
canonical origin, not the tenant origin.

- [ ] **Step 2: Add account management entry**

Render the compact link near booking actions. It navigates to
`getAppUrl('/notificaciones')`; the central page derives target Customers from
the shared authenticated session.

- [ ] **Step 3: Add browser E2E coverage**

Mock `serviceWorker` and `PushManager` in Playwright to verify permission is not
requested on load, is requested after the button, and the subscription POST
contains a grant but never places it in the query string.

- [ ] **Step 4: Update env and go/no-go docs**

Document the three VAPID vars, `ENCRYPTION_KEY` dependency, central-origin/iOS
requirements, smoke commands and explicit real-device QA gate.

- [ ] **Step 5: Run the full verification matrix**

```bash
npx prisma generate
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
npm run build
npm run test:e2e -- tests/e2e/self-service.spec.ts
git diff --check origin/main...HEAD
```

Expected: all commands exit 0. Real push delivery remains a deployment gate,
not something mocked tests can prove.

- [ ] **Step 6: Final independent reviews**

Run a product/spec review and a security/correctness review over the complete
diff. Fix all blocking findings, re-review the fixes and rerun the full matrix.

- [ ] **Step 7: Commit final integration**

```bash
git add 'src/app/mi/[slug]/page.tsx' src/components/push/account-push-link.tsx docs tests
git commit -m "feat: expose customer push preferences"
```

### Task 8: Create, review, merge and production-gate the PR

**Files:**
- Review every file changed by Tasks 1–7 and both design/plan documents.

**Interfaces:**
- Produces: merged Web Push implementation with an explicit external configuration gate.

- [ ] **Step 1: Push and create a ready PR**

Use the `feature/push-cancellation-warnings` branch. Summarize policy snapshots,
canonical-origin security, lease recovery, cron hardening and the no-offline
scope boundary.

- [ ] **Step 2: Refresh exact-head evidence**

Immediately before merge, refresh head SHA, diff, checks, mergeability and
unresolved review threads. Do not merge if the branch moved after review.

- [ ] **Step 3: Squash-merge after green checks**

Merge only after CI and both review gates are clean. Update local `main` and
confirm the merge commit is deployed.

- [ ] **Step 4: Configure VAPID without exposing secrets**

Generate keys locally, store only the public key in public config and put the
private key/subject directly into Vercel. Never paste them into chat, GitHub PR
text or logs.

- [ ] **Step 5: Run the real production gate**

With one controlled business and booking:

1. Confirm warning copy on checkout, final screen and delivered email.
2. Subscribe from Chromium on the canonical origin and verify one push.
3. Install the PWA on iOS 16.4+ and verify subscribe, delivery and click target.
4. Reprogram and verify exactly one new warning is eligible.
5. Unsubscribe and verify no later push is sent.
6. Confirm production health and both cron workflows remain green.

Do not call Web Push production-complete until this real-device gate passes.

## Security remediation addendum (2026-08-10)

The final security review split remediation into independent tracks. Track A
replaces Customer-wide implicit authorization before the PR can ship:

- add a forward migration with `PushSubscription.authorizedUserId`, a stable
  endpoint-and-keys fingerprint, and `PushSubscriptionBooking`;
- guest subscribe/unsubscribe creates or removes only the exact booking
  entitlement after revalidating all signed ownership fields;
- authenticated subscribe/unsubscribe writes or clears only the exact
  `authorizedUserId`; it never infers persisted authorization from
  `Customer.userId`;
- the scheduler requires an exact booking entitlement or an explicit user ID
  match, avoids nullable equality, and caps selected devices at five;
- subscription writes enforce a transactionally serialized five-device cap per
  Customer authorization or booking entitlement, plus target-aware rate limits;
- legacy rows receive no inferred authorization during migration and remain
  ineligible until re-subscribed.

Possession-based reload management, TTL/UI work, and cron-workflow changes stay
in their respective remediation tracks unless a compile-only adaptation is
required here.
