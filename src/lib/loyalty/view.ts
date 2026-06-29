import type { LoyaltyReason } from '@prisma/client'

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
