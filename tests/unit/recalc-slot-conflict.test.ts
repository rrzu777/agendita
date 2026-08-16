import { beforeAll, describe, it, expect, vi, beforeEach } from 'vitest'
import { BookingStatus } from '@prisma/client'

// El chequeo de cupo se mockea a propósito: acá se prueba la DECISIÓN (¿confirma o
// no?, ¿pregunta o no?), no la query de solape. Que la query encuentre de verdad
// una reserva pisada lo cubre tests/integration/booking-slot-race.integration.test.ts.
const findSlotConflictMock = vi.fn()
vi.mock('@/lib/availability/validation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/availability/validation')>()),
  findSlotConflict: findSlotConflictMock,
}))

const FUTURO = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
const PASADO = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

function bookingPendiente(overrides: Record<string, unknown> = {}) {
  return {
    id: 'b1',
    status: BookingStatus.pending_payment,
    businessId: 'biz',
    customerId: 'c1',
    startDateTime: FUTURO,
    endDateTime: new Date(FUTURO.getTime() + 60 * 60 * 1000),
    totalPrice: 10000,
    depositRequired: 5000,
    depositPaid: 0,
    remainingBalance: 10000,
    finalAmount: 10000,
    paymentStatus: 'unpaid',
    ...overrides,
  }
}

function makeTx(booking: Record<string, unknown>, aprobados: Array<Record<string, unknown>>) {
  return {
    booking: {
      findUnique: vi.fn(async () => booking),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...booking, ...data })),
      // count: 1 = ganó la carrera del flip atómico.
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    payment: {
      findMany: vi.fn(async () => aprobados),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    business: { findUnique: vi.fn(async () => ({ timezone: 'America/Santiago' })) },
  }
}

const ABONO_SUFICIENTE = [{ id: 'p1', amount: 5000, paymentType: 'deposit' }]
let recalcBookingFromPayments: typeof import('@/server/services/finance')['recalcBookingFromPayments']

beforeAll(async () => {
  ({ recalcBookingFromPayments } = await import('@/server/services/finance'))
})

describe('recalcBookingFromPayments — no confirma sobre un horario ocupado', () => {
  beforeEach(() => {
    findSlotConflictMock.mockReset()
  })

  it('con el horario libre confirma igual que siempre', async () => {
    findSlotConflictMock.mockResolvedValue(null)
    const tx = makeTx(bookingPendiente(), ABONO_SUFICIENTE)

    const res = await recalcBookingFromPayments(tx as never, 'b1')

    expect(res.wasConfirmed).toBe(true)
    expect(res.slotConflict).toBeNull()
    expect(tx.booking.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: BookingStatus.confirmed }),
    }))
  })

  it('con el horario tomado NO confirma, pero deja la plata asentada', async () => {
    findSlotConflictMock.mockResolvedValue({ reason: 'booking_overlap', overlappingBookingIds: ['otra-reserva'] })
    const tx = makeTx(bookingPendiente(), ABONO_SUFICIENTE)

    const res = await recalcBookingFromPayments(tx as never, 'b1')

    // Lo que NO pasa: el flip a confirmed. Sin esta línea el test pasaría igual
    // aunque la reserva se confirmara, porque los montos se escriben en los dos casos.
    expect(tx.booking.updateMany).not.toHaveBeenCalled()
    expect(res.wasConfirmed).toBe(false)
    expect(res.slotConflict).toEqual({ reason: 'booking_overlap', overlappingBookingIds: ['otra-reserva'] })
    // La plata sí queda registrada: el cobro es real y no se deshace desde acá.
    expect(tx.booking.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ depositPaid: 5000, remainingBalance: 5000 }),
    }))
    expect(res.booking.depositPaid).toBe(5000)
    expect(res.booking.status).toBe(BookingStatus.pending_payment)
  })

  it('un turno que ya pasó no se re-valida: no hay cupo que proteger', async () => {
    const tx = makeTx(bookingPendiente({ startDateTime: PASADO, endDateTime: new Date(PASADO.getTime() + 3600_000) }), ABONO_SUFICIENTE)

    const res = await recalcBookingFromPayments(tx as never, 'b1')

    expect(findSlotConflictMock).not.toHaveBeenCalled()
    expect(res.wasConfirmed).toBe(true)
  })

  it('un recálculo que no iba a confirmar tampoco consulta el cupo', async () => {
    const tx = makeTx(bookingPendiente({ status: BookingStatus.confirmed }), ABONO_SUFICIENTE)

    const res = await recalcBookingFromPayments(tx as never, 'b1')

    expect(findSlotConflictMock).not.toHaveBeenCalled()
    expect(res.slotConflict).toBeNull()
  })

  it('excluye la propia reserva del chequeo: su hold no compite consigo mismo', async () => {
    findSlotConflictMock.mockResolvedValue(null)
    const tx = makeTx(bookingPendiente(), ABONO_SUFICIENTE)

    await recalcBookingFromPayments(tx as never, 'b1')

    expect(findSlotConflictMock).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz',
      excludeBookingId: 'b1',
      timezone: 'America/Santiago',
    }))
  })
})
