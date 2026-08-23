# QA Functional Plan

## Scope

End-to-end functional tests covering the booking + payment flow, notification system, and error handling.

## Environment

- **Provider**: `mock` (PAYMENT_PROVIDER=mock)
- **Bookings**: Use real service + customer created during test
- **Payments**: Mock payment flow (no real Mercado Pago calls)
- **Notifications**: Console/log-based (check notification calls)
- **Database**: Test database with foreign key constraints enforced

---

## Test Categories

### 1. Happy Path — Complete Booking Flow

| ID | Scenario | Steps | Expected |
|----|----------|-------|----------|
| QA-01 | Full booking: create → pay deposit → confirm → complete | 1. Create booking via public form<br>2. Simulate Mercado Pago webhook with `payment_status=approved`<br>3. Call `confirmPayment`<br>4. Call `updateBookingStatus` to `completed` | Booking status transitions: `pending_payment` → `confirmed` → `completed`<br>Payment recorded with correct `paymentType`<br>Confirmation email triggered<br>Remaining balance = totalPrice - depositPaid |
| QA-02 | Manual payment: create booking → register deposit → register final payment | 1. Create booking<br>2. `createManualPayment` with amount < remainingBalance<br>3. `createManualPayment` with amount = remainingBalance | First payment: `paymentType=deposit`, booking `confirmed`<br>Second payment: `paymentType=final_payment`, booking `fully_paid` |
| QA-03 | Booking creation with customer lookup | 1. Create customer via public form<br>2. Create second booking with same phone+name | Second booking reuses existing customer (no duplicate) |

### 2. Payment Notifications

| ID | Scenario | Steps | Expected |
|----|----------|-------|----------|
| QA-10 | Booking created → customer received email | Create booking with customer email | `sendBookingReceivedToCustomer` called with correct booking data |
| QA-11 | Booking confirmed → customer confirmation email | Apply payment + `confirmPayment` with `wasConfirmed=true` | `sendBookingConfirmedNotification` called once |
| QA-12 | Booking cancelled → customer cancellation email | `updateBookingStatus` to `cancelled` | `sendBookingCancelledNotification` called with correct service/time |
| QA-13 | Payment confirmed but booking already confirmed → no duplicate email | Call `confirmPayment` twice | `sendBookingConfirmedNotification` called only on first call |

### 3. Error States

| ID | Scenario | Steps | Expected |
|----|----------|-------|----------|
| QA-20 | Create booking with invalid service | Submit form with non-existent serviceId | 400 + error message |
| QA-21 | Create booking with past date | Submit form with startDateTime in past | 400 + validation error |
| QA-22 | Create booking with unavailable slot | Create booking, then create second booking for same slot | Second booking fails with slot unavailable error |
| QA-23 | Register payment exceeding remaining balance | Call `createManualPayment` with amount > remainingBalance | Error: `El monto excede el saldo pendiente` |
| QA-24 | Register payment with mismatched paymentType | Client sends `paymentType=deposit` but server derives `full_payment` | Error: `Tipo de pago incompatible` |
| QA-25 | Confirm payment for non-existent booking | Call `confirmPayment` with random UUID | ForbiddenError: `Reserva no encontrada` |
| QA-26 | Update booking to invalid status transition | Try to change `completed` → `confirmed` | ForbiddenError: invalid transition |

### 4. Edge Cases

| ID | Scenario | Steps | Expected |
|----|----------|-------|----------|
| QA-30 | Booking at business closing time | Create service with 60min duration, book at 23:00 | End time wraps to next day — handled gracefully |
| QA-31 | Payment with exact remaining balance | Create booking with remainingBalance=5000, pay 5000 | Derives `full_payment` when depositPaid=0, `final_payment` when depositPaid>0 |
| QA-32 | Customer with no email | Create booking with customerEmail=null | No `sendBookingReceivedToCustomer` call (guarded by null check) |
| QA-33 | Idempotent booking creation | Create booking with same idempotencyKey twice | Returns existing booking (no duplicate created) |
| QA-34 | Multiple rapid payment attempts | Call `createManualPayment` twice rapidly for same booking | Second call succeeds (idempotency via paymentId) |

---

## Test Execution

Run with:
```bash
npm run test:e2e
```

Run with UI:
```bash
npm run test:e2e:ui
```

Run integration tests only:
```bash
npm run test:integration
```

### Dashboard guided tours QA matrix

Keep `DASHBOARD_TOURS_ENABLED=false` by default. Automated coverage enables it
only in the Playwright process and queries Prisma for the exact
`(userId, businessId, tourKey, tourVersion)` row.

| Role | Viewport | Booking state | Required result | Automated evidence |
|------|----------|---------------|-----------------|--------------------|
| Owner | 1440 desktop | Data | Explicit intro, completion/reload, Help replay, booking row targets, dirty Settings pause, Escape/focus and no overflow | `dashboard-tours.spec.ts` |
| Owner | 375 mobile | Empty | Explicit intro without auto-open, focus trap, reduced motion, all permitted “Más” routes + Help, empty booking fallback and no overflow | `dashboard-tours.spec.ts` |
| Admin | 768 tablet/desktop layout | Empty | Eligible intro, persistence, hidden-target fail-open and restored focus | `dashboard-tours.spec.ts` |
| Staff | 375 mobile | Empty | No tour invitation/Help; no Settings or Billing; all other permitted “Más” routes remain reachable | `dashboard-tours.spec.ts` |
| Owner/admin/staff | Physical iOS Safari and Android Chrome | Data + empty | Safe-area layout, virtual keyboard, touch focus, browser Back/Forward and no horizontal overflow | **Pending real-device QA** |

Playwright viewport emulation is not physical-device evidence. Before enabling
the production flag, run the last row with disposable QA identities on at least
one current iOS/Safari device and one current Android/Chrome device. Record OS,
browser version, role, viewport/orientation, data state and result; never record
session cookies, auth headers or credentials.

### Dashboard guided tours rollout and rollback

`DASHBOARD_TOURS_ENABLED` is a strict server-side boolean. Its absent/default
value is `false`. Setting it to `false` is the rollback switch: it removes tour
invitations and Help launchers without reverting the additive schema or deleting
saved progress. Mobile “Más” remains available independently.

Deployment order:

1. Keep `DASHBOARD_TOURS_ENABLED=false`.
2. Run `npx prisma migrate deploy`; migration
   `20260822180000_user_tour_progress` must land before any enabled app process.
3. Run the post-deploy schema query below.
4. Deploy the application with the flag still false and smoke-test mobile
   navigation for owner/admin/staff.
5. Enable the flag in QA/canary, complete the matrix above, then enable the
   intended production environment. The current switch is global per deployment,
   not a per-tour or per-account cohort control.
6. If product interaction regresses, set the flag back to `false`; do not roll
   back the migration.

Post-deploy schema verification:

```sql
SELECT
  to_regclass('"UserTourProgress"') AS progress_table,
  EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'TourStatus'
  ) AS tour_status_enum,
  EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE indexname = 'UserTourProgress_userId_businessId_tourKey_tourVersion_key'
  ) AS progress_identity_unique;
```

All three results must be present/true before enabling the flag.

Use aggregate-only queries for phase-1 metrics; do not export `userId`,
`businessId` or emails:

```sql
SELECT
  "tourKey",
  "tourVersion",
  count(*) FILTER (WHERE "offeredAt" IS NOT NULL) AS offered,
  count(*) FILTER (WHERE "startedAt" IS NOT NULL) AS started,
  round(
    100.0 * count(*) FILTER (
      WHERE "offeredAt" IS NOT NULL AND "startedAt" IS NOT NULL
    ) / NULLIF(count(*) FILTER (WHERE "offeredAt" IS NOT NULL), 0),
    2
  ) AS offered_to_started_pct,
  count(*) FILTER (WHERE "completedAt" IS NOT NULL) AS completed,
  round(
    100.0 * count(*) FILTER (
      WHERE "startedAt" IS NOT NULL AND "completedAt" IS NOT NULL
    ) / NULLIF(count(*) FILTER (WHERE "startedAt" IS NOT NULL), 0),
    2
  ) AS started_to_completed_pct,
  count(*) FILTER (WHERE "dismissedAt" IS NOT NULL) AS dismissed
FROM "UserTourProgress"
GROUP BY "tourKey", "tourVersion"
ORDER BY "tourKey", "tourVersion";
```

Phase 2 is gated by real usage, not a calendar date. Decide only after there is
a representative production sample across enabled roles/viewports, stable
offered→started and started→completed trends, dismissal/abandonment review,
support feedback and completed physical-device QA. If the sample is too small
to interpret without exposing small cohorts, keep phase 2 closed.

### Real registration gate

The regular E2E suite uses the read-only auth bypass and never writes to
Supabase. The `Real registration E2E` workflow is a manual, isolated gate for
registration, confirmed password sign-in and authenticated dashboard access.
Configure the protected GitHub environment
`registration-e2e` with a disposable Supabase project that requires email
confirmation:

- secrets `REGISTRATION_SUPABASE_URL`, `REGISTRATION_SUPABASE_ANON_KEY` and
  `REGISTRATION_SUPABASE_SERVICE_ROLE_KEY`;
- variable `REGISTRATION_EMAIL_DOMAIN`, using a domain accepted by that project.

The test creates a unique Auth user plus its local business, confirms that user
through the disposable project's Admin API, then verifies real password sign-in,
the authenticated onboarding/dashboard, owner, trial, service templates and
availability defaults. It removes both Auth and PostgreSQL records in `finally`.
It does not validate outbound email delivery, a production email template or the
email-link PKCE callback; those require an inbox-controlled provider journey.
Never point this workflow at production.

---

## Coverage Goals

- ✅ Booking creation (public form)
- ✅ Payment confirmation flow
- ✅ Manual payment registration
- ✅ Status transitions
- ✅ Notification triggers (email + business)
- ✅ Error handling for invalid inputs
- ✅ Idempotency (booking + payment)
- ✅ Edge: zero remaining balance, exact match payments, missing customer data
