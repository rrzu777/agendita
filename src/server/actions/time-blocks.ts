'use server'

import { z } from 'zod'
import { prisma } from '@/lib/db'
import type { TimeBlock } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { checkRateLimit } from '@/lib/rate-limit'
import { revalidateBusinessPublicPaths } from './revalidate-business'
import { requireBusiness, requireBusinessRole, ForbiddenError } from '@/lib/auth/server'

const createTimeBlockSchema = z.object({
  startDateTime: z.date(),
  endDateTime: z.date(),
  reason: z.string().max(255).optional().nullable(),
}).refine(data => data.endDateTime > data.startDateTime, {
  message: 'La fecha de fin debe ser posterior a la de inicio',
})

export async function getTimeBlocks() {
  const { businessId } = await requireBusiness()
  return prisma.timeBlock.findMany({
    where: { businessId },
    orderBy: { startDateTime: 'asc' },
  })
}

export async function createTimeBlock(data: Omit<TimeBlock, 'id' | 'createdAt' | 'businessId'>) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('create-timeblock', 20, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = createTimeBlockSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const newBlock = await prisma.timeBlock.create({ data: { ...data, businessId } })
  revalidatePath('/dashboard/availability')
  await revalidateBusinessPublicPaths(newBlock.businessId)
  return newBlock
}

export async function getTimeBlocksByRange(start: Date, end: Date) {
  const { businessId } = await requireBusiness()
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
  await revalidateBusinessPublicPaths(businessId)
}
