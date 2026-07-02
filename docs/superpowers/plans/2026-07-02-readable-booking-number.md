# Readable Booking Number Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every booking a short, non-traceable, human-readable number (`#4738`) shown to customers and owners everywhere the cuid slice is shown today, plus in confirmation/reminder notifications.

**Architecture:** Per-business counter `Business.bookingNumberSeq` (random base). Each booking atomically increments it by a random step (2–9) inside the existing creation transaction and stores the result in `Booking.bookingNumber Int?` (unique per business). Display via a `formatBookingNumber` helper with a cuid fallback. Full rationale + invariants: `docs/superpowers/specs/2026-07-02-readable-booking-number-design.md` (read the "Why a dedicated counter" section — the collision-impossibility invariant and lock order are load-bearing).

**Tech Stack:** Next.js (App Router, custom — read `node_modules/next/dist/docs/` before touching framework APIs), Prisma + PostgreSQL, vitest. Tests live in `tests/unit/**` and `tests/integration/**` (NOT co-located in `src/`). Integration tests need a local Postgres and are gated by `requireTestDatabase()` — validated in CI.

**Conventions (project landmines):**
- `'use server'` files may only export async functions. `src/lib/bookings/number.ts` is a plain lib (not `'use server'`), so its non-async exports are fine to import into server actions.
- `revalidateBusinessPublicPaths` must be `await`ed.
- Component tests use `renderToStaticMarkup`; mock `next/navigation` only when the rendered tree calls `useRouter()`.
- Migrations: one `migration.sql` per timestamped folder; CI runs the full chain (`00000000000000_init` baseline → … → this) via `prisma migrate deploy` against fresh Postgres in the `integration` and `e2e` jobs, so the backfill SQL actually executes in CI.
- Required CI checks: `lint`, `unit`, `integration`, `build`. `e2e` is NOT required (known public-booking flake).

---

## File Structure

- **Create:** `src/lib/bookings/number.ts` — `assignBookingNumber`, `randomBookingNumberBase`, `formatBookingNumber`.
- **Create:** `tests/unit/booking-number.test.ts`, `tests/integration/booking-number-assignment.test.ts`.
- **Create:** `prisma/migrations/20260702000000_readable_booking_number/migration.sql`.
- **Modify:** `prisma/schema.prisma`; `src/server/actions/bookings.ts`; `src/server/actions/recover-business.ts`; `src/lib/auth/actions.ts`.
- **Modify (display):** `src/app/book/confirmation/page.tsx`; `src/app/dashboard/bookings/page.tsx`; `src/components/dashboard/manual-payment-dialog.tsx` + `src/lib/.../manual-payment-utils.ts`; `src/app/dashboard/customers/[id]/page.tsx`; `src/app/dashboard/bookings/[id]/reschedule/page.tsx`; `src/server/services/finance.ts`; the wizard (`step-payment.tsx`, `wizard.tsx`, `step-confirmation.tsx`).
- **Modify (notifications):** `src/lib/notifications/types.ts`, `templates.ts`, `whatsapp.ts`, `email-provider.ts`; `src/lib/cron/send-reminders.ts`; `src/components/dashboard/booking-contact-buttons.tsx` (+ its callers `page.tsx`, `booking-drawer.tsx`).

---

### Task 1: Schema + migration

**Files:** Modify `prisma/schema.prisma`; Create `prisma/migrations/20260702000000_readable_booking_number/migration.sql`

- [ ] **Step 1: Add fields to schema**

`model Booking`: add `bookingNumber Int?` after `idempotencyKey`, and add block attribute `@@unique([businessId, bookingNumber])`.
`model Business`: add `bookingNumberSeq Int @default(1000)` after `bookingWindowDays`.

- [ ] **Step 2: Generate the exact DDL offline (MANDATORY — do not hand-write the ALTER/INDEX)**

```bash
git show HEAD:prisma/schema.prisma > /tmp/old-schema.prisma
npx prisma migrate diff \
  --from-schema-datamodel /tmp/old-schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script
```
Use the emitted DDL verbatim (exact column types + the `Booking_businessId_bookingNumber_key` index name) so Prisma Client queries match the built schema in CI. **If line 1 is shell noise like `zsh: command not found: _nvm_load`, delete it** — keep only real SQL.

- [ ] **Step 3: Write the migration file**

Create `prisma/migrations/20260702000000_readable_booking_number/migration.sql` with the Step-2 DDL, inserting the backfill **between the ADD COLUMNs and the CREATE UNIQUE INDEX** (Prisma runs the whole file in one transaction on Postgres, so this is atomic):

```sql
-- Columns (from `prisma migrate diff`)
ALTER TABLE "Business" ADD COLUMN "bookingNumberSeq" INTEGER NOT NULL DEFAULT 1000;
ALTER TABLE "Booking" ADD COLUMN "bookingNumber" INTEGER;

-- Backfill: randomize every business's base (covers zero-booking businesses too)
UPDATE "Business" SET "bookingNumberSeq" = 1000 + floor(random() * 9000)::int;

-- Backfill: assign jittered, monotonic, per-business-unique numbers to existing bookings.
-- Per-row range [base + (rn-1)*7, base + (rn-1)*7 + 5]; next row starts at +7 so ranges never overlap.
WITH seq AS (
  SELECT b.id,
         b."businessId",
         row_number() OVER (PARTITION BY b."businessId" ORDER BY b."createdAt", b.id) AS rn
  FROM "Booking" b
)
UPDATE "Booking" bk
SET "bookingNumber" = biz."bookingNumberSeq" + (seq.rn - 1) * 7 + floor(random() * 6)::int
FROM seq
JOIN "Business" biz ON biz.id = seq."businessId"
WHERE bk.id = seq.id;

-- Raise each business's seq to its max assigned number so future bookings continue above the range
UPDATE "Business" biz
SET "bookingNumberSeq" = m.maxnum
FROM (SELECT "businessId", max("bookingNumber") AS maxnum FROM "Booking" GROUP BY "businessId") m
WHERE biz.id = m."businessId";

-- Unique constraint (after backfill) — use the EXACT name from `prisma migrate diff`
CREATE UNIQUE INDEX "Booking_businessId_bookingNumber_key" ON "Booking"("businessId", "bookingNumber");
```

**Operational note (prod):** booking table is small → single-shot migration is fine. (If it ever grows large, split the index to `CREATE UNIQUE INDEX CONCURRENTLY` outside the migration txn, off-peak.)

- [ ] **Step 4: Regenerate client + typecheck** — `npx prisma generate && npx tsc --noEmit` → baseline error count unchanged; `bookingNumber`/`bookingNumberSeq` now on generated types.

- [ ] **Step 5: Commit** — `feat(booking-number): schema + backfill migration`

---

### Task 2: `assignBookingNumber` / `randomBookingNumberBase` / `formatBookingNumber`

**Files:** Create `src/lib/bookings/number.ts`; Create `tests/unit/booking-number.test.ts`

- [ ] **Step 1: Write the failing unit test** (`tests/unit/booking-number.test.ts`)

```ts
import { describe, it, expect, vi } from 'vitest'
import { assignBookingNumber, formatBookingNumber, randomBookingNumberBase } from '@/lib/bookings/number'

describe('formatBookingNumber', () => {
  it('renders #<number> when present', () => {
    expect(formatBookingNumber(4738, 'clabc12345')).toBe('#4738')
  })
  it('falls back to the cuid slice when null', () => {
    expect(formatBookingNumber(null, 'clabc12345')).toBe('#clabc123')
  })
})

describe('randomBookingNumberBase', () => {
  it('is within [1000, 9999]', () => {
    for (let i = 0; i < 100; i++) {
      const b = randomBookingNumberBase()
      expect(b).toBeGreaterThanOrEqual(1000)
      expect(b).toBeLessThanOrEqual(9999)
    }
  })
})

describe('assignBookingNumber', () => {
  it('atomically increments seq by a step in [2,9] and returns the new value', async () => {
    const update = vi.fn().mockResolvedValue({ bookingNumberSeq: 1042 })
    const tx = { business: { update } } as unknown as Parameters<typeof assignBookingNumber>[0]
    const result = await assignBookingNumber(tx, 'biz1')
    expect(result).toBe(1042)
    const arg = update.mock.calls[0][0]
    expect(arg.where).toEqual({ id: 'biz1' })
    expect(arg.select).toEqual({ bookingNumberSeq: true })
    const step = arg.data.bookingNumberSeq.increment
    expect(step).toBeGreaterThanOrEqual(2)
    expect(step).toBeLessThanOrEqual(9)
  })
  it('uses a variety of steps across many calls', async () => {
    const update = vi.fn().mockResolvedValue({ bookingNumberSeq: 1 })
    const tx = { business: { update } } as unknown as Parameters<typeof assignBookingNumber>[0]
    const steps = new Set<number>()
    for (let i = 0; i < 50; i++) { await assignBookingNumber(tx, 'b'); steps.add(update.mock.calls[i][0].data.bookingNumberSeq.increment) }
    expect(steps.size).toBeGreaterThan(1)
  })
})
```

- [ ] **Step 2: Run it, expect failure** — `npx vitest run tests/unit/booking-number.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** (`src/lib/bookings/number.ts`)

```ts
import { randomInt } from 'node:crypto'
import type { Prisma } from '@prisma/client'

type TxClient = Prisma.TransactionClient

/**
 * Atomically assign the next booking number for a business. Increments
 * Business.bookingNumberSeq by a random step (2–9) and returns the new value.
 * The DB-level increment is atomic (row lock), so concurrent bookings for the
 * same business (which do NOT share the per-day advisory lock across days) each
 * get a distinct number. Collisions are impossible because the migration sets
 * seq = max(bookingNumber) atomically and seq only ever increases (see spec).
 */
export async function assignBookingNumber(tx: TxClient, businessId: string): Promise<number> {
  const step = randomInt(2, 10) // [2, 9]
  const updated = await tx.business.update({
    where: { id: businessId },
    data: { bookingNumberSeq: { increment: step } },
    select: { bookingNumberSeq: true },
  })
  return updated.bookingNumberSeq
}

/** Random starting base for a brand-new business: [1000, 9999]. */
export function randomBookingNumberBase(): number {
  return randomInt(1000, 10000)
}

/** Display helper: `#4738`, or a cuid-slice fallback if the number is missing. */
export function formatBookingNumber(n: number | null | undefined, fallbackId: string): string {
  return n != null ? `#${n}` : `#${fallbackId.slice(0, 8)}`
}
```

- [ ] **Step 4: Run tests, expect pass.**
- [ ] **Step 5: Commit** — `feat(booking-number): assignBookingNumber + formatBookingNumber helpers`

---

### Task 3: Assign the number in both creation paths (+ integration tests)

**Files:** Modify `src/server/actions/bookings.ts`; Create `tests/integration/booking-number-assignment.test.ts`

- [ ] **Step 1: Write the failing integration test**

Mirror `tests/integration/booking.test.ts` exactly for setup (top-level `requireTestDatabase()` from `./setup`; `new PrismaClient()`; `deleteMany` cleanup in FK order; create business/user/service/customer). Test the **`assignBookingNumber(tx, businessId)` unit inside `prisma.$transaction`** — NOT the `createBooking` server action (the harness has no auth/rate-limit mock; `requireBusiness()` would fail). Assertions:
1. `assignBookingNumber` returns a value `>` the business's `bookingNumberSeq` before the call and equal to the persisted `bookingNumberSeq` after.
2. Two sequential calls return strictly increasing numbers.
3. **Concurrency:** fire ~20 `assignBookingNumber` calls for the same business via `Promise.all`, each in its own `prisma.$transaction` — assert the returned set has 20 distinct values (no collision).
4. **Backfill uniqueness/monotonicity:** insert several bookings with `bookingNumber = null` (raw `prisma.booking.create`), then run the backfill core via `prisma.$executeRawUnsafe` (the two `UPDATE … WITH seq` + seq-raise statements from the migration) and assert every booking got a distinct, monotonic-by-(createdAt,id) `bookingNumber` and `Business.bookingNumberSeq >= max`.
5. **Unique constraint:** creating two bookings with the same explicit `(businessId, bookingNumber)` rejects — `await expect(...).rejects.toThrow()` (mirror `booking.test.ts`'s EXCLUDE-constraint pattern).

- [ ] **Step 2: Run it** — locally requires Postgres; expected to run/pass in CI's `integration` job. If a local DB is available, `npm run test:integration`.

- [ ] **Step 3: Wire into `createBooking`**

Import `import { assignBookingNumber } from '@/lib/bookings/number'`. Inside the `createBooking` transaction, immediately before `const booking = await tx.booking.create({`, add:
```ts
      const bookingNumber = await assignBookingNumber(tx, businessId)
```
and add `bookingNumber,` to that create's `data`.

- [ ] **Step 4: Wire into `createBookingFromDashboard`** — same edit before `const newBooking = await tx.booking.create({`; add `bookingNumber,` to its `data`.

- [ ] **Step 5: Typecheck** — `npx tsc --noEmit` baseline unchanged.
- [ ] **Step 6: Commit** — `feat(booking-number): assign number in both creation transactions`

---

### Task 4: Seed a random base at business creation

**Files:** Modify `src/server/actions/recover-business.ts` (~line 116); `src/lib/auth/actions.ts` (~line 269)

- [ ] **Step 1:** In both files: `import { randomBookingNumberBase } from '@/lib/bookings/number'`.
- [ ] **Step 2:** Add `bookingNumberSeq: randomBookingNumberBase(),` to both `tx.business.create({ data: { … } })` blocks.
- [ ] **Step 3: Typecheck** — baseline unchanged.
- [ ] **Step 4: Commit** — `feat(booking-number): seed random base for new businesses`

---

### Task 5: Display — dashboard bookings + confirmation + manual payment

**Files:** `src/app/dashboard/bookings/page.tsx` (export `BookingCard` at ~L45; card ~L70; table ~L241; card prop type ~L45–58); `src/app/book/confirmation/page.tsx:160`; `src/components/dashboard/manual-payment-dialog.tsx:151` + `manual-payment-utils.ts` (`ManualPaymentBooking` ~L3–12)

- [ ] **Step 1: Public confirmation page** — import `formatBookingNumber`; replace line 160's identifier with `{formatBookingNumber(booking.bookingNumber, booking.id)}` (page already fetches via `include`, so `bookingNumber` is present; drops the old `.slice(0,8).toUpperCase()`).

- [ ] **Step 2: Dashboard bookings — card + table** — `export function BookingCard` (add `export` so a component test can import it). Add `bookingNumber: number | null` to the card's inline booking prop type. Replace card L70 and table L241 `#{booking.id.slice(0,8)}` with `{formatBookingNumber(booking.bookingNumber, booking.id)}` (import the helper).

- [ ] **Step 3: Manual payment dialog** — add `bookingNumber: number | null` to `ManualPaymentBooking` (`manual-payment-utils.ts`). Replace L151 fallback with `` `Reserva ${formatBookingNumber(booking.bookingNumber, booking.id)} - ` `` (import helper). Data source is `getBookings()` (full rows) — no select widening needed.

- [ ] **Step 4: Component test** (`tests/unit/booking-number-display.test.tsx`) — import the now-exported `BookingCard`; render with `bookingNumber: 4738` → assert `#4738`; render with `bookingNumber: null` → assert `#<slice>` fallback. Mirror `tests/unit/recurring-block-list.test.tsx`; add `vi.mock('next/navigation', …)` only if the extracted card renders a `useRouter()` child (verify after adding `export`).

- [ ] **Step 5: Run tests + typecheck.**
- [ ] **Step 6: Commit** — `feat(booking-number): show #number in dashboard bookings + confirmation + manual payment`

---

### Task 6: Thread the number through the booking wizard

**Files:** `src/components/booking/step-payment.tsx` (`onSuccess` calls ~L229/L286; prop type ~L51); `src/components/booking/wizard.tsx` (state L64; `StepPayment.onSuccess` ~L140; `StepConfirmation` render ~L154); `src/components/booking/step-confirmation.tsx:9,69`

- [ ] **Step 1:** In `wizard.tsx` add `const [bookingNumber, setBookingNumber] = useState<number | null>(null)`. Widen `StepPayment`'s `onSuccess` to a trailing `number: number | null` param; in the callback `setBookingNumber(number ?? null)`.
- [ ] **Step 2:** In `step-payment.tsx`, both handlers call `onSuccess(booking.id, mode, promo, booking.bookingNumber)`; update the `onSuccess` prop type accordingly.
- [ ] **Step 3:** Render `<StepConfirmation … bookingNumber={bookingNumber} … />`. In `step-confirmation.tsx` add `bookingNumber: number | null` to props; replace L69 with `Número de reserva: {formatBookingNumber(bookingNumber, bookingId ?? '')}` (import helper). `StepConfirmation` is exported and does not call `useRouter`.
- [ ] **Step 4: Component test** — render `StepConfirmation` with `bookingNumber={4738}` → `#4738` (no router mock needed).
- [ ] **Step 5: Run tests + typecheck.**
- [ ] **Step 6: Commit** — `feat(booking-number): show #number in wizard confirmation`

---

### Task 7: Display — customer history + reschedule header + ledger descriptions

**Files:** `src/app/dashboard/customers/[id]/page.tsx` (~L226 booking-history table); `src/app/dashboard/bookings/[id]/reschedule/page.tsx` (~L41 header); `src/server/services/finance.ts` (`getLedgerDescription` ~L52, caller ~L209)

- [ ] **Step 1: Customer booking-history table** — the page loads the customer's bookings; add a `#{formatBookingNumber(b.bookingNumber, b.id)}` cell/line per booking row (verify the query returns full booking rows or add `bookingNumber` to its `select`). Import the helper.

- [ ] **Step 2: Reschedule page header** — add `#{formatBookingNumber(booking.bookingNumber, booking.id)}` to the header/subtitle. The page fetches the booking by id; add `bookingNumber` to its `select` if it narrows.

- [ ] **Step 3: Ledger descriptions** — change `getLedgerDescription` to accept the booking number and render `reserva #4738` instead of `reserva ${bookingId.slice(-4)}`. Thread it from the caller (`finance.ts:~209`) — the surrounding code has the booking in scope (`booking.bookingNumber`). Keep the cuid available for logs; only the human-readable description changes.

- [ ] **Step 4: Test** — extend/adjust any existing `finance` test for the new description format; a unit test that `getLedgerDescription` with a number renders `reserva #4738` and falls back cleanly when null.

- [ ] **Step 5: Typecheck + tests.**
- [ ] **Step 6: Commit** — `feat(booking-number): show #number in customer history, reschedule, ledger`

---

### Task 8: Notification types + templates render the number

**Files:** `src/lib/notifications/types.ts`; `src/lib/notifications/whatsapp.ts`; `src/lib/notifications/templates.ts`; extend `tests/unit/notifications.test.ts` + `tests/unit/whatsapp-notifications.test.ts`

- [ ] **Step 1:** Add `bookingNumber?: number | null` to `BookingEmailData`, `NewBookingBusinessEmailData`, `ReminderEmailData` (types.ts) and `BookingWhatsappData` (whatsapp.ts).

- [ ] **Step 2: Failing tests** — assert each builder includes `#<n>` when set and omits the line cleanly (no stray `#`/empty row) when null/undefined. Cover: `bookingConfirmationCustomerHtml/Text`, `bookingReceivedCustomerHtml/Text`, `newBookingBusinessHtml/Text`, `bookingReminderHtml/Text`, `buildBookingConfirmationWhatsappMessage`, `buildWhatsappReminderMessage`.

- [ ] **Step 3: Render** — email templates: a guarded summary row, e.g.
  `${data.bookingNumber != null ? `<tr><td style="padding:8px 0;color:#666">Reserva</td><td style="padding:8px 0;font-weight:600">#${data.bookingNumber}</td></tr>` : ''}` (+ text equivalent `if (data.bookingNumber != null) lines.push(\`Reserva: #${data.bookingNumber}\`)`). WhatsApp: `if (data.bookingNumber != null) lines.push(\`🔖 Reserva #${data.bookingNumber}\`)` before the blank separator.

- [ ] **Step 4: Run tests, expect pass.**
- [ ] **Step 5: Commit** — `feat(booking-number): include #number in email + whatsapp templates`

---

### Task 9: Thread the number from every notification caller

**Files:** `src/server/actions/bookings.ts` (`fireBookingNotifications` param type ~L70–79 + payloads ~L97–135); `src/lib/notifications/email-provider.ts` (`sendBookingConfirmedNotification` ~L200); `src/lib/cron/send-reminders.ts` (~L69); `src/components/dashboard/booking-contact-buttons.tsx` (`BookingContactData` ~L13–25) + its construction sites (`src/app/dashboard/bookings/page.tsx` ~L107 & ~L268, `src/components/dashboard/booking-drawer.tsx` ~L121)

- [ ] **Step 1: `fireBookingNotifications`** — add `bookingNumber: number | null` to its inline `booking` param type; pass `bookingNumber: booking.bookingNumber` into the `sendBookingReceivedToCustomer` and `sendNewBookingNotificationToBusiness` payloads. The `booking` from `createBooking` already carries it.

- [ ] **Step 2: `sendBookingConfirmedNotification`** (`email-provider.ts:200`) — its booking fetch already uses top-level `include`, so `booking.bookingNumber` is available **without** widening any select. Pass it into the `bookingConfirmationCustomerHtml/Text` payload (and the WhatsApp confirmation message if that path builds one).

- [ ] **Step 3: Reminder cron** (`send-reminders.ts:~69`) — top-level `findMany` uses `include`, so `booking.bookingNumber` is available; add `bookingNumber: booking.bookingNumber,` to the `sendReminderEmail` payload.

- [ ] **Step 4: WhatsApp reminder button** — `booking-contact-buttons.tsx` uses a flat DTO `BookingContactData` (not a Prisma row). Add `bookingNumber: number | null` to that interface, pass it into `buildWhatsappReminderMessage`/confirmation builders, and add `bookingNumber` to every inline object that constructs a `BookingContactData` (bookings `page.tsx` ~L107 & ~L268, `booking-drawer.tsx` ~L121) — sourced from `getBookings()` full rows.

- [ ] **Step 5: Typecheck + targeted tests** (`send-reminders.test.ts`, notification tests, affected component tests) — baseline unchanged.
- [ ] **Step 6: Commit** — `feat(booking-number): pass #number from all notification callers`

---

## Final verification (controller, after all tasks)

- [ ] `npx tsc --noEmit` — no new errors vs. baseline.
- [ ] `npx vitest run` — all unit/component green.
- [ ] `rg "\.id\.slice\("` — every remaining booking-id slice is either intentional-internal or converted; confirm none is a leftover user-facing booking display.
- [ ] `/simplify` on the branch diff → apply safe cleanups.
- [ ] Expert code review (superpowers:code-reviewer) → fix findings.
- [ ] Open PR; required checks (build/integration/lint/unit) green; merge (squash). e2e not required (known flake).

## Invariants & gaps already resolved (do not re-litigate)

- **Collision impossibility:** migration runs in one Postgres transaction (Prisma default) setting `seq = max(bookingNumber)`; runtime only ever atomically increments → next number always `> max` → no P2002 on `bookingNumber`. No retry is added (a post-error tx is poisoned in Postgres; correctness rests on the invariant). Deploy-window NULLs are harmless.
- **Advisory lock is per (business, DAY)** (`validation.ts:136`), not per slot; different-day same-business bookings run concurrently → the atomic counter is required and sufficient.
- **Lock order** advisory → Business row → Promotion rows; same-business bookings serialize briefly on the Business row (negligible at this scale). Future Business writers must not invert.
- **Backfill** is ordered (unique index last) with disjoint per-row ranges (`*7 + jitter[0..5]`); zero-booking businesses still get a random base.
- **Nullable column** for deploy safety; every display uses `formatBookingNumber` fallback.
- **Traceability:** random base defeats "read the ordinal"; it does NOT hide cumulative volume from a sampling competitor — accepted (spec documents this honestly). Step stays 2–9.
- **Deferred:** dashboard search by #number → PR C; public lookup → PR B (must be tenant-scoped); MercadoPago description / review email → fast-follow. `external_reference` untouched.
