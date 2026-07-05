import { describe, it, expect, vi, beforeEach } from 'vitest'
import { addDays } from 'date-fns'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

const mockPrisma = {
  timeBlock: {
    create: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  timeBlockSeries: {
    create: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  timeBlockException: {
    upsert: vi.fn(),
  },
  service: {
    findMany: vi.fn().mockResolvedValue([]),
  },
  availabilityRule: {
    findMany: vi.fn().mockResolvedValue([]),
  },
  booking: {
    findMany: vi.fn(),
  },
  $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
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

const {
  createTimeBlock,
  deleteTimeBlock,
  updateTimeBlock,
  createTimeBlockSeries,
  updateTimeBlockSeries,
  overrideSeriesOccurrence,
} = await import('@/server/actions/time-blocks')

const TZ = 'America/Santiago'

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
    expect(findManyCall.where.OR).toEqual([
      { status: { in: ['confirmed', 'completed'] } },
      expect.objectContaining({ status: 'pending_payment' }),
    ])
  })

  it('only checks active bookings for overlap, ignoring expired pending_payment holds', async () => {
    mockPrisma.booking.findMany.mockResolvedValue([])

    await createTimeBlock({ ...baseInput, confirmOverlap: false })

    const findManyCall = mockPrisma.booking.findMany.mock.calls[0][0]
    const statuses = findManyCall.where.OR.flatMap(
      (clause: { status: string | { in: string[] } }) =>
        typeof clause.status === 'string' ? [clause.status] : clause.status.in,
    )
    expect(statuses).not.toContain('cancelled')
    expect(statuses).not.toContain('expired')
    expect(statuses).not.toContain('no_show')

    // Un hold pending_payment ya expirado no cuenta como conflicto
    const pendingClause = findManyCall.where.OR.find(
      (clause: { status: string | { in: string[] } }) => clause.status === 'pending_payment',
    )
    expect(pendingClause.OR).toEqual([
      { holdExpiresAt: null },
      { holdExpiresAt: { gt: expect.any(Date) } },
    ])
  })

  it('appends the service-fit warning to the confirmation message when a service would fit nowhere', async () => {
    mockPrisma.booking.findMany.mockResolvedValue([{ id: 'booking-1' }])
    mockPrisma.service.findMany.mockResolvedValueOnce([
      { id: 'svc-1', name: 'CORTE', durationMinutes: 120, isActive: true },
    ])

    // Regla solo el día del bloqueo propuesto: 09:00-12:00 (180 min, el
    // servicio de 120 cabe hoy). El bloqueo 10:00-12:00 deja 60 min → no cabe.
    const day = addDays(new Date(), 3)
    const dayStr = formatInTimeZone(day, TZ, 'yyyy-MM-dd')
    const dow = Number(formatInTimeZone(day, TZ, 'i')) % 7
    mockPrisma.availabilityRule.findMany.mockResolvedValueOnce([
      { dayOfWeek: dow, startTime: '09:00', endTime: '12:00', isActive: true },
    ])

    const result = await createTimeBlock({
      ...baseInput,
      startDateTime: fromZonedTime(`${dayStr} 10:00:00`, TZ),
      endDateTime: fromZonedTime(`${dayStr} 12:00:00`, TZ),
      confirmOverlap: false,
    })

    expect(result).toEqual({
      requiresConfirmation: true,
      message: expect.stringMatching(/Además, con este bloqueo "CORTE" no cabría en ningún día\./),
    })
    expect(mockPrisma.timeBlock.create).not.toHaveBeenCalled()
  })
})

describe('createTimeBlockSeries', () => {
  const seriesInput = {
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    startTime: '12:00',
    endTime: '14:00',
    reason: 'Almuerzo',
    anchorDate: fromZonedTime(`${formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd')} 00:00:00`, TZ),
    endMode: 'forever' as const,
    weeks: null,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.booking.findMany.mockResolvedValue([])
    mockPrisma.timeBlockSeries.create.mockResolvedValue({ id: 'series-1', businessId: 'biz-1' })
  })

  it('creates the series when no bookings overlap', async () => {
    const result = await createTimeBlockSeries(seriesInput)

    expect('series' in result && result.series.id).toBe('series-1')
    expect('overlappingDates' in result && result.overlappingDates).toEqual([])
    expect(mockPrisma.timeBlockSeries.create).toHaveBeenCalledTimes(1)
  })

  it('returns requiresConfirmation WITHOUT creating when occurrences overlap bookings', async () => {
    const tomorrowStr = formatInTimeZone(addDays(new Date(), 1), TZ, 'yyyy-MM-dd')
    mockPrisma.booking.findMany.mockResolvedValue([
      {
        startDateTime: fromZonedTime(`${tomorrowStr} 12:30:00`, TZ),
        endDateTime: fromZonedTime(`${tomorrowStr} 13:00:00`, TZ),
      },
    ])

    const result = await createTimeBlockSeries(seriesInput)

    expect(result).toEqual({
      requiresConfirmation: true,
      message: expect.stringMatching(new RegExp(`se solapa con reservas existentes.*${tomorrowStr}`)),
    })
    expect(mockPrisma.timeBlockSeries.create).not.toHaveBeenCalled()
  })

  it('creates the series when confirmed despite overlaps, reporting the dates', async () => {
    const tomorrowStr = formatInTimeZone(addDays(new Date(), 1), TZ, 'yyyy-MM-dd')
    mockPrisma.booking.findMany.mockResolvedValue([
      {
        startDateTime: fromZonedTime(`${tomorrowStr} 12:30:00`, TZ),
        endDateTime: fromZonedTime(`${tomorrowStr} 13:00:00`, TZ),
      },
    ])

    const result = await createTimeBlockSeries({ ...seriesInput, confirmed: true })

    expect('series' in result && result.series.id).toBe('series-1')
    expect('overlappingDates' in result && result.overlappingDates).toContain(tomorrowStr)
    expect(mockPrisma.timeBlockSeries.create).toHaveBeenCalledTimes(1)
  })

  it('overlap query excludes expired pending_payment holds', async () => {
    await createTimeBlockSeries(seriesInput)

    const findManyCall = mockPrisma.booking.findMany.mock.calls[0][0]
    expect(findManyCall.where.businessId).toBe('biz-1')
    expect(findManyCall.where.OR).toEqual([
      { status: { in: ['confirmed', 'completed'] } },
      {
        status: 'pending_payment',
        OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: expect.any(Date) } }],
      },
    ])
  })
})

describe('updateTimeBlockSeries', () => {
  const existingSeries = {
    id: 'series-1',
    businessId: 'biz-1',
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    startTime: '12:00',
    endTime: '14:00',
    reason: 'Almuerzo',
    anchorDate: new Date('2026-01-01T03:00:00Z'),
    until: null,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.booking.findMany.mockResolvedValue([])
    mockPrisma.timeBlockSeries.findFirst.mockResolvedValue(existingSeries)
    mockPrisma.timeBlockSeries.update.mockResolvedValue(existingSeries)
    mockPrisma.timeBlockSeries.create.mockResolvedValue({ id: 'series-2', businessId: 'biz-1' })
  })

  it('splits the series when no bookings overlap the new schedule', async () => {
    const result = await updateTimeBlockSeries('series-1', { startTime: '13:00', endTime: '15:00' })

    expect('series' in result && result.series.id).toBe('series-2')
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
  })

  it('returns requiresConfirmation WITHOUT splitting when the new schedule overlaps bookings', async () => {
    const tomorrowStr = formatInTimeZone(addDays(new Date(), 1), TZ, 'yyyy-MM-dd')
    mockPrisma.booking.findMany.mockResolvedValue([
      {
        startDateTime: fromZonedTime(`${tomorrowStr} 13:30:00`, TZ),
        endDateTime: fromZonedTime(`${tomorrowStr} 14:30:00`, TZ),
      },
    ])

    const result = await updateTimeBlockSeries('series-1', { startTime: '13:00', endTime: '15:00' })

    expect(result).toEqual({
      requiresConfirmation: true,
      message: expect.stringMatching(/se solapa con reservas existentes/),
    })
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('splits the series when confirmed despite overlaps', async () => {
    const tomorrowStr = formatInTimeZone(addDays(new Date(), 1), TZ, 'yyyy-MM-dd')
    mockPrisma.booking.findMany.mockResolvedValue([
      {
        startDateTime: fromZonedTime(`${tomorrowStr} 13:30:00`, TZ),
        endDateTime: fromZonedTime(`${tomorrowStr} 14:30:00`, TZ),
      },
    ])

    const result = await updateTimeBlockSeries('series-1', {
      startTime: '13:00',
      endTime: '15:00',
      confirmed: true,
    })

    expect('series' in result && result.series.id).toBe('series-2')
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
  })
})

describe('overrideSeriesOccurrence', () => {
  const occurrenceDate = fromZonedTime('2026-08-03 00:00:00', TZ)
  const overrideData = {
    startDateTime: fromZonedTime('2026-08-03 12:00:00', TZ),
    endDateTime: fromZonedTime('2026-08-03 15:00:00', TZ),
    reason: 'Almuerzo largo',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.booking.findMany.mockResolvedValue([])
    mockPrisma.timeBlockSeries.findFirst.mockResolvedValue({ id: 'series-1', businessId: 'biz-1' })
    mockPrisma.timeBlockException.upsert.mockResolvedValue({})
  })

  it('saves the override when no bookings overlap the new range', async () => {
    const result = await overrideSeriesOccurrence('series-1', occurrenceDate, overrideData)

    expect(result).toBeUndefined()
    expect(mockPrisma.timeBlockException.upsert).toHaveBeenCalledTimes(1)
  })

  it('returns requiresConfirmation WITHOUT saving when the new range overlaps bookings', async () => {
    mockPrisma.booking.findMany.mockResolvedValue([{ id: 'booking-1' }])

    const result = await overrideSeriesOccurrence('series-1', occurrenceDate, overrideData)

    expect(result).toEqual({
      requiresConfirmation: true,
      message: expect.stringMatching(/se solapa con reservas existentes/),
    })
    expect(mockPrisma.timeBlockException.upsert).not.toHaveBeenCalled()
  })

  it('saves the override when confirmed despite overlaps', async () => {
    mockPrisma.booking.findMany.mockResolvedValue([{ id: 'booking-1' }])

    const result = await overrideSeriesOccurrence('series-1', occurrenceDate, {
      ...overrideData,
      confirmed: true,
    })

    expect(result).toBeUndefined()
    expect(mockPrisma.timeBlockException.upsert).toHaveBeenCalledTimes(1)
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

describe('updateTimeBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.timeBlock.findFirst.mockResolvedValue({
      id: 'block-1',
      businessId: 'biz-1',
      startDateTime: baseInput.startDateTime,
      endDateTime: baseInput.endDateTime,
      reason: baseInput.reason,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    })
    mockPrisma.timeBlock.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.booking.findMany.mockResolvedValue([])
  })

  it('updates a time block when no overlap and the time window changed', async () => {
    const result = await updateTimeBlock('block-1', {
      startDateTime: new Date('2026-06-01T11:00:00Z'),
      endDateTime: new Date('2026-06-01T12:00:00Z'),
      reason: 'Updated reason',
      confirmOverlap: false,
    })

    expect('id' in result && result.id).toBe('block-1')
    expect(mockPrisma.timeBlock.updateMany).toHaveBeenCalledWith({
      where: { id: 'block-1', businessId: 'biz-1' },
      data: {
        startDateTime: new Date('2026-06-01T11:00:00Z'),
        endDateTime: new Date('2026-06-01T12:00:00Z'),
        reason: 'Updated reason',
      },
    })
  })

  it('checks overlap when the time window changed', async () => {
    mockPrisma.booking.findMany.mockResolvedValue([{ id: 'booking-1' }])

    const result = await updateTimeBlock('block-1', {
      startDateTime: new Date('2026-06-01T11:00:00Z'),
      endDateTime: new Date('2026-06-01T12:00:00Z'),
      reason: 'Updated reason',
      confirmOverlap: false,
    })

    expect(result).toEqual({
      requiresConfirmation: true,
      message: expect.stringMatching(/solapa con reservas/),
    })
    expect(mockPrisma.timeBlock.updateMany).not.toHaveBeenCalled()
  })

  it('does not re-check overlap when only the reason changed (same time window)', async () => {
    mockPrisma.booking.findMany.mockResolvedValue([{ id: 'booking-1' }])

    const result = await updateTimeBlock('block-1', {
      startDateTime: baseInput.startDateTime,
      endDateTime: baseInput.endDateTime,
      reason: 'Solo cambia el motivo',
      confirmOverlap: false,
    })

    expect(mockPrisma.booking.findMany).not.toHaveBeenCalled()
    expect('id' in result && result.id).toBe('block-1')
    expect(mockPrisma.timeBlock.updateMany).toHaveBeenCalledTimes(1)
  })

  it('updates when overlapping bookings exist and confirmOverlap is true', async () => {
    mockPrisma.booking.findMany.mockResolvedValue([{ id: 'booking-1' }])

    const result = await updateTimeBlock('block-1', {
      startDateTime: new Date('2026-06-01T11:00:00Z'),
      endDateTime: new Date('2026-06-01T12:00:00Z'),
      reason: baseInput.reason,
      confirmOverlap: true,
    })

    expect('id' in result && result.id).toBe('block-1')
    expect(mockPrisma.timeBlock.updateMany).toHaveBeenCalledTimes(1)
  })

  it('rejects when end is before start', async () => {
    await expect(
      updateTimeBlock('block-1', {
        startDateTime: new Date('2026-06-01T10:00:00Z'),
        endDateTime: new Date('2026-06-01T09:00:00Z'),
        reason: null,
        confirmOverlap: false,
      }),
    ).rejects.toThrow(/fecha de fin debe ser posterior/)
  })

  it('rejects when duration exceeds 32 days', async () => {
    await expect(
      updateTimeBlock('block-1', {
        startDateTime: new Date('2026-06-01T00:00:00Z'),
        endDateTime: new Date('2026-07-05T00:00:00Z'),
        reason: null,
        confirmOverlap: false,
      }),
    ).rejects.toThrow(/duración máxima/)
  })

  it('throws ForbiddenError when the block does not exist for this business', async () => {
    mockPrisma.timeBlock.findFirst.mockResolvedValue(null)

    await expect(
      updateTimeBlock('nonexistent', {
        startDateTime: baseInput.startDateTime,
        endDateTime: baseInput.endDateTime,
        reason: null,
        confirmOverlap: false,
      }),
    ).rejects.toThrow('Bloque no encontrado')
  })

  it('scopes the existence check to businessId', async () => {
    await updateTimeBlock('block-1', {
      startDateTime: new Date('2026-06-01T11:00:00Z'),
      endDateTime: new Date('2026-06-01T12:00:00Z'),
      reason: baseInput.reason,
      confirmOverlap: false,
    })

    expect(mockPrisma.timeBlock.findFirst).toHaveBeenCalledWith({
      where: { id: 'block-1', businessId: 'biz-1' },
    })
  })

  it('throws ForbiddenError if the block was deleted concurrently before the update lands', async () => {
    mockPrisma.timeBlock.updateMany.mockResolvedValue({ count: 0 })

    await expect(
      updateTimeBlock('block-1', {
        startDateTime: new Date('2026-06-01T11:00:00Z'),
        endDateTime: new Date('2026-06-01T12:00:00Z'),
        reason: baseInput.reason,
        confirmOverlap: false,
      }),
    ).rejects.toThrow('Bloque no encontrado')
  })
})
