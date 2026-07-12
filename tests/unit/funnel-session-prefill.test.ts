import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetCurrentUser, mockFindFirst } = vi.hoisted(() => ({
  mockGetCurrentUser: vi.fn(),
  mockFindFirst: vi.fn(),
}))
vi.mock('@/lib/auth/user', () => ({ getCurrentUser: mockGetCurrentUser }))
vi.mock('@/lib/db', () => ({ prisma: { customer: { findFirst: mockFindFirst } } }))

import { getFunnelSession } from '@/lib/customers/session-prefill'

describe('getFunnelSession', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sin sesión → null', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    expect(await getFunnelSession('b1')).toBeNull()
    expect(mockFindFirst).not.toHaveBeenCalled()
  })

  it('con sesión y Customer vinculada: prefill desde la Customer más antigua', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: 'u1', email: 'maria@example.com', user_metadata: { name: 'Maria Meta' } })
    mockFindFirst.mockResolvedValue({ name: 'Maria Cliente', phone: '+56911111111' })
    const s = await getFunnelSession('b1')
    expect(s).toEqual({ email: 'maria@example.com', name: 'Maria Cliente', phone: '+56911111111', hasCustomer: true })
    expect(mockFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { businessId: 'b1', userId: 'u1' },
      orderBy: { createdAt: 'asc' },
    }))
  })

  it('con sesión sin Customer: nombre desde user_metadata, teléfono vacío, hasCustomer false', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: 'u1', email: 'maria@example.com', user_metadata: { name: 'Maria Meta' } })
    mockFindFirst.mockResolvedValue(null)
    const s = await getFunnelSession('b1')
    expect(s).toEqual({ email: 'maria@example.com', name: 'Maria Meta', phone: '', hasCustomer: false })
  })

  it('sesión sin email (borde) → null', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: 'u1', email: undefined, user_metadata: {} })
    expect(await getFunnelSession('b1')).toBeNull()
  })
})
