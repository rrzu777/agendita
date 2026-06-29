import type { Prisma } from '@prisma/client'
import { isRedeemable, computeDiscount } from './evaluate'
import { normalizeCode } from './schema'

export interface ApplyResult { discountAmount: number; promotionId: string }

/** Resuelve y consume una promo por código dentro de una transacción de reserva.
 *  Devuelve null si no hay código. Lanza si el código es inválido (la reserva no debe crearse).
 *  Inserta el canje e incrementa redemptionCount atómicamente. */
export async function applyPromotionInTx(tx: Prisma.TransactionClient, args: {
  businessId: string; code: string | null | undefined; serviceId: string; customerId: string
  totalPrice: number; bookingId: string; source: 'public_booking' | 'dashboard_booking'
  createdByUserId?: string | null; now?: Date
}): Promise<ApplyResult | null> {
  const code = normalizeCode(args.code)
  if (!code) return null

  // Rama grant (canje de puntos): el código puede ser un PromotionGrant al portador.
  const grant = await tx.promotionGrant.findFirst({
    where: { businessId: args.businessId, code, status: 'active' },
    include: { promotion: { include: { services: { select: { id: true } } } } },
  })
  if (grant) {
    const p = grant.promotion
    const now = args.now ?? new Date()
    if (grant.expiresAt && now > grant.expiresAt) throw new Error('La recompensa venció')
    // Stock y tope ya se consumieron al canjear; tampoco se exige p.isActive (la
    // clienta ya pagó los puntos, se honra). Sólo se valida alcance y mínimo.
    if (!p.appliesToAll && !p.services.some(s => s.id === args.serviceId))
      throw new Error('La recompensa no aplica a este servicio')
    if (p.minSpend != null && args.totalPrice < p.minSpend)
      throw new Error('La recompensa requiere un monto mínimo mayor')
    const discount = computeDiscount(
      { ...p, serviceIds: p.services.map(s => s.id) } as Parameters<typeof computeDiscount>[0],
      args.totalPrice,
    )
    // Flip atómico anti doble-aplicación concurrente del mismo código.
    const flipped = await tx.promotionGrant.updateMany({
      where: { id: grant.id, status: 'active' },
      data: { status: 'redeemed', redeemedBookingId: args.bookingId, redeemedAt: now },
    })
    if (flipped.count === 0) throw new Error('La recompensa ya fue usada')
    await tx.promotionRedemption.create({
      data: {
        businessId: args.businessId, promotionId: p.id, bookingId: args.bookingId,
        customerId: args.customerId, discountAmount: discount, source: args.source,
        createdByUserId: args.createdByUserId ?? null,
      },
    })
    return { discountAmount: discount, promotionId: p.id }
  }

  const promo = await tx.promotion.findFirst({
    where: { businessId: args.businessId, code, triggerType: 'code' },
    include: { services: { select: { id: true } } },
  })
  if (!promo) throw new Error('El código de promoción no es válido')

  const customerRedemptions = promo.maxPerCustomer == null ? 0
    : await tx.promotionRedemption.count({ where: { promotionId: promo.id, customerId: args.customerId, status: 'applied' } })

  const r = isRedeemable({
    promo: { ...promo, serviceIds: promo.services.map(s => s.id) },
    serviceId: args.serviceId, totalPrice: args.totalPrice, customerRedemptions, now: args.now ?? new Date(),
  })
  if (!r.ok) throw new Error('El código ya no está disponible')

  // Incremento atómico (branch null = ilimitado).
  if (promo.maxRedemptions == null) {
    await tx.promotion.update({ where: { id: promo.id }, data: { redemptionCount: { increment: 1 } } })
  } else {
    const inc = await tx.promotion.updateMany({
      where: { id: promo.id, redemptionCount: { lt: promo.maxRedemptions } },
      data: { redemptionCount: { increment: 1 } },
    })
    if (inc.count === 0) throw new Error('El código ya no está disponible')
  }

  await tx.promotionRedemption.create({
    data: {
      businessId: args.businessId, promotionId: promo.id, bookingId: args.bookingId,
      customerId: args.customerId, discountAmount: r.discount, source: args.source,
      createdByUserId: args.createdByUserId ?? null,
    },
  })
  return { discountAmount: r.discount, promotionId: promo.id }
}
