import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRelease } = vi.hoisted(() => ({ mockRelease: vi.fn() }))
vi.mock('@/lib/promotions/release', () => ({ releaseRedemptionForBooking: mockRelease }))

import { cancelBookingInTx } from '@/lib/bookings/mutate'
import { declaredTransferPaymentWhere } from '@/lib/bank-transfer/declared'

function makeTx() {
  return {
    booking: { update: vi.fn().mockResolvedValue({}) },
    payment: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
  }
}

describe('cancelBookingInTx', () => {
  beforeEach(() => vi.clearAllMocks())

  it('flip a cancelled + release + cierra bt-declared pendiente', async () => {
    const tx = makeTx()
    await cancelBookingInTx(tx as never, { id: 'b1', internalNotes: 'nota' }, { reason: 'me enfermé' })
    expect(tx.booking.update).toHaveBeenCalledWith({
      where: { id: 'b1' },
      data: { status: 'cancelled', internalNotes: 'nota\n[CANCELADA: me enfermé]' },
    })
    expect(mockRelease).toHaveBeenCalledWith(tx, 'b1', 'cancelled')
    expect(tx.payment.updateMany).toHaveBeenCalledWith({
      where: { bookingId: 'b1', ...declaredTransferPaymentWhere },
      data: { status: 'cancelled' },
    })
  })

  it('sin reason conserva internalNotes tal cual', async () => {
    const tx = makeTx()
    await cancelBookingInTx(tx as never, { id: 'b1', internalNotes: null }, {})
    expect(tx.booking.update).toHaveBeenCalledWith({
      where: { id: 'b1' },
      data: { status: 'cancelled', internalNotes: null },
    })
  })
})
