'use server'

import { z } from 'zod'
import { prisma } from '@/lib/db'
import type { Service } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { checkRateLimit } from '@/lib/rate-limit'

const createServiceSchema = z.object({
  businessId: z.string().min(1),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional().nullable(),
  durationMinutes: z.number().int().positive().max(480),
  price: z.number().nonnegative(),
  depositAmount: z.number().nonnegative(),
  pastelColor: z.string().max(50),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
})

const updateServiceSchema = createServiceSchema.partial().omit({ businessId: true })

export async function getServices(businessId?: string) {
  return prisma.service.findMany({
    where: {
      isActive: true,
      ...(businessId && { businessId }),
    },
    orderBy: { sortOrder: 'asc' },
  })
}

export async function createService(data: Omit<Service, 'id' | 'createdAt' | 'updatedAt'>) {
  const limit = await checkRateLimit('create-service', 30, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = createServiceSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const newService = await prisma.service.create({ data })
  revalidatePath('/dashboard/services')
  return newService
}

export async function updateService(id: string, data: Partial<Omit<Service, 'id' | 'createdAt' | 'updatedAt'>>) {
  const limit = await checkRateLimit('update-service', 30, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = updateServiceSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const updated = await prisma.service.update({
    where: { id },
    data,
  })
  revalidatePath('/dashboard/services')
  return updated
}

export async function deleteService(id: string) {
  const limit = await checkRateLimit('delete-service', 20, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  await prisma.service.update({
    where: { id },
    data: { isActive: false },
  })
  revalidatePath('/dashboard/services')
}
