import { randomInt } from 'node:crypto'
import type { Prisma } from '@prisma/client'

type TxClient = Prisma.TransactionClient

/**
 * Atomically assign the next booking number for a business. Increments
 * Business.bookingNumberSeq by a random step (2–9) and returns the new value.
 *
 * The DB-level increment is atomic (row lock), so concurrent bookings for the
 * same business — which do NOT share the per-day advisory lock across different
 * days — each receive a distinct number. Collisions with existing numbers are
 * impossible because the migration sets seq = max(bookingNumber) atomically and
 * seq only ever increases, so seq >= max(assigned) always holds and the next
 * number (seq + step) is strictly greater than every existing one.
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
export function formatBookingNumber(n: number | null | undefined, fallbackId: string | null | undefined): string {
  return n != null ? `#${n}` : `#${(fallbackId ?? '').slice(0, 8)}`
}
