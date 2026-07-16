import type { Prisma } from '@prisma/client'
import { reverseVisitPoints } from './credit'
import { reverseAutoRewardsForBooking } from './automatic'

/**
 * Clawback de loyalty por el refund/chargeback de UNA reserva: revierte los
 * visit points (siempre) y las auto-recompensas (solo si el negocio optó por
 * `clawbackAutoRewardOnRefund`). Ambas reversas son idempotentes.
 *
 * Fuente única de la política — la usan la reversión de pago de reserva
 * (reverse-payment.ts) y la rama de degradación del webhook MP. La reversión
 * de PAQUETE (packages/reverse.ts) mantiene su forma batch a propósito: revisa
 * N reservas y consulta la config UNA vez fuera del loop.
 */
export async function clawbackLoyaltyForBooking(
  tx: Prisma.TransactionClient,
  opts: { bookingId: string; businessId: string; now: Date },
): Promise<void> {
  await reverseVisitPoints(tx, opts.bookingId)
  const cfg = await tx.loyaltyConfig.findUnique({
    where: { businessId: opts.businessId },
    select: { clawbackAutoRewardOnRefund: true },
  })
  if (cfg?.clawbackAutoRewardOnRefund) {
    await reverseAutoRewardsForBooking(tx, opts.bookingId, opts.now, opts.businessId)
  }
}
