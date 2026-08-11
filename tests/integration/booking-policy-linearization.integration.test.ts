import { PrismaClient } from '@prisma/client'
import { formatInTimeZone } from 'date-fns-tz'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cancellationPolicyRevision } from '@/lib/bookings/cancellation-policy-revision'
import { normalizePhone } from '@/lib/customers/phone'
import { requireTestDatabase } from './setup'
import { expectActionError, unwrap } from './helpers/action-result'

requireTestDatabase()

const BUSINESS_ID = 'policy-linearization-business'
const OWNER_ID = 'policy-linearization-owner'
const SERVICE_ID = 'policy-linearization-service'
const OLD_CUTOFF = 24
const OLD_POLICY = 'Condiciones originales'
const NEW_CUTOFF = 12
const NEW_POLICY = 'Condiciones nuevas'

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async () => ({ success: true, remaining: 30, resetAt: 0 }),
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/server/actions/revalidate-business', () => ({
  revalidateBusinessPublicPaths: async () => {},
}))
vi.mock('@/lib/auth/user', () => ({
  getCurrentUser: async () => null,
  getConfirmedSessionUser: async () => null,
}))
vi.mock('@/lib/auth/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/server')>()),
  requireBusiness: async () => ({ businessId: 'policy-linearization-business' }),
  requireBusinessRole: async () => ({
    businessId: 'policy-linearization-business',
    user: { id: 'policy-linearization-owner' },
    business: {
      id: 'policy-linearization-business',
      name: 'Policy Linearization',
      category: 'other',
      timezone: 'America/Santiago',
      currency: 'CLP',
      selfServiceCutoffHours: 24,
      cancellationPolicy: 'Condiciones originales',
      defaultMeetingUrl: null,
      subscriptionStatus: 'trialing',
    },
  }),
}))
vi.mock('@/lib/payments/factory', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/payments/factory')>()),
  resolveOnlinePaymentAvailabilityForBusiness: async () => ({
    available: true,
    provider: 'mercado_pago',
    isMock: false,
  }),
}))
vi.mock('@/lib/notifications', () => ({
  getBusinessReplyToEmail: async () => 'owner@policy-linearization.test',
  sendBookingReceivedToCustomer: async () => ({ success: true }),
  sendNewBookingNotificationToBusiness: async () => [],
  sendBookingCancelledNotification: async () => ({ success: true }),
  sendBookingConfirmedNotification: async () => ({ success: true }),
  sendBookingRescheduledNotification: async () => ({ success: true }),
  sendNotificationSafely: async () => ({ success: true }),
  sendMultiNotificationSafely: async () => [],
}))

function hashStringToInt(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index)
    hash &= hash
  }
  return Math.abs(hash)
}

async function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('cancellation policy booking linearization', () => {
  const prisma = new PrismaClient()
  const blocker = new PrismaClient()
  const updater = new PrismaClient()
  const observer = new PrismaClient()
  const startDateTime = (() => {
    const date = new Date()
    date.setUTCDate(date.getUTCDate() + 7)
    date.setUTCHours(15, 0, 0, 0)
    return date
  })()

  async function cleanup() {
    await prisma.business.deleteMany({ where: { id: BUSINESS_ID } })
    await prisma.user.deleteMany({ where: { id: OWNER_ID } })
  }

  beforeAll(async () => {
    await cleanup()
    await prisma.user.create({
      data: { id: OWNER_ID, email: 'owner@policy-linearization.test' },
    })
    await prisma.business.create({
      data: {
        id: BUSINESS_ID,
        name: 'Policy Linearization',
        slug: BUSINESS_ID,
        subdomain: 'policylinearization',
        ownerUserId: OWNER_ID,
        city: 'Santiago',
        timezone: 'America/Santiago',
        selfServiceCutoffHours: OLD_CUTOFF,
        cancellationPolicy: OLD_POLICY,
      },
    })
    await prisma.service.create({
      data: {
        id: SERVICE_ID,
        businessId: BUSINESS_ID,
        name: 'Servicio',
        durationMinutes: 60,
        price: 10_000,
        depositAmount: 2_000,
        pastelColor: '#abcdef',
      },
    })
    for (let dayOfWeek = 0; dayOfWeek <= 6; dayOfWeek += 1) {
      await prisma.availabilityRule.create({
        data: {
          businessId: BUSINESS_ID,
          dayOfWeek,
          startTime: '00:00',
          endTime: '23:59',
          isActive: true,
        },
      })
    }
  })

  beforeEach(async () => {
    await prisma.booking.deleteMany({ where: { businessId: BUSINESS_ID } })
    await prisma.customer.deleteMany({ where: { businessId: BUSINESS_ID } })
    await prisma.business.update({
      where: { id: BUSINESS_ID },
      data: {
        selfServiceCutoffHours: OLD_CUTOFF,
        cancellationPolicy: OLD_POLICY,
      },
    })
  })

  afterAll(async () => {
    await cleanup()
    await Promise.all([
      prisma.$disconnect(),
      blocker.$disconnect(),
      updater.$disconnect(),
      observer.$disconnect(),
    ])
  })

  function revision(cutoffHours: number, additionalPolicy: string) {
    return cancellationPolicyRevision({
      businessId: BUSINESS_ID,
      cutoffHours,
      additionalPolicy,
    })
  }

  async function reserve(
    idempotencyKey: string,
    policyRevision: string,
    start = startDateTime,
  ) {
    const { createBooking } = await import('@/server/actions/bookings')
    const phoneSuffix = [...idempotencyKey]
      .reduce((sum, character) => (sum * 31 + character.charCodeAt(0)) % 100_000_000, 0)
      .toString()
      .padStart(8, '0')
    return createBooking({
      serviceId: SERVICE_ID,
      customerName: 'Ana',
      customerPhone: `569${phoneSuffix}`,
      startDateTime: start,
      acceptedTerms: true,
      cancellationPolicyRevision: policyRevision,
      idempotencyKey,
    }, BUSINESS_ID)
  }

  async function waitForLockWait(queryFragment: string) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const rows = await observer.$queryRaw<Array<{ waiting: boolean }>>`
        SELECT EXISTS (
          SELECT 1
          FROM pg_stat_activity
          WHERE datname = current_database()
            AND pid <> pg_backend_pid()
            AND wait_event_type = 'Lock'
            AND query LIKE ${`%${queryFragment}%`}
        ) AS waiting
      `
      if (rows[0]?.waiting) return
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error(`Timed out waiting for PostgreSQL lock: ${queryFragment}`)
  }

  async function waitForLockWaitCount(minimum: number) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const rows = await observer.$queryRaw<Array<{ waiting: bigint }>>`
        SELECT COUNT(*)::bigint AS waiting
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND wait_event_type = 'Lock'
      `
      if (Number(rows[0]?.waiting ?? 0) >= minimum) return
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error(`Timed out waiting for ${minimum} PostgreSQL lock waiters`)
  }

  it('rejects stale consent when the settings update committed before the booking lock', async () => {
    const updateAcquired = await deferred()
    const releaseUpdate = await deferred()
    const updateTransaction = updater.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE "Business"
        SET "selfServiceCutoffHours" = ${NEW_CUTOFF},
            "cancellationPolicy" = ${NEW_POLICY},
            "updatedAt" = NOW()
        WHERE "id" = ${BUSINESS_ID}
        /* policy-linearization-update-first */
      `
      updateAcquired.resolve()
      await releaseUpdate.promise
    }, { timeout: 20_000 })
    await updateAcquired.promise

    let bookingFinished = false
    const bookingPromise = reserve(
      'policy-update-first',
      revision(OLD_CUTOFF, OLD_POLICY),
    ).then((result) => {
      bookingFinished = true
      return result
    })

    try {
      // The uncommitted settings UPDATE owns the Business row. The public
      // booking must wait at FOR UPDATE instead of validating the outer read.
      await waitForLockWait('FOR UPDATE')
      expect(bookingFinished).toBe(false)

      releaseUpdate.resolve()
      await updateTransaction
      await expectActionError(bookingPromise, 'política de cancelación se actualizó')
      expect(await prisma.booking.count({ where: { businessId: BUSINESS_ID } })).toBe(0)
    } finally {
      releaseUpdate.resolve()
      await updateTransaction.catch(() => {})
    }
  })

  it('commits the protected snapshot before a later settings update can complete', async () => {
    const localDate = formatInTimeZone(startDateTime, 'America/Santiago', 'yyyy-MM-dd')
    const slotLock = hashStringToInt(`${BUSINESS_ID}:${localDate}`)
    const blockerAcquired = await deferred()
    const releaseBlocker = await deferred()
    const blockerTransaction = blocker.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${slotLock})`
      blockerAcquired.resolve()
      await releaseBlocker.promise
    }, { timeout: 20_000 })
    await blockerAcquired.promise

    try {
      const bookingPromise = unwrap(reserve(
        'policy-lock-first',
        revision(OLD_CUTOFF, OLD_POLICY),
      ))
      await waitForLockWait('pg_advisory_xact_lock')

      // PrismaPromise is lazy; attaching `then` starts the UPDATE before the
      // observer looks for its row-lock wait.
      const updatePromise = updater.$executeRaw`
        UPDATE "Business"
        SET "selfServiceCutoffHours" = ${NEW_CUTOFF},
            "cancellationPolicy" = ${NEW_POLICY},
            "updatedAt" = NOW()
        WHERE "id" = ${BUSINESS_ID}
        /* policy-linearization-update */
      `.then((count) => count)
      await waitForLockWait('UPDATE "Business"')

      releaseBlocker.resolve()
      const booking = await bookingPromise
      await updatePromise
      await blockerTransaction

      expect(booking.cancellationCutoffHours).toBe(OLD_CUTOFF)
      expect(booking.cancellationPolicySnapshot).toBe(OLD_POLICY)
      const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })
      expect(stored.cancellationCutoffHours).toBe(OLD_CUTOFF)
      expect(stored.cancellationPolicySnapshot).toBe(OLD_POLICY)
      const changedBusiness = await prisma.business.findUniqueOrThrow({
        where: { id: BUSINESS_ID },
        select: { selfServiceCutoffHours: true, cancellationPolicy: true },
      })
      expect(changedBusiness).toEqual({
        selfServiceCutoffHours: NEW_CUTOFF,
        cancellationPolicy: NEW_POLICY,
      })
    } finally {
      releaseBlocker.resolve()
      await blockerTransaction.catch(() => {})
    }
  })

  it('serializes public bookings before their per-day slot locks without lock upgrades', async () => {
    const secondStart = new Date(startDateTime.getTime() + 24 * 60 * 60 * 1000)
    const firstDate = formatInTimeZone(startDateTime, 'America/Santiago', 'yyyy-MM-dd')
    const secondDate = formatInTimeZone(secondStart, 'America/Santiago', 'yyyy-MM-dd')
    const slotsBlocked = await deferred()
    const releaseSlots = await deferred()
    const slotBlocker = blocker.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${hashStringToInt(`${BUSINESS_ID}:${firstDate}`)})`
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${hashStringToInt(`${BUSINESS_ID}:${secondDate}`)})`
      slotsBlocked.resolve()
      await releaseSlots.promise
    }, { timeout: 20_000 })
    await slotsBlocked.promise

    const first = unwrap(reserve(
      'policy-public-concurrent-a',
      revision(OLD_CUTOFF, OLD_POLICY),
      startDateTime,
    ))
    const second = unwrap(reserve(
      'policy-public-concurrent-b',
      revision(OLD_CUTOFF, OLD_POLICY),
      secondStart,
    ))

    try {
      // With FOR UPDATE, one request waits on Business while the winner waits
      // on its day lock. The former FOR SHARE let both reach slot locks and
      // then deadlock while upgrading bookingNumberSeq.
      await waitForLockWaitCount(2)
      releaseSlots.resolve()
      const results = await Promise.allSettled([first, second])
      await slotBlocker

      expect(results.every(({ status }) => status === 'fulfilled')).toBe(true)
      expect(await prisma.booking.count({ where: { businessId: BUSINESS_ID } })).toBe(2)
    } finally {
      releaseSlots.resolve()
      await slotBlocker.catch(() => {})
    }
  })

  it('keeps public and dashboard booking lock order deadlock-free', async () => {
    const dashboardPhone = '+56 9 1111 2222'
    const customerLock = hashStringToInt(
      `customer:${BUSINESS_ID}:${normalizePhone(dashboardPhone)}`,
    )
    const customerBlockerAcquired = await deferred()
    const releaseCustomerBlocker = await deferred()
    const customerBlocker = blocker.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${customerLock})`
      customerBlockerAcquired.resolve()
      await releaseCustomerBlocker.promise
    }, { timeout: 20_000 })
    await customerBlockerAcquired.promise

    const { createBookingFromDashboard } = await import('@/server/actions/bookings')
    const dashboardPromise = unwrap(createBookingFromDashboard({
      serviceId: SERVICE_ID,
      customerName: 'Dashboard',
      customerPhone: dashboardPhone,
      startDateTime,
      paymentMode: 'none',
    }))

    try {
      // Dashboard reaches the held Customer lock while retaining every earlier
      // lock. Starting public now forces the historically inverted order.
      await waitForLockWaitCount(1)
      const publicStart = new Date(startDateTime.getTime() + 2 * 60 * 60 * 1000)
      const publicPromise = unwrap(reserve(
        'policy-public-dashboard-order',
        revision(OLD_CUTOFF, OLD_POLICY),
        publicStart,
      ))
      await waitForLockWaitCount(2)

      releaseCustomerBlocker.resolve()
      const results = await Promise.allSettled([
        dashboardPromise,
        publicPromise,
      ])
      await customerBlocker

      expect(results.every(({ status }) => status === 'fulfilled')).toBe(true)
      const [dashboardBooking, publicBooking] = results.map((result) => {
        if (result.status === 'rejected') throw result.reason
        return result.value
      })
      expect(dashboardBooking.id).not.toBe(publicBooking.id)
      expect(await prisma.booking.count({ where: { businessId: BUSINESS_ID } })).toBe(2)
    } finally {
      releaseCustomerBlocker.resolve()
      await customerBlocker.catch(() => {})
    }
  })

  it('preserves an idempotent retry snapshot after a later policy change', async () => {
    const oldRevision = revision(OLD_CUTOFF, OLD_POLICY)
    const first = await unwrap(reserve('policy-idempotent', oldRevision))
    await prisma.business.update({
      where: { id: BUSINESS_ID },
      data: {
        selfServiceCutoffHours: NEW_CUTOFF,
        cancellationPolicy: NEW_POLICY,
      },
    })

    const retry = await unwrap(reserve('policy-idempotent', oldRevision))

    expect(retry.id).toBe(first.id)
    expect(retry.cancellationCutoffHours).toBe(OLD_CUTOFF)
    expect(retry.cancellationPolicySnapshot).toBe(OLD_POLICY)
    expect(await prisma.booking.count({ where: { businessId: BUSINESS_ID } })).toBe(1)
  })
})
