import { describe, it, expect, vi } from 'vitest'
import { BookingStatus } from '@prisma/client'

// El reply-to sale de una query REAL sobre el prisma global (no el db
// inyectado); sin este mock, el aviso de coordinación manual pegaría contra
// la base en un test unitario.
vi.mock('@/lib/notifications', () => ({
  getBusinessReplyToEmail: vi.fn().mockResolvedValue(null),
  sendNotificationSafely: vi.fn(async (_label: string, fn: () => Promise<unknown>) => fn()),
  sendBankTransferExpiredToCustomer: vi.fn(),
  sendManualHoldExpiredToCustomer: vi.fn(),
  sendBookingCancelledNotification: vi.fn(),
}))

const { expireStaleHolds } = await import('@/lib/cron/expire-holds')

describe('expireStaleHolds', () => {
  function makeDb(overrides: Record<string, any> = {}): any {
    // tx.booking.updateMany is the one whose result drives `expired`.
    const updateMany = vi.fn().mockResolvedValue(overrides.updateMany ?? { count: 0 })
    const tx = {
      // booking.findMany (post-updateMany) = qué reservas transicionaron a expired;
      // [] por defecto = ninguna transferencia declarada que cancelar.
      booking: { updateMany, findMany: vi.fn().mockResolvedValue(overrides.expiredNow ?? []) },
      payment: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      promotionRedemption: {
        // No applied redemptions on the expired holds by default.
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      promotion: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      packagePurchase: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    }
    return {
      booking: {
        // El cron hace DOS barridos de reservas: primero las solicitudes sin
        // responder (pending_confirmation) y después los holds de pago. El mock
        // despacha por status para que un test de holds no se coma sus propias
        // filas en el sweep de solicitudes.
        findMany: vi.fn().mockImplementation(async (args: any) =>
          args?.where?.status === BookingStatus.pending_confirmation
            ? (overrides.requestsFindMany ?? [])
            // El aviso post-sweep a las reservas de coordinación manual filtra
            // por paymentMethod: 'manual'.
            : args?.where?.paymentMethod === 'manual'
              ? (overrides.manualFindMany ?? [])
              : (overrides.findMany ?? []),
        ),
        // Exposed so assertions can target the booking.updateMany inside the tx.
        updateMany,
      },
      packagePurchase: {
        findMany: vi.fn().mockResolvedValue(overrides.packagesFindMany ?? []),
      },
      $transaction: (fn: any) => fn(tx),
    }
  }

  it('returns 0 when no stale holds exist', async () => {
    const db = makeDb()
    const result = await expireStaleHolds(new Date(), db)

    expect(result.expired).toBe(0)
    expect(result.businessIds).toEqual([])
    expect(db.booking.updateMany).not.toHaveBeenCalled()
  })

  it('expires stale holds and returns count', async () => {
    const db = makeDb({
      findMany: [
        { id: 'b1', businessId: 'biz-1' },
        { id: 'b2', businessId: 'biz-1' },
      ],
      updateMany: { count: 2 },
    })

    const now = new Date('2026-05-20T12:00:00Z')
    const result = await expireStaleHolds(now, db)

    expect(result.expired).toBe(2)
    expect(result.businessIds).toEqual(['biz-1'])
    expect(db.booking.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['b1', 'b2'] },
        status: BookingStatus.pending_payment,
        paymentStatus: 'unpaid',
        holdExpiresAt: { lt: now },
      },
      data: { status: BookingStatus.expired },
    })
  })

  // Coordinación manual: la clienta no abandonó un checkout — el negocio no
  // confirmó a tiempo. A ella hay que avisarle; el sweep de MP sigue mudo.
  it('avisa a la clienta de coordinación manual cuando su ventana expira', async () => {
    const db = makeDb({
      // paymentMethod viaja en el select de candidatos: es lo que decide si
      // la query de avisos manuales corre siquiera.
      findMany: [{ id: 'b1', businessId: 'biz-1', paymentMethod: 'manual' }],
      updateMany: { count: 1 },
      manualFindMany: [{
        id: 'b1',
        businessId: 'biz-1',
        bookingNumber: 4738,
        startDateTime: new Date('2026-08-10T14:00:00Z'),
        customer: { name: 'Ana', email: 'ana@test.com' },
        service: { name: 'Manicure' },
        business: { name: 'Mimos Nails', timezone: 'America/Santiago' },
      }],
    })
    const deps = {
      sendExpiredEmail: vi.fn().mockResolvedValue({ success: true }),
      sendManualExpiredEmail: vi.fn().mockResolvedValue({ success: true }),
      sendCancelledEmail: vi.fn().mockResolvedValue({ success: true }),
    }

    await expireStaleHolds(new Date('2026-08-03T12:00:00Z'), db, deps)

    expect(deps.sendManualExpiredEmail).toHaveBeenCalledTimes(1)
    expect(deps.sendManualExpiredEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        customerEmail: 'ana@test.com',
        businessName: 'Mimos Nails',
        serviceName: 'Manicure',
        bookingNumber: 4738,
      }),
    )
    expect(deps.sendExpiredEmail).not.toHaveBeenCalled()
  })

  it('sin reservas de coordinación manual no manda nada', async () => {
    const db = makeDb({
      findMany: [{ id: 'b1', businessId: 'biz-1' }],
      updateMany: { count: 1 },
    })
    const deps = {
      sendExpiredEmail: vi.fn().mockResolvedValue({ success: true }),
      sendManualExpiredEmail: vi.fn().mockResolvedValue({ success: true }),
      sendCancelledEmail: vi.fn().mockResolvedValue({ success: true }),
    }

    await expireStaleHolds(new Date(), db, deps)

    expect(deps.sendManualExpiredEmail).not.toHaveBeenCalled()
  })

  it('reports lower count if a race occurred (payment processed between find and update)', async () => {
    const db = makeDb({
      findMany: [
        { id: 'b1', businessId: 'biz-1' },
        { id: 'b2', businessId: 'biz-1' },
      ],
      updateMany: { count: 1 },
    })

    const result = await expireStaleHolds(new Date(), db)

    expect(result.expired).toBe(1)
    expect(result.businessIds).toEqual(['biz-1'])
  })

  it('deduplicates businessIds for revalidation', async () => {
    const db = makeDb({
      findMany: [
        { id: 'b1', businessId: 'biz-1' },
        { id: 'b2', businessId: 'biz-2' },
        { id: 'b3', businessId: 'biz-1' },
      ],
      updateMany: { count: 3 },
    })

    const result = await expireStaleHolds(new Date(), db)

    expect(result.businessIds).toEqual(['biz-1', 'biz-2'])
  })
})
