'use server'

import { z } from 'zod'
import { prisma } from '@/lib/db'
import type { TimeBlock } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { checkRateLimit } from '@/lib/rate-limit'
import { revalidateBusinessPublicPaths } from './revalidate-business'
import { requireBusiness, requireBusinessRole, ForbiddenError } from '@/lib/auth/server'
import { differenceInMilliseconds } from 'date-fns'

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
  const { businessId } = await requireBusiness()
  if (!(start instanceof Date) || isNaN(start.getTime()) || !(end instanceof Date) || isNaN(end.getTime())) {
    throw new Error('Rango de fechas inválido')
  }
  if (start > end) {
    throw new Error('La fecha de inicio debe ser anterior a la fecha de término')
  }
  return prisma.timeBlock.findMany({
    where: {
      businessId,
      OR: [
        { startDateTime: { gte: start, lte: end } },
        { endDateTime: { gte: start, lte: end } },
        { startDateTime: { lte: start }, endDateTime: { gte: end } },
      ],
    },
    orderBy: { startDateTime: 'asc' },
  })
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
) {
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

  await prisma.timeBlock.updateMany({
    where: { id, businessId },
    data: { startDateTime, endDateTime, reason },
  })

  revalidatePath('/dashboard/availability')
  revalidatePath('/dashboard/calendar')
  await revalidateBusinessPublicPaths(businessId)

  return { ...existing, startDateTime, endDateTime, reason }
}
