import { BookingStatus, type Prisma } from '@prisma/client'
import { hasUsablePushConfig } from '@/lib/push/config'

export const PUSH_ELIGIBLE_BOOKING_STATUSES = [
  BookingStatus.pending_payment,
  BookingStatus.pending_confirmation,
  BookingStatus.confirmed,
] as const

export type PushEligibleCustomer = { id: string; businessId: string }

type CustomerReader = {
  customer: {
    findMany(args: {
      where: Prisma.CustomerWhereInput
      select: { id: true; businessId: true }
      orderBy: { id: 'asc' }
    }): Promise<PushEligibleCustomer[]>
  }
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
  return db.customer.findMany({
    where: eligiblePushCustomerWhere(userId, now),
    select: { id: true, businessId: true },
    orderBy: { id: 'asc' },
  })
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
    && booking.startDateTime.getTime() > now.getTime()
    && (PUSH_ELIGIBLE_BOOKING_STATUSES as readonly BookingStatus[]).includes(booking.status)
    && cutoffHours > 0
    && (booking.depositRequired > 0 || booking.depositPaid > 0)
}
