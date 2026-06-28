import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPrisma = {
  timeBlock: {
    create: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    deleteMany: vi.fn(),
  },
  booking: {
    findMany: vi.fn(),
  },
}

vi.mock('@/lib/db', () => ({
  prisma: mockPrisma,
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock('@/lib/auth/server', () => ({
  requireBusiness: vi.fn().mockResolvedValue({ businessId: 'biz-1' }),
  requireBusinessRole: vi.fn().mockResolvedValue({
    business: { id: 'biz-1', timezone: 'America/Santiago' },
    businessId: 'biz-1',
  }),
  ForbiddenError: class extends Error {
    constructor(msg: string) {
      super(msg)
      this.name = 'ForbiddenError'
    }
  },
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/server/actions/revalidate-business', () => ({
  revalidateBusinessPublicPaths: vi.fn().mockResolvedValue(undefined),
}))

const { createTimeBlock, deleteTimeBlock } = await import('@/server/actions/time-blocks')

const baseInput = {
  startDateTime: new Date('2026-06-01T09:00:00Z'),
  endDateTime: new Date('2026-06-01T10:00:00Z'),
  reason: 'Test block',
  confirmOverlap: false,
}

describe('createTimeBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.timeBlock.create.mockResolvedValue({
      id: 'block-1',
      businessId: 'biz-1',
      startDateTime: baseInput.startDateTime,
      endDateTime: baseInput.endDateTime,
      reason: baseInput.reason,
    })
    mockPrisma.booking.findMany.mockResolvedValue([])
    mockPrisma.timeBlock.deleteMany.mockResolvedValue({ count: 1 })
  })

  it('creates a time block when no overlap', async () => {
    const result = await createTimeBlock(baseInput)

    expect(result.id).toBe('block-1')
    expect(mockPrisma.timeBlock.create).toHaveBeenCalledTimes(1)
  })

  it('returns requiresConfirmation (no throw, no 500) when overlapping and confirmOverlap is false', async () => {
    mockPrisma.booking.findMany.mockResolvedValue([{ id: 'booking-1' }])

    const result = await createTimeBlock({ ...baseInput, confirmOverlap: false })

    expect(result).toEqual({
      requiresConfirmation: true,
      message: expect.stringMatching(/solapa con reservas/),
    })
    expect(mockPrisma.timeBlock.create).not.toHaveBeenCalled()
  })

  it('creates block when overlapping bookings exist and confirmOverlap is true', async () => {
    mockPrisma.booking.findMany.mockResolvedValue([{ id: 'booking-1' }])

    const result = await createTimeBlock({ ...baseInput, confirmOverlap: true })

    expect(result.id).toBe('block-1')
    expect(mockPrisma.timeBlock.create).toHaveBeenCalledTimes(1)
  })

  it('rejects when end is before start', async () => {
    await expect(
      createTimeBlock({
        ...baseInput,
        startDateTime: new Date('2026-06-01T10:00:00Z'),
        endDateTime: new Date('2026-06-01T09:00:00Z'),
      }),
    ).rejects.toThrow(/fecha de fin debe ser posterior/)
  })

  it('rejects when duration exceeds 32 days', async () => {
    await expect(
      createTimeBlock({
        ...baseInput,
        startDateTime: new Date('2026-06-01T00:00:00Z'),
        endDateTime: new Date('2026-07-05T00:00:00Z'),
      }),
    ).rejects.toThrow(/duración máxima/)
  })

  it('does not affect other businesses', async () => {
    mockPrisma.booking.findMany.mockResolvedValue([])

    await createTimeBlock(baseInput)

    const createCall = mockPrisma.timeBlock.create.mock.calls[0][0]
    expect(createCall.data.businessId).toBe('biz-1')
  })

  it('overlap check is scoped to businessId', async () => {
    mockPrisma.booking.findMany.mockResolvedValue([{ id: 'booking-1' }])

    await createTimeBlock({ ...baseInput, confirmOverlap: true })

    const findManyCall = mockPrisma.booking.findMany.mock.calls[0][0]
    expect(findManyCall.where.businessId).toBe('biz-1')
    expect(findManyCall.where.status.in).toEqual(['pending_payment', 'confirmed', 'completed'])
  })

  it('only checks active bookings for overlap', async () => {
    mockPrisma.booking.findMany.mockResolvedValue([])

    await createTimeBlock({ ...baseInput, confirmOverlap: false })

    const findManyCall = mockPrisma.booking.findMany.mock.calls[0][0]
    expect(findManyCall.where.status.in).not.toContain('cancelled')
    expect(findManyCall.where.status.in).not.toContain('expired')
    expect(findManyCall.where.status.in).not.toContain('no_show')
  })
})

describe('deleteTimeBlock', () => {
  it('deletes a time block for the current business', async () => {
    await deleteTimeBlock('block-1')

    expect(mockPrisma.timeBlock.deleteMany).toHaveBeenCalledWith({
      where: { id: 'block-1', businessId: 'biz-1' },
    })
  })

  it('throws ForbiddenError when block not found', async () => {
    mockPrisma.timeBlock.deleteMany.mockResolvedValue({ count: 0 })

    await expect(deleteTimeBlock('nonexistent')).rejects.toThrow('Bloque no encontrado')
  })

  it('revalidates paths after creation', async () => {
    const { revalidatePath } = await import('next/cache')
    mockPrisma.booking.findMany.mockResolvedValue([])

    await createTimeBlock(baseInput)

    expect(revalidatePath).toHaveBeenCalledWith('/dashboard/calendar')
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard/availability')
  })
})
