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
   - Result: business A → `4732, 4738, 4741, 4749…`; business B → `1180, 1185, 1191…`. Monotonic per business (nice for support/sorting), but neither the start nor the gaps are predictable, so you can't read volume off it.
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

The anti-double-booking advisory lock in `assertSlotIsAvailable` is scoped to `(business, time-slot)`, **not** to the business. Two bookings for the same business at different times run concurrently with no shared lock, so a `SELECT max(bookingNumber) … + step` read would race and could assign duplicates. An atomic `UPDATE … SET seq = seq + step RETURNING seq` on the `Business` row serializes correctly (row lock) and is the source of truth.

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

On the fresh CI/test DB (no rows) steps 4–5 are no-ops (step 3 randomizes the seeded business's base harmlessly); the constraint is still created. The backfill correctness only matters for prod.

**Because step 3 randomizes the base for ALL businesses, the business-creation patch is a belt-and-suspenders nicety, not strictly required** — but new businesses created after deploy still need a random base, so the creation path must set one (or a lazy-init in `assignBookingNumber` when seq is still at a sentinel). Locked during planning once the creation site is located.

## Display sites (replace cuid slice with `#{bookingNumber}`)

A tiny formatter `formatBookingNumber(n: number | null, fallbackId: string): string` (returns `#${n}` or the current cuid-slice fallback) to keep display consistent:

- `src/app/book/confirmation/page.tsx` — ensure the fetch selects `bookingNumber`; render `#{bookingNumber}`.
- `src/components/booking/step-confirmation.tsx` — currently gets only `bookingId`; thread `bookingNumber` through so it shows `#{bookingNumber}`.
- `src/app/dashboard/bookings/page.tsx` — card (line ~70) + table (line ~241): `#{bookingNumber}`. `getBookings` already returns all scalar fields.
- `src/components/dashboard/manual-payment-dialog.tsx` — fallback label uses `#{bookingNumber}`.

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

- Public "buscar mi reserva por número" lookup (PR B).
- Backfilling the number into already-sent notifications (not possible; only future notifications carry it).
- Changing the internal `id` (cuid) — all internal lookups/routes keep using the cuid; `bookingNumber` is a **display + customer-facing lookup** value only.

## Open questions for gap review

1. **Reminder cron path:** confirm exactly where reminders are composed so `bookingNumber` gets threaded (the explorer found `bookingReminderHtml` / `buildWhatsappReminderMessage` but not the caller).
2. **Business creation site(s):** need to locate the onboarding/signup path that creates a `Business` to set the random base. If there are multiple, all must set it (or rely on the `@default` + a lazy init — decide during planning).
3. **`step-confirmation.tsx` data flow:** it currently receives only `bookingId`. Threading `bookingNumber` may touch the wizard's state shape — verify the blast radius during planning.
