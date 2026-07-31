import { prisma } from '@/lib/db'
import { generateSlots } from '@/lib/availability/slots'
import { getBusinessDayRange } from '@/lib/availability/timezone'
import { getEffectiveBlocks } from '@/lib/availability/effective-blocks'
import { blockScopeFor, bookingScopeCondition, resolveAvailabilityRules } from '@/lib/availability/scope'
import { RELEASED_STATUSES } from '@/lib/bookings/approval'

/** Slots disponibles para reprogramar una reserva (excluye la reserva misma).
 *  SIN auth: el caller (action de dueña o de clienta) valida ownership antes.
 *
 *  Reprogramar CONSERVA la persona de la reserva: los slots que se ofrecen son los
 *  de quien la iba a atender, no los del negocio. Ninguna de las dos vías recorta
 *  los escalares del booking, así que `professionalId` llega gratis en las dos. */
export async function computeRescheduleSlots(
  booking: {
    id: string
    businessId: string
    professionalId: string | null
    service: { durationMinutes: number }
    business: { timezone: string | null; bookingWindowDays: number | null; slotStepMinutes: number | null }
  },
  date: Date
) {
  const timezone = booking.business.timezone || 'America/Santiago'
  const bookingWindowDays = booking.business.bookingWindowDays ?? 90
  const { dayStart, dayEnd } = getBusinessDayRange(date, timezone)

  const [availabilityRules, timeBlocks, bookings] = await Promise.all([
    resolveAvailabilityRules(prisma, booking.businessId, booking.professionalId),
    getEffectiveBlocks({
      businessId: booking.businessId,
      rangeStart: dayStart,
      rangeEnd: dayEnd,
      timezone,
      scope: blockScopeFor(booking.professionalId),
    }),
    prisma.booking.findMany({
      where: {
        businessId: booking.businessId,
        id: { not: booking.id },
        status: { notIn: [...RELEASED_STATUSES] },
        startDateTime: { lte: dayEnd },
        endDateTime: { gte: dayStart },
        AND: bookingScopeCondition(booking.professionalId),
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
