import { BookingStatus, type Prisma } from '@prisma/client'
import { hasUsablePushConfig } from '@/lib/push/config'

export const PUSH_ELIGIBLE_BOOKING_STATUSES = [
  BookingStatus.pending_payment,
  BookingStatus.pending_confirmation,
  BookingStatus.confirmed,
] as const

export type PushEligibleCustomer = { id: string; businessId: string }

type PushEligibleBookingCandidate = {
  startDateTime: Date
  status: BookingStatus
  cancellationCutoffHours: number | null
  depositRequired: number
  depositPaid: number
}

type PushEligibleBusinessCandidate = {
  cancellationReminderEnabled: boolean
  selfServiceCutoffHours: number
}

type PushEligibleCustomerCandidate = PushEligibleCustomer & {
  business: PushEligibleBusinessCandidate
  bookings: PushEligibleBookingCandidate[]
}

type CustomerReader = {
  customer: {
    findMany(args: {
      where: Prisma.CustomerWhereInput
      select: {
        id: true
        businessId: true
        business: {
          select: {
            cancellationReminderEnabled: true
            selfServiceCutoffHours: true
          }
        }
        bookings: {
          where: Prisma.BookingWhereInput
          select: {
            startDateTime: true
            status: true
            cancellationCutoffHours: true
            depositRequired: true
            depositPaid: true
          }
        }
      }
      orderBy: { id: 'asc' }
    }): Promise<PushEligibleCustomerCandidate[]>
  }
}

const HOUR_MS = 60 * 60 * 1000

function hasOpenCancellationWindow(
  startDateTime: Date,
  cutoffHours: number,
  now: Date,
): boolean {
  const startMs = startDateTime.getTime()
  const nowMs = now.getTime()
  if (
    !Number.isSafeInteger(startMs)
    || !Number.isSafeInteger(nowMs)
    || !Number.isSafeInteger(cutoffHours)
    || cutoffHours <= 0
  ) return false

  const cutoffMs = cutoffHours * HOUR_MS
  if (!Number.isSafeInteger(cutoffMs)) return false
  const closesAtMs = startMs - cutoffMs
  return Number.isSafeInteger(closesAtMs) && nowMs < closesAtMs
}

/**
 * Account subscriptions are associated while an appointment can still become
 * a paid cancellation-warning target. Requiring either a requested or paid
 * deposit lets a pending payment be activated before checkout completes; the
 * scheduler remains stricter and sends only after `depositPaid > 0`.
 */
export function eligiblePushBookingWhere(now: Date): Prisma.BookingWhereInput {
  return {
    startDateTime: { gt: now },
    status: { in: [...PUSH_ELIGIBLE_BOOKING_STATUSES] },
    AND: [
      {
        OR: [
          { depositRequired: { gt: 0 } },
          { depositPaid: { gt: 0 } },
        ],
      },
      {
        OR: [
          { cancellationCutoffHours: { gt: 0 } },
          {
            cancellationCutoffHours: null,
            business: { selfServiceCutoffHours: { gt: 0 } },
          },
        ],
      },
    ],
  }
}

export function eligiblePushCustomerWhere(
  userId: string,
  now: Date,
): Prisma.CustomerWhereInput {
  return {
    userId,
    business: { cancellationReminderEnabled: true },
    bookings: { some: eligiblePushBookingWhere(now) },
  }
}

export async function findEligiblePushCustomers(
  db: CustomerReader,
  userId: string,
  now: Date,
): Promise<PushEligibleCustomer[]> {
  if (!hasUsablePushConfig()) return []
  const candidates = await db.customer.findMany({
    where: eligiblePushCustomerWhere(userId, now),
    select: {
      id: true,
      businessId: true,
      business: {
        select: {
          cancellationReminderEnabled: true,
          selfServiceCutoffHours: true,
        },
      },
      bookings: {
        where: eligiblePushBookingWhere(now),
        select: {
          startDateTime: true,
          status: true,
          cancellationCutoffHours: true,
          depositRequired: true,
          depositPaid: true,
        },
      },
    },
    orderBy: { id: 'asc' },
  })
  return candidates
    .filter((customer) => customer.bookings.some((booking) => (
      isPushBookingEligible(booking, customer.business, now)
    )))
    .map(({ id, businessId }) => ({ id, businessId }))
}

export function isPushBookingEligible(
  booking: {
    startDateTime: Date
    status: BookingStatus
    cancellationCutoffHours: number | null
    depositRequired: number
    depositPaid: number
  },
  business: {
    cancellationReminderEnabled: boolean
    selfServiceCutoffHours: number
  },
  now: Date,
): boolean {
  if (!(booking.startDateTime instanceof Date)) return false
  const cutoffHours = booking.cancellationCutoffHours
    ?? business.selfServiceCutoffHours
  return hasUsablePushConfig()
    && business.cancellationReminderEnabled
    && (PUSH_ELIGIBLE_BOOKING_STATUSES as readonly BookingStatus[]).includes(booking.status)
    && hasOpenCancellationWindow(booking.startDateTime, cutoffHours, now)
    && (booking.depositRequired > 0 || booking.depositPaid > 0)
}
