import { describe, it, expect, vi } from 'vitest'
import { createGrantInTx } from '@/lib/loyalty/grant'

function fakeTx(created: any = { id: 'g1', code: 'ABC' }) {
  return {
    promotion: { findFirst: vi.fn().mockResolvedValue(null) },
    promotionGrant: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(created),
    },
  } as any
}

describe('createGrantInTx', () => {
  it('genera código y crea el grant con los defaults (pointsSpent 0, activo, sin refund/forfeit)', async () => {
    const tx = fakeTx()
    const grant = await createGrantInTx(tx, {
      businessId: 'b1', promotionId: 'p1', customerId: 'c1', requestId: 'r1',
    })
    expect(grant).toEqual({ id: 'g1', code: 'ABC' })
    expect(tx.promotionGrant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        businessId: 'b1', promotionId: 'p1', customerId: 'c1',
        code: expect.any(String), pointsSpent: 0, status: 'active',
        expiresAt: null, refundOnExpiry: false, forfeitOnNoShow: false,
        requestId: 'r1', createdByUserId: null,
      }),
    })
  })

  it('propaga los overrides (pointsSpent, flags, expiresAt y campos extra)', async () => {
    const tx = fakeTx()
    const exp = new Date('2030-01-01')
    await createGrantInTx(tx, {
      businessId: 'b1', promotionId: 'p1', customerId: 'c1', requestId: 'r2',
      pointsSpent: 80, refundOnExpiry: true, forfeitOnNoShow: true,
      expiresAt: exp, createdByUserId: 'u1',
      triggeringBookingId: 'bk1', packagePurchaseId: 'pp1', metadata: { grantId: 'x' },
    })
    expect(tx.promotionGrant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        pointsSpent: 80, refundOnExpiry: true, forfeitOnNoShow: true,
        expiresAt: exp, createdByUserId: 'u1',
        triggeringBookingId: 'bk1', packagePurchaseId: 'pp1', metadata: { grantId: 'x' },
      }),
    })
  })
})
