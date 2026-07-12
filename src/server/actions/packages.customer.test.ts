import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/server', () => ({
  requireBusinessRole: vi.fn().mockResolvedValue({ businessId: 'b1', user: { id: 'u1' } }),
  ForbiddenError: class extends Error {},
}))
const findMany = vi.fn()
vi.mock('@/lib/db', () => ({ prisma: { packagePurchase: { findMany: (...a: unknown[]) => findMany(...a) } } }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ success: true }) }))

import { getCustomerPackages } from './packages'

describe('getCustomerPackages', () => {
  beforeEach(() => findMany.mockReset())
  it('incluye pending/expired en el panel de la dueña', async () => {
    findMany.mockResolvedValue([])
    await getCustomerPackages('c1')
    const arg = findMany.mock.calls[0][0]
    expect(arg.where.status).toEqual({ in: ['active', 'refunded', 'pending', 'expired'] })
  })
})
