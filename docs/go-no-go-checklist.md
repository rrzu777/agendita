# Go/No-Go Checklist — Beta

## Status: ⏳ PARTIAL — external QA gates remain

This checklist confirms stabilization work complete and the app ready to run in production mode with real data. **Prompt 06 (Mercado Pago sandbox QA) and Web Push real-device delivery QA are pending execution.** Do not enable Mercado Pago production until TC-01 through TC-09 pass, and do not expand Web Push beyond the pilot business until the device checks below pass.

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
| 07 | Critical unit/integration/E2E tests | ✅ Done — run the current suites; do not rely on a copied test count |
| 08 | Production hardening + Vercel checklist | ✅ Done |
| 09 | UX polish | ✅ Done |

---

## ✅ Test Results

```bash
npm run test:unit
# The command output is the source of truth for the current test count.

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

### Web Push cancellation reminders
- [x] Permission requested only after an explicit customer click
- [x] Activation requires an authenticated session or an eligible booking grant
- [x] Existing browser subscriptions are detected after reload and can always be deactivated locally
- [x] Canonical `/notificaciones` origin for guest and authenticated customers
- [x] Guest grant transferred in a URL fragment and removed immediately
- [x] Subscription payload encrypted at rest; endpoint stored only as a hash for lookup
- [x] Recoverable cron claim and application-error-aware 15-minute workflow
- [x] Service worker has push/click handlers only; no fetch or offline cache
- [ ] Chromium real-device subscribe, delivery and unsubscribe QA
- [ ] iOS/iPadOS 16.4+ installed-PWA subscribe, delivery and unsubscribe QA
- [ ] Pilot-business cutoff timing and duplicate-suppression QA across two cron runs

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
7. **Web Push** — Configure the VAPID trio plus `ENCRYPTION_KEY` on the canonical origin, or leave all VAPID variables absent to keep push disabled
8. **Cron** — Configure `CRON_SECRET` in GitHub and the deployment, plus `APP_BASE_URL=https://www.agendita.cl` as a repository variable when the canonical origin differs from the default

---

## 📋 Final Steps to Launch

1. [ ] Configure all environment variables in Vercel project settings
2. [ ] Run `prisma migrate deploy` against production database
3. [x] Keep `/api/cron/expire-holds` in the hourly `Scheduled crons` workflow; GitHub scheduling is best-effort and may be delayed
4. [ ] Register Mercado Pago webhook URL: `https://yourdomain.com/api/webhooks/mercado-pago`
5. [ ] Verify Resend domain ownership for `FROM_EMAIL`
6. [ ] Trigger first deployment from `main` branch
7. [ ] Run smoke test: create a booking with mock payment, confirm it in dashboard
8. [ ] Check Vercel function logs for any errors

### Web Push rollout gate

- [ ] Confirm `https://www.agendita.cl/notificaciones` loads and never asks for permission before a click.
- [ ] Confirm `https://www.agendita.cl/sw.js` returns JavaScript with `Cache-Control: no-cache, no-store, must-revalidate` and `Service-Worker-Allowed: /`.
- [ ] On Chromium, activate from an isolated customer booking, receive one privacy-safe cancellation warning, then unsubscribe and confirm later sends stop.
- [ ] On iOS/iPadOS 16.4+, install Agendita to the home screen, open the installed app, activate, receive one warning, then unsubscribe.
- [ ] With a paid, confirmed pilot booking, verify the warning arrives while the snapshotted cancellation window is still open and does not arrive after it closes.
- [ ] Run the cron twice and confirm the second run does not duplicate an already successful warning.

Automated E2E uses mocked browser Push APIs and cannot prove delivery by Apple,
Google, the browser, or the installed PWA. Until every item above is checked,
real-device delivery remains explicitly **pending**.

---

## 🎯 Beta Scope

- Businesses can create accounts, add services, set availability
- Customers can book services via public link
- Manual payments can be recorded by business owner
- Email notifications are sent (Resend)
- Rate limiting is active (Upstash Redis)
- All environment validation is enforced at build + runtime
