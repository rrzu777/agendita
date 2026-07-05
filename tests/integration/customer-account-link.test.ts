import { PrismaClient } from '@prisma/client'
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { requireTestDatabase } from './setup'

requireTestDatabase()

// Approach: createBooking (public server action) envuelve su lógica con
// checkRateLimit, revalidatePath/revalidateBusinessPublicPaths, notificaciones
// y getCurrentUser (sesión). Siguiendo el precedente de
// tests/integration/packages-actions.test.ts y time-block-series.test.ts,
// mockeamos esas capas de infraestructura para poder ejercitar la LÓGICA REAL
// de vinculación de Customer<->User contra un Postgres real.
const BIZ = 'cal-biz-1'
const OWNER_USER = 'cal-owner-1'
const LOGGED_USER = 'test-user-1'

let mockSessionUser: { id: string; email: string } | null = null

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => ({ success: true, remaining: 30, resetAt: 0 }) }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/server/actions/revalidate-business', () => ({ revalidateBusinessPublicPaths: async () => {} }))
vi.mock('@/lib/notifications', () => ({
  getBusinessReplyToEmail: async () => 'owner@cal.test',
  sendBookingReceivedToCustomer: async () => {},
  sendNewBookingNotificationToBusiness: async () => {},
  sendBookingCancelledNotification: async () => {},
  sendBookingConfirmedNotification: async () => {},
  sendBookingRescheduledNotification: async () => {},
  sendNotificationSafely: async () => ({ success: true }),
  sendMultiNotificationSafely: async () => [],
}))
vi.mock('@/lib/auth/user', () => ({
  getCurrentUser: async () => mockSessionUser,
}))

describe('customer-account link (vía 3)', () => {
  let prisma: PrismaClient
  let svc: { id: string; durationMinutes: number; price: number; depositAmount: number }

  beforeAll(async () => {
    prisma = new PrismaClient()

    await prisma.booking.deleteMany()
    await prisma.customer.deleteMany()
    await prisma.service.deleteMany()
    await prisma.availabilityRule.deleteMany()
    await prisma.businessUser.deleteMany()
    await prisma.business.deleteMany()
    await prisma.user.deleteMany({ where: { id: { in: [OWNER_USER, LOGGED_USER] } } })

    await prisma.user.create({
      data: { id: OWNER_USER, email: 'owner@cal.test', name: 'Cal Owner' },
    })

    await prisma.business.create({
      data: {
        id: BIZ,
        name: 'Cal Biz',
        slug: 'cal-biz',
        subdomain: 'calbiz',
        ownerUserId: OWNER_USER,
        city: 'Santiago',
        country: 'CL',
        currency: 'CLP',
        timezone: 'America/Santiago',
        bookingWindowDays: 90,
      },
    })

    await prisma.businessUser.create({
      data: { id: 'cal-bu-owner', businessId: BIZ, userId: OWNER_USER, role: 'owner' },
    })

    svc = await prisma.service.create({
      data: {
        id: 'cal-svc-1',
        businessId: BIZ,
        name: 'Corte',
        durationMinutes: 60,
        price: 20000,
        depositAmount: 0,
        pastelColor: '#FFD700',
      },
    })

    for (let day = 0; day <= 6; day++) {
      await prisma.availabilityRule.create({
        data: {
          businessId: BIZ,
          dayOfWeek: day,
          startTime: '00:00',
          endTime: '23:59',
          isActive: true,
        },
      })
    }
  })

  afterAll(async () => {
    await prisma.booking.deleteMany({ where: { businessId: BIZ } })
    await prisma.customer.deleteMany({ where: { businessId: BIZ } })
    await prisma.service.deleteMany({ where: { businessId: BIZ } })
    await prisma.availabilityRule.deleteMany({ where: { businessId: BIZ } })
    await prisma.businessUser.deleteMany({ where: { businessId: BIZ } })
    await prisma.business.deleteMany({ where: { id: BIZ } })
    await prisma.user.deleteMany({ where: { id: { in: [OWNER_USER, LOGGED_USER] } } })
    await prisma.$disconnect()
  })

  beforeEach(() => {
    mockSessionUser = null
  })

  function futureDate(daysAhead: number, hourUTC: number) {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() + daysAhead)
    d.setUTCHours(hourUTC, 0, 0, 0)
    return d
  }

  it('links the new Customer to the logged-in User when booking with an active session', async () => {
    const { createBooking } = await import('@/server/actions/bookings')

    await prisma.user.upsert({
      where: { id: LOGGED_USER },
      create: { id: LOGGED_USER, email: 'logged-1@cal.test', name: 'Logged Client' },
      update: {},
    })
    mockSessionUser = { id: LOGGED_USER, email: 'logged-1@cal.test' }

    const phone = '+56911100001'
    const booking = await createBooking(
      {
        serviceId: svc.id,
        customerName: 'Ana',
        customerPhone: phone,
        startDateTime: futureDate(2, 15),
        acceptedTerms: true,
      },
      BIZ,
    )

    const customer = await prisma.customer.findFirst({ where: { businessId: BIZ, phone } })
    expect(customer).not.toBeNull()
    expect(customer!.userId).toBe(LOGGED_USER)
    expect(booking).toBeDefined()
  })

  it('never overwrites an existing userId on the Customer', async () => {
    const { createBooking } = await import('@/server/actions/bookings')

    await prisma.user.upsert({
      where: { id: LOGGED_USER },
      create: { id: LOGGED_USER, email: 'logged-2@cal.test', name: 'Logged Client' },
      update: {},
    })
    const otherUserId = 'cal-other-user-1'
    await prisma.user.upsert({
      where: { id: otherUserId },
      create: { id: otherUserId, email: 'other@cal.test', name: 'Other User' },
      update: {},
    })

    const phone = '+56911100002'
    await prisma.customer.create({
      data: {
        businessId: BIZ,
        name: 'Bea',
        phone,
        userId: otherUserId,
      },
    })

    mockSessionUser = { id: LOGGED_USER, email: 'logged-2@cal.test' }

    await createBooking(
      {
        serviceId: svc.id,
        customerName: 'Bea',
        customerPhone: phone,
        startDateTime: futureDate(3, 15),
        acceptedTerms: true,
      },
      BIZ,
    )

    const customer = await prisma.customer.findFirst({ where: { businessId: BIZ, phone } })
    expect(customer).not.toBeNull()
    expect(customer!.userId).toBe(otherUserId)
  })

  it('does not link business members (owner/staff booking on behalf of clients)', async () => {
    const { createBooking } = await import('@/server/actions/bookings')

    // OWNER_USER is already a BusinessUser member of BIZ (seeded in beforeAll).
    mockSessionUser = { id: OWNER_USER, email: 'owner@cal.test' }

    const phone = '+56911100003'
    await createBooking(
      {
        serviceId: svc.id,
        customerName: 'Cata',
        customerPhone: phone,
        startDateTime: futureDate(4, 15),
        acceptedTerms: true,
      },
      BIZ,
    )

    const customer = await prisma.customer.findFirst({ where: { businessId: BIZ, phone } })
    expect(customer).not.toBeNull()
    expect(customer!.userId).toBeNull()
  })

  it('linkCustomersByVerifiedEmail links only the unlinked Customer with a matching (trimmed, case-insensitive) email', async () => {
    const { linkCustomersByVerifiedEmail } = await import('@/lib/customers/link')

    await prisma.user.upsert({
      where: { id: LOGGED_USER },
      create: { id: LOGGED_USER, email: 'logged-4@cal.test', name: 'Logged Client' },
      update: {},
    })
    const alreadyLinkedUser = 'cal-already-linked-user-1'
    await prisma.user.upsert({
      where: { id: alreadyLinkedUser },
      create: { id: alreadyLinkedUser, email: 'already@cal.test', name: 'Already Linked' },
      update: {},
    })

    const unlinked = await prisma.customer.create({
      data: {
        businessId: BIZ,
        name: 'Dani',
        phone: '+56911100004',
        email: 'Ana@Example.com',
      },
    })
    const alreadyLinked = await prisma.customer.create({
      data: {
        businessId: BIZ,
        name: 'Elena',
        phone: '+56911100005',
        email: 'ANA@EXAMPLE.COM',
        userId: alreadyLinkedUser,
      },
    })

    const count = await linkCustomersByVerifiedEmail(prisma, LOGGED_USER, ' ana@example.com ')
    expect(count).toBe(1)

    const unlinkedAfter = await prisma.customer.findUnique({ where: { id: unlinked.id } })
    expect(unlinkedAfter?.userId).toBe(LOGGED_USER)

    const alreadyLinkedAfter = await prisma.customer.findUnique({ where: { id: alreadyLinked.id } })
    expect(alreadyLinkedAfter?.userId).toBe(alreadyLinkedUser)
  })
})
