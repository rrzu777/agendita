import { describe, it, expect, vi } from 'vitest'
import { BookingPaymentStatus } from '@prisma/client'

// El override de paymentStatus se aplica en el update final; los montos
// (depositPaid/remainingBalance) se derivan igual de los payments approved.
describe('recalcBookingFromPayments — paymentStatusOverride', () => {
  function makeTx(booking: Record<string, unknown>, approvedPayments: Array<Record<string, unknown>>) {
    return {
      booking: {
        findUnique: vi.fn(async () => booking),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...booking, ...data })),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      payment: {
        findMany: vi.fn(async () => approvedPayments),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
    }
  }

  it('sin override deriva paymentStatus de los payments (comportamiento actual)', async () => {
    const { recalcBookingFromPayments } = await import('@/server/services/finance')
    const booking = { id: 'b1', status: 'confirmed', businessId: 'biz', customerId: 'c1', totalPrice: 10000, depositRequired: 5000, depositPaid: 5000, remainingBalance: 5000, finalAmount: 10000, paymentStatus: 'deposit_paid' }
    const tx = makeTx(booking, []) // el pago fue flipeado a refunded → 0 approved
    const { booking: updated } = await recalcBookingFromPayments(tx as never, 'b1')
    expect(tx.booking.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ depositPaid: 0, remainingBalance: 10000, paymentStatus: BookingPaymentStatus.unpaid }),
    }))
    expect(updated.paymentStatus).toBe(BookingPaymentStatus.unpaid)
  })

  it('con override escribe el paymentStatus dado y los montos derivados', async () => {
    const { recalcBookingFromPayments } = await import('@/server/services/finance')
    const booking = { id: 'b1', status: 'confirmed', businessId: 'biz', customerId: 'c1', totalPrice: 10000, depositRequired: 5000, depositPaid: 5000, remainingBalance: 5000, finalAmount: 10000, paymentStatus: 'deposit_paid' }
    const tx = makeTx(booking, [])
    await recalcBookingFromPayments(tx as never, 'b1', { paymentStatusOverride: BookingPaymentStatus.refunded })
    expect(tx.booking.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ depositPaid: 0, remainingBalance: 10000, paymentStatus: BookingPaymentStatus.refunded }),
    }))
  })
})
