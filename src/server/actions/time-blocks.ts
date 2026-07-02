'use server'

import { z } from 'zod'
import { prisma } from '@/lib/db'
import type { TimeBlock } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { checkRateLimit } from '@/lib/rate-limit'
import { revalidateBusinessPublicPaths } from './revalidate-business'
import { requireBusiness, requireBusinessRole, ForbiddenError } from '@/lib/auth/server'
import { differenceInMilliseconds, addDays } from 'date-fns'
import { getEffectiveBlocks } from '@/lib/availability/effective-blocks'
import { computeSeriesUntil, expandSeries, type SeriesEndMode } from '@/lib/calendar/expand-series'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

const MAX_BLOCK_DURATION_MS = 32 * 24 * 60 * 60 * 1000 // 32 dias

const createTimeBlockSchema = z.object({
  startDateTime: z.date(),
  endDateTime: z.date(),
  reason: z.string().max(255).optional().nullable(),
  confirmOverlap: z.boolean().optional(),
}).refine(data => data.endDateTime > data.startDateTime, {
  message: 'La fecha de fin debe ser posterior a la de inicio',
})

function parseTimeBlockInput(raw: Record<string, unknown>): { startDateTime: Date; endDateTime: Date; reason: string | null; confirmOverlap: boolean } {
  const startDateTime = raw.startDateTime instanceof Date ? raw.startDateTime : new Date(raw.startDateTime as string)
  const endDateTime = raw.endDateTime instanceof Date ? raw.endDateTime : new Date(raw.endDateTime as string)
  const reason = typeof raw.reason === 'string' ? raw.reason : null
  const confirmOverlap = raw.confirmOverlap === true
  return { startDateTime, endDateTime, reason, confirmOverlap }
}

async function rateLimitOrThrow(key: string) {
  const limit = await checkRateLimit(key, 20, 60000)
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
}

function revalidateTimeBlocks(businessId: string) {
  revalidatePath('/dashboard/availability')
  revalidatePath('/dashboard/calendar')
  return revalidateBusinessPublicPaths(businessId)
}

export async function getTimeBlocks() {
  const { businessId } = await requireBusiness()
  return prisma.timeBlock.findMany({
    where: { businessId },
    orderBy: { startDateTime: 'asc' },
  })
}

export async function createTimeBlock(data: Omit<TimeBlock, 'id' | 'createdAt' | 'businessId'> & { confirmOverlap?: boolean }) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('create-timeblock', 20, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const raw = data as unknown as Record<string, unknown>
  const { startDateTime, endDateTime, reason, confirmOverlap } = parseTimeBlockInput(raw)

  const parsed = createTimeBlockSchema.safeParse({ startDateTime, endDateTime, reason, confirmOverlap })
  if (!parsed.success) {
    throw new Error('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const durationMs = differenceInMilliseconds(endDateTime, startDateTime)
  if (durationMs > MAX_BLOCK_DURATION_MS) {
    throw new Error('La duración máxima de un bloqueo es de 32 días')
  }

  const overlappingBookings = await prisma.booking.findMany({
    where: {
      businessId,
      status: { in: ['pending_payment', 'confirmed', 'completed'] },
      startDateTime: { lt: endDateTime },
      endDateTime: { gt: startDateTime },
    },
    select: { id: true },
    take: 1,
  })

  if (overlappingBookings.length > 0 && confirmOverlap !== true) {
    // No es un error: es un estado "requiere confirmación". Devolvemos un
    // resultado estructurado en lugar de lanzar, para no generar un 500 (y su
    // ruido en los logs) en un flujo de validación esperado.
    return {
      requiresConfirmation: true as const,
      message:
        'El bloqueo se solapa con reservas existentes. ' +
        'Marca la casilla de confirmación si deseas crearlo de todas formas ' +
        '(no se cancelarán las reservas existentes).',
    }
  }

  const newBlock = await prisma.timeBlock.create({
    data: { startDateTime, endDateTime, reason, businessId },
  })
  revalidatePath('/dashboard/availability')
  revalidatePath('/dashboard/calendar')
  await revalidateBusinessPublicPaths(newBlock.businessId)
  return newBlock
}

export async function getTimeBlocksByRange(start: Date, end: Date) {
  const { businessId, business } = await requireBusiness()
  if (!(start instanceof Date) || isNaN(start.getTime()) || !(end instanceof Date) || isNaN(end.getTime())) {
    throw new Error('Rango de fechas inválido')
  }
  if (start > end) {
    throw new Error('La fecha de inicio debe ser anterior a la fecha de término')
  }
  const timezone = business.timezone || 'America/Santiago'
  return getEffectiveBlocks(businessId, start, end, timezone)
}

export async function deleteTimeBlock(id: string) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('delete-timeblock', 20, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const deleteResult = await prisma.timeBlock.deleteMany({
    where: { id, businessId },
  })
  if (deleteResult.count === 0) {
    throw new ForbiddenError('Bloque no encontrado')
  }

  revalidatePath('/dashboard/availability')
  revalidatePath('/dashboard/calendar')
  await revalidateBusinessPublicPaths(businessId)
}

export async function updateTimeBlock(
  id: string,
  data: Omit<TimeBlock, 'id' | 'createdAt' | 'businessId'> & { confirmOverlap?: boolean },
): Promise<TimeBlock | { requiresConfirmation: true; message: string }> {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('update-timeblock', 20, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const raw = data as unknown as Record<string, unknown>
  const { startDateTime, endDateTime, reason, confirmOverlap } = parseTimeBlockInput(raw)

  const parsed = createTimeBlockSchema.safeParse({ startDateTime, endDateTime, reason, confirmOverlap })
  if (!parsed.success) {
    throw new Error('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const durationMs = differenceInMilliseconds(endDateTime, startDateTime)
  if (durationMs > MAX_BLOCK_DURATION_MS) {
    throw new Error('La duración máxima de un bloqueo es de 32 días')
  }

  const existing = await prisma.timeBlock.findFirst({
    where: { id, businessId },
  })
  if (!existing) {
    throw new ForbiddenError('Bloque no encontrado')
  }

  const timeChanged =
    existing.startDateTime.getTime() !== startDateTime.getTime() ||
    existing.endDateTime.getTime() !== endDateTime.getTime()

  if (timeChanged) {
    const overlappingBookings = await prisma.booking.findMany({
      where: {
        businessId,
        status: { in: ['pending_payment', 'confirmed', 'completed'] },
        startDateTime: { lt: endDateTime },
        endDateTime: { gt: startDateTime },
      },
      select: { id: true },
      take: 1,
    })

    if (overlappingBookings.length > 0 && confirmOverlap !== true) {
      return {
        requiresConfirmation: true as const,
        message:
          'El bloqueo se solapa con reservas existentes. ' +
          'Marca la casilla de confirmación si deseas guardarlo de todas formas ' +
          '(no se cancelarán las reservas existentes).',
      }
    }
  }

  const updateResult = await prisma.timeBlock.updateMany({
    where: { id, businessId },
    data: { startDateTime, endDateTime, reason },
  })
  if (updateResult.count === 0) {
    throw new ForbiddenError('Bloque no encontrado')
  }

  revalidatePath('/dashboard/availability')
  revalidatePath('/dashboard/calendar')
  await revalidateBusinessPublicPaths(businessId)

  return { ...existing, startDateTime, endDateTime, reason }
}

const createSeriesSchema = z.object({
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1, 'Selecciona al menos un día'),
  startTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
  endTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
  reason: z.string().max(255).optional().nullable(),
  anchorDate: z.date(),
  endMode: z.enum(['forever', 'month', 'weeks']),
  weeks: z.number().int().min(1).max(52).optional().nullable(),
}).refine((d) => d.endTime > d.startTime, { message: 'La hora de fin debe ser posterior a la de inicio' })

export async function createTimeBlockSeries(data: {
  daysOfWeek: number[]
  startTime: string
  endTime: string
  reason?: string | null
  anchorDate: Date
  endMode: SeriesEndMode
  weeks?: number | null
}) {
  const { businessId, business } = await requireBusinessRole(['owner', 'admin'])
  await rateLimitOrThrow('create-timeblock')

  const parsed = createSeriesSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error('Datos inválidos: ' + parsed.error.issues.map((i) => i.message).join(', '))
  }

  const timezone = business.timezone || 'America/Santiago'
  const bookingWindowDays = business.bookingWindowDays ?? 90

  const until = computeSeriesUntil(data.anchorDate, data.endMode, data.weeks ?? null, timezone)

  const series = await prisma.timeBlockSeries.create({
    data: {
      businessId,
      daysOfWeek: data.daysOfWeek,
      startTime: data.startTime,
      endTime: data.endTime,
      reason: data.reason ?? null,
      anchorDate: data.anchorDate,
      until,
    },
  })

  // Aviso "crear igual + avisar": listar días (yyyy-MM-dd) dentro de la ventana de
  // reserva cuyas ocurrencias se solapan con reservas existentes. No se cancela nada.
  const windowEnd = new Date(Date.now() + bookingWindowDays * 24 * 60 * 60 * 1000)
  const occurrences = expandSeries(series, [], data.anchorDate, windowEnd, timezone)
  const bookings = await prisma.booking.findMany({
    where: {
      businessId,
      status: { in: ['pending_payment', 'confirmed', 'completed'] },
      startDateTime: { lt: windowEnd },
      endDateTime: { gt: data.anchorDate },
    },
    select: { startDateTime: true, endDateTime: true },
  })
  const overlappingDates = occurrences
    .filter((occ) => bookings.some((b) => occ.startDateTime < b.endDateTime && b.startDateTime < occ.endDateTime))
    .map((occ) => formatInTimeZone(occ.startDateTime, timezone, 'yyyy-MM-dd'))

  await revalidateTimeBlocks(businessId)

  return { series, overlappingDates }
}

async function assertSeriesOwned(seriesId: string, businessId: string) {
  const series = await prisma.timeBlockSeries.findFirst({ where: { id: seriesId, businessId } })
  if (!series) throw new ForbiddenError('Serie no encontrada')
  return series
}

export async function skipSeriesOccurrence(seriesId: string, occurrenceDate: Date) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  await rateLimitOrThrow('update-timeblock')
  await assertSeriesOwned(seriesId, businessId)

  await prisma.timeBlockException.upsert({
    where: { seriesId_occurrenceDate: { seriesId, occurrenceDate } },
    create: { seriesId, occurrenceDate, isSkipped: true },
    update: { isSkipped: true, startDateTime: null, endDateTime: null, reason: null },
  })

  await revalidateTimeBlocks(businessId)
}

export async function updateTimeBlockSeries(
  seriesId: string,
  changes: { startTime: string; endTime: string; reason?: string | null },
) {
  const { businessId, business } = await requireBusinessRole(['owner', 'admin'])
  await rateLimitOrThrow('update-timeblock')

  const timeRe = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/
  if (!timeRe.test(changes.startTime) || !timeRe.test(changes.endTime) || changes.endTime <= changes.startTime) {
    throw new Error('Datos inválidos: la hora de fin debe ser posterior a la de inicio')
  }

  const existing = await assertSeriesOwned(seriesId, businessId)
  const timezone = business.timezone || 'America/Santiago'

  // Split en hoy: la serie vieja termina AYER (inclusivo), la nueva arranca hoy y
  // CONSERVA el patrón de días y la fecha de fin (until) originales — el diálogo de
  // edición solo cambia hora/motivo. Reset de excepciones futuras (viven en la vieja).
  const todayStr = formatInTimeZone(new Date(), timezone, 'yyyy-MM-dd')
  const yesterdayStr = formatInTimeZone(addDays(new Date(), -1), timezone, 'yyyy-MM-dd')
  const oldUntil = fromZonedTime(`${yesterdayStr} 00:00:00`, timezone)
  const anchorToday = fromZonedTime(`${todayStr} 00:00:00`, timezone)

  const [, newSeries] = await prisma.$transaction([
    prisma.timeBlockSeries.update({ where: { id: seriesId }, data: { until: oldUntil, isActive: existing.anchorDate <= oldUntil } }),
    prisma.timeBlockSeries.create({
      data: {
        businessId,
        daysOfWeek: existing.daysOfWeek,
        startTime: changes.startTime,
        endTime: changes.endTime,
        reason: changes.reason ?? null,
        anchorDate: anchorToday,
        until: existing.until,
      },
    }),
  ])

  await revalidateTimeBlocks(businessId)

  return { series: newSeries }
}

export async function deleteTimeBlockSeries(seriesId: string) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  await rateLimitOrThrow('delete-timeblock')
  await assertSeriesOwned(seriesId, businessId)

  // onDelete: Cascade en TimeBlockException borra las excepciones.
  await prisma.timeBlockSeries.delete({ where: { id: seriesId } })

  await revalidateTimeBlocks(businessId)
}

export async function getTimeBlockSeries() {
  const { businessId } = await requireBusiness()
  return prisma.timeBlockSeries.findMany({
    where: { businessId, isActive: true, OR: [{ until: null }, { until: { gte: new Date() } }] },
    orderBy: { createdAt: 'desc' },
  })
}

export async function overrideSeriesOccurrence(
  seriesId: string,
  occurrenceDate: Date,
  data: { startDateTime: Date; endDateTime: Date; reason?: string | null },
) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  await rateLimitOrThrow('update-timeblock')
  if (data.endDateTime <= data.startDateTime) throw new Error('La hora de fin debe ser posterior a la de inicio')
  await assertSeriesOwned(seriesId, businessId)

  await prisma.timeBlockException.upsert({
    where: { seriesId_occurrenceDate: { seriesId, occurrenceDate } },
    create: { seriesId, occurrenceDate, isSkipped: false, startDateTime: data.startDateTime, endDateTime: data.endDateTime, reason: data.reason ?? null },
    update: { isSkipped: false, startDateTime: data.startDateTime, endDateTime: data.endDateTime, reason: data.reason ?? null },
  })

  await revalidateTimeBlocks(businessId)
}
