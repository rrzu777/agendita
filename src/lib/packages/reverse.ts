import type { Prisma } from '@prisma/client'
import { reverseVisitPoints } from '@/lib/loyalty/credit'
import { reverseAutoRewardsForBooking } from '@/lib/loyalty/automatic'

export interface ReversablePurchase {
  id: string
  businessId: string
  customerId: string
}

export interface ReverseOptions {
  mode: 'voluntary' | 'chargeback'
  /** prorrateo (voluntary) o monto completo de MP (chargeback). */
  amount: number
  currency: string
  /** Payment que originó la reversión; sólo para trazabilidad — el asiento va con paymentId null. */
  paymentId: string | null
  now: Date
}

export interface ReverseResult { reversed: boolean }

/**
 * Núcleo de reversión de una PackagePurchase, reusable por la owner-action (con
 * auth) y el webhook (sin auth). Corre dentro de la tx del caller.
 *
 * Idempotencia: el flip `active→refunded` es atómico (updateMany where status:'active').
 * Sólo el llamador que gana el flip (count===1) asienta y revierte — así el eco del
 * refund voluntario y el redelivery del webhook de chargeback son no-ops.
 * El asiento `refund_issued` va con paymentId:null (el @@unique([paymentId]) ya lo
 * consume el package_sale, no se puede reusar).
 */
export async function reversePackagePurchaseInTx(
  tx: Prisma.TransactionClient,
  purchase: ReversablePurchase,
  opts: ReverseOptions,
): Promise<ReverseResult> {
  const flip = await tx.packagePurchase.updateMany({
    where: { id: purchase.id, status: 'active' },
    data: {
      status: 'refunded',
      refundedAt: opts.now,
      refundedAmount: opts.amount,
      ...(opts.mode === 'chargeback' ? { chargebackAt: opts.now } : {}),
    },
  })
  if (flip.count === 0) return { reversed: false } // ya reversado / eco / redelivery

  // Grants libres (no atados a ninguna reserva) → reversed.
  await tx.promotionGrant.updateMany({
    where: { packagePurchaseId: purchase.id, status: 'active' },
    data: { status: 'reversed', reversedAt: opts.now },
  })

  if (opts.mode === 'chargeback') {
    await reverseChargebackExtras(tx, purchase, opts.now)
  }

  if (opts.amount > 0) {
    await tx.ledgerEntry.create({
      data: {
        businessId: purchase.businessId,
        packagePurchaseId: purchase.id,
        paymentId: null,
        customerId: purchase.customerId,
        type: 'refund_issued',
        direction: 'expense',
        amount: opts.amount,
        currency: opts.currency,
        description: opts.mode === 'chargeback' ? 'Contracargo de paquete' : 'Reembolso de paquete',
        occurredAt: opts.now,
      },
    })
  }

  return { reversed: true }
}

/** Reversión profunda del chargeback: grants consumidos (redeemed) del paquete
 *  disputado. Para reservas futuras (upcoming) libera la cobertura y descubre la
 *  reserva a pending_payment (sin auto-cancelar); para sesiones ya completadas
 *  hace clawback de los puntos (el servicio fue entregado, el grant se deja). */
async function reverseChargebackExtras(
  tx: Prisma.TransactionClient,
  purchase: ReversablePurchase,
  now: Date,
): Promise<void> {
  const redeemed = await tx.promotionGrant.findMany({
    where: { packagePurchaseId: purchase.id, status: 'redeemed', redeemedBookingId: { not: null } },
    select: { id: true, redeemedBookingId: true },
  })
  const bookingIds = redeemed.map((g) => g.redeemedBookingId!).filter(Boolean)
  if (bookingIds.length === 0) return

  const bookings = await tx.booking.findMany({
    where: { id: { in: bookingIds } },
    select: { id: true, status: true },
  })
  const byId = new Map(bookings.map((b) => [b.id, b]))
  const UPCOMING = new Set(['pending_payment', 'confirmed'])

  // El clawback de auto-recompensas sólo aplica a sesiones completadas; si el
  // chargeback sólo toca reservas futuras, ni consultamos la config.
  const hasCompleted = bookings.some((b) => b.status === 'completed')
  const cfg = hasCompleted
    ? await tx.loyaltyConfig.findUnique({
        where: { businessId: purchase.businessId },
        select: { clawbackAutoRewardOnRefund: true },
      })
    : null

  for (const g of redeemed) {
    const bk = byId.get(g.redeemedBookingId!)
    if (!bk) continue

    if (UPCOMING.has(bk.status)) {
      // Reserva futura no completada: liberar la cobertura y descubrir la reserva.
      await tx.promotionRedemption.updateMany({
        where: { bookingId: bk.id, status: 'applied' },
        data: { status: 'released', releaseReason: 'refunded', releasedAt: now },
      })
      await tx.promotionGrant.updateMany({
        where: { id: g.id, status: 'redeemed', redeemedBookingId: bk.id },
        data: { status: 'reversed', reversedAt: now, redeemedBookingId: null, redeemedAt: null },
      })
      // Descubrir: la reserva vuelve a cobrable (owner-visible, sin auto-cancelar).
      await tx.booking.updateMany({
        where: { id: bk.id },
        data: { status: 'pending_payment', paymentStatus: 'unpaid' },
      })
    } else if (bk.status === 'completed') {
      // Sesión ya entregada: no se descubre; clawback de puntos.
      await reverseVisitPoints(tx, bk.id)
      if (cfg?.clawbackAutoRewardOnRefund) {
        await reverseAutoRewardsForBooking(tx, bk.id, now, purchase.businessId)
      }
      // El grant redeemed de una sesión completada se deja tal cual (servicio dado).
    }
  }
}
