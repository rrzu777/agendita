import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUpsert } = vi.hoisted(() => ({ mockUpsert: vi.fn() }))
vi.mock('@/lib/db', () => ({ prisma: { user: { upsert: mockUpsert } } }))

import { Prisma } from '@prisma/client'
import { ensureUserRow, AccountConflictError } from '@/lib/auth/ensure-user-row'

describe('ensureUserRow', () => {
  beforeEach(() => vi.clearAllMocks())

  it('upserts by supabase id with email and name from metadata', async () => {
    mockUpsert.mockResolvedValue({})
    await ensureUserRow({ id: 'auth-1', email: 'ana@example.com', user_metadata: { full_name: 'Ana Pérez' } })
    expect(mockUpsert).toHaveBeenCalledWith({
      where: { id: 'auth-1' },
      update: {},
      create: { id: 'auth-1', email: 'ana@example.com', name: 'Ana Pérez' },
    })
  })

  it('is idempotent (upsert update is a no-op, never overwrites)', async () => {
    mockUpsert.mockResolvedValue({})
    await ensureUserRow({ id: 'auth-1', email: 'ana@example.com', user_metadata: null })
    expect(mockUpsert.mock.calls[0][0].update).toEqual({})
  })

  it('throws AccountConflictError on unique-email collision (P2002)', async () => {
    mockUpsert.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('conflict', { code: 'P2002', clientVersion: 'x' }),
    )
    await expect(ensureUserRow({ id: 'auth-2', email: 'dueña@example.com', user_metadata: null }))
      .rejects.toBeInstanceOf(AccountConflictError)
  })

  it('throws AccountConflictError when the session user has no email', async () => {
    await expect(ensureUserRow({ id: 'auth-3', email: null, user_metadata: null }))
      .rejects.toBeInstanceOf(AccountConflictError)
    expect(mockUpsert).not.toHaveBeenCalled()
  })
})
