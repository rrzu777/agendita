import type { LoyaltyReason } from '@prisma/client'
import { formatMoney } from '@/lib/money'
import type { AutomaticRule } from './automatic'
import type { EmittedReward } from './automatic'

const REASON_LABELS: Record<LoyaltyReason, string> = {
  visit: 'Visita',
  visit_reversal: 'Reembolso',
  adjustment: 'Ajuste',
  redemption: 'Canje',
  redemption_reversal: 'Reembolso de canje',
  bonus: 'Bonificación',
  bonus_reversal: 'Reverso de bonificación',
}

export function loyaltyReasonLabel(reason: LoyaltyReason): string {
  return REASON_LABELS[reason] ?? 'Movimiento'
}

/** La cara a la clienta nunca muestra saldo negativo (el ledger sí guarda la verdad). */
export function displayBalance(balance: number): number {
  return Math.max(0, balance)
}

/** La clienta puede pagar la recompensa si su saldo cubre el costo en puntos. */
export function canAfford(balance: number, pointsCost: number): boolean {
  return balance >= pointsCost
}

/** Etiqueta humana de la recompensa efectivamente emitida, para el email de recompensa.
 *  - puntos → "150 puntos" (usa el `pointsLabel` del config si está disponible).
 *  - grant percentage → "un 20% de descuento".
 *  - grant fixed_amount → "un descuento de $5.000" (currency-clean vía formatMoney).
 *  - grant free_service → "un servicio gratis".
 *  Devuelve null si `reward` es null (nada emitido). */
export function describeReward(
  reward: EmittedReward,
  rule: Pick<AutomaticRule, 'rewardType' | 'rewardValue'>,
  pointsLabel: string,
  currency: string,
): string | null {
  if (!reward) return null
  if (reward.kind === 'points') return `${reward.points} ${pointsLabel}`
  // kind === 'grant'
  if (rule.rewardType === 'percentage') return `un ${rule.rewardValue}% de descuento`
  if (rule.rewardType === 'fixed_amount') return `un descuento de ${formatMoney(rule.rewardValue, currency)}`
  return 'un servicio gratis'
}
