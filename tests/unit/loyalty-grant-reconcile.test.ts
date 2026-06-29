import { describe, it, expect, vi } from 'vitest'
import { reconcileExpiredGrants } from '@/lib/loyalty/grant'

function db(grants: any[]) {
  const create = vi.fn().mockResolvedValue({})
  const updateMany = vi.fn().mockResolvedValue({ count: 1 })
  return {
    db: {
      promotionGrant: { findMany: vi.fn().mockResolvedValue(grants), updateMany },
      loyaltyLedger: { create },
    } as any,
    create, updateMany,
  }
}
const NOW = new Date('2026-06-29T00:00:00Z')

describe('reconcileExpiredGrants', () => {
  it('refundOnExpiry=true => marca reversed e inserta reembolso', async () => {
    const { db: d, create, updateMany } = db([
      { id: 'g1', businessId: 'b1', customerId: 'c1', pointsSpent: 50, refundOnExpiry: true },
    ])
    await reconcileExpiredGrants(d, 'c1', 'b1', NOW)
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'reversed' }) }))
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ points: 50, reason: 'redemption_reversal' }) }))
  })
  it('refundOnExpiry=false => marca expired sin reembolso', async () => {
    const { db: d, create, updateMany } = db([
      { id: 'g2', businessId: 'b1', customerId: 'c1', pointsSpent: 50, refundOnExpiry: false },
    ])
    await reconcileExpiredGrants(d, 'c1', 'b1', NOW)
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: 'expired' } }))
    expect(create).not.toHaveBeenCalled()
  })
  it('no reembolsa si el flip no ganó la carrera (count 0)', async () => {
    const { db: d, create } = db([
      { id: 'g3', businessId: 'b1', customerId: 'c1', pointsSpent: 50, refundOnExpiry: true },
    ])
    d.promotionGrant.updateMany = vi.fn().mockResolvedValue({ count: 0 })
    await reconcileExpiredGrants(d, 'c1', 'b1', NOW)
    expect(create).not.toHaveBeenCalled()
  })
})
