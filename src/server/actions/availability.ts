'use server'

import { z } from 'zod'
import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { checkRateLimit } from '@/lib/rate-limit'
import { revalidateBusinessPublicPaths } from './revalidate-business'
import { generateSlots } from '@/lib/availability/slots'
import { getBusinessDayRange } from '@/lib/availability/timezone'
import { getEffectiveBlocks } from '@/lib/availability/effective-blocks'
import { requireBusiness, requireBusinessRole, ForbiddenError } from '@/lib/auth/server'
import { isValidTimeRange } from '@/lib/availability/time-range'
import { computeRescheduleSlots } from '@/lib/availability/reschedule-slots'
import { action, UserError } from '@/lib/actions/result'

const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/

const updateAvailabilityRuleSchema = z.object({
  startTime: z.string().regex(timeRegex, 'Formato de hora inválido (HH:MM)'),
  endTime: z.string().regex(timeRegex, 'Formato de hora inválido (HH:MM)'),
  isActive: z.boolean(),
}).refine((d) => isValidTimeRange(d.startTime, d.endTime), {
  message: 'La hora de inicio debe ser anterior a la de término',
})

const rescheduleSlotsSchema = z.object({
  bookingId: z.string().min(1),
  date: z.date(),
})

const NON_RESCHEDULABLE_STATUSES = ['completed', 'cancelled', 'no_show', 'expired'] as const

export async function getAvailabilityRules() {
  const { businessId } = await requireBusiness()
  return prisma.availabilityRule.findMany({
    where: { businessId },
    orderBy: { dayOfWeek: 'asc' },
  })
}

async function _getAvailableTimeSlots(businessId: string, serviceId: string, date: Date) {
  // Config 'get-availability' (60/min por IP): una clienta explorando fechas
  // hace un request por click; 10/min se agotaba en uso humano normal.
  const limit = await checkRateLimit('get-availability')
  if (!limit.success) {
    throw new UserError('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const business = await prisma.business.findUnique({
    where: { id: businessId, isActive: true },
    select: { id: true, timezone: true, bookingWindowDays: true, slotStepMinutes: true },
  })
  if (!business) {
    throw new UserError('Negocio no válido')
  }

  const timezone = business.timezone || 'America/Santiago'
  const bookingWindowDays = business.bookingWindowDays ?? 90
  const { dayStart, dayEnd } = getBusinessDayRange(date, timezone)

  const [service, availabilityRules, timeBlocks, bookings] = await Promise.all([
    prisma.service.findFirst({
      where: { id: serviceId, businessId, isActive: true },
      select: { durationMinutes: true },
    }),
    prisma.availabilityRule.findMany({
      where: { businessId, isActive: true },
      orderBy: { dayOfWeek: 'asc' },
    }),
    getEffectiveBlocks(businessId, dayStart, dayEnd, timezone),
    prisma.booking.findMany({
      where: {
        businessId,
        status: { notIn: ['cancelled', 'no_show', 'expired'] },
        startDateTime: { lte: dayEnd },
        endDateTime: { gte: dayStart },
      },
      orderBy: { startDateTime: 'asc' },
    }),
  ])

  if (!service) {
    throw new UserError('Servicio no disponible')
  }

  return generateSlots(date, service.durationMinutes, availabilityRules, timeBlocks, bookings, {
    timezone,
    now: new Date(),
    bookingWindowDays,
    slotStepMinutes: business.slotStepMinutes,
  })
}

export const getAvailableTimeSlots = action(_getAvailableTimeSlots)

async function _getAvailableSlotsForReschedule(bookingId: string, date: Date) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])

  const parsed = rescheduleSlotsSchema.safeParse({ bookingId, date })
  if (!parsed.success) {
    throw new UserError('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, businessId },
    include: {
      service: { select: { id: true, durationMinutes: true, name: true, isActive: true } },
      business: { select: { timezone: true, bookingWindowDays: true, slotStepMinutes: true } },
    },
  })

  if (!booking) {
    throw new ForbiddenError('Reserva no encontrada')
  }

  if (NON_RESCHEDULABLE_STATUSES.includes(booking.status as typeof NON_RESCHEDULABLE_STATUSES[number])) {
    throw new UserError('No se puede reprogramar una reserva en este estado')
  }

  if (!booking.service || !booking.service.isActive) {
    throw new UserError('Servicio no disponible')
  }

  return computeRescheduleSlots(booking, date)
}

export const getAvailableSlotsForReschedule = action(_getAvailableSlotsForReschedule)

async function _updateAvailabilityRule(
  id: string,
  data: { startTime: string; endTime: string; isActive: boolean }
) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('update-availability', 30, 60000)
  if (!limit.success) {
    throw new UserError('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = updateAvailabilityRuleSchema.safeParse(data)
  if (!parsed.success) {
    throw new UserError('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const updateResult = await prisma.availabilityRule.updateMany({
    where: { id, businessId },
    data,
  })
  if (updateResult.count === 0) {
    throw new ForbiddenError('Regla no encontrada')
  }

  const updated = await prisma.availabilityRule.findUnique({ where: { id } })
  revalidatePath('/dashboard/availability')
  if (updated) {
    await revalidateBusinessPublicPaths(updated.businessId)
  }
  return updated
}

export const updateAvailabilityRule = action(_updateAvailabilityRule)
