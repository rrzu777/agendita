'use server'

import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { checkRateLimit } from '@/lib/rate-limit'
import { requireBusiness, requireBusinessRole, ForbiddenError } from '@/lib/auth/server'
import { createPromotionSchema, updatePromotionSchema } from '@/lib/promotions/schema'
import { fromZonedTime } from 'date-fns-tz'

async function assertServicesBelong(businessId: string, serviceIds: string[]) {
  if (serviceIds.length === 0) return
  const count = await prisma.service.count({ where: { id: { in: serviceIds }, businessId } })
  if (count !== serviceIds.length) throw new Error('Servicio inválido')
}

// Construye los límites de vigencia como instantes UTC reales del día local del
// negocio (mismo patrón que getBusinessDayRange en lib/availability/timezone):
// validFrom = 00:00:00 local, validUntil = 23:59:59.999 local. Sin esto, un
// negocio en America/Santiago (UTC-4) veía su promo expirar ~4h antes en prod.
function startOfBusinessDay(dateStr: string, timezone: string): Date {
  return fromZonedTime(`${dateStr}T00:00:00.000`, timezone)
}
function endOfBusinessDay(dateStr: string, timezone: string): Date {
  return fromZonedTime(`${dateStr}T23:59:59.999`, timezone)
}

export async function createPromotion(data: unknown) {
  const { businessId, business, user } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('create-promotion', 30, 60000)
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta más tarde.')

  const parsed = createPromotionSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }
  const d = parsed.data
  await assertServicesBelong(businessId, d.serviceIds)

  const created = await prisma.promotion
    .create({
      data: {
        businessId,
        name: d.name,
        description: d.description,
        triggerType: 'code',
        code: d.code,
        rewardType: d.rewardType,
        rewardValue: d.rewardValue,
        maxDiscount: d.maxDiscount ?? null,
        appliesToAll: d.appliesToAll,
        services: d.appliesToAll ? undefined : { connect: d.serviceIds.map(id => ({ id })) },
        validFrom: d.validFrom ? startOfBusinessDay(d.validFrom, business.timezone) : null,
        validUntil: d.validUntil ? endOfBusinessDay(d.validUntil, business.timezone) : null,
        minSpend: d.minSpend ?? null,
        maxRedemptions: d.maxRedemptions ?? null,
        maxPerCustomer: d.maxPerCustomer ?? null,
        createdByUserId: user.id,
      },
    })
    .catch((e: { code?: string }) => {
      if (e.code === 'P2002') throw new Error('Ya existe una promoción con ese código')
      throw e
    })

  revalidatePath('/dashboard/promociones')
  return created
}

export async function updatePromotion(id: string, data: unknown) {
  const { businessId, business, user } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('manage-promotion', 60, 60000)
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta más tarde.')

  const existing = await prisma.promotion.findFirst({ where: { id, businessId } })
  if (!existing) throw new ForbiddenError('Promoción no encontrada')

  const parsed = updatePromotionSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }
  const d = parsed.data
  await assertServicesBelong(businessId, d.serviceIds)

  // Solo el código se bloquea tras el primer canje (los reportes se llevan por
  // código). rewardValue/rewardType siguen editables: cada PromotionRedemption
  // guarda su discountAmount, así que el historial no cambia retroactivamente.
  const code = existing.redemptionCount > 0 ? existing.code : d.code

  const updated = await prisma.promotion
    .update({
      where: { id },
      data: {
        name: d.name,
        description: d.description,
        code,
        rewardType: d.rewardType,
        rewardValue: d.rewardValue,
        maxDiscount: d.maxDiscount ?? null,
        appliesToAll: d.appliesToAll,
        services: { set: d.appliesToAll ? [] : d.serviceIds.map(sid => ({ id: sid })) },
        validFrom: d.validFrom ? startOfBusinessDay(d.validFrom, business.timezone) : null,
        validUntil: d.validUntil ? endOfBusinessDay(d.validUntil, business.timezone) : null,
        minSpend: d.minSpend ?? null,
        maxRedemptions: d.maxRedemptions ?? null,
        maxPerCustomer: d.maxPerCustomer ?? null,
        updatedByUserId: user.id,
      },
    })
    .catch((e: { code?: string }) => {
      if (e.code === 'P2002') throw new Error('Ya existe una promoción con ese código')
      throw e
    })

  revalidatePath('/dashboard/promociones')
  return updated
}

export async function setPromotionActive(id: string, isActive: boolean) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('manage-promotion', 60, 60000)
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta más tarde.')

  const existing = await prisma.promotion.findFirst({ where: { id, businessId } })
  if (!existing) throw new ForbiddenError('Promoción no encontrada')
  await prisma.promotion.update({ where: { id }, data: { isActive } })
  revalidatePath('/dashboard/promociones')
}

export async function listPromotions() {
  const { businessId } = await requireBusiness()
  return prisma.promotion.findMany({
    where: { businessId },
    orderBy: { createdAt: 'desc' },
    include: { services: { select: { id: true, name: true } } },
  })
}

export async function getPromotionRedemptions(promotionId: string) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  return prisma.promotionRedemption.findMany({
    where: { promotionId, businessId },
    orderBy: { createdAt: 'desc' },
    include: {
      customer: { select: { id: true, name: true } },
      booking: { select: { id: true, startDateTime: true } },
    },
  })
}
