import type { LoyaltyReason } from '@prisma/client'

const REASON_LABELS: Record<LoyaltyReason, string> = {
  visit: 'Visita',
  visit_reversal: 'Reembolso',
  adjustment: 'Ajuste',
}

export function loyaltyReasonLabel(reason: LoyaltyReason): string {
  return REASON_LABELS[reason] ?? 'Movimiento'
}

/** La cara a la clienta nunca muestra saldo negativo (el ledger sí guarda la verdad). */
export function displayBalance(balance: number): number {
  return Math.max(0, balance)
}
