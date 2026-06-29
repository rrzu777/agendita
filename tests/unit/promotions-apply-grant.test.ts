import { describe, it, expect, vi } from 'vitest'
import { applyPromotionInTx } from '@/lib/promotions/apply'

const PROMO = { id: 'p1', appliesToAll: true, services: [], minSpend: null,
  rewardType: 'percentage', rewardValue: 50, maxDiscount: null }

function fakeTx(grant: any) {
  return {
    promotionGrant: {
      findFirst: vi.fn().mockResolvedValue(grant),
      updateMany: vi.fn().mockResolvedValue({ count: grant ? 1 : 0 }),
    },
    promotion: { findFirst: vi.fn().mockResolvedValue(null) },
    promotionRedemption: { create: vi.fn().mockResolvedValue({}) },
  } as any
}
const ARGS = { businessId: 'b1', serviceId: 's1', customerId: 'c1', totalPrice: 1000,
  bookingId: 'bk1', source: 'public_booking' as const }

describe('applyPromotionInTx — rama grant', () => {
  it('aplica un grant activo, lo marca redeemed y NO incrementa redemptionCount', async () => {
    const tx = fakeTx({ id: 'g1', expiresAt: null, promotion: PROMO })
    const res = await applyPromotionInTx(tx, { ...ARGS, code: 'ABC123' })
    expect(res).toEqual({ discountAmount: 500, promotionId: 'p1' })
    expect(tx.promotionGrant.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'redeemed', redeemedBookingId: 'bk1' }) }))
    expect(tx.promotionRedemption.create).toHaveBeenCalled()
    expect(tx.promotion.findFirst).not.toHaveBeenCalled() // no cae al camino de código
  })
  it('rechaza un grant vencido', async () => {
    const tx = fakeTx({ id: 'g1', expiresAt: new Date('2000-01-01'), promotion: PROMO })
    await expect(applyPromotionInTx(tx, { ...ARGS, code: 'ABC123', now: new Date('2026-01-01') }))
      .rejects.toThrow(/venció/)
  })
  it('rechaza si el grant ya fue usado (flip count 0)', async () => {
    const tx = fakeTx({ id: 'g1', expiresAt: null, promotion: PROMO })
    tx.promotionGrant.updateMany = vi.fn().mockResolvedValue({ count: 0 })
    await expect(applyPromotionInTx(tx, { ...ARGS, code: 'ABC123' })).rejects.toThrow(/ya fue usada/)
  })
  it('rechaza si el servicio está fuera de alcance', async () => {
    const tx = fakeTx({ id: 'g1', expiresAt: null,
      promotion: { ...PROMO, appliesToAll: false, services: [{ id: 'otro' }] } })
    await expect(applyPromotionInTx(tx, { ...ARGS, code: 'ABC123' })).rejects.toThrow(/no aplica/)
  })
})
