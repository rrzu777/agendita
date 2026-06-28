import type { Prisma } from '@prisma/client'
import { isRedeemable } from './evaluate'
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
