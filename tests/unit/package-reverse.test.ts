import { describe, it, expect, vi } from 'vitest'
import { reversePackagePurchaseInTx } from '@/lib/packages/reverse'

function makeTx() {
  return {
    promotionGrant: { updateMany: vi.fn().mockResolvedValue({ count: 3 }), findMany: vi.fn().mockResolvedValue([]) },
    packagePurchase: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    ledgerEntry: { create: vi.fn().mockResolvedValue({}) },
    promotionRedemption: { updateMany: vi.fn(), findUnique: vi.fn() },
    booking: { updateMany: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    loyaltyConfig: { findUnique: vi.fn().mockResolvedValue(null) },
    loyaltyLedger: { findUnique: vi.fn(), create: vi.fn() },
  }
}

const purchase = { id: 'pp1', businessId: 'b1', customerId: 'c1' }

describe('reversePackagePurchaseInTx voluntary', () => {
  it('flip atómico active→refunded, revierte grants active, asienta refund_issued con paymentId null', async () => {
    const tx = makeTx()
    const res = await reversePackagePurchaseInTx(tx as never, purchase, {
      mode: 'voluntary', amount: 30000, currency: 'CLP', paymentId: 'pay1', now: new Date('2026-07-12'),
    })
    expect(res.reversed).toBe(true)
    expect(tx.packagePurchase.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'pp1', status: 'active' },
      data: expect.objectContaining({ status: 'refunded', refundedAmount: 30000 }),
    }))
    // voluntary NO setea chargebackAt
    expect(tx.packagePurchase.updateMany.mock.calls[0][0].data.chargebackAt).toBeUndefined()
    expect(tx.promotionGrant.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { packagePurchaseId: 'pp1', status: 'active' },
      data: expect.objectContaining({ status: 'reversed' }),
    }))
    expect(tx.ledgerEntry.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'refund_issued', direction: 'expense', amount: 30000, currency: 'CLP', packagePurchaseId: 'pp1', paymentId: null }),
    }))
  })

  it('idempotente: si el flip no cambió nada (count 0), no asienta', async () => {
    const tx = makeTx()
    tx.packagePurchase.updateMany.mockResolvedValue({ count: 0 })
    const res = await reversePackagePurchaseInTx(tx as never, purchase, {
      mode: 'voluntary', amount: 30000, currency: 'CLP', paymentId: 'pay1', now: new Date(),
    })
    expect(res.reversed).toBe(false)
    expect(tx.ledgerEntry.create).not.toHaveBeenCalled()
  })

  it('amount 0 no asienta pero igual marca refunded', async () => {
    const tx = makeTx()
    const res = await reversePackagePurchaseInTx(tx as never, purchase, {
      mode: 'voluntary', amount: 0, currency: 'CLP', paymentId: null, now: new Date(),
    })
    expect(res.reversed).toBe(true)
    expect(tx.ledgerEntry.create).not.toHaveBeenCalled()
  })
})
