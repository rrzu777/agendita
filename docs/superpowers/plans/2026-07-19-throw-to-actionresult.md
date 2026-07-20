# throw → ActionResult Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make user-facing error messages from client-invoked Server Actions survive production, where Next.js redacts thrown `Error.message` into a generic string + digest.

**Architecture:** Introduce a marker error class `UserError` (a plain `Error` subclass meaning "this message is safe to show the user") and a higher-order `action()` wrapper that turns a throwing Server Action into one returning a discriminated `ActionResult<T>`. Inside `action()`, `UserError` becomes `{ ok: false, error: msg }`; any other error is logged and becomes a generic message; Next.js control-flow errors (redirect/notFound/dynamic) are re-thrown via `unstable_rethrow`. Only **mutation functions called from client components** are wrapped. Read/query functions called from server components/pages/route-handlers are left untouched — wrapping them would break every server caller and they don't hit the redaction path. A codemod converts `throw new Error(` → `throw new UserError(` across the 21 affected action files (safe even for un-wrapped queries: a query throwing `UserError` still bubbles to `error.tsx` exactly as before).

**Tech Stack:** Next.js 16.2.6 (App Router, Server Actions), TypeScript, Vitest, Prisma. Delivered as a single branch `claude/throw-to-actionresult` → one PR, executed domain-by-domain with `tsc --noEmit` green at every commit.

---

## Key Facts & Precedents (verified 2026-07-19)

- **The bug:** clients do `catch (err) { setError(err.message) }`. In prod, Server Action throws are redacted by Next → user sees "An error occurred in the Server Components render..." + a digest, never the Spanish message.
- **`unstable_rethrow`** exists in `next/navigation` (Next 16.2.6). It re-throws all framework control-flow errors (redirect, notFound, dynamic-rendering, postpone, bailout-to-CSR) and recurses into `error.cause`. Use it at the top of every catch instead of a hand-rolled `digest` check. Docs: `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/unstable_rethrow.md`.
- **`requiresConfirmation` precedent:** `time-blocks.ts` already returns `{ requiresConfirmation: true, message }` from `createTimeBlock`/`updateTimeBlock`/`createTimeBlockSeries`/etc. This is a *successful* outcome, not an error. It folds into `data`: `{ ok: true, data: { requiresConfirmation, message } }`. Consumers change `'requiresConfirmation' in res` → `'requiresConfirmation' in res.data`.
- **`recover-business.ts` is EXCLUDED:** it already returns `{ success, error, code, redirectTo, ... }` and never throws user-facing. It is the original precedent for this whole approach. Do not touch it. Note the naming divergence: it uses `success`, the new generic wrapper uses `ok` — this is intentional; `recover-business` carries a domain-specific payload, not the generic wrapper.
- **`error.tsx`** (`src/app/error.tsx`) already shows a generic Spanish message; queries that throw continue to render it. Unchanged by this work.
- **Scope:** 21 action modules have client consumers. `admin.ts`, `ledger.ts`, `subscriptions.ts`, `marketing-optout.ts`, `revalidate-business.ts` have **no client consumers** → excluded.

## Cross-cutting decisions LOCKED during execution (apply to every remaining domain)

1. **Tests live in `tests/unit/`, NOT beside the source.** Each domain's action tests are `tests/unit/<domain>.test.ts` and its component tests are `tests/unit/<component>.test.tsx`. `npx vitest run src/server/actions/<domain>` finds NOTHING — that path is empty. Every domain task MUST: (a) find its tests with `grep -rl "<domain>\|<functionName>" tests/unit` and (b) run the FULL suite `npx vitest run` (or at least the matched files) before claiming done. Task 2 initially passed a fake "no tests found" because of this — do not repeat it.
2. **Migrated actions no longer throw for expected errors** → any existing test using `await expect(fn()).rejects.toThrow('X')` becomes `const r = await fn(); expect(r.ok).toBe(false); expect(r.error).toContain('X')`. Success `X` → `{ok:true,data:X}`. `requiresConfirmation` → `{ok:true,data:{requiresConfirmation,message}}`. Component-test mocks must resolve the wrapped shape `{ok:true,data:...}`.
3. **`AuthError` / `ForbiddenError` already extend `UserError`** (done in the infra commit `8d1a159`, in `src/lib/auth/server.ts`). So `throw new ForbiddenError(...)` / `throw new AuthError(...)` from a wrapped action already resolve to `{ok:false, error:<message>}` and their Spanish messages survive. DO NOT convert them per-domain; DO NOT re-wrap them. The `sed` codemod only touches `throw new Error(` and leaves these untouched — correct.
4. **`result.ts` is NOT `server-only`.** `UserError`/`ActionResult` are client-safe values (shared error base). Do not add `import 'server-only'` back — it breaks every test that transitively imports the real `@/lib/auth/server`.
5. **Domain error classes** (`BookingNotPayableError`, `CardLinkError`, `AccountConflictError`, etc.): case-by-case. In a domain where one is thrown AND its message should reach the user, either convert it to `throw new UserError(...)` or make the class `extends UserError`. If its message is internal, leave it (falls to generic). Decide per occurrence, note the choice in the task report.
7. **`export const foo = action(_foo)` is VALID in a `'use server'` module — BUILD-VERIFIED.** Confirmed three ways against this repo's actual Next 16.2.6: (a) runtime validator `ensureServerEntryExports` (`node_modules/next/dist/build/webpack/loaders/next-flight-loader/action-validate.js`) only checks `typeof export === 'function'` — a function-valued const passes; (b) the TS server-boundary rule (`server-boundary.js`) explicitly allows a `CallExpression` initializer returning a function-that-returns-Promise; (c) a full `next build` compiled + typechecked the migrated time-blocks and exited 0. The memory landmine "non-function exports from 'use server' crash at runtime" is about exporting VALUES (objects/constants/types), NOT function-valued consts — `action(_foo)` returns a function, so it's safe. Do not panic about this per-domain.
6. **Silent-swallow guard:** because actions no longer throw, any consumer that previously relied on a throw to halt (e.g. a delete handler with no `.ok` check that then optimistically updates the UI) will now proceed as if successful. When migrating a consumer, add an `if (!res.ok) { ...surface error, do not mutate UI... }` guard even where the old code had no `catch`. Task 2 found three such handlers.

## Domain → functions → client consumers map

Only functions **called from a client file** get wrapped. Each domain task lists candidates; the executor confirms the exact called set via the import + `tsc`.

| Domain (file) | throws | Client consumers |
|---|---|---|
| time-blocks | 13 | block-time-modal, edit-block-dialog, edit-series-occurrence-dialog, recurring-block-list, time-block-form |
| bank-transfer-public | 38 | app/book/confirmation/transfer-panel, components/booking/step-payment, components/booking/transfer-details |
| availability | 8 | reschedule-form, components/booking/step-time, availability-editor |
| bookings | 24 | reschedule-form, new-booking-form, step-payment, booking-row-actions, cancel-booking-button |
| customers | 6 | new-booking-form, edit-form, marketing-optout-toggle, notes-form, customer-list |
| promotions | 8 | new-booking-form, promotion-form, promotion-row-actions, redemptions-button, step-payment |
| campaigns | 7 | bulk-send-controls, recipient-list, new-campaign-dialog |
| loyalty | 27 | loyalty-panel, automatic-rules, loyalty-config-form, preset-picker, redemption-catalog |
| packages | 8 | customers/[id]/package-panel, paquetes/package-catalog, lib/packages/use-package-availability |
| reviews | 13 | review-link-button, reviews-client, review-form |
| bank-transfer-settings | 5 | bank-transfer-form |
| mercado-pago-connect | 3 | disconnect-button |
| my-bookings | 10 | mi/[slug]/booking-actions, reprogramar-form |
| packages-checkout | 21 | paquetes/confirmation/transfer-panel, components/packages/package-catalog, package-checkout |
| payments | 20 | step-payment, manual-payment-dialog |
| bank-transfer-verify | 21 | pending-transfers-section, verify-transfer-dialog, pending-package-transfers |
| revive-booking | 8 | revive-booking-dialog |
| services | 10 | service-form, service-table |
| business-settings | 4 | settings-form |
| onboarding | 4 | onboarding-wizard |

---

## File Structure

- **Create** `src/lib/actions/result.ts` — `ActionResult<T>`, `UserError`, `action()` wrapper. Single security boundary. One clear responsibility: shaping action outcomes.
- **Create** `src/lib/actions/result.test.ts` — unit tests for the wrapper.
- **Modify** the 21 action files under `src/server/actions/` — codemod throws + wrap client-called mutations.
- **Modify** the ~40 client consumer files listed above — read `res.ok`/`res.error`/`res.data` instead of catching.

---

## The Migration Recipe (applied per domain in Tasks 3–21)

This is the exact mechanical procedure. Task 2 (time-blocks) is the fully worked reference; Tasks 3–21 instantiate this recipe with each domain's concrete names.

**In the action file** (`src/server/actions/<domain>.ts`):

1. Codemod every user-facing `throw new Error(` → `throw new UserError(`. Command:
   ```bash
   sed -i '' 's/throw new Error(/throw new UserError(/g' src/server/actions/<domain>.ts
   ```
   Then add the import: `import { action, UserError } from '@/lib/actions/result'`. (Queries in the file also get the codemod — harmless, they still bubble to `error.tsx`.)
2. For each **mutation called from a client component**, wrap its exported binding:
   ```ts
   // before
   export async function fooMutation(args: A): Promise<T> { ... }
   // after — rename impl to _fooMutation, export the wrapped version
   async function _fooMutation(args: A): Promise<T> { ...unchanged body... }
   export const fooMutation = action(_fooMutation)
   ```
   The wrapped export's type becomes `(args: A) => Promise<ActionResult<T>>`. `requiresConfirmation` unions stay inside `T`, so they land in `data`.
3. **Do not wrap queries** called from server components/pages/route handlers.

**In each client consumer** (`.tsx`):

```ts
// before
try {
  const res = await fooMutation(args)
  if (res && 'requiresConfirmation' in res) { setError(res.message); return }
  // ...use res...
} catch (err: unknown) {
  setError(err instanceof Error ? err.message : 'Error')
}

// after — no try/catch for the action's own errors
const res = await fooMutation(args)
if (!res.ok) { setError(res.error); return }
if ('requiresConfirmation' in res.data) { setError(res.data.message); return }
// ...use res.data...
```
Keep any surrounding `try/catch` only if the component also awaits *non-action* code that can throw. The action itself no longer throws user errors.

**Per-domain verification (every task — ALL THREE, not just tsc):**
```bash
# 1. Source type-safety (this is the CI `build` gate — next build only typechecks the app graph, i.e. src/)
npx tsc --noEmit 2>&1 | grep '^src/' || echo "tsc clean"
# 2. Unit tests — find them in tests/unit/ (NOT beside the source), then run the whole unit suite
grep -rl "<domain>\|<wrappedFn>" tests/unit                 # locate the domain's unit + component tests
npm run test:unit 2>&1 | tail -5                             # must stay green (244+ files)
# 3. Integration tests — these run in CI via `npm run test:integration` and are NOT in the default vitest run.
grep -rln "<wrappedFn1>\|<wrappedFn2>" tests/integration     # any integration test that calls a wrapped fn is now broken
#    For each hit, migrate it to the ActionResult shape and run:
npx vitest --run --config vitest.integration.config.ts tests/integration/<file> 2>&1 | tail -10
```
Why all three: `tsc | grep ^src/` alone MISSES broken test files (tsc errors under `tests/` are filtered out, and integration tests are excluded from the default vitest run) — Task 2 shipped a "green" migration that had 15 tsc errors and a runtime failure in `tests/integration/time-block-series.test.ts`. `next build` does NOT typecheck test files (only the app graph), so integration breakage only surfaces by RUNNING `test:integration`. The task is not done until source `tsc` is clean AND every unit/integration test that touches the domain's wrapped functions is migrated and green.

---

### Task 1: Infra — ActionResult, UserError, action() wrapper

**Files:**
- Create: `src/lib/actions/result.ts`
- Test: `src/lib/actions/result.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/actions/result.test.ts
import { describe, it, expect, vi } from 'vitest'
import { redirect, notFound } from 'next/navigation'
import { action, UserError } from './result'

describe('action() wrapper', () => {
  it('returns ok:true with data on success', async () => {
    const wrapped = action(async (n: number) => n * 2)
    await expect(wrapped(21)).resolves.toEqual({ ok: true, data: 42 })
  })

  it('maps UserError to ok:false with its message', async () => {
    const wrapped = action(async () => { throw new UserError('Saldo insuficiente') })
    await expect(wrapped()).resolves.toEqual({ ok: false, error: 'Saldo insuficiente' })
  })

  it('maps a generic Error to a generic message and logs it', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const wrapped = action(async () => { throw new TypeError('boom internal') })
    const res = await wrapped()
    expect(res).toEqual({ ok: false, error: 'Ocurrió un error inesperado. Intenta nuevamente.' })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('re-throws Next redirect control-flow errors', async () => {
    const wrapped = action(async () => { redirect('/dashboard') })
    await expect(wrapped()).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') })
  })

  it('re-throws Next notFound control-flow errors', async () => {
    const wrapped = action(async () => { notFound() })
    await expect(wrapped()).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_HTTP_ERROR_FALLBACK') })
  })

  it('preserves the wrapped function argument signature', async () => {
    const wrapped = action(async (a: string, b: number) => `${a}:${b}`)
    await expect(wrapped('x', 3)).resolves.toEqual({ ok: true, data: 'x:3' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/actions/result.test.ts`
Expected: FAIL — `Cannot find module './result'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/actions/result.ts
import 'server-only'
import { unstable_rethrow } from 'next/navigation'

/**
 * Resultado estructurado de una Server Action invocada desde el cliente.
 * En prod Next.js redacta el mensaje de un throw; devolver el error preserva
 * el texto que el usuario debe ver.
 */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

/**
 * Marcador: "este mensaje SÍ se muestra al usuario". Cualquier otro Error se
 * considera interno y se reemplaza por un genérico (nunca se filtra al cliente).
 */
export class UserError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UserError'
  }
}

const GENERIC_ERROR = 'Ocurrió un error inesperado. Intenta nuevamente.'

/**
 * Envuelve una Server Action de mutación. Único borde de seguridad:
 * - UserError            → { ok: false, error: <mensaje> }
 * - control-flow de Next → se re-lanza (redirect/notFound/dynamic)
 * - cualquier otro Error → se loguea y devuelve un mensaje genérico
 * - éxito                → { ok: true, data }
 */
export function action<A extends unknown[], T>(
  fn: (...args: A) => Promise<T>,
): (...args: A) => Promise<ActionResult<T>> {
  return async (...args: A): Promise<ActionResult<T>> => {
    try {
      return { ok: true, data: await fn(...args) }
    } catch (e) {
      unstable_rethrow(e) // re-lanza redirect/notFound/dynamic — NO son errores
      if (e instanceof UserError) return { ok: false, error: e.message }
      console.error(e)
      return { ok: false, error: GENERIC_ERROR }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/actions/result.test.ts`
Expected: PASS (6 tests). If the `notFound` digest assertion mismatches this Next version, run the test once, read the actual `digest`, and update the `stringContaining(...)` to match — do not weaken it to `.rejects.toThrow()`.

- [ ] **Step 5: tsc + commit**

Run: `npx tsc --noEmit 2>&1 | grep '^src/' || echo "tsc clean"`
Expected: `tsc clean`

```bash
git add src/lib/actions/result.ts src/lib/actions/result.test.ts
git commit -m "feat(actions): ActionResult + UserError + action() wrapper"
```

---

### Task 2: time-blocks (worked reference domain)

**Files:**
- Modify: `src/server/actions/time-blocks.ts`
- Modify: `src/components/dashboard/block-time-modal.tsx`, `edit-block-dialog.tsx`, `edit-series-occurrence-dialog.tsx`, `recurring-block-list.tsx`, `time-block-form.tsx`

Client-called mutations to wrap: `createTimeBlock`, `updateTimeBlock`, `deleteTimeBlock`, `createTimeBlockSeries`, `updateTimeBlockSeries`, `deleteTimeBlockSeries`, `skipSeriesOccurrence`, `overrideSeriesOccurrence`. **Leave queries unwrapped:** `getTimeBlocks`, `getTimeBlocksByRange`, `getTimeBlockSeries` (confirm none are imported by a client file before deciding — per the map, only the mutations are).

- [ ] **Step 1: Codemod throws + import**

```bash
sed -i '' 's/throw new Error(/throw new UserError(/g' src/server/actions/time-blocks.ts
```
Add to the imports of `src/server/actions/time-blocks.ts`:
```ts
import { action, UserError } from '@/lib/actions/result'
```

- [ ] **Step 2: Wrap each client-called mutation**

For each of the 8 mutations, rename the `export async function X` to a private `async function _X` and re-export wrapped. Example for `createTimeBlock`:
```ts
async function _createTimeBlock(data: Omit<TimeBlock, 'id' | 'createdAt' | 'businessId' | 'overlapToleranceMinutes'> & { overlapToleranceMinutes?: number; confirmOverlap?: boolean }) {
  // ...body unchanged (throws are now UserError)...
}
export const createTimeBlock = action(_createTimeBlock)
```
Repeat identically for `updateTimeBlock`, `deleteTimeBlock`, `createTimeBlockSeries`, `updateTimeBlockSeries`, `deleteTimeBlockSeries`, `skipSeriesOccurrence`, `overrideSeriesOccurrence`. Their `requiresConfirmation` return unions are unchanged and now live under `data`.

- [ ] **Step 3: Run tsc to enumerate broken consumers**

Run: `npx tsc --noEmit 2>&1 | grep '^src/' | grep -i 'time-block\|block'`
Expected: FAIL — each consumer that reads the old return shape is now a type error. This is the checklist.

- [ ] **Step 4: Update each consumer**

In `block-time-modal.tsx` the current code (lines ~136–157) is:
```ts
const res = await createTimeBlockSeries({ ... })
if ('requiresConfirmation' in res) { setError(res.message); return }
// ...
const result = await createTimeBlock({ ... })
if (result && 'requiresConfirmation' in result) { setError(result.message); return }
// ...
} catch (err: unknown) {
  setError(err instanceof Error ? err.message : 'Error al crear bloqueo')
}
```
becomes:
```ts
const res = await createTimeBlockSeries({ ... })
if (!res.ok) { setError(res.error); return }
if ('requiresConfirmation' in res.data) { setError(res.data.message); return }
// ...
const result = await createTimeBlock({ ... })
if (!result.ok) { setError(result.error); return }
if ('requiresConfirmation' in result.data) { setError(result.data.message); return }
```
Drop the `catch (err)` branch that only handled the action's error (keep `try/catch` only if the block awaits other throwing code). Apply the same transform in `edit-block-dialog.tsx`, `edit-series-occurrence-dialog.tsx`, `recurring-block-list.tsx`, `time-block-form.tsx` — each guided by its tsc error.

- [ ] **Step 5: Verify tsc clean + tests + commit**

Run:
```bash
npx tsc --noEmit 2>&1 | grep '^src/' || echo "tsc clean"
npx vitest run src/server/actions/time-blocks 2>&1 | tail -5
```
Expected: `tsc clean`; time-block tests (if any) pass.

```bash
git add src/server/actions/time-blocks.ts src/components/dashboard/block-time-modal.tsx src/components/dashboard/edit-block-dialog.tsx src/components/dashboard/edit-series-occurrence-dialog.tsx src/components/dashboard/recurring-block-list.tsx src/components/dashboard/time-block-form.tsx
git commit -m "refactor(time-blocks): migrate client mutations to ActionResult"
```

---

### Tasks 3–21: Remaining domains

Each task applies **The Migration Recipe** to one domain: codemod its `throw new Error`→`UserError` + add the import, wrap only its client-called mutations, update its listed consumers driven by `tsc`, verify `tsc` clean + run any domain tests, and commit with `refactor(<domain>): migrate client mutations to ActionResult`. Do them one at a time; never commit with `tsc` broken. Order chosen small→large to build confidence, ending with the highest-throw domains.

- [ ] **Task 3: business-settings** (4 throws) — wrap `updateBusinessSettings`. Consumer: `src/components/dashboard/settings-form.tsx`.
- [ ] **Task 4: onboarding** (4 throws) — wrap `saveOnboardingStep`, `completeOnboarding`. Consumer: `src/components/onboarding/onboarding-wizard.tsx` (watch for `redirect()`/`router.push` — the wrapper re-throws real redirects).
- [ ] **Task 5: bank-transfer-settings** (5 throws) — wrap `saveBankTransferAccount`, `setBankTransferEnabled`, `setRequireTransferProof`. Consumer: `src/app/dashboard/settings/payments/bank-transfer-form.tsx`.
- [ ] **Task 6: customers** (6 throws) — wrap client-called of `updateCustomer`, `updateCustomerNotes`, `setCustomerMarketingOptOut`, `searchCustomersForBooking`. Leave `getCustomers`, `getCustomerDetail` (server queries). Consumers: `edit-form`, `notes-form`, `marketing-optout-toggle`, `customer-list`, `new-booking-form`.
- [ ] **Task 7: promotions** (8 throws) — wrap `createPromotion`, `updatePromotion`, `setPromotionActive`, `getPromotionRedemptions`, `previewPromotion` as called from clients; leave `listPromotions` if only server-called. Consumers: `promotion-form`, `promotion-row-actions`, `redemptions-button`, `new-booking-form`, `step-payment`.
- [ ] **Task 8: availability** (8 throws) — wrap `updateAvailabilityRule` and any client-called slot fetchers (`getAvailableTimeSlots`, `getAvailableSlotsForReschedule` are called from `step-time`/`reschedule-form` clients — wrap them too since clients read `.message`). Leave `getAvailabilityRules` if server-only. Consumers: `availability-editor`, `components/booking/step-time`, `reschedule-form`.
- [ ] **Task 9: packages** (8 throws) — wrap `upsertPackageProduct`, `archivePackageProduct`, `sellPackage`, `refundPackagePurchase` and client-called getters used by `use-package-availability`. Consumers: `customers/[id]/package-panel`, `paquetes/package-catalog`, `lib/packages/use-package-availability`.
- [ ] **Task 10: revive-booking** (8 throws) — wrap `reviveBooking`. Consumer: `src/components/dashboard/revive-booking-dialog.tsx`.
- [ ] **Task 11: services** (10 throws) — wrap `createService`, `updateService`, `toggleService`, `deleteService`, `reorderServices`. Leave `getServices`. Consumers: `service-form`, `service-table`.
- [ ] **Task 12: my-bookings** (10 throws) — wrap `cancelMyBooking`, `rescheduleMyBooking`, and `getMyRescheduleSlots` if client-called. Consumers: `mi/[slug]/booking-actions`, `reprogramar-form`.
- [ ] **Task 13: reviews** (13 throws) — wrap client-called of `submitReview`, `approveReview`, `hideReview`, `ensureReviewTokenForBooking`, `getReviewLink`, `getReviewWhatsappLink`, `sendReviewRequestEmail`. Leave server queries (`getDashboardReviews`, `getPendingReviewCount`, `getCompletedBookingsWithoutReview`, `getReviewRequest`). Consumers: `review-link-button`, `reviews-client`, `review-form`.
- [ ] **Task 14: campaigns** (7 throws) — wrap `createCampaign`, `sendCampaignMessage`, `sendCampaignEmail`, `sendCampaignEmailBatch`, `listCampaignPromotions` if client-called. Leave `getCampaigns`, `getCampaignDetail`. Consumers: `bulk-send-controls`, `recipient-list`, `new-campaign-dialog`.
- [ ] **Task 15: mercado-pago-connect** (3 throws) — wrap `disconnectMercadoPagoConnection`/`disconnectMercadoPago` as called; `initiateMercadoPagoOAuth`/`startMercadoPagoConnect` likely `redirect()` — verify wrapper re-throws the redirect. Consumer: `disconnect-button`.
- [ ] **Task 16: bookings** (24 throws) — wrap `createBooking`, `updateBookingStatus`, `confirmPayment`, `createBookingFromDashboard`, `cancelBooking`, `rescheduleBooking`. Leave `getBookings`, `getBookingsSummary`, `getBookingsByRange` (server queries — see memory: getBookings is a hot server path). Consumers: `reschedule-form`, `new-booking-form`, `step-payment`, `booking-row-actions`, `cancel-booking-button`.
- [ ] **Task 17: payments** (20 throws) — wrap `initiatePayment`, `verifyAndConfirmPayment`, `createManualPayment` and client-called getters. Leave `getPayments`, `getPaymentsByBooking` if server-only. Consumers: `step-payment`, `manual-payment-dialog`.
- [ ] **Task 18: packages-checkout** (21 throws) — wrap `createPackagePurchase`, `initiatePackagePayment`, `verifyAndConfirmPackagePayment`, `declarePackageTransfer`, and `getPackageCheckoutPrefill` if client-called. Consumers: `paquetes/confirmation/transfer-panel`, `components/packages/package-catalog`, `package-checkout`.
- [ ] **Task 19: bank-transfer-verify** (21 throws) — wrap `confirmBankTransfer`, `rejectBankTransfer`, `confirmPackageTransfer`, `rejectPackageTransfer`. Consumers: `pending-transfers-section`, `verify-transfer-dialog`, `pending-package-transfers`. (Memory landmine: `revalidate*` must be awaited — unrelated but don't remove awaits.)
- [ ] **Task 20: loyalty** (27 throws) — wrap client-called mutations: `upsertLoyaltyConfig`, `adjustCustomerPoints`, `upsertRedemptionOption`, `archiveRedemptionOption`, `redeemPointsAsOwner`, `redeemPointsAsCustomer`, `redeemPointsAsMe`, `upsertAutomaticRule`, `archiveAutomaticRule`, `applyLoyaltyPreset`. Leave `getLoyaltyConfig`, `getCustomerLoyalty`, `listRedemptionOptions`, `listAutomaticRules` if server-called. Consumers: `loyalty-panel`, `automatic-rules`, `loyalty-config-form`, `preset-picker`, `redemption-catalog`.
- [ ] **Task 21: bank-transfer-public** (38 throws) — wrap `createProofUploadUrl`, `declareBankTransfer`, `declareBalanceTransfer`, `attachProof`. Leave `getBankTransferInfo` (called from server + `transfer-details` — if client-called, wrap; confirm via import). Consumers: `app/book/confirmation/transfer-panel`, `components/booking/step-payment`, `components/booking/transfer-details`.

---

### Task 22: Full-suite verification before PR

- [ ] **Step 1: tsc across whole tree**

Run: `npx tsc --noEmit 2>&1 | grep '^src/' || echo "tsc clean"`
Expected: `tsc clean`

- [ ] **Step 2: Full unit + integration suites**

Run: `npx vitest run 2>&1 | tail -15`
Expected: all green. Fix any integration mock that referenced an old return shape (memory landmine: integration mocks must export the functions actions import).

- [ ] **Step 3: Production build (the ONLY gate that validates `'use server'` exports)**

The build compiles the flight loader (validates every `'use server'` export is a function) and runs Next's TS server-boundary rule — neither is caught by vitest or `tsc | grep ^src/`. Run with placeholder (non-secret) env so it compiles without real credentials:
```bash
DATABASE_URL="postgresql://u:p@localhost:5432/db?schema=public" \
DIRECT_URL="postgresql://u:p@localhost:5432/db?schema=public" \
NEXT_PUBLIC_SUPABASE_URL="https://placeholder.supabase.co" \
NEXT_PUBLIC_SUPABASE_ANON_KEY="placeholder-anon-key" \
APP_DOMAIN="example.com" NEXT_PUBLIC_APP_DOMAIN="example.com" \
PAYMENT_PROVIDER="manual" NEXT_TELEMETRY_DISABLED=1 \
npx prisma generate && npx next build 2>&1 | tail -25
```
Expected: `✓ Compiled successfully`, TypeScript passes, exit 0, and NO `E352` / "use server file can only export async functions". (Pages are all dynamic `ƒ`, so the placeholder DB URL is never queried at build.) This was already run once mid-execution and passed — run it again after the last domain.

- [ ] **Step 4: Grep for stragglers**

Run: `grep -rn "err.message\|error.message" src/components src/app --include="*.tsx" | grep -i "setError"`
Expected: no client still reads `.message` from a wrapped action's throw. Any hit is either a non-action throw (fine) or a missed consumer (fix it).

- [ ] **Step 5: Commit any fixes, then open PR**

```bash
git push -u origin claude/throw-to-actionresult
gh pr create --title "refactor(actions): throw → ActionResult para que los mensajes sobrevivan a prod" --body "<summary of the migration, domains covered, and the mutation-vs-query principle>"
```

---

## Self-Review Notes

- **Spec coverage:** mutation-vs-query distinction → File Structure + Recipe + every domain task names which functions to leave unwrapped. `requiresConfirmation` folding → Task 1 type + Task 2 Step 4 + recipe. Security boundary → Task 1 impl + test. `unstable_rethrow` → Task 1. recover-business exclusion → Key Facts.
- **Type consistency:** the wrapper is `action()` and the marker is `UserError` everywhere; return is `ActionResult<T>` with `ok`/`data`/`error` throughout; consumers read `res.ok`/`res.error`/`res.data`/`res.data.message` consistently.
- **Known unknown per domain:** which exact functions are client-called is confirmed by the import + `tsc` at execution time; the map above lists candidates and the "leave unwrapped" queries. This is the one place the plan defers to the compiler by design — `tsc` is a total, mechanical checklist, not a guess.
