'use server'

import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { checkRateLimit } from '@/lib/rate-limit'
import { requireBusiness, requireBusinessRole, ForbiddenError } from '@/lib/auth/server'
import { loyaltyConfigSchema, adjustPointsSchema, redemptionOptionSchema, redeemSchema } from '@/lib/loyalty/schema'
import { getLoyaltyBalance, getLoyaltyHistory } from '@/lib/loyalty/balance'
import { reconcileExpiredGrants } from '@/lib/loyalty/grant'
import { redeemForGrant, type RedeemPromotion } from '@/lib/loyalty/redeem'
import { isP2002 } from '@/lib/loyalty/credit'
import { resolveLoyaltyCustomer } from '@/lib/loyalty/token'

// Module-local helpers — NOT exported (use server modules may only export async functions)

function redemptionOptionWhere(businessId: string) {
  return { businessId, triggerType: 'granted' as const, pointsCost: { not: null } }
}

const REDEEM_SELECT = {
  id: true, businessId: true, triggerType: true, isActive: true,
  pointsCost: true, grantExpiryDays: true, maxRedemptions: true, maxPerCustomer: true,
} as const

async function runRedemption(args: {
  businessId: string; customerId: string; optionId: string; requestId: string
  createdByUserId: string | null
}): Promise<void> {
  const { businessId, customerId, optionId, requestId } = args
  // Lecturas independientes en paralelo (opción + config).
  const [promotion, cfg] = await Promise.all([
    prisma.promotion.findFirst({
      where: { id: optionId, ...redemptionOptionWhere(businessId) }, select: REDEEM_SELECT,
    }),
    prisma.loyaltyConfig.findUnique({ where: { businessId } }),
  ])
  if (!promotion) throw new Error('La recompensa no está disponible')
  const config = {
    isActive: cfg?.isActive ?? false,
    grantExpiryDays: cfg?.grantExpiryDays ?? null,
    refundPointsOnExpiry: cfg?.refundPointsOnExpiry ?? true,
    forfeitGrantOnNoShow: cfg?.forfeitGrantOnNoShow ?? false,
  }
  try {
    await prisma.$transaction((tx) => redeemForGrant(tx, {
      businessId, customerId, promotion: promotion as RedeemPromotion, config, requestId,
      createdByUserId: args.createdByUserId,
    }))
  } catch (e) {
    if (isP2002(e)) {
      const existing = await prisma.promotionGrant.findUnique({
        where: { customerId_requestId: { customerId, requestId } },
      })
      if (existing) return
    }
    throw e
  }
}

// Exported async actions

export async function getLoyaltyConfig() {
  const { businessId } = await requireBusiness()
  return prisma.loyaltyConfig.findUnique({ where: { businessId } })
}

export async function upsertLoyaltyConfig(data: unknown) {
  const { businessId, user } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('loyalty-config', 30, 60000, { userId: user.id, businessId })
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta más tarde.')

  const parsed = loyaltyConfigSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error('Datos inválidos: ' + parsed.error.issues.map((i) => i.message).join(', '))
  }
  const d = parsed.data
  const saved = await prisma.loyaltyConfig.upsert({
    where: { businessId },
    create: { businessId, ...d, updatedByUserId: user.id },
    update: { ...d, updatedByUserId: user.id },
  })
  await revalidatePath('/dashboard/fidelizacion')
  return saved
}

export async function getCustomerLoyalty(customerId: string) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const customer = await prisma.customer.findFirst({ where: { id: customerId, businessId }, select: { id: true } })
  if (!customer) throw new ForbiddenError('Clienta no encontrada')
  await prisma.$transaction((tx) => reconcileExpiredGrants(tx, customerId, businessId))
  const [balance, history, grants, catalog] = await Promise.all([
    getLoyaltyBalance(prisma, customerId, businessId),
    getLoyaltyHistory(prisma, customerId, businessId, 50),
    prisma.promotionGrant.findMany({
      where: { customerId, businessId, status: 'active' },
      orderBy: { createdAt: 'desc' },
      include: { promotion: { select: { name: true } } },
    }),
    prisma.promotion.findMany({
      where: { ...redemptionOptionWhere(businessId), isActive: true },
      orderBy: { pointsCost: 'asc' },
      include: { services: { select: { id: true, name: true } } },
    }),
  ])
  return { balance, history, grants, catalog }
}

export async function adjustCustomerPoints(customerId: string, delta: unknown, note: unknown) {
  const { businessId, user } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('loyalty-adjust', 30, 60000, { userId: user.id, businessId })
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta más tarde.')

  const parsed = adjustPointsSchema.safeParse({ delta, note })
  if (!parsed.success) {
    throw new Error('Datos inválidos: ' + parsed.error.issues.map((i) => i.message).join(', '))
  }
  const customer = await prisma.customer.findFirst({ where: { id: customerId, businessId }, select: { id: true } })
  if (!customer) throw new ForbiddenError('Clienta no encontrada')

  await prisma.$transaction(async (tx) => {
    // Advisory lock por-clienta: bajo READ COMMITTED el aggregate NO toma lock, así
    // que sin esto dos ajustes concurrentes podrían ambos pasar el chequeo de
    // saldo>=0 y sobregirar. El lock serializa solo los ajustes de esta misma clienta.
    // $executeRaw (no $queryRaw): pg_advisory_xact_lock devuelve void y $queryRaw
    // falla al deserializar esa columna.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${customerId}))`
    const agg = await tx.loyaltyLedger.aggregate({ where: { customerId, businessId }, _sum: { points: true } })
    const balance = agg._sum.points ?? 0
    if (balance + parsed.data.delta < 0) {
      throw new Error('El ajuste dejaría el saldo en negativo')
    }
    await tx.loyaltyLedger.create({
      data: {
        businessId, customerId, points: parsed.data.delta, reason: 'adjustment',
        note: parsed.data.note, createdByUserId: user.id,
        metadata: { previousBalance: balance },
      },
    })
  })
  await revalidatePath(`/dashboard/customers/${customerId}`)
}

export async function listRedemptionOptions() {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  return prisma.promotion.findMany({
    where: redemptionOptionWhere(businessId),
    orderBy: { createdAt: 'desc' },
    include: { services: { select: { id: true, name: true } } },
  })
}

export async function upsertRedemptionOption(data: unknown, id?: string) {
  const { businessId, user } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('redemption-option', 30, 60000, { userId: user.id, businessId })
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta más tarde.')

  const parsed = redemptionOptionSchema.safeParse(data)
  if (!parsed.success) throw new Error('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  const d = parsed.data
  if (d.serviceIds.length) {
    const count = await prisma.service.count({ where: { id: { in: d.serviceIds }, businessId } })
    if (count !== d.serviceIds.length) throw new Error('Servicio inválido')
  }
  const scalars = {
    name: d.name, rewardType: d.rewardType, rewardValue: d.rewardValue, maxDiscount: d.maxDiscount,
    appliesToAll: d.appliesToAll, pointsCost: d.pointsCost, grantExpiryDays: d.grantExpiryDays,
    maxRedemptions: d.maxRedemptions, maxPerCustomer: d.maxPerCustomer, isActive: d.isActive,
  }
  if (id) {
    const existing = await prisma.promotion.findFirst({ where: { id, businessId, triggerType: 'granted' }, select: { id: true } })
    if (!existing) throw new ForbiddenError('Recompensa no encontrada')
    await prisma.promotion.update({
      where: { id },
      data: { ...scalars, updatedByUserId: user.id,
        services: d.appliesToAll ? { set: [] } : { set: d.serviceIds.map(sid => ({ id: sid })) } },
    })
  } else {
    await prisma.promotion.create({
      data: { businessId, triggerType: 'granted', ...scalars, createdByUserId: user.id,
        services: d.appliesToAll ? undefined : { connect: d.serviceIds.map(sid => ({ id: sid })) } },
    })
  }
  await revalidatePath('/dashboard/fidelizacion')
}

export async function archiveRedemptionOption(id: string) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const existing = await prisma.promotion.findFirst({ where: { id, businessId, triggerType: 'granted' }, select: { id: true } })
  if (!existing) throw new ForbiddenError('Recompensa no encontrada')
  await prisma.promotion.update({ where: { id }, data: { isActive: false } })
  await revalidatePath('/dashboard/fidelizacion')
}

export async function redeemPointsAsOwner(customerId: string, optionId: unknown, requestId: unknown) {
  const { businessId, user } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('loyalty-redeem', 30, 60000, { userId: user.id, businessId })
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta más tarde.')
  const parsed = redeemSchema.safeParse({ optionId, requestId })
  if (!parsed.success) throw new Error('Datos inválidos')
  const customer = await prisma.customer.findFirst({ where: { id: customerId, businessId }, select: { id: true } })
  if (!customer) throw new ForbiddenError('Clienta no encontrada')
  await runRedemption({ businessId, customerId, optionId: parsed.data.optionId, requestId: parsed.data.requestId, createdByUserId: user.id })
  await revalidatePath(`/dashboard/customers/${customerId}`)
}

export async function redeemPointsAsCustomer(loyaltyToken: string, optionId: unknown, requestId: unknown) {
  const parsed = redeemSchema.safeParse({ optionId, requestId })
  if (!parsed.success) throw new Error('Datos inválidos')
  const customer = await resolveLoyaltyCustomer(prisma, loyaltyToken)
  if (!customer) throw new ForbiddenError('Tarjeta no disponible')
  const config = customer.business.loyaltyConfig
  if (!config || !config.isActive) throw new Error('El programa no está disponible')
  const limit = await checkRateLimit('loyalty-redeem-public', 10, 60000, { businessId: customer.businessId, userId: customer.id })
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta más tarde.')
  await runRedemption({ businessId: customer.businessId, customerId: customer.id, optionId: parsed.data.optionId, requestId: parsed.data.requestId, createdByUserId: null })
  await revalidatePath(`/tarjeta/${loyaltyToken}`)
}
