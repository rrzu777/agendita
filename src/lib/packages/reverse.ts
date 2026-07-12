import type { Prisma } from '@prisma/client'

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

/** Placeholder de la reversión profunda del chargeback — se implementa en Task 7. */
async function reverseChargebackExtras(
  _tx: Prisma.TransactionClient,
  _purchase: ReversablePurchase,
  _now: Date,
): Promise<void> {
  // Task 7: revertir grants redeemed de reservas upcoming (descubrir reserva) +
  // clawback de puntos de sesiones completadas.
}
