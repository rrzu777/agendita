import { PrismaClient, type BusinessRole } from '@prisma/client'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { unwrap } from './helpers/action-result'
import { requireTestDatabase } from './setup'

requireTestDatabase()

const USER_ONE = 'tour-progress-user-1'
const USER_TWO = 'tour-progress-user-2'
const BUSINESS_ONE = 'tour-progress-business-1'
const BUSINESS_TWO = 'tour-progress-business-2'
const CASCADE_USER = 'tour-progress-cascade-user'
const CASCADE_BUSINESS = 'tour-progress-cascade-business'

const auth = vi.hoisted(() => ({
  current: {
    businessId: 'tour-progress-business-1',
    role: 'owner' as BusinessRole,
    user: { id: 'tour-progress-user-1' },
  },
}))

vi.mock('@/lib/auth/server', () => ({
  requireBusinessRole: async (allowedRoles: BusinessRole[]) => {
    if (!allowedRoles.includes(auth.current.role)) {
      throw new Error('forbidden test context')
    }
    return auth.current
  },
}))

const { getTourProgress, recordTourProgress } = await import('@/server/actions/tour-progress')
const prisma = new PrismaClient()

function setAuth(userId: string, businessId: string, role: BusinessRole = 'owner') {
  auth.current = { user: { id: userId }, businessId, role }
}

async function cleanupAuxiliaryFixtures() {
  await prisma.business.deleteMany({ where: { id: CASCADE_BUSINESS } })
  await prisma.user.deleteMany({ where: { id: CASCADE_USER } })
}

describe('persisted tour progress', () => {
  beforeAll(async () => {
    await cleanupAuxiliaryFixtures()
    await prisma.business.deleteMany({
      where: { id: { in: [BUSINESS_ONE, BUSINESS_TWO] } },
    })
    await prisma.user.deleteMany({
      where: { id: { in: [USER_ONE, USER_TWO] } },
    })
    await prisma.user.createMany({
      data: [
        { id: USER_ONE, email: 'tour-progress-1@agendita.test', name: 'Tour One' },
        { id: USER_TWO, email: 'tour-progress-2@agendita.test', name: 'Tour Two' },
      ],
    })
    await prisma.business.createMany({
      data: [
        {
          id: BUSINESS_ONE,
          name: 'Tour Business One',
          slug: 'tour-progress-business-1',
          subdomain: 'tour-progress-business-1',
          ownerUserId: USER_ONE,
          city: 'Santiago',
        },
        {
          id: BUSINESS_TWO,
          name: 'Tour Business Two',
          slug: 'tour-progress-business-2',
          subdomain: 'tour-progress-business-2',
          ownerUserId: USER_ONE,
          city: 'Santiago',
        },
      ],
    })
    await prisma.businessUser.createMany({
      data: [
        { id: 'tour-progress-membership-1', userId: USER_ONE, businessId: BUSINESS_ONE, role: 'owner' },
        { id: 'tour-progress-membership-2', userId: USER_ONE, businessId: BUSINESS_TWO, role: 'admin' },
        { id: 'tour-progress-membership-3', userId: USER_TWO, businessId: BUSINESS_ONE, role: 'admin' },
      ],
    })
  })

  afterEach(async () => {
    await prisma.userTourProgress.deleteMany({
      where: {
        OR: [
          { userId: { in: [USER_ONE, USER_TWO, CASCADE_USER] } },
          { businessId: { in: [BUSINESS_ONE, BUSINESS_TWO, CASCADE_BUSINESS] } },
        ],
      },
    })
    await cleanupAuxiliaryFixtures()
  })

  afterAll(async () => {
    await cleanupAuxiliaryFixtures()
    await prisma.business.deleteMany({
      where: { id: { in: [BUSINESS_ONE, BUSINESS_TWO] } },
    })
    await prisma.user.deleteMany({
      where: { id: { in: [USER_ONE, USER_TWO] } },
    })
    await prisma.$disconnect()
  })

  it('isolates progress by authenticated user and business', async () => {
    setAuth(USER_ONE, BUSINESS_ONE)
    await unwrap(recordTourProgress({
      key: 'bookings', version: 1, event: { type: 'step', step: 1 },
    }))
    setAuth(USER_ONE, BUSINESS_TWO, 'admin')
    await unwrap(recordTourProgress({
      key: 'bookings', version: 1, event: { type: 'step', step: 2 },
    }))
    setAuth(USER_TWO, BUSINESS_ONE, 'admin')
    await unwrap(recordTourProgress({
      key: 'bookings', version: 1, event: { type: 'dismiss' },
    }))

    setAuth(USER_ONE, BUSINESS_ONE)
    await expect(unwrap(getTourProgress())).resolves.toEqual([{
      key: 'bookings', version: 1, status: 'in_progress', lastStep: 1,
    }])
    setAuth(USER_ONE, BUSINESS_TWO, 'admin')
    await expect(unwrap(getTourProgress())).resolves.toEqual([{
      key: 'bookings', version: 1, status: 'in_progress', lastStep: 2,
    }])
    setAuth(USER_TWO, BUSINESS_ONE, 'admin')
    await expect(unwrap(getTourProgress())).resolves.toEqual([{
      key: 'bookings', version: 1, status: 'dismissed', lastStep: 0,
    }])
    await expect(prisma.userTourProgress.count({
      where: { tourKey: 'bookings', tourVersion: 1 },
    })).resolves.toBe(3)
  })

  it('keeps completion monotonic when stale start and step events arrive', async () => {
    setAuth(USER_ONE, BUSINESS_ONE)
    await unwrap(recordTourProgress({
      key: 'payments', version: 1, event: { type: 'step', step: 3 },
    }))
    await unwrap(recordTourProgress({
      key: 'payments', version: 1, event: { type: 'complete' },
    }))

    const staleResults = await Promise.all([
      unwrap(recordTourProgress({
        key: 'payments', version: 1, event: { type: 'start' },
      })),
      unwrap(recordTourProgress({
        key: 'payments', version: 1, event: { type: 'step', step: 1 },
      })),
    ])

    expect(staleResults).toEqual([
      { key: 'payments', version: 1, status: 'completed', lastStep: 3 },
      { key: 'payments', version: 1, status: 'completed', lastStep: 3 },
    ])
    await expect(prisma.userTourProgress.findUniqueOrThrow({
      where: {
        userId_businessId_tourKey_tourVersion: {
          userId: USER_ONE,
          businessId: BUSINESS_ONE,
          tourKey: 'payments',
          tourVersion: 1,
        },
      },
      select: { status: true, lastStep: true, completedAt: true },
    })).resolves.toEqual({
      status: 'completed',
      lastStep: 3,
      completedAt: expect.any(Date),
    })
  })

  it('keeps duplicate completion and dismissal rows fully idempotent', async () => {
    setAuth(USER_ONE, BUSINESS_ONE)
    await unwrap(recordTourProgress({
      key: 'dashboard_intro', version: 1, event: { type: 'complete' },
    }))
    const completedIdentity = {
      userId: USER_ONE,
      businessId: BUSINESS_ONE,
      tourKey: 'dashboard_intro',
      tourVersion: 1,
    }
    const completedSentinel = new Date('2020-01-01T00:00:00.000Z')
    const completedOnce = await prisma.userTourProgress.update({
      where: { userId_businessId_tourKey_tourVersion: completedIdentity },
      data: { updatedAt: completedSentinel },
    })
    await unwrap(recordTourProgress({
      key: 'dashboard_intro', version: 1, event: { type: 'complete' },
    }))
    const completedTwice = await prisma.userTourProgress.findUniqueOrThrow({
      where: { userId_businessId_tourKey_tourVersion: completedIdentity },
    })

    await unwrap(recordTourProgress({
      key: 'settings', version: 1, event: { type: 'dismiss' },
    }))
    const dismissedIdentity = {
      userId: USER_ONE,
      businessId: BUSINESS_ONE,
      tourKey: 'settings',
      tourVersion: 1,
    }
    const dismissedSentinel = new Date('2020-02-01T00:00:00.000Z')
    const dismissedOnce = await prisma.userTourProgress.update({
      where: { userId_businessId_tourKey_tourVersion: dismissedIdentity },
      data: { updatedAt: dismissedSentinel },
    })
    await unwrap(recordTourProgress({
      key: 'settings', version: 1, event: { type: 'dismiss' },
    }))
    const dismissedTwice = await prisma.userTourProgress.findUniqueOrThrow({
      where: { userId_businessId_tourKey_tourVersion: dismissedIdentity },
    })

    expect(completedTwice.completedAt).toEqual(completedOnce.completedAt)
    expect(completedTwice.updatedAt).toEqual(completedSentinel)
    expect(completedTwice.status).toBe('completed')
    expect(dismissedTwice.dismissedAt).toEqual(dismissedOnce.dismissedAt)
    expect(dismissedTwice.updatedAt).toEqual(dismissedSentinel)
    expect(dismissedTwice.status).toBe('dismissed')
    await expect(prisma.userTourProgress.count({
      where: { userId: USER_ONE, businessId: BUSINESS_ONE },
    })).resolves.toBe(2)
  })

  it('still writes legal non-terminal progression', async () => {
    setAuth(USER_ONE, BUSINESS_ONE)
    await unwrap(recordTourProgress({
      key: 'bookings', version: 1, event: { type: 'start' },
    }))
    const identity = {
      userId: USER_ONE,
      businessId: BUSINESS_ONE,
      tourKey: 'bookings',
      tourVersion: 1,
    }
    const sentinel = new Date('2020-03-01T00:00:00.000Z')
    await prisma.userTourProgress.update({
      where: { userId_businessId_tourKey_tourVersion: identity },
      data: { updatedAt: sentinel },
    })

    await unwrap(recordTourProgress({
      key: 'bookings', version: 1, event: { type: 'step', step: 2 },
    }))

    const progressed = await prisma.userTourProgress.findUniqueOrThrow({
      where: { userId_businessId_tourKey_tourVersion: identity },
      select: { status: true, lastStep: true, updatedAt: true },
    })
    expect(progressed).toMatchObject({ status: 'in_progress', lastStep: 2 })
    expect(progressed.updatedAt).not.toEqual(sentinel)
  })

  it('cascades progress when either its user or its business is deleted', async () => {
    await prisma.user.create({
      data: { id: CASCADE_USER, email: 'tour-progress-cascade@agendita.test' },
    })
    await prisma.businessUser.create({
      data: {
        id: 'tour-progress-cascade-user-membership',
        userId: CASCADE_USER,
        businessId: BUSINESS_ONE,
        role: 'admin',
      },
    })
    setAuth(CASCADE_USER, BUSINESS_ONE, 'admin')
    const userProgress = await unwrap(recordTourProgress({
      key: 'bookings', version: 1, event: { type: 'start' },
    }))
    expect(userProgress.status).toBe('in_progress')
    await prisma.user.delete({ where: { id: CASCADE_USER } })
    await expect(prisma.userTourProgress.count({
      where: { userId: CASCADE_USER },
    })).resolves.toBe(0)

    await prisma.business.create({
      data: {
        id: CASCADE_BUSINESS,
        name: 'Tour Cascade Business',
        slug: 'tour-progress-cascade-business',
        subdomain: 'tour-progress-cascade-business',
        ownerUserId: USER_ONE,
        city: 'Santiago',
      },
    })
    await prisma.businessUser.create({
      data: {
        id: 'tour-progress-cascade-business-membership',
        userId: USER_ONE,
        businessId: CASCADE_BUSINESS,
        role: 'owner',
      },
    })
    setAuth(USER_ONE, CASCADE_BUSINESS)
    const businessProgress = await unwrap(recordTourProgress({
      key: 'bookings', version: 1, event: { type: 'start' },
    }))
    expect(businessProgress.status).toBe('in_progress')
    await prisma.business.delete({ where: { id: CASCADE_BUSINESS } })
    await expect(prisma.userTourProgress.count({
      where: { businessId: CASCADE_BUSINESS },
    })).resolves.toBe(0)
  })

  it('serializes concurrent starts and preserves the greatest concurrent step', async () => {
    setAuth(USER_ONE, BUSINESS_ONE)
    const starts = await Promise.all(Array.from({ length: 8 }, () =>
      unwrap(recordTourProgress({
        key: 'bookings', version: 1, event: { type: 'start' },
      }))))

    expect(starts.every((snapshot) => snapshot.status === 'in_progress')).toBe(true)
    await expect(prisma.userTourProgress.count({
      where: {
        userId: USER_ONE,
        businessId: BUSINESS_ONE,
        tourKey: 'bookings',
        tourVersion: 1,
      },
    })).resolves.toBe(1)

    await Promise.all([5, 1, 8, 3, 2].map((step) =>
      unwrap(recordTourProgress({
        key: 'bookings', version: 1, event: { type: 'step', step },
      }))))
    await expect(prisma.userTourProgress.findFirstOrThrow({
      where: { userId: USER_ONE, businessId: BUSINESS_ONE, tourKey: 'bookings' },
      select: { lastStep: true },
    })).resolves.toEqual({ lastStep: 8 })
  })
})
