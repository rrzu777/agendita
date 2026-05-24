import { addMinutes, differenceInMinutes, addDays } from 'date-fns'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { getLocalDayOfWeek } from './timezone'
import type { PrismaClient, Prisma } from '@prisma/client'

export interface AssertSlotInput {
  tx: PrismaClient | Prisma.TransactionClient
  businessId: string
  serviceId: string
  startDateTime: Date
  endDateTime: Date
  timezone: string
}

function hashStringToInt(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return Math.abs(hash)
}

function logEvent(event: string, meta: Record<string, unknown>) {
  // Log estructurado sin PII; en producción esto podría enviarse a un servicio de logs
  const payload = { timestamp: new Date().toISOString(), event, ...meta }
  console.log(JSON.stringify(payload))
}

export async function assertSlotIsAvailable(input: AssertSlotInput): Promise<void> {
  const { tx, businessId, serviceId, startDateTime, endDateTime, timezone } = input

  if (endDateTime <= startDateTime) {
    logEvent('slot_validation_rejected', { businessId, reason: 'end_before_start' })
    throw new Error('Ese horario ya no está disponible. Por favor selecciona otro.')
  }

  const now = new Date()

  // Lead time mínimo: 2 horas antes del slot
  const minStart = addMinutes(now, 120)
  if (startDateTime < minStart) {
    logEvent('slot_validation_rejected', { businessId, reason: 'lead_time', slotStart: startDateTime.toISOString() })
    throw new Error('Ese horario ya no está disponible. Por favor selecciona otro.')
  }

  const business = await tx.business.findUnique({
    where: { id: businessId },
    select: { bookingWindowDays: true },
  })

  // Booking window máximo: 90 días por defecto
  const bookingWindowDays = business?.bookingWindowDays ?? 90
  const maxStart = addDays(now, bookingWindowDays)
  if (startDateTime > maxStart) {
    logEvent('slot_validation_rejected', { businessId, reason: 'booking_window', slotStart: startDateTime.toISOString(), maxStart: maxStart.toISOString() })
    throw new Error('Ese horario ya no está disponible. Por favor selecciona otro.')
  }

  const service = await tx.service.findFirst({
    where: { id: serviceId, businessId, isActive: true },
    select: { durationMinutes: true },
  })
  if (!service) {
    logEvent('slot_validation_rejected', { businessId, reason: 'service_not_found' })
    throw new Error('Ese horario ya no está disponible. Por favor selecciona otro.')
  }

  const duration = differenceInMinutes(endDateTime, startDateTime)
  if (duration !== service.durationMinutes) {
    logEvent('slot_validation_rejected', { businessId, reason: 'duration_mismatch' })
    throw new Error('Ese horario ya no está disponible. Por favor selecciona otro.')
  }

  // Usar timezone del negocio para calcular día y rango horario
  const localStartStr = formatInTimeZone(startDateTime, timezone, 'yyyy-MM-dd')
  const localDayOfWeek = getLocalDayOfWeek(startDateTime, timezone)

  const rule = await tx.availabilityRule.findFirst({
    where: { businessId, dayOfWeek: localDayOfWeek, isActive: true },
    select: { startTime: true, endTime: true },
  })
  if (!rule) {
    logEvent('slot_validation_rejected', { businessId, reason: 'no_availability_rule', dayOfWeek: localDayOfWeek })
    throw new Error('Ese horario ya no está disponible. Por favor selecciona otro.')
  }

  // Construir timestamps UTC reales para inicio y fin de regla
  const ruleStart = fromZonedTime(`${localStartStr} ${rule.startTime}`, timezone)
  const ruleEnd = fromZonedTime(`${localStartStr} ${rule.endTime}`, timezone)

  if (startDateTime < ruleStart || endDateTime > ruleEnd) {
    logEvent('slot_validation_rejected', { businessId, reason: 'outside_rule_hours' })
    throw new Error('Ese horario ya no está disponible. Por favor selecciona otro.')
  }

  const block = await tx.timeBlock.findFirst({
    where: {
      businessId,
      startDateTime: { lt: endDateTime },
      endDateTime: { gt: startDateTime },
    },
    select: { id: true },
  })
  if (block) {
    logEvent('slot_validation_rejected', { businessId, reason: 'timeblock_overlap' })
    throw new Error('Ese horario ya no está disponible. Por favor selecciona otro.')
  }

  // Advisory lock por businessId + día local del negocio.
  // Esto serializa todas las creaciones de reserva para un negocio en un día,
  // evitando doble-booking concurrente incluso entre slots con distinto startDateTime.
  const lockKey = `${businessId}:${localStartStr}`
  const hash = hashStringToInt(lockKey)
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${hash})`

  const overlappingBookings = await tx.$queryRaw`
    SELECT "id" FROM "Booking"
    WHERE "businessId" = ${businessId}
      AND "status" IN ('pending_payment', 'confirmed', 'completed')
      AND "startDateTime" < ${endDateTime}
      AND "endDateTime" > ${startDateTime}
    FOR UPDATE
  `
  if (Array.isArray(overlappingBookings) && overlappingBookings.length > 0) {
    logEvent('slot_validation_rejected', { businessId, reason: 'booking_overlap', overlappingCount: overlappingBookings.length })
    throw new Error('Ese horario ya no está disponible. Por favor selecciona otro.')
  }
}
