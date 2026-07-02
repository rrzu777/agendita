# Readable Booking Number Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every booking a short, non-traceable, human-readable number (`#4738`) shown to customers everywhere the cuid slice is shown today, plus in confirmation/reminder notifications.

**Architecture:** Per-business counter `Business.bookingNumberSeq` (random base). Each booking atomically increments it by a random step (2–9) inside the existing creation transaction and stores the result in `Booking.bookingNumber Int?` (unique per business). Display via a `formatBookingNumber` helper with a cuid fallback. See spec: `docs/superpowers/specs/2026-07-02-readable-booking-number-design.md`.

**Tech Stack:** Next.js (App Router, custom — read `node_modules/next/dist/docs/` before touching framework APIs), Prisma + PostgreSQL, vitest (unit), CI-only integration tests (no local DB), `renderToStaticMarkup` component tests (must mock `next/navigation`).

**Conventions (project landmines):**
- `'use server'` files may only export async functions.
- `revalidateBusinessPublicPaths` must be `await`ed.
- Component tests using a component that calls `useRouter()` must `vi.mock('next/navigation', …)`.
- No local DB → integration tests are validated in CI only. Migrations are hand-written / generated offline.

---

## File Structure

- **Create:** `src/lib/bookings/number.ts` — `assignBookingNumber(tx, businessId)` + `formatBookingNumber(n, fallbackId)`.
- **Create:** `src/lib/bookings/number.test.ts` — unit tests for the formatter + step bounds.
- **Create:** `prisma/migrations/<ts>_readable_booking_number/migration.sql` — DDL + backfill.
- **Modify:** `prisma/schema.prisma` — add `Booking.bookingNumber`, `@@unique`, `Business.bookingNumberSeq`.
- **Modify:** `src/server/actions/bookings.ts` — assign number in both create paths; thread into notifications.
- **Modify:** `src/server/actions/recover-business.ts`, `src/lib/auth/actions.ts` — seed random base.
- **Modify:** display sites — `src/app/book/confirmation/page.tsx`, `src/app/dashboard/bookings/page.tsx`, `src/components/dashboard/manual-payment-dialog.tsx`.
- **Modify:** wizard — `src/components/booking/step-payment.tsx`, `wizard.tsx`, `step-confirmation.tsx`.
- **Modify:** notifications — `src/lib/notifications/types.ts`, `templates.ts`, `whatsapp.ts`, `email-provider.ts` (if needed), `src/lib/cron/send-reminders.ts`, `src/components/dashboard/booking-contact-buttons.tsx`, and the `sendBookingConfirmedNotification` path.

---

### Task 1: Schema + migration

**Files:**
- Modify: `prisma/schema.prisma` (Booking model ~line 335, Business model line 45)
- Create: `prisma/migrations/<timestamp>_readable_booking_number/migration.sql`

- [ ] **Step 1: Add fields to schema**

In `model Booking`, add after `idempotencyKey`:
```prisma
  bookingNumber  Int?
```
And add to the model's block-attributes (next to the existing `@@unique`/`@@index`):
```prisma
  @@unique([businessId, bookingNumber])
```

In `model Business`, add after `bookingWindowDays`:
```prisma
  bookingNumberSeq      Int                @default(1000)
```

- [ ] **Step 2: Generate the exact DDL offline (no DB needed)**

Keep a copy of the pre-change schema first, then diff datamodel-to-datamodel:
```bash
git show HEAD:prisma/schema.prisma > /tmp/old-schema.prisma
npx prisma migrate diff \
  --from-schema-datamodel /tmp/old-schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script
```
Expected output: `ALTER TABLE "Business" ADD COLUMN "bookingNumberSeq" INTEGER NOT NULL DEFAULT 1000;`, `ALTER TABLE "Booking" ADD COLUMN "bookingNumber" INTEGER;`, and `CREATE UNIQUE INDEX "Booking_businessId_bookingNumber_key" ON "Booking"("businessId", "bookingNumber");`. Use this exact DDL (names/types) in the migration file so it stays in sync with what Prisma expects.

- [ ] **Step 3: Write the migration file**

Create `prisma/migrations/20260702000000_readable_booking_number/migration.sql` with the DDL from Step 2, **inserting the backfill between the ADD COLUMNs and the CREATE UNIQUE INDEX** (order matters — the unique index must be created only after `bookingNumber` is populated):

```sql
-- Columns
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

-- Unique constraint (after backfill)
CREATE UNIQUE INDEX "Booking_businessId_bookingNumber_key" ON "Booking"("businessId", "bookingNumber");
```

- [ ] **Step 4: Regenerate Prisma client + typecheck**

Run: `npx prisma generate && npx tsc --noEmit`
Expected: client regenerates; tsc error count stays at the repo baseline (no *new* errors). `bookingNumber` / `bookingNumberSeq` now exist on the generated types.

- [ ] **Step 5: Commit**
```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(booking-number): schema + backfill migration"
```

---

### Task 2: `assignBookingNumber` + `formatBookingNumber` helpers

**Files:**
- Create: `src/lib/bookings/number.ts`
- Create: `src/lib/bookings/number.test.ts`

- [ ] **Step 1: Write the failing test** (`src/lib/bookings/number.test.ts`)

```ts
import { describe, it, expect, vi } from 'vitest'
import { assignBookingNumber, formatBookingNumber } from './number'

describe('formatBookingNumber', () => {
  it('renders #<number> when present', () => {
    expect(formatBookingNumber(4738, 'clabc12345')).toBe('#4738')
  })
  it('falls back to the cuid slice when null', () => {
    expect(formatBookingNumber(null, 'clabc12345')).toBe('#clabc123')
  })
})

describe('assignBookingNumber', () => {
  it('atomically increments the business seq by a step in [2,9] and returns the new value', async () => {
    const update = vi.fn().mockResolvedValue({ bookingNumberSeq: 1042 })
    const tx = { business: { update } } as unknown as Parameters<typeof assignBookingNumber>[0]
    const result = await assignBookingNumber(tx, 'biz1')
    expect(result).toBe(1042)
    expect(update).toHaveBeenCalledOnce()
    const arg = update.mock.calls[0][0]
    expect(arg.where).toEqual({ id: 'biz1' })
    expect(arg.select).toEqual({ bookingNumberSeq: true })
    const step = arg.data.bookingNumberSeq.increment
    expect(step).toBeGreaterThanOrEqual(2)
    expect(step).toBeLessThanOrEqual(9)
  })
  it('uses a variety of steps across many calls (randomized)', async () => {
    const update = vi.fn().mockResolvedValue({ bookingNumberSeq: 1 })
    const tx = { business: { update } } as unknown as Parameters<typeof assignBookingNumber>[0]
    const steps = new Set<number>()
    for (let i = 0; i < 50; i++) { await assignBookingNumber(tx, 'b') ; steps.add(update.mock.calls[i][0].data.bookingNumberSeq.increment) }
    expect(steps.size).toBeGreaterThan(1)
  })
})
```

- [ ] **Step 2: Run it, expect failure** — `npx vitest run src/lib/bookings/number.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** (`src/lib/bookings/number.ts`)

```ts
import { randomInt } from 'node:crypto'
import type { Prisma } from '@prisma/client'

type TxClient = Prisma.TransactionClient

/**
 * Atomically assign the next booking number for a business.
 * Increments Business.bookingNumberSeq by a random step (2–9) and returns the
 * new value. The DB-level increment is atomic (row lock), so concurrent callers
 * for the same business each receive a distinct number even though the slot
 * advisory lock does NOT serialize per-business.
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

- [ ] **Step 4: Run tests, expect pass** — `npx vitest run src/lib/bookings/number.test.ts` → PASS.

- [ ] **Step 5: Commit** — `feat(booking-number): assignBookingNumber + formatBookingNumber helpers`

---

### Task 3: Assign the number in both creation paths

**Files:**
- Modify: `src/server/actions/bookings.ts` (`createBooking` tx ~line 285; `createBookingFromDashboard` tx ~line 781)
- Test: `src/**/booking-number-assignment.integration.test.ts` (follow existing integration test layout; CI-only)

- [ ] **Step 1: Write the failing integration test**

Create an integration test (mirror an existing `*.integration.test.ts` for setup/teardown + `requireTestDatabase()`). Assertions:
- Creating a booking sets `bookingNumber` to a value `>` the business's `bookingNumberSeq` before creation... (capture seq before, assert `bookingNumber > seqBefore` and `<= seqAfter`).
- Two sequential bookings for the same business get strictly increasing `bookingNumber`s.
- `bookingNumber` is unique per business (attempt/verify no collision across N bookings).

(If the repo has no integration harness reachable without a DB, write the test to the established pattern and rely on CI — per project convention.)

- [ ] **Step 2: Run it, expect failure** (locally will skip/fail without DB; that's expected — it runs in CI).

- [ ] **Step 3: Wire `assignBookingNumber` into `createBooking`**

In `src/server/actions/bookings.ts`, import the helper:
```ts
import { assignBookingNumber } from '@/lib/bookings/number'
```
Inside the `createBooking` transaction, right before `const booking = await tx.booking.create({`, add:
```ts
      const bookingNumber = await assignBookingNumber(tx, businessId)
```
Add `bookingNumber,` to the `data: { … }` of that `tx.booking.create`.

- [ ] **Step 4: Wire into `createBookingFromDashboard`**

Same edit inside its transaction before `const newBooking = await tx.booking.create({`:
```ts
    const bookingNumber = await assignBookingNumber(tx, businessId)
```
Add `bookingNumber,` to that create's `data`.

- [ ] **Step 5: Typecheck** — `npx tsc --noEmit` → baseline error count unchanged.

- [ ] **Step 6: Commit** — `feat(booking-number): assign number in both creation transactions`

---

### Task 4: Seed a random base at business creation

**Files:**
- Modify: `src/server/actions/recover-business.ts` (~line 116)
- Modify: `src/lib/auth/actions.ts` (~line 269)

- [ ] **Step 1: Import the helper in both files**
```ts
import { randomBookingNumberBase } from '@/lib/bookings/number'
```
(Note: `recover-business.ts` may be `'use server'` — importing a value that is only used internally is fine; you are NOT adding a non-async export.)

- [ ] **Step 2: Add the field to both `tx.business.create({ data: { … } })` calls**
```ts
        bookingNumberSeq: randomBookingNumberBase(),
```

- [ ] **Step 3: Typecheck** — `npx tsc --noEmit` → baseline unchanged.

- [ ] **Step 4: Commit** — `feat(booking-number): seed random base for new businesses`

---

### Task 5: Display sites (dashboard + public confirmation + manual payment)

**Files:**
- Modify: `src/app/book/confirmation/page.tsx:160`
- Modify: `src/app/dashboard/bookings/page.tsx` (card `~line 70`, table `~line 241`, and the `BookingCard` prop type `~lines 55–58`)
- Modify: `src/components/dashboard/manual-payment-dialog.tsx:151` (and its `payableBookings` type — ensure `bookingNumber` is present)

- [ ] **Step 1: Public confirmation page**

The page fetches with `include` (not `select`) at line 20, so `booking.bookingNumber` is already available. Replace line 160's content:
```tsx
Tu código de reserva: <span className="font-mono font-semibold text-primary">{formatBookingNumber(booking.bookingNumber, booking.id)}</span>
```
Import: `import { formatBookingNumber } from '@/lib/bookings/number'`. (This is fine to import in a server component.)

- [ ] **Step 2: Dashboard bookings — card + table**

Import `formatBookingNumber` in `src/app/dashboard/bookings/page.tsx`. Add `bookingNumber: number | null` to the `BookingCard` booking prop type (the inline type around lines 45–58). Replace:
- Card line ~70: `#{booking.id.slice(0, 8)}` → `{formatBookingNumber(booking.bookingNumber, booking.id)}`
- Table line ~241: same replacement.

`getBookings` returns full Booking rows, so `bookingNumber` is present at runtime; only the inline prop type needs the field added.

- [ ] **Step 3: Manual payment dialog**

In `src/components/dashboard/manual-payment-dialog.tsx`, ensure the `payableBookings` item type includes `bookingNumber: number | null` (add it to the prop type). Replace line 151's fallback:
```tsx
{booking.customer?.name ? `${booking.customer.name} - ` : `Reserva ${formatBookingNumber(booking.bookingNumber, booking.id)} - `}
```
Import `formatBookingNumber`. Verify the parent that passes `payableBookings` provides `bookingNumber` (full booking rows do); add to the query `select` if it uses a narrowing `select`.

- [ ] **Step 4: Component test** (dashboard bookings render)

Add/extend a component test that renders the bookings table/card with a booking having `bookingNumber: 4738` and asserts `#4738` appears; and one with `bookingNumber: null` asserting the `#<slice>` fallback. `vi.mock('next/navigation', …)` if the component tree calls `useRouter()`.

- [ ] **Step 5: Run tests + typecheck** — targeted vitest + `npx tsc --noEmit` (baseline unchanged).

- [ ] **Step 6: Commit** — `feat(booking-number): show #number in dashboard + confirmation + manual payment`

---

### Task 6: Thread the number through the booking wizard

**Files:**
- Modify: `src/components/booking/step-payment.tsx` (`onSuccess` calls ~lines 215–260)
- Modify: `src/components/booking/wizard.tsx` (state line 64, `StepPayment.onSuccess` ~line 140, `StepConfirmation` render ~line 153)
- Modify: `src/components/booking/step-confirmation.tsx:9,69`

- [ ] **Step 1: Widen `onSuccess` to carry the number**

In `wizard.tsx`, add state next to `bookingId`:
```ts
const [bookingNumber, setBookingNumber] = useState<number | null>(null)
```
Change the `StepPayment` `onSuccess` signature to `(id, mode, promo, number)` (append a new last param) and call `setBookingNumber(number ?? null)`.

In `step-payment.tsx`, both `createBooking` result handlers currently call `onSuccess(booking.id, mode, promo)`. Change to `onSuccess(booking.id, mode, promo, booking.bookingNumber)`. (Update the `onSuccess` prop type on `StepPayment` accordingly.)

- [ ] **Step 2: Pass to `StepConfirmation`**

Render (line ~153): `<StepConfirmation data={data} bookingId={bookingId} bookingNumber={bookingNumber} mode={confirmationMode} promo={confirmationPromo} />`.

- [ ] **Step 3: Show it in `step-confirmation.tsx`**

Add `bookingNumber: number | null` to the props type. Replace line 69:
```tsx
<p className="mb-6 text-sm text-muted-foreground">Número de reserva: {formatBookingNumber(bookingNumber, bookingId ?? '')}</p>
```
Import `formatBookingNumber`. (When both are missing it renders `#` — acceptable; in practice `bookingNumber` is always set.)

- [ ] **Step 4: Component test** — render `StepConfirmation` with `bookingNumber={4738}` → asserts `#4738`. Mock `next/navigation` if needed.

- [ ] **Step 5: Run tests + typecheck.**

- [ ] **Step 6: Commit** — `feat(booking-number): show #number in booking wizard confirmation`

---

### Task 7: Notification types + templates render the number

**Files:**
- Modify: `src/lib/notifications/types.ts` (BookingEmailData, NewBookingBusinessEmailData, ReminderEmailData)
- Modify: `src/lib/notifications/whatsapp.ts` (BookingWhatsappData + 3 builders)
- Modify: `src/lib/notifications/templates.ts` (4 html + text pairs)
- Test: `src/lib/notifications/*.test.ts` (extend existing template tests if present)

- [ ] **Step 1: Add the field to the data types**

To `BookingEmailData`, `NewBookingBusinessEmailData`, `ReminderEmailData` (types.ts) and `BookingWhatsappData` (whatsapp.ts), add:
```ts
  bookingNumber?: number | null
```

- [ ] **Step 2: Write failing tests**

Add tests asserting each builder includes `#<n>` when `bookingNumber` is set, and omits the line cleanly when it's null/undefined. Cover: `bookingConfirmationCustomerHtml/Text`, `bookingReceivedCustomerHtml/Text`, `newBookingBusinessHtml/Text`, `bookingReminderHtml/Text`, `buildBookingConfirmationWhatsappMessage`, `buildWhatsappReminderMessage`.

- [ ] **Step 3: Render the number**

In each email template, add a row/line near the top of the summary, e.g. HTML:
```html
${data.bookingNumber != null ? `<tr><td style="padding:8px 0;color:#666">Reserva</td><td style="padding:8px 0;font-weight:600">#${data.bookingNumber}</td></tr>` : ''}
```
and the text equivalent: `if (data.bookingNumber != null) lines.push(\`Reserva: #${data.bookingNumber}\`)`.

In WhatsApp builders, add a line after the greeting: `if (data.bookingNumber != null) lines.push(\`🔖 Reserva #${data.bookingNumber}\`)` (place before the blank separator).

Keep it guarded so a missing number never renders a stray `#` or empty row.

- [ ] **Step 4: Run tests, expect pass.**

- [ ] **Step 5: Commit** — `feat(booking-number): include #number in email + whatsapp templates`

---

### Task 8: Thread the number from every notification caller

**Files:**
- Modify: `src/server/actions/bookings.ts` (`fireBookingNotifications` payloads ~lines 92–137)
- Modify: the `sendBookingConfirmedNotification` implementation in `src/lib/notifications` (locate it; it fetches the booking by id — add `bookingNumber` to its select + pass to the confirmation template)
- Modify: `src/lib/cron/send-reminders.ts` (pass `bookingNumber: booking.bookingNumber` to `sendReminderEmail`, ~line 69)
- Modify: `src/components/dashboard/booking-contact-buttons.tsx` (add `bookingNumber` to the `bookingData` it builds ~line 60; ensure its booking prop carries the field)

- [ ] **Step 1: `fireBookingNotifications`**

Add `bookingNumber: number | null` to the `booking` param type of `fireBookingNotifications`, and include `bookingNumber: booking.bookingNumber` in the `sendBookingReceivedToCustomer` and `sendNewBookingNotificationToBusiness` payloads. The `booking` passed in from `createBooking` already has the field.

- [ ] **Step 2: `sendBookingConfirmedNotification`**

Locate it in `src/lib/notifications` (called from `confirmPayment` / `updateBookingStatus`). It fetches the booking internally — add `bookingNumber` to that `select`/`include` and pass it into `bookingConfirmationCustomerHtml/Text` (and the WhatsApp confirmation message if it sends one).

- [ ] **Step 3: Reminder cron**

In `src/lib/cron/send-reminders.ts`, the top-level `findMany` uses `include`, so `booking.bookingNumber` is available. Add `bookingNumber: booking.bookingNumber,` to the object passed to `sendReminderEmail` (line ~69).

- [ ] **Step 4: WhatsApp reminder button**

In `src/components/dashboard/booking-contact-buttons.tsx`, add `bookingNumber` to the `bookingData` object passed to `buildWhatsappReminderMessage` (and to the confirmation message builder if used here). Ensure the component's `booking` prop type includes `bookingNumber: number | null`; add it to the server query feeding this component if it uses a narrowing `select`.

- [ ] **Step 5: Typecheck + targeted tests** — `npx tsc --noEmit` baseline unchanged; run notification + affected component tests.

- [ ] **Step 6: Commit** — `feat(booking-number): pass #number from all notification callers`

---

## Final verification (controller, after all tasks)

- [ ] `npx tsc --noEmit` — no new errors vs. baseline.
- [ ] `npx vitest run` — all unit/component green.
- [ ] Grep for remaining raw cuid-slice displays of a booking id to confirm none were missed: `rg "booking\.id\.slice"` — each hit should either be intentional (internal/debug) or converted.
- [ ] `/simplify` on the branch diff → apply safe cleanups.
- [ ] Expert code review (superpowers:code-reviewer) → fix findings.
- [ ] Open PR, ensure required checks (build/integration/lint/unit) pass, merge (squash). e2e is not required (known flake).

## Self-review notes (gaps already considered)

- **Backfill ordering** — unique index is created only after `bookingNumber` is populated (Task 1 Step 3). Disjoint per-row ranges (`*7 + jitter[0..5]`) guarantee no collision.
- **Nullable column** — chosen for migration/deploy safety; every display path uses `formatBookingNumber` with a fallback, so a transient null never crashes.
- **Concurrency** — atomic `increment` in the same tx as `booking.create`; rollback (e.g. promo failure) rolls back the increment too (no wasted number, no gap-based leak).
- **Two create paths + two business-creation paths** — both covered (Tasks 3 & 4).
- **Reminder select** — top-level `include` already exposes `bookingNumber`; no select widening needed there (Task 8 Step 3).
