'use server'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { acquireAdvisoryXactLock } from '@/lib/db/advisory-lock'
import { revalidatePath } from 'next/cache'
import { checkRateLimit } from '@/lib/rate-limit'
import { requireBusiness, requireBusinessRole, requireUser, ForbiddenError } from '@/lib/auth/server'
import { loyaltyConfigSchema, adjustPointsSchema, redemptionOptionSchema, redeemSchema, automaticRuleSchema, buildConditions, type AutomaticRuleInput } from '@/lib/loyalty/schema'
import { getLoyaltyBalance, getLoyaltyHistory } from '@/lib/loyalty/balance'
import { reconcileExpiredGrants } from '@/lib/loyalty/grant'
import { redeemForGrant, type RedeemPromotion } from '@/lib/loyalty/redeem'
import { isP2002 } from '@/lib/loyalty/credit'
import { resolveLoyaltyCustomer } from '@/lib/loyalty/token'
import { conditionKind } from '@/lib/loyalty/automatic-match'
import { buildPresetPayload, planPresetApply, summarizeApply, redemptionSignature, type CurrentLoyaltyState, type ApplyPresetSummary } from '@/lib/loyalty/presets'
import { action, UserError } from '@/lib/actions/result'

// Module-local helpers — NOT exported (use server modules may only export async functions)

function redemptionOptionWhere(businessId: string) {
  return { businessId, triggerType: 'granted' as const, pointsCost: { not: null } }
}

function automaticRuleWhere(businessId: string) {
  return { businessId, triggerType: 'automatic' as const }
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
  // Mensaje user-facing: llega al cliente vía redeemPointsAsOwner/AsCustomer/AsMe.
  if (!promotion) throw new UserError('La recompensa no está disponible')
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

/** Crea una Promotion automatic a partir de una regla ya validada. Module-local
 *  (los módulos 'use server' solo exportan funciones async). */
async function createAutomaticRuleFromInput(
  tx: Prisma.TransactionClient, businessId: string, userId: string, d: AutomaticRuleInput,
): Promise<void> {
  await tx.promotion.create({
    data: {
      businessId, triggerType: 'automatic',
      name: `auto:${d.kind}`, rewardType: d.rewardType ?? 'percentage', rewardValue: d.rewardValue,
      maxDiscount: d.maxDiscount, appliesToAll: d.appliesToAll, rewardPoints: d.rewardPoints,
      grantExpiryDays: d.grantExpiryDays, priority: d.priority, isActive: d.isActive,
      maxPerCustomer: d.maxPerCustomer,
      conditions: buildConditions(d) as Prisma.InputJsonValue,
      createdByUserId: userId,
      services: d.rewardKind === 'grant' && !d.appliesToAll
        ? { connect: d.serviceIds.map((sid) => ({ id: sid })) } : undefined,
    },
  })
}

/** Estado de fidelización relevante para planificar un preset (dentro de una tx). */
async function loadLoyaltyState(tx: Prisma.TransactionClient, businessId: string): Promise<{
  state: CurrentLoyaltyState; configRow: Awaited<ReturnType<typeof tx.loyaltyConfig.findUnique>>
}> {
  const [configRow, autoRules, redemptions] = await Promise.all([
    tx.loyaltyConfig.findUnique({ where: { businessId } }),
    // Reglas: sin filtro isActive → un kind existente (incluso archivado) bloquea el
    // reseed, igual que la unicidad por kind de upsertAutomaticRule.
    tx.promotion.findMany({ where: automaticRuleWhere(businessId), select: { conditions: true } }),
    // Canjes: solo activos → re-aplicar un preset puede resembrar una recompensa
    // archivada (comportamiento aditivo, a diferencia de las reglas).
    tx.promotion.findMany({
      where: { ...redemptionOptionWhere(businessId), isActive: true },
      select: { rewardType: true, rewardValue: true, pointsCost: true, appliesToAll: true },
    }),
  ])
  const state: CurrentLoyaltyState = {
    config: configRow ? {
      pointsLabel: configRow.pointsLabel, pointsPerVisit: configRow.pointsPerVisit,
      spendPerPoint: configRow.spendPerPoint, minSpendToEarn: configRow.minSpendToEarn,
      programName: configRow.programName,
    } : null,
    existingRuleKinds: autoRules
      .map((p) => conditionKind(p.conditions))
      .filter((k): k is string => k != null),
    existingRedemptionSignatures: redemptions.map((o) => redemptionSignature({
      rewardType: o.rewardType, rewardValue: o.rewardValue, pointsCost: o.pointsCost ?? 0, appliesToAll: o.appliesToAll,
    })),
  }
  return { state, configRow }
}

// Exported async actions

export async function getLoyaltyConfig() {
  const { businessId } = await requireBusiness()
  return prisma.loyaltyConfig.findUnique({ where: { businessId } })
}

async function _upsertLoyaltyConfig(data: unknown) {
  const { businessId, user } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('loyalty-config', 30, 60000, { userId: user.id, businessId })
  if (!limit.success) throw new UserError('Demasiadas solicitudes. Intenta más tarde.')

  const parsed = loyaltyConfigSchema.safeParse(data)
  if (!parsed.success) {
    throw new UserError('Datos inválidos: ' + parsed.error.issues.map((i) => i.message).join(', '))
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

export const upsertLoyaltyConfig = action(_upsertLoyaltyConfig)

export async function getCustomerLoyalty(customerId: string) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const customer = await prisma.customer.findFirst({ where: { id: customerId, businessId }, select: { id: true } })
  if (!customer) throw new ForbiddenError('Clienta no encontrada')
  await prisma.$transaction((tx) => reconcileExpiredGrants(tx, customerId, businessId))
  const [balance, history, grants, catalog] = await Promise.all([
    getLoyaltyBalance(prisma, customerId, businessId),
    getLoyaltyHistory(prisma, customerId, businessId, 50),
    prisma.promotionGrant.findMany({
      // Excluir grants de paquete prepago: se consumen automáticamente en la reserva,
      // no son recompensas al portador para mostrar/canjear en la tarjeta.
      where: { customerId, businessId, status: 'active', packagePurchaseId: null },
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

async function _adjustCustomerPoints(customerId: string, delta: unknown, note: unknown) {
  const { businessId, user } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('loyalty-adjust', 30, 60000, { userId: user.id, businessId })
  if (!limit.success) throw new UserError('Demasiadas solicitudes. Intenta más tarde.')

  const parsed = adjustPointsSchema.safeParse({ delta, note })
  if (!parsed.success) {
    throw new UserError('Datos inválidos: ' + parsed.error.issues.map((i) => i.message).join(', '))
  }
  const customer = await prisma.customer.findFirst({ where: { id: customerId, businessId }, select: { id: true } })
  if (!customer) throw new ForbiddenError('Clienta no encontrada')

  await prisma.$transaction(async (tx) => {
    // Advisory lock por-clienta: bajo READ COMMITTED el aggregate NO toma lock, así
    // que sin esto dos ajustes concurrentes podrían ambos pasar el chequeo de
    // saldo>=0 y sobregirar. El lock serializa solo los ajustes de esta misma clienta.
    // Misma clave (customerId) que redeemForGrant → se excluyen mutuamente.
    await acquireAdvisoryXactLock(tx, customerId)
    const agg = await tx.loyaltyLedger.aggregate({ where: { customerId, businessId }, _sum: { points: true } })
    const balance = agg._sum.points ?? 0
    if (balance + parsed.data.delta < 0) {
      throw new UserError('El ajuste dejaría el saldo en negativo')
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

export const adjustCustomerPoints = action(_adjustCustomerPoints)

export async function listRedemptionOptions() {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  return prisma.promotion.findMany({
    where: redemptionOptionWhere(businessId),
    orderBy: { createdAt: 'desc' },
    include: { services: { select: { id: true, name: true } } },
  })
}

async function _upsertRedemptionOption(data: unknown, id?: string) {
  const { businessId, user } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('redemption-option', 30, 60000, { userId: user.id, businessId })
  if (!limit.success) throw new UserError('Demasiadas solicitudes. Intenta más tarde.')

  const parsed = redemptionOptionSchema.safeParse(data)
  if (!parsed.success) throw new UserError('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  const d = parsed.data
  if (d.serviceIds.length) {
    const count = await prisma.service.count({ where: { id: { in: d.serviceIds }, businessId } })
    if (count !== d.serviceIds.length) throw new UserError('Servicio inválido')
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

export const upsertRedemptionOption = action(_upsertRedemptionOption)

async function _archiveRedemptionOption(id: string) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const existing = await prisma.promotion.findFirst({ where: { id, businessId, triggerType: 'granted' }, select: { id: true } })
  if (!existing) throw new ForbiddenError('Recompensa no encontrada')
  await prisma.promotion.update({ where: { id }, data: { isActive: false } })
  await revalidatePath('/dashboard/fidelizacion')
}

export const archiveRedemptionOption = action(_archiveRedemptionOption)

async function _redeemPointsAsOwner(customerId: string, optionId: unknown, requestId: unknown) {
  const { businessId, user } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('loyalty-redeem', 30, 60000, { userId: user.id, businessId })
  if (!limit.success) throw new UserError('Demasiadas solicitudes. Intenta más tarde.')
  const parsed = redeemSchema.safeParse({ optionId, requestId })
  if (!parsed.success) throw new UserError('Datos inválidos')
  const customer = await prisma.customer.findFirst({ where: { id: customerId, businessId }, select: { id: true } })
  if (!customer) throw new ForbiddenError('Clienta no encontrada')
  await runRedemption({ businessId, customerId, optionId: parsed.data.optionId, requestId: parsed.data.requestId, createdByUserId: user.id })
  await revalidatePath(`/dashboard/customers/${customerId}`)
}

export const redeemPointsAsOwner = action(_redeemPointsAsOwner)

async function _redeemPointsAsCustomer(loyaltyToken: string, optionId: unknown, requestId: unknown) {
  const parsed = redeemSchema.safeParse({ optionId, requestId })
  if (!parsed.success) throw new UserError('Datos inválidos')
  const customer = await resolveLoyaltyCustomer(prisma, loyaltyToken)
  if (!customer) throw new ForbiddenError('Tarjeta no disponible')
  const config = customer.business.loyaltyConfig
  if (!config || !config.isActive) throw new UserError('El programa no está disponible')
  const limit = await checkRateLimit('loyalty-redeem-public', 10, 60000, { businessId: customer.businessId, userId: customer.id })
  if (!limit.success) throw new UserError('Demasiadas solicitudes. Intenta más tarde.')
  await runRedemption({ businessId: customer.businessId, customerId: customer.id, optionId: parsed.data.optionId, requestId: parsed.data.requestId, createdByUserId: null })
  await revalidatePath(`/tarjeta/${loyaltyToken}`)
}

export const redeemPointsAsCustomer = action(_redeemPointsAsCustomer)

async function _redeemPointsAsMe(customerId: string, optionId: unknown, requestId: unknown) {
  const user = await requireUser()
  const parsed = redeemSchema.safeParse({ optionId, requestId })
  if (!parsed.success) throw new UserError('Datos inválidos')
  // Ownership por sesión: el Customer debe estar vinculado a esta cuenta.
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, userId: user.id },
    select: { id: true, businessId: true, loyaltyToken: true, business: { select: { slug: true, loyaltyConfig: true } } },
  })
  if (!customer) throw new ForbiddenError('Tarjeta no disponible')
  const config = customer.business.loyaltyConfig
  if (!config || !config.isActive) throw new UserError('El programa no está disponible')
  // Mismo bucket que redeemPointsAsCustomer (keyed por customer.id): alternar
  // tarjeta pública y /mi no debe duplicar el cupo de intentos sobre una tarjeta.
  const limit = await checkRateLimit('loyalty-redeem-public', 10, 60000, { businessId: customer.businessId, userId: customer.id })
  if (!limit.success) throw new UserError('Demasiadas solicitudes. Intenta más tarde.')
  await runRedemption({ businessId: customer.businessId, customerId: customer.id, optionId: parsed.data.optionId, requestId: parsed.data.requestId, createdByUserId: null })
  await revalidatePath(`/mi/${customer.business.slug}`)
  // La tarjeta pública del mismo Customer se cachea (redeemPointsAsCustomer ya
  // la revalida) — un canje desde /mi también debe refrescarla o queda stale.
  if (customer.loyaltyToken) {
    await revalidatePath(`/tarjeta/${customer.loyaltyToken}`)
  }
}

export const redeemPointsAsMe = action(_redeemPointsAsMe)

export async function listAutomaticRules() {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  return prisma.promotion.findMany({
    where: automaticRuleWhere(businessId),
    orderBy: { priority: 'desc' },
    include: { services: { select: { id: true, name: true } } },
  })
}

async function _upsertAutomaticRule(data: unknown, id?: string) {
  const { businessId, user } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('automatic-rule', 30, 60000, { userId: user.id, businessId })
  if (!limit.success) throw new UserError('Demasiadas solicitudes. Intenta más tarde.')

  const parsed = automaticRuleSchema.safeParse(data)
  if (!parsed.success) throw new UserError('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  const d = parsed.data
  if (d.rewardKind === 'grant' && d.serviceIds.length) {
    const count = await prisma.service.count({ where: { id: { in: d.serviceIds }, businessId } })
    if (count !== d.serviceIds.length) throw new UserError('Servicio inválido')
  }
  // Una regla por (negocio, kind): si ya existe OTRA del mismo kind, rechazar.
  const sameKind = (await prisma.promotion.findMany({
    where: { ...automaticRuleWhere(businessId), ...(id ? { id: { not: id } } : {}) },
    select: { id: true, conditions: true },
  })).find((p) => conditionKind(p.conditions) === d.kind)
  if (sameKind) throw new UserError('Ya existe una regla para esta condición')

  const scalars = {
    name: `auto:${d.kind}`, rewardType: d.rewardType ?? 'percentage', rewardValue: d.rewardValue,
    maxDiscount: d.maxDiscount, appliesToAll: d.appliesToAll, rewardPoints: d.rewardPoints,
    grantExpiryDays: d.grantExpiryDays, priority: d.priority, isActive: d.isActive,
    maxPerCustomer: d.maxPerCustomer,
    conditions: buildConditions(d) as Prisma.InputJsonValue,
  }
  if (id) {
    const existing = await prisma.promotion.findFirst({ where: { id, ...automaticRuleWhere(businessId) }, select: { id: true } })
    if (!existing) throw new ForbiddenError('Regla no encontrada')
    await prisma.promotion.update({
      where: { id },
      data: { ...scalars, updatedByUserId: user.id,
        services: d.appliesToAll || d.rewardKind === 'points' ? { set: [] } : { set: d.serviceIds.map(sid => ({ id: sid })) } },
    })
  } else {
    await prisma.promotion.create({
      data: { businessId, triggerType: 'automatic', ...scalars, createdByUserId: user.id,
        services: d.rewardKind === 'grant' && !d.appliesToAll ? { connect: d.serviceIds.map(sid => ({ id: sid })) } : undefined },
    })
  }
  await revalidatePath('/dashboard/fidelizacion')
}

export const upsertAutomaticRule = action(_upsertAutomaticRule)

async function _archiveAutomaticRule(id: string) {
  const { businessId, user } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('automatic-rule', 30, 60000, { userId: user.id, businessId })
  if (!limit.success) throw new UserError('Demasiadas solicitudes. Intenta más tarde.')
  const existing = await prisma.promotion.findFirst({ where: { id, ...automaticRuleWhere(businessId) }, select: { id: true } })
  if (!existing) throw new ForbiddenError('Regla no encontrada')
  await prisma.promotion.update({ where: { id }, data: { isActive: false } })
  await revalidatePath('/dashboard/fidelizacion')
}

export const archiveAutomaticRule = action(_archiveAutomaticRule)

async function _applyLoyaltyPreset(presetId: unknown): Promise<ApplyPresetSummary> {
  const { businessId, user } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('loyalty-preset', 30, 60000, { userId: user.id, businessId })
  if (!limit.success) throw new UserError('Demasiadas solicitudes. Intenta más tarde.')
  if (typeof presetId !== 'string') throw new UserError('Preset inválido')
  const payload = buildPresetPayload(presetId) // lanza UserError si el id no existe

  const summary = await prisma.$transaction(async (tx) => {
    // Advisory lock: serializa los applies de este negocio. Sin unique de DB para
    // "una regla por kind" (kind vive en JSON) ni para la firma de canje, dos applies
    // concurrentes (o doble-clic) crearían duplicados.
    await acquireAdvisoryXactLock(tx, businessId)

    const { state, configRow } = await loadLoyaltyState(tx, businessId)
    const plan = planPresetApply(payload, state)

    if (plan.configToWrite) {
      // Merge: el patch del preset pisa solo los escalares del modelo de acumulación;
      // el resto de la fila (toggles, cardMessage, grantExpiryDays) se preserva. Depende
      // de que loyaltyConfigSchema use .strip() para descartar columnas solo-de-DB
      // (id, businessId, createdAt, updatedAt, updatedByUserId) antes del upsert.
      const merged = { ...configRow, ...plan.configToWrite }
      const parsed = loyaltyConfigSchema.safeParse(merged)
      if (!parsed.success) throw new UserError('Config de fidelización inválida')
      await tx.loyaltyConfig.upsert({
        where: { businessId },
        create: { businessId, ...parsed.data, updatedByUserId: user.id },
        update: { ...parsed.data, updatedByUserId: user.id },
      })
    }

    for (const r of plan.rulesToCreate) {
      const parsed = automaticRuleSchema.safeParse(r)
      if (!parsed.success) throw new UserError('Regla de preset inválida')
      await createAutomaticRuleFromInput(tx, businessId, user.id, parsed.data)
    }

    for (const o of plan.redemptionsToCreate) {
      const parsed = redemptionOptionSchema.safeParse(o)
      if (!parsed.success) throw new UserError('Recompensa de preset inválida')
      const d = parsed.data
      await tx.promotion.create({
        data: {
          businessId, triggerType: 'granted', name: d.name, rewardType: d.rewardType,
          rewardValue: d.rewardValue, maxDiscount: d.maxDiscount, appliesToAll: d.appliesToAll,
          pointsCost: d.pointsCost, grantExpiryDays: d.grantExpiryDays,
          maxRedemptions: d.maxRedemptions, maxPerCustomer: d.maxPerCustomer,
          isActive: d.isActive, createdByUserId: user.id,
        },
      })
    }

    return summarizeApply(plan)
  })

  await revalidatePath('/dashboard/fidelizacion')
  return summary
}

export const applyLoyaltyPreset = action(_applyLoyaltyPreset)
