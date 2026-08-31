import { PrismaClient } from '@prisma/client'

export const databaseUrl = 'postgresql://analytics:analytics@127.0.0.1:55439/agendita_owner_analytics_test'
export const fixture = {
  businessId: 'owner-analytics-public-e2e-task6',
  slug: 'owner-analytics-public-e2e-task6',
  customerId: 'owner-analytics-public-customer-task6',
  customerEmail: 'customer-task6@e2e.agendita.test',
  ownerId: 'owner-analytics-public-owner-task6',
  ownerEmail: 'owner-task6@e2e.agendita.test',
  serviceId: 'owner-analytics-public-service-task6',
  linkToken: 'syntheticacquisitiontoken00000006',
}

export function guardedPrisma() {
  if (process.env.DATABASE_URL !== databaseUrl || process.env.DIRECT_URL !== databaseUrl || process.env.NODE_ENV === 'production') {
    throw new Error('Public analytics fixture requires BOTH exact exclusive loopback database URLs and non-production runtime')
  }
  return new PrismaClient()
}

export async function seedPublicFixture(prisma) {
  // Never delete/reuse an existing fixture: it might belong to an active run.
  await prisma.$transaction(async (tx) => {
    await tx.user.createMany({ data: [
      { id: fixture.ownerId, email: fixture.ownerEmail, name: 'Synthetic Owner' },
      { id: fixture.customerId, email: fixture.customerEmail, name: 'Synthetic Customer' },
    ] })
    // Path-hosted loopback fixture: a subdomain of an IPv4 literal is not a valid URL.
    await tx.business.create({ data: { id: fixture.businessId, name: 'Analytics QA local', slug: fixture.slug, subdomain: '', ownerUserId: fixture.ownerId, city: 'Santiago', timezone: 'America/Santiago', onboardingCompletedAt: new Date(), bookingPolicy: 'Reserva de prueba local', cancellationReminderEnabled: false } })
    await tx.businessUser.create({ data: { businessId: fixture.businessId, userId: fixture.ownerId, role: 'owner' } })
    await tx.service.create({ data: { id: fixture.serviceId, businessId: fixture.businessId, name: 'Servicio de prueba', durationMinutes: 30, price: 10000, depositAmount: 0, pastelColor: '#e0ece6' } })
    await tx.availabilityRule.createMany({ data: Array.from({ length: 7 }, (_, dayOfWeek) => ({ businessId: fixture.businessId, dayOfWeek, startTime: '09:00', endTime: '18:00' })) })
    await tx.analyticsCollectionPeriod.create({ data: { businessId: fixture.businessId, definitionVersion: 1, consentVersion: 1, businessTimeZone: 'America/Santiago', startedAt: new Date() } })
    await tx.acquisitionLink.create({ data: { businessId: fixture.businessId, token: fixture.linkToken, channel: 'instagram', campaignName: 'QA local' } })
  })
}

export async function cleanPublicFixture(prisma) {
  await prisma.business.delete({ where: { id: fixture.businessId } })
  await prisma.user.deleteMany({ where: { id: { in: [fixture.customerId, fixture.ownerId] } } })
}
