import type { Prisma } from '@prisma/client'
import { computeEarnedPoints, type EarnBreakdown } from './earn'

type Tx = Prisma.TransactionClient

export interface CreditConfig {
  isActive: boolean
  pointsPerVisit: number
  spendPerPoint: number | null
  minSpendToEarn: number | null
}

function isP2002(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { code?: string }).code === 'P2002'
}

/** Acredita puntos por una reserva completada, dentro de la tx de la reserva.
 *  No-op si programa inactivo / sin clienta / total 0 / ya acreditado (P2002). */
export async function creditVisitPoints(tx: Tx, args: {
  businessId: string
  customerId: string | null
  finalAmount: number
  bookingId: string
  config: CreditConfig | null
}): Promise<EarnBreakdown | null> {
  const { config, customerId } = args
  // bookingId no-vacío es requisito de la idempotencia: la unique (bookingId, reason)
  // no aplica con NULL en Postgres, así que un bookingId vacío permitiría doble crédito.
  if (!config || !config.isActive || !customerId || !args.bookingId) return null

  const breakdown = computeEarnedPoints(config, { finalAmount: args.finalAmount })
  if (breakdown.total <= 0) return null

  try {
    await tx.loyaltyLedger.create({
      data: {
        businessId: args.businessId,
        customerId,
        points: breakdown.total,
        reason: 'visit',
        bookingId: args.bookingId,
        metadata: breakdown as unknown as Prisma.InputJsonValue,
      },
    })
    return breakdown
  } catch (e) {
    if (isP2002(e)) return null // ya acreditado: idempotente
    throw e
  }
}

/** Reversa (clawback) del visit de una reserva reembolsada. Append-only. Idempotente. */
export async function reverseVisitPoints(tx: Tx, bookingId: string): Promise<void> {
  const original = await tx.loyaltyLedger.findUnique({
    where: { bookingId_reason: { bookingId, reason: 'visit' } },
  })
  if (!original) return

  try {
    await tx.loyaltyLedger.create({
      data: {
        businessId: original.businessId,
        customerId: original.customerId,
        points: -original.points,
        reason: 'visit_reversal',
        bookingId,
        metadata: { reversedLedgerId: original.id, originalPoints: original.points },
      },
    })
  } catch (e) {
    if (isP2002(e)) return // ya reversado
    throw e
  }
}
