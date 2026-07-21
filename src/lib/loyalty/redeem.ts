import type { Prisma } from '@prisma/client'
import { acquireAdvisoryXactLock } from '@/lib/db/advisory-lock'
import { createGrantInTx, reconcileExpiredGrants } from './grant'
import { getLoyaltyBalance } from './balance'
import { UserError } from '@/lib/actions/result'

type Tx = Prisma.TransactionClient

export interface RedeemConfig {
  isActive: boolean
  grantExpiryDays: number | null
  refundPointsOnExpiry: boolean
  forfeitGrantOnNoShow: boolean
}

export interface RedeemPromotion {
  id: string
  businessId: string
  triggerType: string
  isActive: boolean
  pointsCost: number | null
  grantExpiryDays: number | null
  maxRedemptions: number | null
  maxPerCustomer: number | null
}

const DAY_MS = 86_400_000

/** Canjea puntos por un grant, DENTRO de una $transaction. Toma un advisory lock
 *  por-clienta (serializa canjes/ajustes de la misma clienta). Devuelve el grant.
 *  Idempotente por (customerId, requestId): un doble-click devuelve el grant ya
 *  emitido sin descontar de nuevo. El P2002 del create (carrera extrema) se deja
 *  propagar: la action lo captura, hace rollback y re-lee el grant existente. */
export async function redeemForGrant(tx: Tx, args: {
  businessId: string
  customerId: string
  promotion: RedeemPromotion
  config: RedeemConfig
  requestId: string
  createdByUserId?: string | null
  now?: Date
}) {
  const now = args.now ?? new Date()
  const { businessId, customerId, promotion, config, requestId } = args

  await acquireAdvisoryXactLock(tx, customerId)

  // Idempotencia (antes de tocar stock/saldo).
  const existing = await tx.promotionGrant.findUnique({
    where: { customerId_requestId: { customerId, requestId } },
  })
  if (existing) return existing

  await reconcileExpiredGrants(tx, customerId, businessId, now)

  // Pausa global del programa: bloquea el canje en AMBAS superficies (owner y clienta),
  // no sólo en redeemPointsAsCustomer (decisión #9 del spec). Mensajes user-facing:
  // esta función corre dentro de runRedemption, llamada por las tres actions de canje.
  if (!config.isActive) throw new UserError('El programa de fidelización está pausado')

  if (promotion.triggerType !== 'granted' || !promotion.isActive || promotion.pointsCost == null) {
    throw new UserError('La recompensa no está disponible')
  }
  const pointsCost = promotion.pointsCost

  if (promotion.maxPerCustomer != null) {
    const claimed = await tx.promotionGrant.count({
      where: { promotionId: promotion.id, customerId, status: { in: ['active', 'redeemed'] } },
    })
    if (claimed >= promotion.maxPerCustomer) throw new UserError('Ya alcanzaste el límite de esta recompensa')
  }

  const balance = await getLoyaltyBalance(tx, customerId, businessId)
  if (balance < pointsCost) throw new UserError('No tienes puntos suficientes')

  // Stock atómico (el lock per-customer NO cubre el stock compartido entre clientas).
  if (promotion.maxRedemptions == null) {
    await tx.promotion.update({ where: { id: promotion.id }, data: { redemptionCount: { increment: 1 } } })
  } else {
    const inc = await tx.promotion.updateMany({
      where: { id: promotion.id, redemptionCount: { lt: promotion.maxRedemptions } },
      data: { redemptionCount: { increment: 1 } },
    })
    if (inc.count === 0) throw new UserError('La recompensa se agotó')
  }

  const expiryDays = promotion.grantExpiryDays ?? config.grantExpiryDays
  const expiresAt = expiryDays != null ? new Date(now.getTime() + expiryDays * DAY_MS) : null

  const grant = await createGrantInTx(tx, {
    businessId, promotionId: promotion.id, customerId, requestId,
    pointsSpent: pointsCost, expiresAt,
    refundOnExpiry: config.refundPointsOnExpiry,
    forfeitOnNoShow: config.forfeitGrantOnNoShow,
    createdByUserId: args.createdByUserId ?? null,
  })

  await tx.loyaltyLedger.create({
    data: {
      businessId, customerId, points: -pointsCost, reason: 'redemption',
      metadata: { grantId: grant.id, promotionId: promotion.id },
      createdByUserId: args.createdByUserId ?? null,
    },
  })

  return grant
}
