import { describe, it, expect, vi, beforeEach } from 'vitest'

const recalcMock = vi.fn(async () => ({ booking: { id: 'b1' }, wasConfirmed: false }))
vi.mock('@/server/services/finance', () => ({ recalcBookingFromPayments: recalcMock }))
const reverseVisitMock = vi.fn(async () => {})
vi.mock('@/lib/loyalty/credit', () => ({ reverseVisitPoints: reverseVisitMock }))
const reverseAutoMock = vi.fn(async () => {})
vi.mock('@/lib/loyalty/automatic', () => ({ reverseAutoRewardsForBooking: reverseAutoMock }))

function makeTx(flipCount: number, clawbackCfg: { clawbackAutoRewardOnRefund: boolean } | null = { clawbackAutoRewardOnRefund: true }) {
  return {
    payment: { updateMany: vi.fn(async () => ({ count: flipCount })) },
    ledgerEntry: { create: vi.fn(async () => ({})) },
    loyaltyConfig: { findUnique: vi.fn(async () => clawbackCfg) },
    promotionRedemption: { updateMany: vi.fn(async () => ({ count: 0 })) },
  }
}

const OPTS = {
  paymentId: 'pay1', bookingId: 'b1', businessId: 'biz', customerId: 'c1',
  amount: 8000, currency: 'CLP', mode: 'chargeback' as const, now: new Date('2026-07-16T12:00:00Z'),
}

beforeEach(() => { vi.clearAllMocks() })

describe('reverseBookingPaymentInTx', () => {
  it('flip ganado: flipea el Payment con CAS, asienta expense con paymentId null, recalca con override refunded y hace clawback', async () => {
    const { reverseBookingPaymentInTx } = await import('@/lib/bookings/reverse-payment')
    const tx = makeTx(1)
    const res = await reverseBookingPaymentInTx(tx as never, OPTS)
    expect(res.reversed).toBe(true)
    expect(tx.payment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'pay1', status: 'approved' },
      data: expect.objectContaining({ status: 'refunded' }),
    }))
    expect(tx.ledgerEntry.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        bookingId: 'b1', paymentId: null, type: 'refund_issued', direction: 'expense', amount: 8000,
      }),
    }))
    expect(recalcMock).toHaveBeenCalledWith(tx, 'b1', { paymentStatusOverride: 'refunded' })
    expect(reverseVisitMock).toHaveBeenCalledWith(tx, 'b1')
    expect(reverseAutoMock).toHaveBeenCalledWith(tx, 'b1', OPTS.now, 'biz')
  })

  it('flip perdido (count 0): retorna reversed false y CERO side effects', async () => {
    const { reverseBookingPaymentInTx } = await import('@/lib/bookings/reverse-payment')
    const tx = makeTx(0)
    const res = await reverseBookingPaymentInTx(tx as never, OPTS)
    expect(res.reversed).toBe(false)
    expect(tx.ledgerEntry.create).not.toHaveBeenCalled()
    expect(recalcMock).not.toHaveBeenCalled()
    expect(reverseVisitMock).not.toHaveBeenCalled()
    expect(reverseAutoMock).not.toHaveBeenCalled()
  })

  it('clawbackAutoRewardOnRefund apagado: revierte visit points pero NO auto-rewards', async () => {
    const { reverseBookingPaymentInTx } = await import('@/lib/bookings/reverse-payment')
    const tx = makeTx(1, { clawbackAutoRewardOnRefund: false })
    await reverseBookingPaymentInTx(tx as never, OPTS)
    expect(reverseVisitMock).toHaveBeenCalled()
    expect(reverseAutoMock).not.toHaveBeenCalled()
  })

  it('NO libera la redención de promo (la reserva sigue viva)', async () => {
    const { reverseBookingPaymentInTx } = await import('@/lib/bookings/reverse-payment')
    const tx = makeTx(1)
    await reverseBookingPaymentInTx(tx as never, OPTS)
    expect(tx.promotionRedemption.updateMany).not.toHaveBeenCalled()
  })

  it('flipData del webhook viaja al update del Payment', async () => {
    const { reverseBookingPaymentInTx } = await import('@/lib/bookings/reverse-payment')
    const tx = makeTx(1)
    await reverseBookingPaymentInTx(tx as never, { ...OPTS, flipData: { providerPaymentId: 'mp-99', rawPayload: { id: 'mp-99' } } })
    expect(tx.payment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'refunded', providerPaymentId: 'mp-99' }),
    }))
  })
})
