# Readable booking number — design spec

**Date:** 2026-07-02
**Status:** DECIDED (pending gap review)
**Feature:** Give every booking a short, human-readable number (e.g. `#4738`) instead of showing customers a truncated cuid.

This is **PR A** of a 3-PR track:

- **PR A (this doc):** number storage + generation + backfill + display everywhere + notifications.
- **PR B:** public "buscar mi reserva por número" lookup flow (depends on A).
- **PR C:** responsive dashboard tables (independent).

---

## Problem

A booking's identity today is a `cuid` (`clvj8x9w8000108kx0j8j8j8k`). It's shown to users truncated and **inconsistently**:

- `/book/confirmation` — first 8 chars, UPPERCASE.
- Booking wizard step 6 (`step-confirmation.tsx`) — full cuid.
- Dashboard list (card + table) — `#` + first 8 chars, lowercase.
- Manual payment dialog — last 4 chars (fallback when no customer name).
- **Emails + WhatsApp — no identifier at all.**

A cuid slice is not memorable, not dictatable over the phone, and not a stable reference a customer can quote. We want a short number the customer can actually keep.

## Decisions (locked with the user)

1. **Format:** plain number with a `#` prefix for display → `#4738`. No letter prefix.
2. **Per-business** numbering — each business has its own sequence (numbers are only ever shown inside that business's context, so no cross-tenant disambiguation is needed).
3. **Not traceable:** the number must NOT reveal booking volume or ordinal position. A fixed start (e.g. everyone starts at 1000) fails this — `1002` still reads as "the 2nd booking". So:
   - **Random start** per business: base ∈ [1000, 9999], chosen with `crypto.randomInt`.
   - **Random step** per booking: +2…+9, chosen with `crypto.randomInt`.
   - Result: business A → `4732, 4738, 4741, 4749…`; business B → `1180, 1185, 1191…`. Monotonic per business (nice for support/sorting).
   - **Honest scope of the guarantee:** the random *base* fully defeats the headline read ("`#1002` = the 2nd booking") — that goal is met. The random *step* hides small deltas but does **not** hide cumulative volume from a determined competitor who samples the sequence over time (two of their own numbers, N bookings apart, differ by ≈ `N × 5.5 ± 2.3√N` — the relative error shrinks with volume). No monotonic small-step scheme can prevent this; a non-monotonic (Feistel/format-preserving) scheme could, but it loses the ordering property we deliberately want. We accept this: the threat model is "a customer glances at their own number," not "a competitor runs statistics." Do NOT claim the number hides volume.
4. **Scope:** replace the cuid slice in all current display sites **+** include the number in confirmation emails & WhatsApp. (The public lookup flow is PR B.)

## Data model

### `Booking.bookingNumber Int?`

- **Nullable**, unique per business: `@@unique([businessId, bookingNumber])`.
- Why nullable (not `Int`): adding a required column to a table with existing rows, plus the deploy window where migrated schema briefly coexists with old code, both risk NOT-NULL violations. Nullable sidesteps this. In practice it's **never null**: both create paths set it and the backfill covers all existing rows. Postgres treats NULLs as distinct, so the unique constraint still permits the (transient/nonexistent) null case.
- Display always uses a fallback: `booking.bookingNumber ?? <cuid slice>` so nothing breaks if a null ever appears.

### `Business.bookingNumberSeq Int @default(1000)`

- Holds the **last assigned** number for that business (the counter high-water mark).
- New businesses: set to a random base ∈ [1000, 9999] at creation (patch the business-creation path).
- Existing businesses: backfilled (see Migration).
- The `@default(1000)` is only a schema-level floor; creation code always sets an explicit random base.

### Why a dedicated counter (not `max(bookingNumber)+step`)

The anti-double-booking advisory lock in `assertSlotIsAvailable` (`validation.ts:136`) is keyed on `${businessId}:${localDayStr}` — per `(business, calendar DAY)`, **not** per business and **not** per slot. So two bookings for the **same business on different days** run concurrently with no shared lock; a `SELECT max(bookingNumber) … + step` read would race there and could assign duplicates. An atomic `UPDATE … SET seq = seq + step RETURNING seq` on the `Business` row serializes correctly (row lock) and is the source of truth.

**Collision impossibility (load-bearing invariant).** The unique index `@@unique([businessId, bookingNumber])` can only be violated if `bookingNumberSeq` ever sits *below* an already-assigned number for that business. The migration sets `seq = max(bookingNumber)` **atomically** (Prisma runs each `migration.sql` in a single transaction on Postgres, which has transactional DDL), and the only runtime writer is the monotonic atomic `increment`. Therefore `seq ≥ max(assigned)` always holds, and each new number (`seq + step`) is strictly greater than every existing one → no collision is possible. A retry-on-P2002 is deliberately NOT added: after a unique violation Postgres aborts the whole transaction, so an in-tx retry cannot work; correctness rests on the invariant, not on catching the error. (Old code writing `NULL` bookingNumber during the deploy window is harmless — NULLs don't collide.)

**Lock order (invariant for future writers).** A booking transaction acquires locks in the order: advisory lock (`pg_advisory_xact_lock`) → `Business` row (the `bookingNumberSeq` increment) → `Promotion` rows (promo path). All same-business bookings therefore serialize briefly on the `Business` row for the tail of their transaction; at this app's scale that latency is negligible. Future code that writes the `Business` row must not invert this order.

## Number generation

New helper `assignBookingNumber(tx, businessId): Promise<number>` in `src/lib/bookings/number.ts`:

```ts
import { randomInt } from 'crypto'

// step ∈ [2, 9]
export async function assignBookingNumber(tx: TxClient, businessId: string): Promise<number> {
  const step = randomInt(2, 10)
  const updated = await tx.business.update({
    where: { id: businessId },
    data: { bookingNumberSeq: { increment: step } },
    select: { bookingNumberSeq: true },
  })
  return updated.bookingNumberSeq
}
```

- Prisma's `{ increment: step }` compiles to `SET "bookingNumberSeq" = "bookingNumberSeq" + $step`, atomic at the row level; concurrent callers serialize on the row lock and each receives a distinct post-increment value.
- Called inside **both** creation transactions (`createBooking`, `createBookingFromDashboard`), right before `tx.booking.create`, and the returned value is written to `bookingNumber`.
- Random **base** for new businesses is set at business creation: `bookingNumberSeq: randomInt(1000, 10000)`.

Note: the first booking for a business increments from the base (`base + step`), so the base value itself is never used as a booking number — intended, adds one more bit of unpredictability.

## Migration (Postgres, generated offline via `prisma migrate diff`)

Ordered statements in one migration:

1. `ALTER TABLE "Business" ADD COLUMN "bookingNumberSeq" INTEGER NOT NULL DEFAULT 1000;`
2. `ALTER TABLE "Booking" ADD COLUMN "bookingNumber" INTEGER;` (nullable)
3. **Randomize EVERY business's base** (including those with zero bookings, so their first future booking isn't predictable either):

   ```sql
   UPDATE "Business" SET "bookingNumberSeq" = 1000 + floor(random() * 9000)::int;
   ```

4. **Assign jittered numbers to existing bookings** in `createdAt` order, per business, starting from that business's just-set base. A fixed per-row step (7) + bounded jitter (0…5) keeps the per-row ranges `[base + (rn-1)*7, base + (rn-1)*7 + 5]` disjoint and monotonic (next row starts at +7, current row tops out at +5 → never overlap, always unique within the business):

   ```sql
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
   ```

5. **Raise each business's seq to its max assigned number** so future bookings continue above the backfilled range (businesses with zero bookings keep their random base from step 3):

   ```sql
   UPDATE "Business" biz
   SET "bookingNumberSeq" = m.maxnum
   FROM (SELECT "businessId", max("bookingNumber") AS maxnum FROM "Booking" GROUP BY "businessId") m
   WHERE biz.id = m."businessId";
   ```

6. `CREATE UNIQUE INDEX "Booking_businessId_bookingNumber_key" ON "Booking"("businessId", "bookingNumber");`

On the fresh CI/test DB (no rows) steps 4–5 are no-ops (step 3 randomizes the seeded business's base harmlessly); the constraint is still created. The backfill correctness only matters for prod. Prisma wraps the whole `migration.sql` in one transaction (Postgres transactional DDL), so steps 1–6 apply atomically — the `seq = max` high-water mark and the unique index can never disagree.

**Operational note (prod):** the backfill `UPDATE`s every `Booking` row and the non-`CONCURRENTLY` `CREATE UNIQUE INDEX` briefly blocks writes to `Booking`. This app's booking table is small, so a single-shot migration is fine — run it as normal. If the table ever grows large, split the index out to `CREATE UNIQUE INDEX CONCURRENTLY` run *outside* the migration transaction and deploy off-peak. Recorded here so the choice is deliberate, not accidental.

**Because step 3 randomizes the base for ALL businesses, the business-creation patch is a belt-and-suspenders nicety, not strictly required** — but new businesses created after deploy still need a random base, so the creation path must set one (or a lazy-init in `assignBookingNumber` when seq is still at a sentinel). Locked during planning once the creation site is located.

## Display sites (replace cuid slice with `#{bookingNumber}`)

A tiny formatter `formatBookingNumber(n: number | null, fallbackId: string): string` (returns `#${n}` or the current cuid-slice fallback) to keep display consistent:

- `src/app/book/confirmation/page.tsx` — ensure the fetch selects `bookingNumber`; render `#{bookingNumber}`.
- `src/components/booking/step-confirmation.tsx` — currently gets only `bookingId`; thread `bookingNumber` through so it shows `#{bookingNumber}`.
- `src/app/dashboard/bookings/page.tsx` — card (line ~70) + table (line ~241): `#{bookingNumber}`. `getBookings` already returns all scalar fields.
- `src/components/dashboard/manual-payment-dialog.tsx` — fallback label uses `#{bookingNumber}` (field added to `ManualPaymentBooking` in `manual-payment-utils.ts`).
- `src/app/dashboard/customers/[id]/page.tsx` — the customer's booking-history table (owner reads it while the customer quotes their number): show `#{bookingNumber}` per row.
- `src/app/dashboard/bookings/[id]/reschedule/page.tsx` — header/subtitle: include `#{bookingNumber}`.
- `src/server/services/finance.ts` — `getLedgerDescription` builds "reserva XXXX" from `bookingId.slice(-4)`; thread `bookingNumber` in so ledger descriptions read `reserva #4738` (owner-facing). Caller at `finance.ts:~209` passes it.

**Cross-business collisions & logs:** the same `#4738` will belong to many businesses (all start low). It is only ever unambiguous *with* its business context. Keep the internal cuid in all logs (`logger.booking.*`) and never present `#number` as a sole identifier in a support/log surface. The composite `@@unique([businessId, bookingNumber])` already forces any lookup to be tenant-scoped.

## Notifications (add the number)

Thread `bookingNumber` into the notification payloads and render it in each template. Both channels, confirmation + reminder:

- `src/lib/notifications/templates.ts` — `bookingConfirmationCustomerHtml`, `bookingReceivedCustomerHtml`, `newBookingBusinessHtml`, `bookingReminderHtml`: add a "Reserva: #4738" line.
- `src/lib/notifications/whatsapp.ts` — `buildBookingConfirmationWhatsappMessage`, `buildWhatsappReminderMessage`, `buildWhatsappBookingSummaryText`: prefix/append `Reserva #4738`.
- `fireBookingNotifications` in `bookings.ts` and the reminder-sending path (cron) must pass `bookingNumber` into these builders. The reminder path reads bookings from DB, so `bookingNumber` is already available there.

## Testing

- **Unit** — `assignBookingNumber`: increments atomically, returns the new value, uses a step in [2,9]. `formatBookingNumber`: `#n` when present, cuid fallback when null.
- **Integration** — creating a booking assigns a `bookingNumber` > the business's previous seq; two sequential bookings get increasing numbers; the number is unique per business; a business's first booking initializes above its random base.
- **Component** — display sites render `#<number>` (mock `next/navigation` per the known landmine).
- No local DB → integration validated in CI (per project convention).

## Out of scope (PR A)

- **Dashboard search by `#number`** — deferred to **PR C** (the dashboard-tables PR); it touches `getBookings` query shape + filter UI. Known follow-up: without it, the owner can display the number but not yet jump to a booking by it. Flagged so PR A doesn't read as "complete" when the owner's own lookup use case is unmet.
- Public "buscar mi reserva por número" lookup → **PR B**. PR A sets it up correctly: `@@unique([businessId, bookingNumber])` forces PR B to query tenant-scoped (`subdomain → businessId`, then `(businessId, bookingNumber)`) — never a global `findUnique({ where: { bookingNumber } })`. `bookingNumber` is a plain `Int`, so PR B parses user input with `parseInt` (strip a leading `#`).
- MercadoPago item description and the review-request email/WhatsApp — cheap on-theme nice-to-haves, deferred (not core to A's confirmation+reminder notification scope). MercadoPago `external_reference` stays the `Payment` id — do NOT touch it.
- Backfilling the number into already-sent notifications (not possible; only future notifications carry it).
- Changing the internal `id` (cuid) — all internal lookups/routes keep using the cuid; `bookingNumber` is a **display + customer-facing lookup** value only.

## Open questions for gap review

1. **Reminder cron path:** confirm exactly where reminders are composed so `bookingNumber` gets threaded (the explorer found `bookingReminderHtml` / `buildWhatsappReminderMessage` but not the caller).
2. **Business creation site(s):** need to locate the onboarding/signup path that creates a `Business` to set the random base. If there are multiple, all must set it (or rely on the `@default` + a lazy init — decide during planning).
3. **`step-confirmation.tsx` data flow:** it currently receives only `bookingId`. Threading `bookingNumber` may touch the wizard's state shape — verify the blast radius during planning.
