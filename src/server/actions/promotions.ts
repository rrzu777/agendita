'use server'

import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { checkRateLimit } from '@/lib/rate-limit'
import { requireBusiness, requireBusinessRole, ForbiddenError } from '@/lib/auth/server'
import { createPromotionSchema, updatePromotionSchema, normalizeCode, type CreatePromotionInput } from '@/lib/promotions/schema'
import { startOfLocalDay, endOfLocalDay } from '@/lib/availability/timezone'
import { isRedeemable, computeDiscount } from '@/lib/promotions/evaluate'
import { normalizePhone } from '@/lib/customers/phone'

async function assertServicesBelong(businessId: string, serviceIds: string[]) {
  if (serviceIds.length === 0) return
  const count = await prisma.service.count({ where: { id: { in: serviceIds }, businessId } })
  if (count !== serviceIds.length) throw new Error('Servicio inválido')
}

// Campos escalares compartidos por create y update. Los que difieren entre
// ambas (code, services, audit user) se arman en cada acción. La vigencia se
// fija como instantes UTC reales del día local del negocio (validFrom = 00:00,
// validUntil = 23:59:59.999 local); sin esto, un negocio en America/Santiago
// (UTC-4) veía su promo expirar ~4h antes en prod.
function promotionScalars(d: CreatePromotionInput, timezone: string) {
  return {
    name: d.name,
    description: d.description,
    rewardType: d.rewardType,
    rewardValue: d.rewardValue,
    maxDiscount: d.maxDiscount ?? null,
    appliesToAll: d.appliesToAll,
    validFrom: d.validFrom ? startOfLocalDay(d.validFrom, timezone) : null,
    validUntil: d.validUntil ? endOfLocalDay(d.validUntil, timezone) : null,
    minSpend: d.minSpend ?? null,
    maxRedemptions: d.maxRedemptions ?? null,
    maxPerCustomer: d.maxPerCustomer ?? null,
  }
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
        ...promotionScalars(d, business.timezone),
        triggerType: 'code',
        code: d.code,
        services: d.appliesToAll ? undefined : { connect: d.serviceIds.map(id => ({ id })) },
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
        ...promotionScalars(d, business.timezone),
        code,
        services: { set: d.appliesToAll ? [] : d.serviceIds.map(sid => ({ id: sid })) },
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
    where: { businessId, triggerType: { not: 'granted' } },
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

const GENERIC_INVALID = { ok: false as const, message: 'Código inválido o no aplicable' }

/** Preview público: NO crea canje. Tenant-scoped + rate-limited + respuesta genérica
 *  (no revela si el código existe). */
export async function previewPromotion(input: { businessId: string; code: string; serviceId: string; phone?: string }) {
  const limit = await checkRateLimit('preview-promotion', 30, 60000)
  if (!limit.success) return GENERIC_INVALID

  const code = normalizeCode(input.code)
  if (!code) return GENERIC_INVALID

  // Preview es una ayuda de UI no autoritativa (la validación real ocurre al
  // aplicar, dentro de createBooking). Un error transitorio de Prisma degrada a
  // la misma respuesta genérica en vez de romper el wizard con un 500.
  try {
    const service = await prisma.service.findFirst({
      where: { id: input.serviceId, businessId: input.businessId, isActive: true },
    })
    if (!service) return GENERIC_INVALID

    // Rama grant (canje de puntos)
    const grant = await prisma.promotionGrant.findFirst({
      where: { businessId: input.businessId, code, status: 'active' },
      include: { promotion: { include: { services: { select: { id: true } } } } },
    })
    if (grant) {
      const p = grant.promotion
      if (grant.expiresAt && new Date() > grant.expiresAt) return GENERIC_INVALID
      if (!p.appliesToAll && !p.services.some((s: { id: string }) => s.id === input.serviceId)) return GENERIC_INVALID
      if (p.minSpend != null && service.price < p.minSpend) return GENERIC_INVALID
      const discount = computeDiscount({ ...p, serviceIds: p.services.map((s: { id: string }) => s.id) } as Parameters<typeof computeDiscount>[0], service.price)
      return { ok: true as const, discount, finalAmount: service.price - discount }
    }

    // Rama código (triggerType='code') — reusa `service`, ya no se vuelve a buscar
    const promo = await prisma.promotion.findFirst({
      where: { businessId: input.businessId, code, triggerType: 'code' },
      include: { services: { select: { id: true } } },
    })
    if (!promo) return GENERIC_INVALID

    let customerRedemptions = 0
    if (input.phone && promo.maxPerCustomer != null) {
      // Los clientes se guardan con el teléfono normalizado (createBooking usa
      // normalizePhone); buscar con el raw no haría match → cap mal evaluado.
      const phone = normalizePhone(input.phone)
      const customer = await prisma.customer.findFirst({ where: { businessId: input.businessId, phone }, select: { id: true } })
      if (customer) {
        customerRedemptions = await prisma.promotionRedemption.count({
          where: { promotionId: promo.id, customerId: customer.id, status: 'applied' },
        })
      }
    }

    const result = isRedeemable({
      promo: { ...promo, serviceIds: promo.services.map(s => s.id) },
      serviceId: input.serviceId, totalPrice: service.price, customerRedemptions, now: new Date(),
    })
    if (!result.ok) return GENERIC_INVALID
    return { ok: true as const, discount: result.discount, finalAmount: service.price - result.discount }
  } catch {
    return GENERIC_INVALID
  }
}
