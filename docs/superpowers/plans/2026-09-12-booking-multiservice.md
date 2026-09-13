# Booking multiservice implementation plan

> **For agentic workers:** Execute inline with independent review subagents under build-review-ship. User approved all audit points on 2026-09-12; no further design approval is needed for the scope below.

**Goal:** Allow multiple consecutive services in one appointment, simplify guest/customer details, preserve Google continuity, and show real availability before choosing a day.

**Architecture:** One Booking owns the interval, customer, professional, payments and status; BookingService holds immutable service lines. Shared selection and amount helpers serve public, owner and availability paths. Optional professional selection and a validated `professional` query parameter remain preferences, never authorization.

**Tech Stack:** Next.js 16.3.2, React 19, Prisma 5/PostgreSQL, Vitest and Playwright.

**Spec:** `docs/superpowers/audits/2026-09-12-booking-flow.md` in the main workspace, plus the user's approved follow-up: all points; explicit required/optional UI; payment remains business-dependent.

## Global constraints

- Preserve unrelated worktrees and dirty files. Base: f9a9f02d2f10ecaf2ed949d031c6104d42fbf756.
- One business/customer/modality/professional, continuous interval, 1–10 distinct services. No physical product inventory, group bookings or multi-professional appointments.
- Keep existing no-deposit, manual coordination, transfer, online payment and approval policies.
- No real booking/payment/SMS or analytics activation for testing. Staging remains deferred.
- Never infer empty availability from a request failure. Never trust client prices, duration, eligibility or discounts.
- Every track: failing boundary tests, implementation, independent code review, fixes/re-review, relevant tests/typecheck/lint/build and commit.

## Track 1 — Customer details and login continuity

**Files:** `src/app/book/[slug]/page.tsx`, `src/lib/business/urls.ts`, `src/lib/auth/sanitize-next.ts`, `src/app/ingresar/page.tsx`, `src/components/booking/step-customer.tsx`, `src/components/booking/wizard.tsx`; tests in `tests/unit/booking-entry.test.tsx`, `step-customer-session.test.tsx`, `business-urls.test.ts`, `sanitize-next.test.ts`.

**Interfaces:** Canonical route uses `getBookingFunnelUrl(business, publicAcquisitionSearch(search))`. `publicAcquisitionSearch` accepts one bounded `professional` ID. `authErrorRedirectPath('/ir/slug', error)` preserves customer login and next. Existing `onLoginCta(partial)` persists the draft before opening Google; return/cancel uses the trusted `/ir/slug` route.

- [x] Reproduce canonical entry and callback-error failures in tests; assert no private query parameters are forwarded.
- [x] Canonicalize subdomain businesses before wizard mounts. Preserve no-subdomain routes and tenant/slug mismatch rejection.
- [x] Expose Google and guest choice explicitly, label required/optional fields, collapse notes and optional birth date, use birth-date terminology and neutral review CTA rather than unconditional payment copy.
- [x] Add a safe return-to-booking option on the login screen, including failure paths. Keep existing identity/linking semantics.
- [x] Verify guest submission with optional fields empty and Google initiation preserving entered data; review, verify and commit.

Track 1 verification: 448 unit files passed (4,051 passed, one skipped); focused 66 tests passed; typecheck, lint and synthetic production build passed. Local PostgreSQL public browser regression passed for guest fields, synthetic Google initiation, browser Back and canceled-login draft restoration. Independent review and second review completed; fixed control-character redirect normalization, Next redirect exception handling and home-address copy. Actual Google success/PKCE and cross-subdomain cookies remain external verification, not claimed by the synthetic test. No production data or deployment changed.

Example boundary expectations:

```ts
expect(authErrorRedirectPath('/ir/mimos?professional=ana', 'missing_code'))
  .toBe('/ingresar?error=missing_code&next=%2Fir%2Fmimos%3Fprofessional%3Dana')
expect(publicAcquisitionSearch({ professional: 'ana', email: 'private@example.test' }))
  .toBe('professional=ana')
```

## Track 2 — Atomic multiservice booking and legacy compatibility

Delivery boundary: split into 2a (additive schema and pure selection/snapshot/allocation helpers, not exposed by booking actions) and 2b (atomic writes, discount semantics and every reader). Each receives its own review, verification and commit. This keeps the catalogue/payment compatibility change independently reviewable before enabling any multiservice endpoint.

Track 2a: implemented selection validation, immutable snapshot shapes, integer eligible-line allocation, persisted-duration/name helpers and additive BookingService table. No endpoints consume these helpers yet. Unit 26 passed; local migration applied; schema plus legacy booking/modality/professional integration regressions 29 passed. Two independent reviews found no blockers; low precondition/rounding-boundary coverage notes addressed. Typecheck, lint and synthetic build passed. No historical backfill, production migration or public multiselect activation performed.

**Files:** `prisma/schema.prisma`, additive migration, `src/lib/bookings/{selection,draft,service-lines,recompute,discount,retry,notifications}.ts`, `src/lib/professionals/{eligible,assign}.ts`, `src/lib/availability/{team-slots,reschedule-slots}.ts`, `src/server/actions/{bookings,my-bookings,availability,revive-booking}.ts`, booking read projections and consumers, package/promotion helpers and integration tests.

**Interfaces:** A bounded selection normalizer accepts legacy `serviceId` or `serviceIds`; contradictory payloads reject. `resolveBookingDraft` produces authoritative ordered service lines and aggregate interval/amounts. BookingService snapshots persist with the same transaction as Booking. Legacy readers use one fallback line when no detail exists; new readers show all service names. A shared selection predicate checks EVERY selected service for professional eligibility.

- [x] Add pure tests for two services, duplicates, 11 services, mixed modalities and wrong tenant. Fixture: 45 min/$15000 plus 20 min/$4000 → 65 min/$19000.
- [x] Add detail model and indices; preserve existing rows and avoid fabricated historical snapshot claims. Keep scalar serviceId as compatibility pointer until all readers migrate.
- [x] Refactor authoritative draft and atomic create/manual-create to write all lines; include selection in replay identity and immutable snapshots.
- [x] Apply availability/eligibility and reschedule using the complete interval; reject active-team combinations with no shared professional.
- [x] Allocate discounts only across eligible lines, in integers; preserve package/promo precedence and transactional consumption/reversal. Keep aggregate amounts equal to line sums.
- [x] Migrate owner lists/calendar/detail, notifications, calendar invite, self-service and payment confirmation to all lines; add database concurrency and replay regressions.
- [x] Review, run integration/unit/typecheck/lint/build and commit before exposing multiselect UI.

Track 2b verification: independent first and second reviews completed; fixed transfer-email projections, zero-price free-service redemption and the long payment-description boundary. Real PostgreSQL multiservice 12 tests passed, including full cash payment, package cancellation/reversal, scoped coupons, persisted reschedule duration, eligibility, overlapping tail and concurrent replay. Focused integration run (including transfer emails and 50,000-event boundary) 51 passed. Full integration: 77 files/547 tests passed, one fixture-preparation timeout; that complete file passed isolated. Final full unit run: 450 files/4,088 tests passed, one skipped and one intermittent unrelated bank-transfer draft-recovery assertion; that unchanged file and policy settings passed isolated (18 tests). Earlier focused booking regressions 79 passed. Typecheck, lint, diff check and synthetic production build passed. Do not describe the full-suite runs as entirely green. Inherited reassignment eligibility is checked before its transaction, and catalogue snapshots represent the authoritative read before commit, not a catalogue-row lock; these are not new guarantees. No production mutations.

Core invariants:

```ts
expect(draft.endDateTime.toISOString()).toBe('2026-09-14T14:05:00.000Z') // start 13:00Z
expect(draft.totalPrice).toBe(19000)
expect(draft.lines.reduce((sum, line) => sum + line.finalAmount, 0)).toBe(draft.finalAmount)
```

## Track 3 — Catalogue, optional professionals and preview availability

UI direction (frontend-design): preserve Agendita's existing cream #fff8f1, white #ffffff, ink #332920, peach #f4dbca and muted #6d5b4e tokens. Keep Jakarta headings and Geist body; left-aligned service names that wrap rather than truncate. The characteristic element is the useful booking summary: selected lines, total time/price and abono remain visible. No new decorative palette or typography. Layout: `[category / selectable service rows] → [sticky total + continue]`; date/time: `[month + capacity-marked days] [selected-day hours with end time]`. On mobile this is one column, keyboard-accessible controls, explicit optional choice and errors that never masquerade as empty availability. Review against brief: retain the product's established warm palette (not a new generic redesign); replace auto-advance with deliberate multiselect and consolidate only the date/time screens. Confirmation is a result, not another form to complete.

**Files:** `src/components/booking/{wizard,step-service,step-professional,step-date-time,step-customer,booking-summary,step-payment}.tsx`, `src/lib/bookings/{wizard-storage,wizard-steps}.ts`, public page props, `src/server/actions/availability.ts`, catalogue service category schema/form, availability and browser tests.

**Interfaces:** Selected services are toggled in place, with an explicit continue action. `professional` is validated against public active professionals and the service set; invalid/stale links leave the choice available. Date/time component receives business, selection, timezone and pick; month/day responses distinguish pending/error/empty/available and discard stale results.

- [x] Test selecting/removing two services and state restoration without losing chosen professional when still eligible.
- [x] Group catalogue by optional owner-managed category, preserve uncategorized services and existing order; display count, total, duration and abono persistently.
- [x] Add optional professional preference with `professional` deep link and next-available preview; offer “Cualquiera disponible”. No simultaneous full calendars for every professional.
- [x] Combine date/time. Use bounded server queries for availability preview; calendar communicates actual capacity, selected state, limits and loading/errors. Show next slot and exact end time.
- [x] Invalidate date/time/payment identity correctly after selection changes; preserve guest and payment policy branches.
- [x] Review and verify responsive UI, keyboard/focus, business timezone/DST, empty/error states, query tampering and existing one-service flow; commit.


Track 3 verification: first review and second/focal re-review completed with no remaining blockers. Local public browser created exactly one two-line 65-minute / $19,000 no-abono booking without email, and keyboard selection passed; evidence in `docs/superpowers/audits/2026-09-12-multiservice-local-qa.md`. Final full unit run: 456 of 457 files passed, 4,108 tests passed, one skipped, one inherited intermittent bank-transfer draft-recovery assertion; calendar stale-response/DST and catalogue follow-up tests passed (5). Typecheck, lint, diff check and synthetic production build (61 static pages) passed. Full integration passed: 78 files / 551 tests. The inherited bank-transfer file passed separately (8 tests). Final acceptance guard for changed quotes additionally passed 22 multiservice DB tests, 8 retry DB tests, 42 idempotency/professional unit tests and 21 payment/wizard unit tests; build and lint rerun successfully. Two focal independent reviews closed quote replay findings. Full suites will run again at the final track boundary. Additive category migration applied only to disposable local DB.

## Track 4 — Metrics and operational closure

**Files:** `src/lib/analytics/{contracts,ingest,funnel,daily-metrics,flow-breakdowns,booking-snapshot}.ts`, client analytics context, report queries, associated unit/integration tests and operations docs.

**Interfaces:** Backward-compatible analytics selection supports bounded distinct service IDs and flow version. Booking is one conversion; service lines feed per-service counts/revenue. Consent version is unchanged by flow version.

- [x] Add regression: two selected services → one attempt/booking conversion, two service counts, no duplicated total revenue.
- [x] Track add/remove and incompatible combinations with bounded dimensions; no personal fields. Preserve consent and existing activation flags.
- [x] Keep historical funnel comparisons version-aware when date/time become one screen.
- [x] Resolve exact public test-service rows read-only and prepare reversible cleanup; do not delete customer/booking history or guess test targets from a prefix alone.
- [x] Final independent review, full unit/integration suites, public/owner E2E against synthetic DB, build; document results and any external actions not executed.

Track 4 verification: two independent review rounds closed the v1→v2 restoration and expired-receipt boundaries; no high/medium findings remain. Public synthetic E2E passed 8/8 and owner dashboard E2E passed 7/7 on desktop/mobile, including consent withdrawal, offline recovery, filters and authorization. The final serial full runs passed 458 unit files/4,123 tests (one skipped) and 78 integration files/560 tests. Typecheck, lint, diff check, a fresh 62-migration database and synthetic production build (61 static pages) passed. Read-only production catalogue evidence and the reversible cleanup proposal are in `docs/operations/2026-09-12-public-catalogue-cleanup.md`. Production currently has none of the three multiservice/category/flow-version migrations recorded, so deployment must run them before this code; no production migration, catalogue mutation, activation or deployment was performed.

## Verification commands

```sh
npm test -- tests/unit/step-customer-session.test.tsx tests/unit/wizard-storage.test.ts tests/unit/business-urls.test.ts tests/unit/sanitize-next.test.ts
npm run typecheck
npm run lint
npm run test:integration
npm run build
```

Commands run in the isolated worktree with Node 22 and only local/synthetic DB/provider settings. Do not load production env files into test processes.
