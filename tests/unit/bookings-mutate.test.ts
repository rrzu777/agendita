import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRelease } = vi.hoisted(() => ({ mockRelease: vi.fn() }))
vi.mock('@/lib/promotions/release', () => ({ releaseRedemptionForBooking: mockRelease }))

const { mockAssertSlot } = vi.hoisted(() => ({ mockAssertSlot: vi.fn() }))
vi.mock('@/lib/availability/validation', () => ({ assertSlotIsAvailable: mockAssertSlot }))

import { cancelBookingInTx, rescheduleBookingInTx } from '@/lib/bookings/mutate'
import { anyDeclaredTransferWhere } from '@/lib/bank-transfer/declared'

function makeTx() {
  return {
    booking: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    payment: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
  }
}

describe('cancelBookingInTx', () => {
  beforeEach(() => vi.clearAllMocks())

  it('flip a cancelled (guardado por status) + release + cierra bt-declared pendiente', async () => {
    const tx = makeTx()
    await cancelBookingInTx(tx as never, { id: 'b1', internalNotes: 'nota' }, { reason: 'me enfermé' })
    expect(tx.booking.updateMany).toHaveBeenCalledWith({
      where: { id: 'b1', status: { notIn: ['completed', 'cancelled'] } },
      data: { status: 'cancelled', internalNotes: 'nota\n[CANCELADA: me enfermé]' },
    })
    expect(mockRelease).toHaveBeenCalledWith(tx, 'b1', 'cancelled')
    expect(tx.payment.updateMany).toHaveBeenCalledWith({
      where: { bookingId: 'b1', ...anyDeclaredTransferWhere },
      data: { status: 'cancelled' },
    })
  })

  it('sin reason conserva internalNotes tal cual', async () => {
    const tx = makeTx()
    await cancelBookingInTx(tx as never, { id: 'b1', internalNotes: null }, {})
    expect(tx.booking.updateMany).toHaveBeenCalledWith({
      where: { id: 'b1', status: { notIn: ['completed', 'cancelled'] } },
      data: { status: 'cancelled', internalNotes: null },
    })
  })

  it('lanza si el updateMany no matchea (carrera: se completó entre el read y la tx) y no libera nada', async () => {
    const tx = makeTx()
    tx.booking.updateMany.mockResolvedValue({ count: 0 })
    await expect(cancelBookingInTx(tx as never, { id: 'b1', internalNotes: null }, {})).rejects.toThrow('No se puede cancelar')
    expect(mockRelease).not.toHaveBeenCalled()
    expect(tx.payment.updateMany).not.toHaveBeenCalled()
  })
})

describe('rescheduleBookingInTx', () => {
  beforeEach(() => vi.clearAllMocks())

  const baseInput = {
    booking: {
      id: 'b1', businessId: 'biz1', serviceId: 's1',
      startDateTime: new Date('2026-07-20T15:00:00Z'), internalNotes: null,
    },
    newStartDateTime: new Date('2026-07-21T15:00:00Z'),
    durationMinutes: 60,
    timezone: 'America/Santiago',
  }

  it('valida slot y actualiza con guard de status', async () => {
    const tx = { booking: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } }
    await rescheduleBookingInTx(tx as never, { ...baseInput, leadTimeMinutes: 0 })
    expect(mockAssertSlot).toHaveBeenCalledWith(expect.objectContaining({
      tx, businessId: 'biz1', serviceId: 's1',
      startDateTime: baseInput.newStartDateTime,
      endDateTime: new Date('2026-07-21T16:00:00Z'),
      excludeBookingId: 'b1', leadTimeMinutes: 0,
    }))
    expect(tx.booking.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'b1', businessId: 'biz1' }),
      data: expect.objectContaining({
        startDateTime: baseInput.newStartDateTime,
        endDateTime: new Date('2026-07-21T16:00:00Z'),
      }),
    }))
  })

  it('lanza si el updateMany no matchea (carrera de status)', async () => {
    const tx = { booking: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) } }
    await expect(rescheduleBookingInTx(tx as never, baseInput)).rejects.toThrow('No se puede reprogramar')
  })

  it('la nota REPROGRAMADA usa la fecha local del negocio, no la del server', async () => {
    // 2026-07-21T02:00:00Z = 2026-07-20 22:00 en Santiago (UTC-4). Con la TZ del
    // server (UTC) saldría "21-07"; con la del negocio, "20-07 22:00".
    const tx = { booking: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } }
    await rescheduleBookingInTx(tx as never, {
      ...baseInput,
      booking: { ...baseInput.booking, startDateTime: new Date('2026-07-21T02:00:00Z'), internalNotes: null },
      leadTimeMinutes: 0,
    })
    expect(tx.booking.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ internalNotes: '[REPROGRAMADA de 20-07-2026 22:00]' }),
    }))
  })
})
