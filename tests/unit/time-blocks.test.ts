import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ForbiddenError } from '../helpers/auth-errors'
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
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  service: {
    findMany: vi.fn().mockResolvedValue([]),
  },
  availabilityRule: {
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
  },
  professional: {
    findFirst: vi.fn().mockResolvedValue({ id: 'juan' }),
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
  ForbiddenError,
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
  getTimeBlocks,
  getTimeBlockSeries,
} = await import('@/server/actions/time-blocks')

const TZ = 'America/Santiago'

const baseInput = {
  startDateTime: new Date('2026-06-01T09:00:00Z'),
  endDateTime: new Date('2026-06-01T10:00:00Z'),
  reason: 'Test block',
  confirmOverlap: false,
  professionalId: null,
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

    expect(result).toEqual({ ok: true, data: expect.objectContaining({ id: 'block-1' }) })
    expect(mockPrisma.timeBlock.create).toHaveBeenCalledTimes(1)
  })

  it('returns requiresConfirmation (no throw, no 500) when overlapping and confirmOverlap is false', async () => {
    mockPrisma.booking.findMany.mockResolvedValue([{ id: 'booking-1' }])

    const result = await createTimeBlock({ ...baseInput, confirmOverlap: false })

    expect(result).toEqual({
      ok: true,
      data: {
        requiresConfirmation: true,
        message: expect.stringMatching(/solapa con reservas/),
      },
    })
    expect(mockPrisma.timeBlock.create).not.toHaveBeenCalled()
  })

  it('creates block when overlapping bookings exist and confirmOverlap is true', async () => {
    mockPrisma.booking.findMany.mockResolvedValue([{ id: 'booking-1' }])

    const result = await createTimeBlock({ ...baseInput, confirmOverlap: true })

    expect(result).toEqual({ ok: true, data: expect.objectContaining({ id: 'block-1' }) })
    expect(mockPrisma.timeBlock.create).toHaveBeenCalledTimes(1)
  })

  it('rejects when end is before start', async () => {
    const result = await createTimeBlock({
      ...baseInput,
      startDateTime: new Date('2026-06-01T10:00:00Z'),
      endDateTime: new Date('2026-06-01T09:00:00Z'),
    })

    expect(result).toEqual({ ok: false, error: expect.stringMatching(/fecha de fin debe ser posterior/) })
  })

  it('rejects when duration exceeds 32 days', async () => {
    const result = await createTimeBlock({
      ...baseInput,
      startDateTime: new Date('2026-06-01T00:00:00Z'),
      endDateTime: new Date('2026-07-05T00:00:00Z'),
    })

    expect(result).toEqual({ ok: false, error: expect.stringMatching(/duración máxima/) })
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
      { status: { in: ['confirmed', 'completed', 'pending_confirmation'] } },
      expect.objectContaining({ status: 'pending_payment' }),
    ])
  })

  it('only checks active bookings for overlap, ignoring expired holds', async () => {
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

    // Un hold ya expirado no cuenta como conflicto... salvo los que ningún sweep
    // puede barrer (con plata encima o con transferencia bancaria de por medio):
    // ésos siguen ocupando el horario porque el EXCLUDE los sigue viendo ocupado.
    const findClause = (status: string) =>
      findManyCall.where.OR.find((clause: { status: unknown }) => clause.status === status)
    expect(findClause('pending_payment').OR).toEqual([
      { holdExpiresAt: null },
      { holdExpiresAt: { gt: expect.any(Date) } },
      { paymentStatus: { not: 'unpaid' } },
      { paymentMethod: { in: ['bank_transfer', 'manual'] } },
    ])
    // Una solicitud NO se libera por hold vencido: tapa hasta que el cron la
    // expire, igual que en `occupiesSlot`. Por eso no tiene cláusula propia — el
    // test hermano de arriba fija que va en el `in` incondicional.
    expect(findClause('pending_confirmation')).toBeUndefined()
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
      ok: true,
      data: {
        requiresConfirmation: true,
        message: expect.stringMatching(/Además, con este bloqueo "CORTE" no cabría en ningún día\./),
      },
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
    professionalId: null,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.booking.findMany.mockResolvedValue([])
    mockPrisma.timeBlockSeries.create.mockResolvedValue({ id: 'series-1', businessId: 'biz-1' })
  })

  it('creates the series when no bookings overlap', async () => {
    const result = await createTimeBlockSeries(seriesInput)

    expect(result).toEqual({
      ok: true,
      data: { series: { id: 'series-1', businessId: 'biz-1' }, overlappingDates: [] },
    })
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
      ok: true,
      data: {
        requiresConfirmation: true,
        message: expect.stringMatching(new RegExp(`se solapa con reservas existentes.*${tomorrowStr}`)),
      },
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

    expect(result).toEqual({
      ok: true,
      data: {
        series: { id: 'series-1', businessId: 'biz-1' },
        overlappingDates: expect.arrayContaining([tomorrowStr]),
      },
    })
    expect(mockPrisma.timeBlockSeries.create).toHaveBeenCalledTimes(1)
  })

  it('overlap query excludes expired holds de pago, pero no las solicitudes', async () => {
    await createTimeBlockSeries(seriesInput)

    const findManyCall = mockPrisma.booking.findMany.mock.calls[0][0]
    expect(findManyCall.where.businessId).toBe('biz-1')
    expect(findManyCall.where.OR).toEqual([
      { status: { in: ['confirmed', 'completed', 'pending_confirmation'] } },
      {
        status: 'pending_payment',
        OR: [
          { holdExpiresAt: null },
          { holdExpiresAt: { gt: expect.any(Date) } },
          { paymentStatus: { not: 'unpaid' } },
          { paymentMethod: { in: ['bank_transfer', 'manual'] } },
        ],
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

    expect(result).toEqual({ ok: true, data: { series: expect.objectContaining({ id: 'series-2' }) } })
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
      ok: true,
      data: {
        requiresConfirmation: true,
        message: expect.stringMatching(/se solapa con reservas existentes/),
      },
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

    expect(result).toEqual({ ok: true, data: { series: expect.objectContaining({ id: 'series-2' }) } })
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
  })

  // La tercera capa del bug de la ocurrencia movida (las otras dos, #133): el
  // reset de excepciones clasificaba SOLO por `occurrenceDate` (el día
  // ORIGINAL). El corte correcto exige LAS DOS fechas en el dominio del reset:
  // - `occurrenceDate >= hoy`: una excepción con origen en la mitad pasada
  //   pertenece a la serie vieja; borrarla en el split haría que esa serie
  //   REGENERE el bloqueo default en su día original (un bloqueo apareciendo en
  //   el pasado) y mataría el override que el rescate de #133 muestra a propósito.
  // - `startDateTime >= hoy` (si la movieron): la movida a ayer ya ocurrió;
  //   resetearla "des-ocurre" un bloqueo real.
  describe('reset de excepciones: las dos fechas en el dominio del reset', () => {
    const anchorToday = fromZonedTime(`${formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd')} 00:00:00`, TZ)
    const resetEsperado = {
      seriesId: 'series-1',
      occurrenceDate: { gte: anchorToday },
      OR: [
        { startDateTime: null },
        { startDateTime: { gte: anchorToday } },
      ],
    }

    it('el split borra sólo las excepciones con origen Y ocurrencia real de hoy en adelante', async () => {
      await updateTimeBlockSeries('series-1', { startTime: '13:00', endTime: '15:00' })

      expect(mockPrisma.timeBlockSeries.create).toHaveBeenCalledTimes(1)
      expect(mockPrisma.timeBlockException.deleteMany).toHaveBeenCalledWith({ where: resetEsperado })
    })

    it('el modo in-place (serie solo-futura) usa el mismo criterio', async () => {
      const mananaStr = formatInTimeZone(addDays(new Date(), 1), TZ, 'yyyy-MM-dd')
      mockPrisma.timeBlockSeries.findFirst.mockResolvedValue({
        ...existingSeries,
        anchorDate: fromZonedTime(`${mananaStr} 00:00:00`, TZ),
      })

      await updateTimeBlockSeries('series-1', { startTime: '13:00', endTime: '15:00' })

      // Solo-futura: edita el registro, no crea serie nueva.
      expect(mockPrisma.timeBlockSeries.create).not.toHaveBeenCalled()
      expect(mockPrisma.timeBlockSeries.update).toHaveBeenCalledWith({
        where: { id: 'series-1' },
        data: { startTime: '13:00', endTime: '15:00', reason: null },
      })
      expect(mockPrisma.timeBlockException.deleteMany).toHaveBeenCalledWith({ where: resetEsperado })
    })
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

    expect(result).toEqual({ ok: true, data: undefined })
    expect(mockPrisma.timeBlockException.upsert).toHaveBeenCalledTimes(1)
  })

  it('returns requiresConfirmation WITHOUT saving when the new range overlaps bookings', async () => {
    mockPrisma.booking.findMany.mockResolvedValue([{ id: 'booking-1' }])

    const result = await overrideSeriesOccurrence('series-1', occurrenceDate, overrideData)

    expect(result).toEqual({
      ok: true,
      data: {
        requiresConfirmation: true,
        message: expect.stringMatching(/se solapa con reservas existentes/),
      },
    })
    expect(mockPrisma.timeBlockException.upsert).not.toHaveBeenCalled()
  })

  it('saves the override when confirmed despite overlaps', async () => {
    mockPrisma.booking.findMany.mockResolvedValue([{ id: 'booking-1' }])

    const result = await overrideSeriesOccurrence('series-1', occurrenceDate, {
      ...overrideData,
      confirmed: true,
    })

    expect(result).toEqual({ ok: true, data: undefined })
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

  it('returns { ok: false } with the ForbiddenError message when block not found', async () => {
    mockPrisma.timeBlock.deleteMany.mockResolvedValue({ count: 0 })

    const result = await deleteTimeBlock('nonexistent')

    expect(result).toEqual({ ok: false, error: 'Bloque no encontrado' })
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

    expect(result.ok && 'id' in result.data && result.data.id).toBe('block-1')
    expect(mockPrisma.timeBlock.updateMany).toHaveBeenCalledWith({
      where: { id: 'block-1', businessId: 'biz-1' },
      data: {
        startDateTime: new Date('2026-06-01T11:00:00Z'),
        endDateTime: new Date('2026-06-01T12:00:00Z'),
        reason: 'Updated reason',
        overlapToleranceMinutes: 0,
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
      ok: true,
      data: {
        requiresConfirmation: true,
        message: expect.stringMatching(/solapa con reservas/),
      },
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
    expect(result.ok && 'id' in result.data && result.data.id).toBe('block-1')
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

    expect(result.ok && 'id' in result.data && result.data.id).toBe('block-1')
    expect(mockPrisma.timeBlock.updateMany).toHaveBeenCalledTimes(1)
  })

  it('rejects when end is before start', async () => {
    const result = await updateTimeBlock('block-1', {
      startDateTime: new Date('2026-06-01T10:00:00Z'),
      endDateTime: new Date('2026-06-01T09:00:00Z'),
      reason: null,
      confirmOverlap: false,
    })

    expect(result).toEqual({ ok: false, error: expect.stringMatching(/fecha de fin debe ser posterior/) })
  })

  it('rejects when duration exceeds 32 days', async () => {
    const result = await updateTimeBlock('block-1', {
      startDateTime: new Date('2026-06-01T00:00:00Z'),
      endDateTime: new Date('2026-07-05T00:00:00Z'),
      reason: null,
      confirmOverlap: false,
    })

    expect(result).toEqual({ ok: false, error: expect.stringMatching(/duración máxima/) })
  })

  it('returns { ok: false } with the ForbiddenError message when the block does not exist for this business', async () => {
    mockPrisma.timeBlock.findFirst.mockResolvedValue(null)

    const result = await updateTimeBlock('nonexistent', {
      startDateTime: baseInput.startDateTime,
      endDateTime: baseInput.endDateTime,
      reason: null,
      confirmOverlap: false,
    })

    expect(result).toEqual({ ok: false, error: 'Bloque no encontrado' })
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

  it('returns { ok: false } if the block was deleted concurrently before the update lands', async () => {
    mockPrisma.timeBlock.updateMany.mockResolvedValue({ count: 0 })

    const result = await updateTimeBlock('block-1', {
      startDateTime: new Date('2026-06-01T11:00:00Z'),
      endDateTime: new Date('2026-06-01T12:00:00Z'),
      reason: baseInput.reason,
      confirmOverlap: false,
    })

    expect(result).toEqual({ ok: false, error: 'Bloque no encontrado' })
  })
})

describe('overlapToleranceMinutes', () => {
  const anchorDate = fromZonedTime('2026-06-01 00:00:00', TZ)

  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.booking.findMany.mockResolvedValue([])
    mockPrisma.timeBlock.create.mockResolvedValue({ id: 'block-1' })
    mockPrisma.timeBlockSeries.create.mockResolvedValue({ id: 'series-1' })
  })

  it('persists tolerance when creating a one-off block', async () => {
    await createTimeBlock({ ...baseInput, overlapToleranceMinutes: 15 })
    expect(mockPrisma.timeBlock.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ overlapToleranceMinutes: 15 }) }),
    )
  })

  it('defaults tolerance to 0 when not provided', async () => {
    await createTimeBlock(baseInput)
    expect(mockPrisma.timeBlock.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ overlapToleranceMinutes: 0 }) }),
    )
  })

  it('rejects tolerance beyond half the block duration', async () => {
    // baseInput dura 60 min → máximo 30
    const res = await createTimeBlock({ ...baseInput, overlapToleranceMinutes: 31 })
    expect(res).toEqual({ ok: false, error: expect.stringContaining('Datos inválidos') })
    expect(mockPrisma.timeBlock.create).not.toHaveBeenCalled()
  })

  it('persists tolerance when creating a series', async () => {
    const res = await createTimeBlockSeries({
      daysOfWeek: [1],
      startTime: '12:00',
      endTime: '14:00',
      reason: null,
      anchorDate,
      endMode: 'forever',
      weeks: null,
      overlapToleranceMinutes: 45,
      professionalId: null,
    })
    expect(res.ok && 'series' in res.data).toBe(true)
    expect(mockPrisma.timeBlockSeries.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ overlapToleranceMinutes: 45 }) }),
    )
  })

  it('rejects series tolerance beyond half the occurrence duration', async () => {
    const res = await createTimeBlockSeries({
      daysOfWeek: [1],
      startTime: '12:00',
      endTime: '13:00',
      reason: null,
      anchorDate,
      endMode: 'forever',
      weeks: null,
      overlapToleranceMinutes: 31,
      professionalId: null,
    })
    expect(res).toEqual({ ok: false, error: expect.stringContaining('Datos inválidos') })
    expect(mockPrisma.timeBlockSeries.create).not.toHaveBeenCalled()
  })

  it('preserves the series tolerance across a whole-series edit split', async () => {
    mockPrisma.timeBlockSeries.findFirst.mockResolvedValue({
      id: 'series-1',
      businessId: 'biz-1',
      daysOfWeek: [1],
      startTime: '12:00',
      endTime: '14:00',
      reason: null,
      anchorDate,
      until: null,
      isActive: true,
      overlapToleranceMinutes: 30,
    })
    mockPrisma.timeBlockSeries.update.mockResolvedValue({})
    await updateTimeBlockSeries('series-1', { startTime: '12:30', endTime: '14:00' })
    expect(mockPrisma.timeBlockSeries.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ overlapToleranceMinutes: 30 }) }),
    )
  })
})

// Contra qué reservas choca un bloqueo depende de DE QUIÉN es el bloqueo. La palanca
// está en `overlappingActiveBookingsWhere` y no en el literal de la serie propuesta:
// sin esto, crear el almuerzo recurrente de una persona avisa "se solapa con reservas
// en N día(s)" por las citas de OTRA, la dueña aprende a tildar "confirmar" siempre y
// el aviso deja de significar algo.
//
// Hoy nada escribe `professionalId`, así que todos estos caminos piden "todas las
// reservas" — que es el default conservador. Los casos existen para que el PR que
// empiece a escribirlo no tenga que descubrir dónde estaba la palanca.
describe('de quién es el bloqueo decide contra qué reservas choca', () => {
  function scopeOfLastBookingQuery() {
    const calls = mockPrisma.booking.findMany.mock.calls
    return (calls[calls.length - 1][0] as { where: { AND?: unknown } }).where.AND
  }

  const soloDeJuan = { OR: [{ professionalId: null }, { professionalId: 'juan' }] }

  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.booking.findMany.mockResolvedValue([])
  })

  it('un bloqueo del salón choca contra TODAS las citas', async () => {
    mockPrisma.timeBlock.create.mockResolvedValue({ id: 'block-1', businessId: 'biz-1' })

    await createTimeBlock({ ...baseInput, confirmOverlap: true })

    expect(scopeOfLastBookingQuery()).toEqual({})
  })

  it('editar el bloqueo de una persona sólo mira las citas de ella', async () => {
    mockPrisma.timeBlock.findFirst.mockResolvedValue({
      id: 'block-1',
      businessId: 'biz-1',
      professionalId: 'juan',
      startDateTime: baseInput.startDateTime,
      endDateTime: baseInput.endDateTime,
      reason: baseInput.reason,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    })
    mockPrisma.timeBlock.updateMany.mockResolvedValue({ count: 1 })

    // Con horario cambiado, que es cuando corre el chequeo de solape.
    await updateTimeBlock('block-1', {
      startDateTime: new Date('2026-06-01T11:00:00Z'),
      endDateTime: new Date('2026-06-01T12:00:00Z'),
      reason: 'Movido',
      confirmOverlap: true,
    })

    expect(scopeOfLastBookingQuery()).toEqual(soloDeJuan)
  })

  it('la excepción de un día hereda de quién es la serie', async () => {
    mockPrisma.timeBlockSeries.findFirst.mockResolvedValue({
      id: 'series-1',
      businessId: 'biz-1',
      professionalId: 'juan',
    })
    mockPrisma.timeBlockException.upsert.mockResolvedValue({})

    await overrideSeriesOccurrence('series-1', fromZonedTime('2026-08-03 00:00:00', TZ), {
      startDateTime: fromZonedTime('2026-08-03 12:00:00', TZ),
      endDateTime: fromZonedTime('2026-08-03 15:00:00', TZ),
      reason: 'Almuerzo largo',
      confirmed: true,
    })

    expect(scopeOfLastBookingQuery()).toEqual(soloDeJuan)
  })
})

describe('crear un bloqueo a nombre de una persona', () => {
  const anchorDate = fromZonedTime(`${formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd')} 00:00:00`, TZ)
  const seriesInputConDueño = {
    daysOfWeek: [1],
    startTime: '12:00',
    endTime: '14:00',
    reason: 'Almuerzo',
    anchorDate,
    endMode: 'forever' as const,
    weeks: null,
    professionalId: null as string | null,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.booking.findMany.mockResolvedValue([])
    mockPrisma.professional.findFirst.mockResolvedValue({ id: 'juan' })
    mockPrisma.timeBlock.create.mockResolvedValue({ id: 'block-1', businessId: 'biz-1' })
    mockPrisma.timeBlockSeries.create.mockResolvedValue({ id: 'series-1', businessId: 'biz-1' })
  })

  it('el bloqueo suelto se guarda con su dueño', async () => {
    await createTimeBlock({ ...baseInput, professionalId: 'juan' })

    expect(mockPrisma.timeBlock.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ professionalId: 'juan' }) }),
    )
  })

  /**
   * Es el olvido más caro del track: con `null` significando "cierra para todos", una
   * serie que pierde a su dueño en cualquier copia cierra el local entero, todas las
   * semanas. El split ya está cubierto más arriba; esto cubre el alta.
   */
  it('la serie se guarda con su dueño', async () => {
    await createTimeBlockSeries({ ...seriesInputConDueño, professionalId: 'juan' })

    expect(mockPrisma.timeBlockSeries.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ professionalId: 'juan' }) }),
    )
  })

  it('el chequeo de solape del alta mira sólo las citas de esa persona', async () => {
    await createTimeBlock({ ...baseInput, professionalId: 'juan' })

    const calls = mockPrisma.booking.findMany.mock.calls
    const where = (calls[calls.length - 1][0] as { where: { AND?: unknown } }).where
    expect(where.AND).toEqual({ OR: [{ professionalId: null }, { professionalId: 'juan' }] })
  })

  /**
   * Normalizar defiende la forma; esto defiende la procedencia. Un id de otro salón no
   * da error en ninguna query: se guardaría un bloqueo a nombre de alguien que no
   * existe acá, invisible para todas las pantallas de este negocio.
   */
  it('rechaza un id que no es de una persona activa de este negocio', async () => {
    mockPrisma.professional.findFirst.mockResolvedValue(null)

    const res = await createTimeBlock({ ...baseInput, professionalId: 'de-otro-salon' })

    expect(res.ok).toBe(false)
    expect(mockPrisma.timeBlock.create).not.toHaveBeenCalled()
  })

  it('rechaza también en la serie', async () => {
    mockPrisma.professional.findFirst.mockResolvedValue(null)

    const res = await createTimeBlockSeries({ ...seriesInputConDueño, professionalId: 'de-otro-salon' })

    expect(res.ok).toBe(false)
    expect(mockPrisma.timeBlockSeries.create).not.toHaveBeenCalled()
  })

  it('el chequeo exige que sea de este negocio y esté activa', async () => {
    await createTimeBlock({ ...baseInput, professionalId: 'juan' })

    expect(mockPrisma.professional.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'juan', businessId: 'biz-1', isActive: true } }),
    )
  })

  // Un bundle viejo durante un deploy manda un argumento de menos. Eso NO puede
  // convertirse en un filtro "de una persona sin id", que en Prisma no filtra nada.
  it('un undefined es "del salón", no una persona inválida', async () => {
    const res = await createTimeBlock({ ...baseInput, professionalId: undefined as unknown as null })

    expect(res.ok).toBe(true)
    expect(mockPrisma.professional.findFirst).not.toHaveBeenCalled()
    expect(mockPrisma.timeBlock.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ professionalId: null }) }),
    )
  })
})

/**
 * La lista de la pantalla tiene que mostrar exactamente los bloqueos que le tapan la
 * agenda al alcance elegido — ni más ni menos. De más, la dueña ve las vacaciones de
 * Ana arriba del horario del negocio y cree que el local cierra; de menos, le bloquea a
 * Ana un rato que ya estaba cerrado por un feriado y no entiende por qué "no pasa nada".
 */
describe('de quién son los bloqueos que se listan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.professional.findFirst.mockResolvedValue({ id: 'juan' })
    mockPrisma.timeBlock.findMany.mockResolvedValue([])
    mockPrisma.timeBlockSeries.findMany.mockResolvedValue([])
  })

  it('sin persona lista sólo los del negocio', async () => {
    await getTimeBlocks()

    const where = mockPrisma.timeBlock.findMany.mock.calls[0][0].where
    expect(where.AND).toEqual({ professionalId: null })
  })

  it('con una persona lista los suyos MÁS los del negocio', async () => {
    await getTimeBlocks('juan')

    const where = mockPrisma.timeBlock.findMany.mock.calls[0][0].where
    expect(where.AND).toEqual({ OR: [{ professionalId: null }, { professionalId: 'juan' }] })
  })

  it('trae el nombre del dueño en el mismo viaje', async () => {
    await getTimeBlocks('juan')

    const args = mockPrisma.timeBlock.findMany.mock.calls[0][0]
    expect(args.include).toEqual({ professional: { select: { name: true } } })
  })

  /**
   * El alcance va adentro del `AND` justamente por esto: la query de series ya tiene su
   * propio `OR` —el de `until`— y un segundo `OR` al mismo nivel lo pisa en silencio.
   * Las series terminadas volverían a la lista sin un solo error.
   */
  it('el alcance de las series no se come el filtro de fecha de fin', async () => {
    await getTimeBlockSeries('juan')

    const where = mockPrisma.timeBlockSeries.findMany.mock.calls[0][0].where
    expect(where.AND).toEqual({ OR: [{ professionalId: null }, { professionalId: 'juan' }] })
    expect(where.OR).toHaveLength(2)
    expect(where.OR[0]).toEqual({ until: null })
  })

  it('rechaza pedir los bloqueos de alguien que no es de este negocio', async () => {
    mockPrisma.professional.findFirst.mockResolvedValue(null)

    await expect(getTimeBlocks('de-otro-salon')).rejects.toThrow(ForbiddenError)
    expect(mockPrisma.timeBlock.findMany).not.toHaveBeenCalled()
  })
})
