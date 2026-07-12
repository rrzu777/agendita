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

describe('reversePackagePurchaseInTx chargeback', () => {
  it('setea chargebackAt, revierte grants redeemed de reservas upcoming (descubre reserva) y clawback de puntos de completadas', async () => {
    const tx = makeTx()
    // 1 grant redeemed de reserva upcoming, 1 grant redeemed de reserva completada
    tx.promotionGrant.findMany.mockResolvedValue([
      { id: 'g-up', redeemedBookingId: 'bk-up', promotionId: 'promo1' },
      { id: 'g-done', redeemedBookingId: 'bk-done', promotionId: 'promo1' },
    ])
    tx.booking.findMany.mockResolvedValue([
      { id: 'bk-up', status: 'confirmed', serviceId: 's1', finalAmount: 0 },
      { id: 'bk-done', status: 'completed', serviceId: 's1', finalAmount: 0 },
    ])
    tx.loyaltyLedger.findUnique.mockResolvedValue({ id: 'll1', businessId: 'b1', customerId: 'c1', points: 5 })
    // La reserva upcoming estaba cubierta por el paquete (discountAmount = 20000).
    tx.promotionRedemption.findUnique.mockResolvedValue({ status: 'applied', discountAmount: 20000 })

    await reversePackagePurchaseInTx(tx as never, purchase, {
      mode: 'chargeback', amount: 50000, currency: 'CLP', paymentId: 'pay1', now: new Date('2026-07-12'),
    })

    // chargebackAt set
    expect(tx.packagePurchase.updateMany.mock.calls[0][0].data.chargebackAt).toBeInstanceOf(Date)
    // grant de reserva upcoming: liberado (redeemedBookingId null, reversed)
    expect(tx.promotionGrant.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'g-up' }),
      data: expect.objectContaining({ status: 'reversed', redeemedBookingId: null }),
    }))
    // redemption de la upcoming liberado
    expect(tx.promotionRedemption.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ bookingId: 'bk-up' }),
    }))
    // reserva upcoming descubierta → pending_payment, con el monto cubierto vuelto a cobrable
    expect(tx.booking.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'bk-up' }),
      data: expect.objectContaining({ status: 'pending_payment', paymentStatus: 'unpaid', finalAmount: 20000, remainingBalance: 20000 }),
    }))
    // clawback de puntos SOLO de la completada
    expect(tx.loyaltyLedger.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ bookingId: 'bk-done', reason: 'visit_reversal' }),
    }))
  })
})
