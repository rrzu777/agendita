'use server'

import { z } from 'zod'
import { prisma } from '@/lib/db'
import type { TimeBlock } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { checkRateLimit } from '@/lib/rate-limit'
import { revalidateBusinessPublicPaths } from './revalidate-business'

const createTimeBlockSchema = z.object({
  businessId: z.string().min(1),
  startDateTime: z.date(),
  endDateTime: z.date(),
  reason: z.string().max(255).optional().nullable(),
}).refine(data => data.endDateTime > data.startDateTime, {
  message: 'La fecha de fin debe ser posterior a la de inicio',
})

export async function getTimeBlocks(businessId?: string) {
  return prisma.timeBlock.findMany({
    where: businessId ? { businessId } : undefined,
    orderBy: { startDateTime: 'asc' },
  })
}

export async function createTimeBlock(data: Omit<TimeBlock, 'id' | 'createdAt'>) {
  const limit = await checkRateLimit('create-timeblock', 20, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = createTimeBlockSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const newBlock = await prisma.timeBlock.create({ data })
  revalidatePath('/dashboard/availability')
  await revalidateBusinessPublicPaths(newBlock.businessId)
  return newBlock
}

export async function deleteTimeBlock(id: string) {
  const limit = await checkRateLimit('delete-timeblock', 20, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const deleted = await prisma.timeBlock.delete({ where: { id } })
  revalidatePath('/dashboard/availability')
  await revalidateBusinessPublicPaths(deleted.businessId)
}
