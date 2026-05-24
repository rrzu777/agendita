# Go/No-Go Checklist — Beta

## Status: ⏳ PARTIAL — Prompt 06 Not Yet Executed

This checklist confirms stabilization work complete and the app ready to run in production mode with real data. **Prompt 06 (Mercado Pago sandbox QA) is pending execution — do not deploy to production with PAYMENT_PROVIDER=mercado_pago until TC-01 through TC-09 are passed.**

---

## ✅ Completed Prompts

| # | Prompt | Status |
|---|--------|--------|
| 01 | Centralize manual payment flow | ✅ Done |
| 02 | Eliminate duplicate payment registration | ✅ Done |
| 03 | Mandatory env validation at build time | ✅ Done — `scripts/validate-env.js` (providers: mock, manual, mercado_pago, webpay) |
| 04 | Rate limiter hardening with Upstash | ✅ Done — block list, per-action limits, fail-closed |
| 05 | QA functional plan | ✅ Done — `docs/testing-qa-plan.md` |
| 06 | Mercado Pago sandbox QA | ⏳ PENDING — `docs/payments/mercado-pago-qa.md` created, sandbox not yet executed |
| 07 | Critical unit/integration/E2E tests | ✅ Done — 37 test files, 660 tests, all passing |
| 08 | Production hardening + Vercel checklist | ✅ Done |
| 09 | UX polish | ✅ Done |

---

## ✅ Test Results

```bash
npm run test:unit
# 37 test files | 660 tests | ALL PASSING

npm run test:integration
# (requires local DB) — integration tests exist in tests/integration/

npm run test:e2e
# (requires app running) — Playwright tests in tests/e2e/
```

---

## ✅ Critical Path Verification

### Booking Creation
- [x] `createBooking` server action — validates service, customer, slot availability
- [x] Idempotency via `idempotencyKey` (race-safe with P2002 catch)
- [x] Hold expiration via `holdExpiresAt` (15 min window)
- [x] Notifications: `sendBookingReceivedToCustomer` + `sendNewBookingNotificationToBusiness`

### Payment Flow
- [x] `createManualPayment` — server-side `paymentType` derivation, mismatch rejection
- [x] `applyApprovedPayment` — idempotent via `providerPaymentId`, creates correct LedgerEntry type
- [x] `confirmPayment` — transitions booking `pending_payment` → `confirmed`, sends confirmation email
- [x] Payment types: `deposit`, `final_payment`, `full_payment` — correct LedgerEntry types

### Financial Integrity
- [x] `mapPaymentTypeToLedgerEntryType` — correct mapping for all 7 payment types
- [x] `mapPaymentTypeToLedgerDirection` — income vs expense per type
- [x] `deriveManualPaymentType` — pure function, all branches tested
- [x] No duplicate payments via idempotency key

### Security
- [x] Rate limiting — per-action, IP-block list, fail-closed in production
- [x] Mercado Pago webhook — HMAC signature validation, idempotency
- [x] Auth guard — `requireBusiness()` / `requireBusinessRole()` on all private actions
- [x] Business isolation — all queries scoped by `businessId`

### Observability
- [x] Structured logger — JSON, redactable fields, event-based
- [x] `instrumentation.ts` — `assertValidEnv()` fail-fast in production Node.js runtime
- [x] Build-time env validation — `scripts/validate-env.js` blocks deploy if required envs missing

---

## ✅ Documentation

- `docs/deployment/env.md` — required/optional env vars
- `docs/deployment/vercel.md` — deployment steps
- `docs/production-checklist.md` — full prod checklist
- `docs/testing-qa-plan.md` — manual/mock flow test cases
- `docs/payments/mercado-pago-qa.md` — Mercado Pago sandbox test cases (**⏳ NOT EXECUTED — Prompt 06 pending**)
- `docs/testing.md` — unit/integration/E2E guide

---

## ✅ Build Verification

```bash
npm run build
# Runs: node scripts/validate-env.js && prisma generate && next build
# Fails if required env vars are missing
```

---

## ⚠️ Pre-Beta Configuration Required

Before going live, the following must be configured **outside the codebase** (in Vercel or hosting provider):

1. **Database** — `DATABASE_URL` + `DIRECT_URL` pointing to production PostgreSQL
2. **Payment Provider** — Set `PAYMENT_PROVIDER=mercado_pago` (or keep `mock` for testing)
3. **Upstash Redis** — `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` for rate limiting
4. **Resend** — `RESEND_API_KEY` + `FROM_EMAIL` for transactional email
5. **Mercado Pago** — `MERCADO_PAGO_ACCESS_TOKEN` + `MERCADO_PAGO_WEBHOOK_SECRET` + `NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY`
6. **DNS** — Wildcard subdomain `*.yourdomain.com` pointing to Vercel

---

## 📋 Final Steps to Launch

1. [ ] Configure all environment variables in Vercel project settings
2. [ ] Run `prisma migrate deploy` against production database
3. [ ] Add cron job for `/api/cron/expire-holds` (every 5 minutes)
4. [ ] Register Mercado Pago webhook URL: `https://yourdomain.com/api/webhooks/mercado-pago`
5. [ ] Verify Resend domain ownership for `FROM_EMAIL`
6. [ ] Trigger first deployment from `main` branch
7. [ ] Run smoke test: create a booking with mock payment, confirm it in dashboard
8. [ ] Check Vercel function logs for any errors

---

## 🎯 Beta Scope

- Businesses can create accounts, add services, set availability
- Customers can book services via public link
- Manual payments can be recorded by business owner
- Email notifications are sent (Resend)
- Rate limiting is active (Upstash Redis)
- All environment validation is enforced at build + runtime