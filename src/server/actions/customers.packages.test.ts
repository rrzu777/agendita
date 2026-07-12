import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/server', () => ({
  requireBusiness: vi.fn().mockResolvedValue({ businessId: 'b1' }),
  requireBusinessRole: vi.fn().mockResolvedValue({ businessId: 'b1' }),
  ForbiddenError: class extends Error {},
}))

const paymentFindMany = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    customer: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'c1',
        name: 'Ana',
        phone: 'x',
        email: null,
        notes: null,
        birthDate: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    },
    booking: {
      findMany: vi.fn().mockResolvedValue([]),
      aggregate: vi.fn().mockResolvedValue({ _count: { id: 0 }, _max: {}, _sum: {} }),
    },
    payment: {
      findMany: (...a: unknown[]) => paymentFindMany(...a),
      aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 0 } }),
    },
  },
}))

import { getCustomerDetail } from './customers'

describe('getCustomerDetail — historial de pagos', () => {
  beforeEach(() => paymentFindMany.mockReset())

  it('excluye package_purchase pending del listado de pagos', async () => {
    paymentFindMany.mockResolvedValue([])
    await getCustomerDetail('c1')
    const where = paymentFindMany.mock.calls[0][0].where
    expect(JSON.stringify(where)).toContain('package_purchase')
  })
})
