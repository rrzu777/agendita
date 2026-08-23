import { Prisma, type BusinessRole, type PrismaClient } from '@prisma/client'
import { assertSafeTestDatabaseUrl } from '../../helpers/test-database-safety'

export type DashboardFixture = {
  businessId: string
  email: string
  ownerUserId: string
  userId: string
}

export type DashboardFixtureClient = {
  $transaction<T>(callback: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T>
  business: Pick<PrismaClient['business'], 'delete'>
  user: Pick<PrismaClient['user'], 'delete'>
}

let fixtureSequence = 0

function fixtureSuffix() {
  fixtureSequence += 1
  return `${Date.now()}-${process.pid}-${fixtureSequence}`
}

function assertDashboardTourDatabase() {
  assertSafeTestDatabaseUrl(process.env.DATABASE_URL)
}

export async function createDashboardFixture(
  client: DashboardFixtureClient,
  {
    role,
    withBooking = false,
  }: {
    role: BusinessRole
    withBooking?: boolean
  },
): Promise<DashboardFixture> {
  assertDashboardTourDatabase()
  const suffix = fixtureSuffix()
  const email = `dashboard-tours-${role}-${suffix}@e2e.agendita.test`

  return client.$transaction(async (transaction) => {
    const owner = role === 'owner'
      ? null
      : await transaction.user.create({
          data: {
            email: `dashboard-tours-owner-for-${role}-${suffix}@e2e.agendita.test`,
            name: `Dashboard Tours owner for ${role}`,
          },
        })
    const actor = await transaction.user.create({
      data: { email, name: `Dashboard Tours ${role}` },
    })
    const ownerUserId = owner?.id ?? actor.id
    const business = await transaction.business.create({
      data: {
        name: `Tours ${role} ${suffix}`,
        slug: `tours-${role}-${suffix}`,
        subdomain: `tours-${role}-${suffix}`,
        ownerUserId,
        city: 'Santiago',
        onboardingCompletedAt: new Date(),
      },
    })

    await transaction.businessUser.create({
      data: { businessId: business.id, userId: ownerUserId, role: 'owner' },
    })
    if (actor.id !== ownerUserId) {
      await transaction.businessUser.create({
        data: { businessId: business.id, userId: actor.id, role },
      })
    }

    if (withBooking) {
      const service = await transaction.service.create({
        data: {
          businessId: business.id,
          name: 'Servicio E2E de recorridos',
          durationMinutes: 60,
          price: 20_000,
          depositAmount: 5_000,
          pastelColor: '#A3D8FF',
        },
      })
      const customer = await transaction.customer.create({
        data: {
          businessId: business.id,
          name: 'Cliente E2E recorridos',
          phone: `+569${String(fixtureSequence).padStart(8, '0')}`,
        },
      })
      const startDateTime = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

      await transaction.booking.create({
        data: {
          businessId: business.id,
          serviceId: service.id,
          customerId: customer.id,
          startDateTime,
          endDateTime: new Date(startDateTime.getTime() + 60 * 60 * 1000),
          status: 'confirmed',
          totalPrice: 20_000,
          depositRequired: 5_000,
          depositPaid: 5_000,
          remainingBalance: 15_000,
          finalAmount: 20_000,
          paymentStatus: 'deposit_paid',
        },
      })
    }

    return { businessId: business.id, email, ownerUserId, userId: actor.id }
  })
}

export async function cleanupDashboardFixture(
  client: DashboardFixtureClient,
  fixture: DashboardFixture,
) {
  assertDashboardTourDatabase()
  const failures: unknown[] = []
  const attempt = async (operation: () => Promise<unknown>) => {
    try {
      await operation()
    } catch (error) {
      failures.push(error)
    }
  }

  await attempt(() => client.business.delete({ where: { id: fixture.businessId } }))
  for (const userId of new Set([fixture.userId, fixture.ownerUserId])) {
    await attempt(() => client.user.delete({ where: { id: userId } }))
  }

  if (failures.length > 0) {
    throw new AggregateError(failures, 'Dashboard tour fixture cleanup failed.')
  }
}
