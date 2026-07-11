import { prisma } from '@/lib/db'
import { generateSlots } from '@/lib/availability/slots'
import { getBusinessDayRange } from '@/lib/availability/timezone'
import { getEffectiveBlocks } from '@/lib/availability/effective-blocks'

/** Slots disponibles para reprogramar una reserva (excluye la reserva misma).
 *  SIN auth: el caller (action de dueña o de clienta) valida ownership antes. */
export async function computeRescheduleSlots(
  booking: {
    id: string
    businessId: string
    service: { durationMinutes: number }
    business: { timezone: string | null; bookingWindowDays: number | null; slotStepMinutes: number | null }
  },
  date: Date
) {
  const timezone = booking.business.timezone || 'America/Santiago'
  const bookingWindowDays = booking.business.bookingWindowDays ?? 90
  const { dayStart, dayEnd } = getBusinessDayRange(date, timezone)

  const [availabilityRules, timeBlocks, bookings] = await Promise.all([
    prisma.availabilityRule.findMany({
      where: { businessId: booking.businessId, isActive: true },
      orderBy: { dayOfWeek: 'asc' },
    }),
    getEffectiveBlocks(booking.businessId, dayStart, dayEnd, timezone),
    prisma.booking.findMany({
      where: {
        businessId: booking.businessId,
        id: { not: booking.id },
        status: { notIn: ['cancelled', 'no_show', 'expired'] },
        startDateTime: { lte: dayEnd },
        endDateTime: { gte: dayStart },
      },
      orderBy: { startDateTime: 'asc' },
    }),
  ])

  return generateSlots(date, booking.service.durationMinutes, availabilityRules, timeBlocks, bookings, {
    timezone,
    now: new Date(),
    bookingWindowDays,
    slotStepMinutes: booking.business.slotStepMinutes,
  })
}
