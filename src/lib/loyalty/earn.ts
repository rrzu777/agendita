export interface EarnConfig {
  pointsPerVisit: number
  spendPerPoint: number | null
  minSpendToEarn: number | null
}
export interface EarnInput { finalAmount: number }
export interface EarnBreakdown {
  total: number
  pointsPerVisit: number
  pointsFromSpend: number
  finalAmount: number
  spendPerPoint: number | null
  belowMinSpend: boolean
}

/** Puro: calcula puntos ganados al completar una reserva. Sin I/O. */
export function computeEarnedPoints(config: EarnConfig, input: EarnInput): EarnBreakdown {
  const finalAmount = Math.max(0, Math.trunc(input.finalAmount || 0))
  const spendPerPoint = config.spendPerPoint && config.spendPerPoint > 0 ? config.spendPerPoint : null
  const floor = config.minSpendToEarn && config.minSpendToEarn > 0 ? config.minSpendToEarn : null

  const belowMinSpend = floor != null && finalAmount < floor
  if (belowMinSpend) {
    return { total: 0, pointsPerVisit: 0, pointsFromSpend: 0, finalAmount, spendPerPoint, belowMinSpend }
  }
  const pointsPerVisit = Math.max(0, Math.trunc(config.pointsPerVisit || 0))
  const pointsFromSpend = spendPerPoint ? Math.floor(finalAmount / spendPerPoint) : 0
  return { total: pointsPerVisit + pointsFromSpend, pointsPerVisit, pointsFromSpend, finalAmount, spendPerPoint, belowMinSpend }
}
