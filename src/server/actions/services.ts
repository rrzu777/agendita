'use server'

import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { checkRateLimit } from '@/lib/rate-limit'
import { revalidateBusinessPublicPaths } from './revalidate-business'
import { requireBusiness, requireBusinessRole, ForbiddenError } from '@/lib/auth/server'
import {
  createServiceSchema,
  updateServiceSchema,
  reorderSchema,
} from '@/lib/services/schema'

export async function getServices(includeInactive = false) {
  const { businessId } = await requireBusiness()
  return prisma.service.findMany({
    where: {
      ...(includeInactive ? {} : { isActive: true }),
      businessId,
    },
    orderBy: { sortOrder: 'asc' },
  })
}

export async function createService(
  data: Record<string, unknown>
) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('create-service', 30, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = createServiceSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const newService = await prisma.service.create({
    data: { ...parsed.data, businessId },
  })

  revalidatePath('/dashboard/services')
  await revalidateBusinessPublicPaths(businessId)
  return newService
}

export async function updateService(
  serviceId: string,
  data: Record<string, unknown>
) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('update-service', 30, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = updateServiceSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const existing = await prisma.service.findUnique({
    where: { id: serviceId },
    select: { businessId: true, price: true, depositAmount: true },
  })
  if (!existing) {
    throw new ForbiddenError('Servicio no encontrado')
  }
  if (existing.businessId !== businessId) {
    throw new ForbiddenError('Servicio no encontrado')
  }

  if (Object.keys(parsed.data).length === 0) {
    throw new Error('No hay campos para actualizar')
  }

  const finalPrice = parsed.data.price !== undefined ? parsed.data.price : existing.price
  const finalDeposit = parsed.data.depositAmount !== undefined ? parsed.data.depositAmount : existing.depositAmount
  if (finalDeposit > finalPrice) {
    throw new Error('El abono no puede superar el precio')
  }

  const updated = await prisma.service.update({
    where: { id: serviceId },
    data: parsed.data,
  })

  revalidatePath('/dashboard/services')
  await revalidateBusinessPublicPaths(businessId)
  return updated
}

export async function toggleService(serviceId: string) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('toggle-service', 20, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const existing = await prisma.service.findUnique({
    where: { id: serviceId },
    select: { businessId: true, isActive: true },
  })
  if (!existing) {
    throw new ForbiddenError('Servicio no encontrado')
  }
  if (existing.businessId !== businessId) {
    throw new ForbiddenError('Servicio no encontrado')
  }

  const updated = await prisma.service.update({
    where: { id: serviceId },
    data: { isActive: !existing.isActive },
  })

  revalidatePath('/dashboard/services')
  await revalidateBusinessPublicPaths(businessId)
  return updated
}

export async function deleteService(serviceId: string) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('delete-service', 20, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const existing = await prisma.service.findUnique({
    where: { id: serviceId },
    select: { businessId: true },
  })
  if (!existing) {
    throw new ForbiddenError('Servicio no encontrado')
  }
  if (existing.businessId !== businessId) {
    throw new ForbiddenError('Servicio no encontrado')
  }

  const updated = await prisma.service.update({
    where: { id: serviceId },
    data: { isActive: false },
  })

  revalidatePath('/dashboard/services')
  await revalidateBusinessPublicPaths(businessId)
  return updated
}

export async function reorderServices(items: { id: string; sortOrder: number }[]) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('reorder-services', 10, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = reorderSchema.safeParse({ items })
  if (!parsed.success) {
    throw new Error('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const ids = parsed.data.items.map(i => i.id)

  const ownedServices = await prisma.service.findMany({
    where: { id: { in: ids }, businessId },
    select: { id: true },
  })
  const ownedIds = new Set(ownedServices.map(s => s.id))
  const submittedIds = new Set(ids)
  if (ownedIds.size !== submittedIds.size) {
    throw new ForbiddenError('Uno o más servicios no pertenecen a este negocio')
  }

  await prisma.$transaction(async (tx) => {
    for (const item of parsed.data.items) {
      await tx.service.update({
        where: { id: item.id },
        data: { sortOrder: item.sortOrder },
      })
    }
  })

  revalidatePath('/dashboard/services')
  await revalidateBusinessPublicPaths(businessId)
}
