'use server'

import { z } from 'zod'
import { prisma } from '@/lib/db'
import type { Service } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { checkRateLimit } from '@/lib/rate-limit'
import { revalidateBusinessPublicPaths } from './revalidate-business'
import { requireBusiness, requireBusinessRole, ForbiddenError } from '@/lib/auth/server'

const createServiceSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional().nullable(),
  durationMinutes: z.number().int().positive().max(480),
  price: z.number().nonnegative(),
  depositAmount: z.number().nonnegative(),
  pastelColor: z.string().max(50),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
})

const updateServiceSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  durationMinutes: z.number().int().positive().max(480).optional(),
  price: z.number().nonnegative().optional(),
  depositAmount: z.number().nonnegative().optional(),
  pastelColor: z.string().max(50).optional(),
  sortOrder: z.number().int().nonnegative().optional(),
})

export async function getServices() {
  const { businessId } = await requireBusiness()
  return prisma.service.findMany({
    where: {
      isActive: true,
      businessId,
    },
    orderBy: { sortOrder: 'asc' },
  })
}

export async function createService(data: Omit<Service, 'id' | 'createdAt' | 'updatedAt' | 'businessId'>) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('create-service', 30, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = createServiceSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const newService = await prisma.service.create({ data: { ...data, businessId } })
  revalidatePath('/dashboard/services')
  await revalidateBusinessPublicPaths(newService.businessId)
  return newService
}

export async function updateService(id: string, data: Partial<Omit<Service, 'id' | 'createdAt' | 'updatedAt' | 'businessId'>>) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('update-service', 30, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = updateServiceSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const updateResult = await prisma.service.updateMany({
    where: { id, businessId },
    data: parsed.data,
  })
  if (updateResult.count === 0) {
    throw new ForbiddenError('Servicio no encontrado')
  }

  const updated = await prisma.service.findUnique({ where: { id } })
  revalidatePath('/dashboard/services')
  if (updated) {
    await revalidateBusinessPublicPaths(updated.businessId)
  }
  return updated
}

export async function deleteService(id: string) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('delete-service', 20, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const deleteResult = await prisma.service.updateMany({
    where: { id, businessId },
    data: { isActive: false },
  })
  if (deleteResult.count === 0) {
    throw new ForbiddenError('Servicio no encontrado')
  }

  const updated = await prisma.service.findUnique({ where: { id } })
  revalidatePath('/dashboard/services')
  if (updated) {
    await revalidateBusinessPublicPaths(updated.businessId)
  }
}
