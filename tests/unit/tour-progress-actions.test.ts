import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { UserError } from '@/lib/actions/result'
import type { TourKey, TourProgressEvent } from '@/lib/tours/catalog'

const mocks = vi.hoisted(() => ({
  requireBusinessRole: vi.fn(),
  transaction: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  upsert: vi.fn(),
  advisoryLock: vi.fn(),
}))

const tx = {
  userTourProgress: {
    findUnique: mocks.findUnique,
    upsert: mocks.upsert,
  },
}

vi.mock('@/lib/auth/server', () => ({
  requireBusinessRole: mocks.requireBusinessRole,
}))

vi.mock('@/lib/db/advisory-lock', () => ({
  acquireAdvisoryXactLock: mocks.advisoryLock,
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    userTourProgress: { findMany: mocks.findMany },
    $transaction: mocks.transaction,
  },
}))

const { getTourProgress, recordTourProgress } = await import('@/server/actions/tour-progress')

describe('tour progress actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireBusinessRole.mockResolvedValue({
      businessId: 'business-1',
      role: 'owner',
      user: { id: 'user-1' },
    })
    mocks.transaction.mockImplementation(async (callback) => callback(tx))
    mocks.findMany.mockResolvedValue([])
    mocks.findUnique.mockResolvedValue(null)
    mocks.upsert.mockImplementation(async ({ create }) => ({
      ...create,
      id: 'progress-1',
      updatedAt: new Date('2026-08-22T18:00:00.000Z'),
    }))
  })

  it('exposes an input contract without client-controlled user or business ids', () => {
    type ExpectedInput = {
      key: TourKey
      version: number
      event: TourProgressEvent
    }

    expectTypeOf<Parameters<typeof recordTourProgress>[0]>()
      .toEqualTypeOf<ExpectedInput>()
  })

  it('derives scope from auth and locks before reading and upserting', async () => {
    const result = await recordTourProgress({
      key: 'bookings',
      version: 1,
      event: { type: 'start' },
      userId: 'attacker-user',
      businessId: 'attacker-business',
    } as never)

    expect(result).toEqual({
      ok: true,
      data: {
        key: 'bookings',
        version: 1,
        status: 'in_progress',
        lastStep: 0,
      },
    })
    expect(mocks.requireBusinessRole).toHaveBeenCalledWith(['owner', 'admin'])
    expect(mocks.advisoryLock).toHaveBeenCalledWith(
      tx,
      'tour:user-1:business-1:bookings:1',
    )
    expect(mocks.advisoryLock.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.findUnique.mock.invocationCallOrder[0])
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: {
        userId_businessId_tourKey_tourVersion: {
          userId: 'user-1',
          businessId: 'business-1',
          tourKey: 'bookings',
          tourVersion: 1,
        },
      },
    })
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        userId_businessId_tourKey_tourVersion: {
          userId: 'user-1',
          businessId: 'business-1',
          tourKey: 'bookings',
          tourVersion: 1,
        },
      },
      create: expect.objectContaining({
        userId: 'user-1',
        businessId: 'business-1',
      }),
    }))
  })

  it('reads only current catalog progress for the authenticated scope', async () => {
    mocks.findMany.mockResolvedValue([{
      tourKey: 'payments',
      tourVersion: 1,
      status: 'completed',
      lastStep: 3,
    }])

    await expect(getTourProgress()).resolves.toEqual({
      ok: true,
      data: [{
        key: 'payments',
        version: 1,
        status: 'completed',
        lastStep: 3,
      }],
    })
    expect(mocks.requireBusinessRole).toHaveBeenCalledWith(['owner', 'admin'])
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        userId: 'user-1',
        businessId: 'business-1',
      }),
    }))
  })

  it.each([
    ['unknown tour key', { key: 'other', version: 1, event: { type: 'start' } }],
    ['wrong version', { key: 'bookings', version: 2, event: { type: 'start' } }],
    ['negative step', { key: 'bookings', version: 1, event: { type: 'step', step: -1 } }],
    ['fractional step', { key: 'bookings', version: 1, event: { type: 'step', step: 1.5 } }],
    ['out-of-range step', {
      key: 'bookings', version: 1, event: { type: 'step', step: 2_147_483_648 },
    }],
  ])('rejects %s before opening a transaction', async (_name, input) => {
    const result = await recordTourProgress(input as never)

    expect(result).toEqual({ ok: false, error: expect.any(String) })
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('rejects a staff context before database mutation', async () => {
    mocks.requireBusinessRole.mockResolvedValue({
      businessId: 'business-1',
      role: 'staff',
      user: { id: 'user-1' },
    })

    const result = await recordTourProgress({
      key: 'settings',
      version: 1,
      event: { type: 'start' },
    })

    expect(result).toEqual({ ok: false, error: expect.any(String) })
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('returns completed progress without writing when a stale step arrives', async () => {
    const completedAt = new Date('2026-08-22T17:00:00.000Z')
    mocks.findUnique.mockResolvedValue({
      id: 'progress-1',
      userId: 'user-1',
      businessId: 'business-1',
      tourKey: 'bookings',
      tourVersion: 1,
      status: 'completed',
      lastStep: 3,
      offeredAt: null,
      startedAt: new Date('2026-08-22T16:00:00.000Z'),
      completedAt,
      dismissedAt: null,
      updatedAt: completedAt,
    })
    const result = await recordTourProgress({
      key: 'bookings',
      version: 1,
      event: { type: 'step', step: 1 },
    })

    expect(result).toEqual({
      ok: true,
      data: { key: 'bookings', version: 1, status: 'completed', lastStep: 3 },
    })
    expect(mocks.advisoryLock).toHaveBeenCalledWith(
      tx,
      'tour:user-1:business-1:bookings:1',
    )
    expect(mocks.advisoryLock.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.findUnique.mock.invocationCallOrder[0])
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('returns completed progress without writing for duplicate completion', async () => {
    const original = new Date('2026-08-22T17:00:00.000Z')
    mocks.findUnique.mockResolvedValue({
      status: 'completed',
      lastStep: 3,
      offeredAt: null,
      startedAt: null,
      completedAt: original,
      dismissedAt: null,
    })
    await expect(recordTourProgress({
      key: 'bookings', version: 1, event: { type: 'complete' },
    })).resolves.toEqual({
      ok: true,
      data: { key: 'bookings', version: 1, status: 'completed', lastStep: 3 },
    })
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('returns dismissed progress without writing for duplicate dismissal', async () => {
    mocks.findUnique.mockResolvedValue({
      status: 'dismissed',
      lastStep: 1,
      offeredAt: null,
      startedAt: null,
      completedAt: null,
      dismissedAt: new Date('2026-08-22T17:00:00.000Z'),
    })

    await expect(recordTourProgress({
      key: 'settings', version: 1, event: { type: 'dismiss' },
    })).resolves.toEqual({
      ok: true,
      data: { key: 'settings', version: 1, status: 'dismissed', lastStep: 1 },
    })
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('still upserts legal non-terminal step progression', async () => {
    mocks.findUnique.mockResolvedValue({
      status: 'in_progress',
      lastStep: 2,
      offeredAt: null,
      startedAt: new Date('2026-08-22T16:00:00.000Z'),
      completedAt: null,
      dismissedAt: null,
    })
    mocks.upsert.mockResolvedValue({ status: 'in_progress', lastStep: 3 })

    await expect(recordTourProgress({
      key: 'bookings', version: 1, event: { type: 'step', step: 3 },
    })).resolves.toEqual({
      ok: true,
      data: { key: 'bookings', version: 1, status: 'in_progress', lastStep: 3 },
    })
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ status: 'in_progress', lastStep: 3 }),
    }))
  })

  it('surfaces user validation errors through the action result boundary', async () => {
    mocks.requireBusinessRole.mockRejectedValue(new UserError('No autorizado'))

    await expect(recordTourProgress({
      key: 'dashboard_intro', version: 1, event: { type: 'offer' },
    })).resolves.toEqual({ ok: false, error: 'No autorizado' })
  })
})
