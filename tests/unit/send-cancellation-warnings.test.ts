import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingStatus } from '@prisma/client'
import { TEST_PUSH_AUTH, TEST_VAPID_PUBLIC_KEY } from '../helpers/push-fixtures'

const {
  mockBookingFindMany,
  mockBookingFindFirst,
  mockBookingUpdateMany,
  mockTransaction,
  mockSubscriptionFindMany,
  mockSubscriptionUpdate,
  mockSubscriptionUpdateMany,
  mockDecryptSecret,
  mockSendWebPush,
  mockLogger,
} = vi.hoisted(() => ({
  mockBookingFindMany: vi.fn(),
  mockBookingFindFirst: vi.fn(),
  mockBookingUpdateMany: vi.fn(),
  mockTransaction: vi.fn(),
  mockSubscriptionFindMany: vi.fn(),
  mockSubscriptionUpdate: vi.fn(),
  mockSubscriptionUpdateMany: vi.fn(),
  mockDecryptSecret: vi.fn(),
  mockSendWebPush: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    $transaction: mockTransaction,
    booking: {
      findMany: mockBookingFindMany,
      findFirst: mockBookingFindFirst,
      updateMany: mockBookingUpdateMany,
    },
    pushSubscription: {
      findMany: mockSubscriptionFindMany,
      update: mockSubscriptionUpdate,
      updateMany: mockSubscriptionUpdateMany,
    },
  },
}))
vi.mock('@/lib/payments/encryption', () => ({ decryptSecret: mockDecryptSecret }))
vi.mock('@/lib/push/web-push', () => ({ sendWebPush: mockSendWebPush }))
vi.mock('@/lib/logger', () => ({ logger: mockLogger }))

const { cancellationWarningWindow, sendCancellationWarnings } = await import(
  '@/lib/cron/send-cancellation-warnings'
)

const HOUR_MS = 3_600_000
const NOW = new Date('2026-08-10T12:00:00.000Z')
const PUSH_JSON = JSON.stringify({
  endpoint: 'https://fcm.googleapis.com/fcm/send/device-one',
  keys: { p256dh: TEST_VAPID_PUBLIC_KEY, auth: TEST_PUSH_AUTH },
})

function makeBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: 'booking-1',
    customerId: 'customer-1',
    startDateTime: new Date(NOW.getTime() + 26 * HOUR_MS),
    status: BookingStatus.confirmed,
    depositPaid: 5_000,
    cancellationCutoffHours: 24,
    cancellationReminderClaimedAt: null,
    cancellationReminderSentAt: null,
    customer: { userId: 'user-1' },
    business: {
      id: 'business-1',
      name: 'Mimos Nails',
      slug: 'mimos-nails',
      subdomain: 'mimos',
      selfServiceCutoffHours: 24,
      cancellationReminderEnabled: true,
    },
    ...overrides,
  }
}

function makeSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'subscription-1',
    authorizedUserId: 'user-1',
    subscriptionFingerprint: 'fingerprint-1',
    subscriptionEncrypted: PUSH_JSON,
    failureCount: 0,
    ...overrides,
  }
}

type SimulatedSubscriptionRow = ReturnType<typeof makeSubscription> & {
  revokedAt: Date | null
  lastFailureAt: Date | null
  lastSuccessAt: Date | null
}

function simulateSubscriptionPersistence(initial: SimulatedSubscriptionRow) {
  let row = { ...initial }

  mockSubscriptionUpdate.mockImplementation(async ({ data }: {
    data: Record<string, unknown>
  }) => {
    const increment = data.failureCount as { increment?: number } | undefined
    if (increment?.increment) row.failureCount += increment.increment
    if ('lastFailureAt' in data) row.lastFailureAt = data.lastFailureAt as Date | null
    return { failureCount: row.failureCount }
  })
  mockSubscriptionUpdateMany.mockImplementation(async ({ where, data }: {
    where: Record<string, unknown>
    data: Record<string, unknown>
  }) => {
    const expectedFailureCount = where.failureCount as
      | number
      | { gte?: number }
      | undefined
    if (
      where.id !== row.id
      || ('subscriptionFingerprint' in where
        && where.subscriptionFingerprint !== row.subscriptionFingerprint)
      || (typeof expectedFailureCount === 'number'
        && expectedFailureCount !== row.failureCount)
      || (typeof expectedFailureCount === 'object'
        && expectedFailureCount.gte !== undefined
        && row.failureCount < expectedFailureCount.gte)
      || (where.revokedAt === null && row.revokedAt !== null)
    ) {
      return { count: 0 }
    }

    const increment = data.failureCount as { increment?: number } | undefined
    if (increment?.increment) row.failureCount += increment.increment
    else if (typeof data.failureCount === 'number') row.failureCount = data.failureCount
    if ('revokedAt' in data) row.revokedAt = data.revokedAt as Date | null
    if ('lastFailureAt' in data) row.lastFailureAt = data.lastFailureAt as Date | null
    if ('lastSuccessAt' in data) row.lastSuccessAt = data.lastSuccessAt as Date | null
    return { count: 1 }
  })

  return {
    replaceWithFreshGeneration() {
      row = {
        ...row,
        subscriptionFingerprint: 'fingerprint-2',
        subscriptionEncrypted: 'fresh-ciphertext',
        failureCount: 0,
        revokedAt: null,
        lastFailureAt: null,
        lastSuccessAt: null,
      }
    },
    read: () => row,
  }
}

describe('cancellationWarningWindow', () => {
  it('calcula el objetivo dos horas antes del cierre con milisegundos enteros', () => {
    const result = cancellationWarningWindow(
      new Date('2026-08-12T15:00:00.123Z'),
      24,
    )

    expect(result).toEqual({
      targetAt: new Date('2026-08-11T13:00:00.123Z'),
      closesAt: new Date('2026-08-11T15:00:00.123Z'),
    })
  })

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER])(
    'rechaza cutoff no entero/seguro: %s',
    (cutoffHours) => {
      expect(() => cancellationWarningWindow(NOW, cutoffHours)).toThrow()
    },
  )
})

describe('sendCancellationWarnings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NEXT_PUBLIC_APP_DOMAIN', 'www.agendita.cl')
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'public-test-key')
    vi.stubEnv('VAPID_PRIVATE_KEY', 'private-test-key')
    vi.stubEnv('VAPID_SUBJECT', 'mailto:test@agendita.cl')
    vi.stubEnv('ENCRYPTION_KEY', 'encryption-test-key')
    mockBookingFindMany.mockResolvedValue([makeBooking()])
    mockBookingFindFirst.mockResolvedValue({
      cancellationCutoffHours: 24,
      startDateTime: new Date(NOW.getTime() + 26 * HOUR_MS),
      customer: { userId: 'user-1' },
      business: { selfServiceCutoffHours: 24 },
    })
    mockBookingUpdateMany.mockResolvedValue({ count: 1 })
    mockTransaction.mockImplementation(async (callback) => callback({
      pushSubscription: { updateMany: mockSubscriptionUpdateMany },
    }))
    mockSubscriptionFindMany.mockResolvedValue([makeSubscription()])
    mockSubscriptionUpdate.mockResolvedValue({ failureCount: 1 })
    mockSubscriptionUpdateMany.mockResolvedValue({ count: 1 })
    mockDecryptSecret.mockImplementation((ciphertext: string) => ciphertext)
    mockSendWebPush.mockResolvedValue({ ok: true, statusCode: 201 })
  })

  afterEach(() => vi.unstubAllEnvs())

  it('sin configuración Web Push completa no consulta ni falla reservas', async () => {
    vi.stubEnv('VAPID_PRIVATE_KEY', '')

    const result = await sendCancellationWarnings(NOW)

    expect(result).toEqual({ sent: 0, skipped: 0, errors: 0 })
    expect(mockBookingFindMany).not.toHaveBeenCalled()
  })

  it('consulta un rango futuro acotado y filtra estado, abono, toggle, sent y lease', async () => {
    mockBookingFindMany.mockResolvedValue([])

    await sendCancellationWarnings(NOW)

    expect(mockBookingFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: BookingStatus.confirmed,
        depositPaid: { gt: 0 },
        cancellationReminderSentAt: null,
        startDateTime: {
          gt: NOW,
          lte: new Date(NOW.getTime() + 722 * HOUR_MS),
        },
        business: { cancellationReminderEnabled: true },
        OR: [
          { cancellationReminderClaimedAt: null },
          { cancellationReminderClaimedAt: { lt: new Date(NOW.getTime() - 10 * 60_000) } },
        ],
      }),
      take: expect.any(Number),
    }))
  })

  it('pagina un lote exacto de 100 y uno parcial sin duplicar ni omitir reservas', async () => {
    const bookings = Array.from({ length: 102 }, (_, index) => makeBooking({
      id: `booking-${String(index + 1).padStart(3, '0')}`,
    }))
    mockBookingFindMany
      .mockResolvedValueOnce(bookings.slice(0, 100))
      .mockResolvedValueOnce(bookings.slice(100))
    mockSubscriptionFindMany.mockResolvedValue([])

    const result = await sendCancellationWarnings(NOW)

    expect(result).toEqual({ sent: 0, skipped: 102, errors: 0 })
    expect(mockBookingFindMany).toHaveBeenCalledTimes(2)
    const firstQuery = mockBookingFindMany.mock.calls[0][0]
    const secondQuery = mockBookingFindMany.mock.calls[1][0]
    expect(firstQuery).toMatchObject({ orderBy: { id: 'asc' }, take: 100 })
    expect(firstQuery).not.toHaveProperty('cursor')
    expect(firstQuery).not.toHaveProperty('skip')
    expect(secondQuery).toMatchObject({
      orderBy: { id: 'asc' },
      take: 100,
      cursor: { id: 'booking-100' },
      skip: 1,
    })
    const claimedIds = mockBookingUpdateMany.mock.calls
      .filter(([{ data }]) => data.cancellationReminderClaimedAt === NOW)
      .map(([{ where }]) => where.id)
    expect(claimedIds).toEqual(bookings.map(({ id }) => id))
  })

  it('envía exactamente desde targetAt', async () => {
    const result = await sendCancellationWarnings(NOW)

    expect(result).toEqual({ sent: 1, skipped: 0, errors: 0 })
    expect(mockBookingFindFirst).toHaveBeenCalledWith({
      where: {
        id: 'booking-1',
        cancellationReminderClaimedAt: NOW,
        cancellationReminderSentAt: null,
        status: BookingStatus.confirmed,
        depositPaid: { gt: 0 },
        startDateTime: { gt: NOW },
        business: { cancellationReminderEnabled: true },
      },
      select: {
        cancellationCutoffHours: true,
        startDateTime: true,
        customer: { select: { userId: true } },
        business: { select: { selfServiceCutoffHours: true } },
      },
    })
    expect(mockSendWebPush).toHaveBeenCalledTimes(1)
  })

  it('todavía no envía un milisegundo antes de targetAt', async () => {
    mockBookingFindMany.mockResolvedValue([
      makeBooking({ startDateTime: new Date(NOW.getTime() + 26 * HOUR_MS + 1) }),
    ])

    const result = await sendCancellationWarnings(NOW)

    expect(result).toEqual({ sent: 0, skipped: 1, errors: 0 })
    expect(mockBookingUpdateMany).not.toHaveBeenCalled()
  })

  it('no envía en el límite exacto de cierre (now < closesAt es estricto)', async () => {
    mockBookingFindMany.mockResolvedValue([
      makeBooking({ startDateTime: new Date(NOW.getTime() + 24 * HOUR_MS) }),
    ])

    const result = await sendCancellationWarnings(NOW)

    expect(result).toEqual({ sent: 0, skipped: 1, errors: 0 })
    expect(mockBookingUpdateMany).not.toHaveBeenCalled()
  })

  it('cutoff snapshot cero no cae al valor actual del negocio', async () => {
    mockBookingFindMany.mockResolvedValue([
      makeBooking({ cancellationCutoffHours: 0 }),
    ])

    const result = await sendCancellationWarnings(NOW)

    expect(result).toEqual({ sent: 0, skipped: 1, errors: 0 })
    expect(mockBookingUpdateMany).not.toHaveBeenCalled()
  })

  it('sólo para una reserva legacy null usa selfServiceCutoffHours como fallback', async () => {
    mockBookingFindMany.mockResolvedValue([
      makeBooking({ cancellationCutoffHours: null }),
    ])

    const result = await sendCancellationWarnings(NOW)

    expect(result.sent).toBe(1)
    expect(mockSendWebPush).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['cero', 0],
    ['fuera de ventana', 23],
  ])(
    'una reserva legacy revalida el cutoff actual %s después del claim',
    async (_case, currentCutoffHours) => {
      mockBookingFindMany.mockResolvedValue([
        makeBooking({ cancellationCutoffHours: null }),
      ])
      mockBookingFindFirst.mockResolvedValue({
        cancellationCutoffHours: null,
        startDateTime: new Date(NOW.getTime() + 26 * HOUR_MS),
        customer: { userId: 'user-1' },
        business: { selfServiceCutoffHours: currentCutoffHours },
      })

      const result = await sendCancellationWarnings(NOW)

      expect(result).toEqual({ sent: 0, skipped: 1, errors: 0 })
      expect(mockBookingFindFirst).toHaveBeenCalledWith({
        where: {
          id: 'booking-1',
          cancellationReminderClaimedAt: NOW,
          cancellationReminderSentAt: null,
          status: BookingStatus.confirmed,
          depositPaid: { gt: 0 },
          startDateTime: { gt: NOW },
          business: { cancellationReminderEnabled: true },
        },
        select: {
          cancellationCutoffHours: true,
          startDateTime: true,
          customer: { select: { userId: true } },
          business: { select: { selfServiceCutoffHours: true } },
        },
      })
      expect(mockSubscriptionFindMany).not.toHaveBeenCalled()
      expect(mockDecryptSecret).not.toHaveBeenCalled()
      expect(mockSendWebPush).not.toHaveBeenCalled()
      expect(mockBookingUpdateMany).toHaveBeenLastCalledWith({
        where: {
          id: 'booking-1',
          cancellationReminderClaimedAt: NOW,
          cancellationReminderSentAt: null,
        },
        data: { cancellationReminderClaimedAt: null },
      })
    },
  )

  it('no toca Web Push si una reprogramación limpia el claim mientras revalida', async () => {
    let finishRevalidation!: (value: null) => void
    mockBookingFindFirst.mockReturnValue(new Promise((resolve) => {
      finishRevalidation = resolve
    }))

    const running = sendCancellationWarnings(NOW)
    await vi.waitFor(() => expect(mockBookingFindFirst).toHaveBeenCalledTimes(1))
    expect(mockSubscriptionFindMany).not.toHaveBeenCalled()

    finishRevalidation(null)
    const result = await running

    expect(result).toEqual({ sent: 0, skipped: 1, errors: 0 })
    expect(mockDecryptSecret).not.toHaveBeenCalled()
    expect(mockSendWebPush).not.toHaveBeenCalled()
    expect(mockBookingUpdateMany).toHaveBeenLastCalledWith({
      where: {
        id: 'booking-1',
        cancellationReminderClaimedAt: NOW,
        cancellationReminderSentAt: null,
      },
      data: { cancellationReminderClaimedAt: null },
    })
  })

  it.each([
    ['cancelada', { status: BookingStatus.cancelled, depositPaid: 5_000 }],
    ['sin abono', { status: BookingStatus.confirmed, depositPaid: 0 }],
  ])(
    'no toca Web Push si la reserva queda %s después del claim',
    async (_case, changedRow) => {
      mockBookingFindFirst.mockImplementation(async ({ where }) => {
        if (where.status !== undefined && changedRow.status !== where.status) return null
        if (
          where.depositPaid?.gt !== undefined
          && changedRow.depositPaid <= where.depositPaid.gt
        ) return null
        return {
          cancellationCutoffHours: 24,
          startDateTime: new Date(NOW.getTime() + 26 * HOUR_MS),
          customer: { userId: 'user-1' },
          business: { selfServiceCutoffHours: 24 },
        }
      })

      const result = await sendCancellationWarnings(NOW)

      expect(result).toEqual({ sent: 0, skipped: 1, errors: 0 })
      expect(mockSubscriptionFindMany).not.toHaveBeenCalled()
      expect(mockDecryptSecret).not.toHaveBeenCalled()
      expect(mockSendWebPush).not.toHaveBeenCalled()
    },
  )

  it('no toca Web Push si el horario actual queda fuera de ventana después del claim', async () => {
    mockBookingFindFirst.mockResolvedValue({
      cancellationCutoffHours: 24,
      startDateTime: new Date(NOW.getTime() + 26 * HOUR_MS + 1),
      customer: { userId: 'user-1' },
      business: { selfServiceCutoffHours: 24 },
    })

    const result = await sendCancellationWarnings(NOW)

    expect(result).toEqual({ sent: 0, skipped: 1, errors: 0 })
    expect(mockSubscriptionFindMany).not.toHaveBeenCalled()
    expect(mockDecryptSecret).not.toHaveBeenCalled()
    expect(mockSendWebPush).not.toHaveBeenCalled()
  })

  it('el query excluye status incorrecto, abono cero y negocio deshabilitado', async () => {
    mockBookingFindMany.mockResolvedValue([])

    await sendCancellationWarnings(NOW)

    const [{ where }] = mockBookingFindMany.mock.calls[0]
    expect(where.status).toBe(BookingStatus.confirmed)
    expect(where.depositPaid).toEqual({ gt: 0 })
    expect(where.business).toEqual({ cancellationReminderEnabled: true })
  })

  it('el claim es atómico, acepta lease nulo o vencido y fija el horario leído', async () => {
    await sendCancellationWarnings(NOW)

    expect(mockBookingUpdateMany.mock.calls[0][0]).toEqual({
      where: {
        id: 'booking-1',
        status: BookingStatus.confirmed,
        depositPaid: { gt: 0 },
        startDateTime: new Date(NOW.getTime() + 26 * HOUR_MS),
        cancellationReminderSentAt: null,
        business: { cancellationReminderEnabled: true },
        OR: [
          { cancellationReminderClaimedAt: null },
          { cancellationReminderClaimedAt: { lt: new Date(NOW.getTime() - 10 * 60_000) } },
        ],
      },
      data: { cancellationReminderClaimedAt: NOW },
    })
  })

  it('si otro cron ganó el claim no descifra ni toca suscripciones', async () => {
    mockBookingUpdateMany.mockResolvedValueOnce({ count: 0 })

    const result = await sendCancellationWarnings(NOW)

    expect(result).toEqual({ sent: 0, skipped: 1, errors: 0 })
    expect(mockSubscriptionFindMany).not.toHaveBeenCalled()
    expect(mockDecryptSecret).not.toHaveBeenCalled()
    expect(mockSendWebPush).not.toHaveBeenCalled()
  })

  it('recupera un lease de más de diez minutos', async () => {
    mockBookingFindMany.mockResolvedValue([
      makeBooking({ cancellationReminderClaimedAt: new Date(NOW.getTime() - 10 * 60_000 - 1) }),
    ])

    const result = await sendCancellationWarnings(NOW)

    expect(result.sent).toBe(1)
  })

  it('sin suscripciones activas libera el claim para un alta posterior', async () => {
    mockSubscriptionFindMany.mockResolvedValue([])

    const result = await sendCancellationWarnings(NOW)

    expect(result).toEqual({ sent: 0, skipped: 1, errors: 0 })
    expect(mockBookingUpdateMany).toHaveBeenLastCalledWith({
      where: {
        id: 'booking-1',
        cancellationReminderClaimedAt: NOW,
        cancellationReminderSentAt: null,
      },
      data: { cancellationReminderClaimedAt: null },
    })
  })

  it('una invitada sólo recibe el push si la suscripción tiene entitlement para esta reserva', async () => {
    mockBookingFindMany.mockResolvedValue([
      makeBooking({ customer: { userId: null } }),
    ])
    mockBookingFindFirst.mockResolvedValue({
      cancellationCutoffHours: 24,
      startDateTime: new Date(NOW.getTime() + 26 * HOUR_MS),
      customer: { userId: null },
      business: { selfServiceCutoffHours: 24 },
    })

    await sendCancellationWarnings(NOW)

    expect(mockSubscriptionFindMany).toHaveBeenCalledWith({
      where: {
        businessId: 'business-1',
        customerId: 'customer-1',
        revokedAt: null,
        bookingEntitlements: { some: { bookingId: 'booking-1' } },
      },
      select: {
        id: true,
        authorizedUserId: true,
        subscriptionFingerprint: true,
        subscriptionEncrypted: true,
        failureCount: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: 5,
    })
  })

  it('una cuenta usa autorización explícita y nunca compara null con null', async () => {
    await sendCancellationWarnings(NOW)

    expect(mockSubscriptionFindMany).toHaveBeenCalledWith({
      where: {
        businessId: 'business-1',
        customerId: 'customer-1',
        revokedAt: null,
        OR: [
          { bookingEntitlements: { some: { bookingId: 'booking-1' } } },
          { authorizedUserId: 'user-1' },
        ],
      },
      select: {
        id: true,
        authorizedUserId: true,
        subscriptionFingerprint: true,
        subscriptionEncrypted: true,
        failureCount: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: 5,
    })
  })

  it('revalida el usuario actual de Customer antes de seleccionar dispositivos', async () => {
    mockBookingFindFirst.mockResolvedValue({
      cancellationCutoffHours: 24,
      startDateTime: new Date(NOW.getTime() + 26 * HOUR_MS),
      customer: { userId: 'user-2' },
      business: { selfServiceCutoffHours: 24 },
    })
    mockSubscriptionFindMany.mockResolvedValue([])

    await sendCancellationWarnings(NOW)

    expect(mockSubscriptionFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: [
          { bookingEntitlements: { some: { bookingId: 'booking-1' } } },
          { authorizedUserId: 'user-2' },
        ],
      }),
    }))
  })

  it('envía dispositivos con fanout acotado y un éxito parcial marca sent', async () => {
    let releaseFirst!: () => void
    const firstPending = new Promise<void>((resolve) => { releaseFirst = resolve })
    mockSubscriptionFindMany.mockResolvedValue([
      makeSubscription({ id: 'subscription-1' }),
      makeSubscription({ id: 'subscription-2' }),
    ])
    mockSendWebPush
      .mockImplementationOnce(async () => {
        await firstPending
        return { ok: true, statusCode: 201 }
      })
      .mockResolvedValueOnce({ ok: false, statusCode: 410 })

    const running = sendCancellationWarnings(NOW)
    await vi.waitFor(() => expect(mockSendWebPush).toHaveBeenCalledTimes(2))
    releaseFirst()
    const result = await running

    expect(result).toEqual({ sent: 1, skipped: 0, errors: 0 })
    expect(mockSubscriptionUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'subscription-2',
        subscriptionFingerprint: 'fingerprint-1',
        revokedAt: null,
      },
      data: expect.objectContaining({ revokedAt: NOW, lastFailureAt: NOW }),
    })
    expect(mockBookingUpdateMany).toHaveBeenLastCalledWith({
      where: {
        id: 'booking-1',
        cancellationReminderClaimedAt: NOW,
        cancellationReminderSentAt: null,
      },
      data: {
        cancellationReminderSentAt: NOW,
        cancellationReminderClaimedAt: null,
      },
    })
  })

  it.each([404, 410])('HTTP %s revoca inmediatamente', async (statusCode) => {
    mockSendWebPush.mockResolvedValue({ ok: false, statusCode })

    await sendCancellationWarnings(NOW)

    expect(mockSubscriptionUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'subscription-1',
        subscriptionFingerprint: 'fingerprint-1',
        revokedAt: null,
      },
      data: expect.objectContaining({
        revokedAt: NOW,
        lastFailureAt: NOW,
        failureCount: { increment: 1 },
      }),
    })
  })

  it.each([404, 410])(
    'un HTTP %s del envío viejo no revoca una re-suscripción concurrente',
    async (statusCode) => {
      const simulated = simulateSubscriptionPersistence({
        ...makeSubscription(),
        revokedAt: null,
        lastFailureAt: null,
        lastSuccessAt: null,
      })
      mockSendWebPush.mockImplementation(async () => {
        simulated.replaceWithFreshGeneration()
        return { ok: false, statusCode }
      })

      await sendCancellationWarnings(NOW)

      expect(simulated.read()).toMatchObject({
        subscriptionEncrypted: 'fresh-ciphertext',
        failureCount: 0,
        revokedAt: null,
        lastFailureAt: null,
      })
    },
  )

  it.each([400, 401, 403])(
    'HTTP %s incrementa un fallo permanente pero no revoca antes del tercero',
    async (statusCode) => {
      mockSubscriptionFindMany.mockResolvedValue([
        makeSubscription({ failureCount: 1 }),
      ])
      const simulated = simulateSubscriptionPersistence({
        ...makeSubscription({ failureCount: 1 }),
        revokedAt: null,
        lastFailureAt: null,
        lastSuccessAt: null,
      })
      mockSendWebPush.mockResolvedValue({ ok: false, statusCode })

      await sendCancellationWarnings(NOW)

      expect(simulated.read()).toMatchObject({
        failureCount: 2,
        revokedAt: null,
        lastFailureAt: NOW,
      })
      expect(mockTransaction).toHaveBeenCalledTimes(1)
    },
  )

  it.each([400, 401, 403])('HTTP %s revoca al tercer fallo permanente', async (statusCode) => {
    mockSubscriptionFindMany.mockResolvedValue([
      makeSubscription({ failureCount: 2 }),
    ])
    const simulated = simulateSubscriptionPersistence({
      ...makeSubscription({ failureCount: 2 }),
      revokedAt: null,
      lastFailureAt: null,
      lastSuccessAt: null,
    })
    mockSendWebPush.mockResolvedValue({ ok: false, statusCode })

    await sendCancellationWarnings(NOW)

    expect(simulated.read()).toMatchObject({
      failureCount: 3,
      revokedAt: NOW,
      lastFailureAt: NOW,
    })
  })

  it('cuenta dos fallos permanentes concurrentes de la misma generación y revoca al tercero', async () => {
    mockBookingFindMany
      .mockResolvedValueOnce([makeBooking({ id: 'booking-1' })])
      .mockResolvedValueOnce([makeBooking({ id: 'booking-2' })])
    mockSubscriptionFindMany.mockResolvedValue([
      makeSubscription({ failureCount: 1 }),
    ])
    const simulated = simulateSubscriptionPersistence({
      ...makeSubscription({ failureCount: 1 }),
      revokedAt: null,
      lastFailureAt: null,
      lastSuccessAt: null,
    })
    let deliveryCount = 0
    let releaseDeliveries!: () => void
    const deliveryBarrier = new Promise<void>((resolve) => {
      releaseDeliveries = resolve
    })
    mockSendWebPush.mockImplementation(async () => {
      deliveryCount++
      if (deliveryCount === 2) releaseDeliveries()
      await deliveryBarrier
      return { ok: false, statusCode: 400 }
    })

    const [first, second] = await Promise.all([
      sendCancellationWarnings(NOW),
      sendCancellationWarnings(NOW),
    ])

    expect(first).toEqual({ sent: 0, skipped: 0, errors: 1 })
    expect(second).toEqual({ sent: 0, skipped: 0, errors: 1 })
    expect(simulated.read()).toMatchObject({
      subscriptionEncrypted: PUSH_JSON,
      failureCount: 3,
      revokedAt: NOW,
      lastFailureAt: NOW,
    })
  })

  it.each([400, 401, 403])(
    'el tercer HTTP %s del envío viejo no incrementa ni revoca una re-suscripción concurrente',
    async (statusCode) => {
      mockSubscriptionFindMany.mockResolvedValue([
        makeSubscription({ failureCount: 2 }),
      ])
      const simulated = simulateSubscriptionPersistence({
        ...makeSubscription({ failureCount: 2 }),
        revokedAt: null,
        lastFailureAt: null,
        lastSuccessAt: null,
      })
      mockSendWebPush.mockImplementation(async () => {
        simulated.replaceWithFreshGeneration()
        return { ok: false, statusCode }
      })

      await sendCancellationWarnings(NOW)

      expect(simulated.read()).toMatchObject({
        subscriptionEncrypted: 'fresh-ciphertext',
        failureCount: 0,
        revokedAt: null,
        lastFailureAt: null,
      })
    },
  )

  it.each([
    ['rate limit', { ok: false, statusCode: 429 }],
    ['provider 5xx', { ok: false, statusCode: 503 }],
  ])('%s es transitorio: registra fecha sin aumentar ni revocar', async (_name, delivery) => {
    mockSendWebPush.mockResolvedValue(delivery)

    await sendCancellationWarnings(NOW)

    expect(mockSubscriptionUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'subscription-1',
        subscriptionFingerprint: 'fingerprint-1',
        revokedAt: null,
      },
      data: { lastFailureAt: NOW },
    })
    expect(mockSubscriptionUpdate).not.toHaveBeenCalled()
  })

  it('un rechazo de red es transitorio y el fanout acotado evita abortar el lote', async () => {
    mockSendWebPush.mockRejectedValue(new Error('endpoint capability must not leak'))

    const result = await sendCancellationWarnings(NOW)

    expect(result).toEqual({ sent: 0, skipped: 0, errors: 1 })
    expect(mockSubscriptionUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'subscription-1',
        subscriptionFingerprint: 'fingerprint-1',
        revokedAt: null,
      },
      data: { lastFailureAt: NOW },
    })
    expect(JSON.stringify(mockLogger.error.mock.calls)).not.toContain('endpoint capability')
  })

  it('todos los dispositivos fallidos liberan el claim y reportan un error de reserva', async () => {
    mockSubscriptionFindMany.mockResolvedValue([
      makeSubscription({ id: 'subscription-1' }),
      makeSubscription({ id: 'subscription-2' }),
    ])
    mockSendWebPush.mockResolvedValue({ ok: false, statusCode: 503 })

    const result = await sendCancellationWarnings(NOW)

    expect(result).toEqual({ sent: 0, skipped: 0, errors: 1 })
    expect(mockBookingUpdateMany).toHaveBeenLastCalledWith({
      where: {
        id: 'booking-1',
        cancellationReminderClaimedAt: NOW,
        cancellationReminderSentAt: null,
      },
      data: { cancellationReminderClaimedAt: null },
    })
  })

  it('un envío exitoso reinicia fallos y usa un payload privado', async () => {
    await sendCancellationWarnings(NOW)

    expect(mockSubscriptionUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'subscription-1',
        subscriptionFingerprint: 'fingerprint-1',
        revokedAt: null,
      },
      data: {
        failureCount: 0,
        lastFailureAt: null,
        lastSuccessAt: NOW,
      },
    })
    expect(mockSendWebPush).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'https://fcm.googleapis.com/fcm/send/device-one' }),
      {
        title: 'Mimos Nails',
        body: 'Podés cancelar o reprogramar hasta 24 horas antes. Con menos anticipación, el abono no se devuelve. Para cancelaciones anteriores aplica la política del negocio.',
        url: 'https://www.agendita.cl/mi/mimos-nails',
      },
      7_200,
    )
    const payload = JSON.stringify(mockSendWebPush.mock.calls[0][1])
    expect(payload).not.toContain('customer-1')
    expect(payload).not.toContain('5000')
  })

  it('un éxito del envío viejo reintenta la generación actual antes de marcar sent', async () => {
    const freshSuccessAt = new Date('2026-08-10T11:59:00.000Z')
    const simulated = simulateSubscriptionPersistence({
      ...makeSubscription({ failureCount: 2 }),
      revokedAt: null,
      lastFailureAt: new Date('2026-08-10T11:00:00.000Z'),
      lastSuccessAt: null,
    })
    mockSendWebPush.mockImplementation(async () => {
      if (mockSendWebPush.mock.calls.length === 1) {
        simulated.replaceWithFreshGeneration()
        const row = simulated.read()
        row.failureCount = 1
        row.lastFailureAt = new Date('2026-08-10T11:58:00.000Z')
        row.lastSuccessAt = freshSuccessAt
      }
      return { ok: true, statusCode: 201 }
    })
    mockSubscriptionFindMany.mockImplementation(async () => [{ ...simulated.read() }])
    mockDecryptSecret.mockReturnValue(PUSH_JSON)

    const result = await sendCancellationWarnings(NOW)

    expect(simulated.read()).toMatchObject({
      subscriptionEncrypted: 'fresh-ciphertext',
      subscriptionFingerprint: 'fingerprint-2',
      failureCount: 0,
      lastFailureAt: null,
      lastSuccessAt: NOW,
    })
    expect(result).toEqual({ sent: 1, skipped: 0, errors: 0 })
    expect(mockSendWebPush).toHaveBeenCalledTimes(2)
  })

  it('recalcula copy y TTL si cambia el cutoff legacy antes del retry de generación', async () => {
    const simulated = simulateSubscriptionPersistence({
      ...makeSubscription(),
      revokedAt: null,
      lastFailureAt: null,
      lastSuccessAt: null,
    })
    mockBookingFindMany.mockResolvedValue([
      makeBooking({ cancellationCutoffHours: null }),
    ])
    mockBookingFindFirst
      .mockResolvedValueOnce({
        cancellationCutoffHours: null,
        startDateTime: new Date(NOW.getTime() + 26 * HOUR_MS),
        customer: { userId: 'user-1' },
        business: { selfServiceCutoffHours: 24 },
      })
      .mockResolvedValueOnce({
        cancellationCutoffHours: null,
        startDateTime: new Date(NOW.getTime() + 26 * HOUR_MS),
        customer: { userId: 'user-1' },
        business: { selfServiceCutoffHours: 25 },
      })
    mockSubscriptionFindMany.mockImplementation(async () => [{ ...simulated.read() }])
    mockDecryptSecret.mockReturnValue(PUSH_JSON)
    mockSendWebPush.mockImplementation(async () => {
      if (mockSendWebPush.mock.calls.length === 1) simulated.replaceWithFreshGeneration()
      return { ok: true, statusCode: 201 }
    })

    await sendCancellationWarnings(NOW)

    expect(mockSendWebPush).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      expect.objectContaining({
        body: expect.stringContaining('hasta 25 horas antes'),
      }),
      3_600,
    )
  })

  it('calcula TTL fresco antes del efecto y nunca excede la ventana restante', async () => {
    let current = NOW
    mockSubscriptionFindMany.mockImplementation(async () => {
      current = new Date(NOW.getTime() + 30 * 60_000 + 450)
      return [makeSubscription()]
    })

    await sendCancellationWarnings(() => current)

    expect(mockSendWebPush).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      5_399,
    )
  })

  it('libera el claim si la ventana cierra antes del efecto externo', async () => {
    let current = NOW
    mockSubscriptionFindMany.mockImplementation(async () => {
      current = new Date(NOW.getTime() + 2 * HOUR_MS)
      return [makeSubscription()]
    })

    const result = await sendCancellationWarnings(() => current)

    expect(result).toEqual({ sent: 0, skipped: 1, errors: 0 })
    expect(mockSendWebPush).not.toHaveBeenCalled()
    expect(mockBookingUpdateMany).toHaveBeenLastCalledWith({
      where: {
        id: 'booking-1',
        cancellationReminderClaimedAt: NOW,
        cancellationReminderSentAt: null,
      },
      data: { cancellationReminderClaimedAt: null },
    })
  })

  it.each([
    ['rotación de ENCRYPTION_KEY', () => { throw new Error('bad key') }],
    ['ciphertext corrupto', () => '{not-json'],
  ])('revoca una generación localmente ilegible y no la reintenta para siempre: %s', async (_case, decrypt) => {
    mockDecryptSecret.mockImplementation(decrypt)
    mockSubscriptionFindMany
      .mockResolvedValueOnce([makeSubscription()])
      .mockResolvedValueOnce([])

    const first = await sendCancellationWarnings(NOW)
    const second = await sendCancellationWarnings(NOW)

    expect(first).toEqual({ sent: 0, skipped: 0, errors: 1 })
    expect(second).toEqual({ sent: 0, skipped: 1, errors: 0 })
    expect(mockSendWebPush).not.toHaveBeenCalled()
    expect(mockSubscriptionUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'subscription-1',
        subscriptionFingerprint: 'fingerprint-1',
        revokedAt: null,
      },
      data: expect.objectContaining({
        revokedAt: NOW,
        lastFailureAt: NOW,
      }),
    })
  })

  it('limita explícitamente a dos los envíos simultáneos del fanout', async () => {
    mockSubscriptionFindMany.mockResolvedValue(
      Array.from({ length: 5 }, (_, index) => makeSubscription({
        id: `subscription-${index + 1}`,
        subscriptionFingerprint: `fingerprint-${index + 1}`,
      })),
    )
    let active = 0
    let maxActive = 0
    const releases: Array<() => void> = []
    mockSendWebPush.mockImplementation(() => new Promise((resolve) => {
      active++
      maxActive = Math.max(maxActive, active)
      releases.push(() => {
        active--
        resolve({ ok: true, statusCode: 201 })
      })
    }))

    const running = sendCancellationWarnings(NOW)
    await vi.waitFor(() => expect(mockSendWebPush).toHaveBeenCalledTimes(2))
    expect(maxActive).toBe(2)
    releases.splice(0).forEach((release) => release())
    await vi.waitFor(() => expect(mockSendWebPush).toHaveBeenCalledTimes(4))
    expect(maxActive).toBe(2)
    releases.splice(0).forEach((release) => release())
    await vi.waitFor(() => expect(mockSendWebPush).toHaveBeenCalledTimes(5))
    releases.splice(0).forEach((release) => release())

    await expect(running).resolves.toEqual({ sent: 1, skipped: 0, errors: 0 })
    expect(maxActive).toBe(2)
  })

  it('para invitada abre la confirmación pública del tenant', async () => {
    mockBookingFindMany.mockResolvedValue([
      makeBooking({ customer: { userId: null } }),
    ])
    mockBookingFindFirst.mockResolvedValue({
      cancellationCutoffHours: 24,
      startDateTime: new Date(NOW.getTime() + 26 * HOUR_MS),
      customer: { userId: null },
      business: { selfServiceCutoffHours: 24 },
    })

    await sendCancellationWarnings(NOW)

    expect(mockSendWebPush.mock.calls[0][1].url).toBe(
      'https://mimos.agendita.cl/book/confirmation?bookingId=booking-1',
    )
  })

  it('usa destino público para entitlement invitado aunque la Customer después tenga cuenta', async () => {
    mockSubscriptionFindMany.mockResolvedValue([
      makeSubscription({ authorizedUserId: null }),
    ])

    await sendCancellationWarnings(NOW)

    expect(mockSendWebPush.mock.calls[0][1].url).toBe(
      'https://mimos.agendita.cl/book/confirmation?bookingId=booking-1',
    )
  })
})
