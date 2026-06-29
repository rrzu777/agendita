import { describe, it, expect, vi } from 'vitest'
import { creditVisitPoints } from '@/lib/loyalty/credit'

// El wiring real corre dentro de updateBookingStatus; aquí verificamos el contrato
// que ese call site usa: programa activo + completed => un asiento visit.
describe('wiring earn', () => {
  it('acredita el total calculado al completar', async () => {
    const create = vi.fn().mockResolvedValue({})
    const tx = { loyaltyLedger: { create } } as any
    await creditVisitPoints(tx, {
      businessId: 'b1', customerId: 'c1', finalAmount: 20000, bookingId: 'bk1',
      config: { isActive: true, pointsPerVisit: 5, spendPerPoint: 1000, minSpendToEarn: null },
    })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ points: 25, reason: 'visit', bookingId: 'bk1' }),
    }))
  })
})
