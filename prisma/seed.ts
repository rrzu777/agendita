import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  await prisma.subscriptionPayment.deleteMany()
  await prisma.subscriptionLog.deleteMany()
  await prisma.businessSubscription.deleteMany()
  await prisma.plan.deleteMany()
  await prisma.ledgerEntry.deleteMany()
  await prisma.payment.deleteMany()
  await prisma.review.deleteMany()
  await prisma.booking.deleteMany()
  await prisma.customer.deleteMany()
  await prisma.galleryImage.deleteMany()
  await prisma.service.deleteMany()
  await prisma.timeBlock.deleteMany()
  await prisma.availabilityRule.deleteMany()
  await prisma.businessUser.deleteMany()
  await prisma.business.deleteMany()
  await prisma.user.deleteMany()

  const betaFreePlan = await prisma.plan.create({
    data: {
      name: 'Beta gratis',
      description: 'Plan gratuito para negocios durante la beta. Acceso completo a todas las funcionalidades.',
      priceMonthly: 0,
      priceYearly: 0,
      isPublic: false,
      sortOrder: 1,
    },
  })

  await prisma.plan.create({
    data: {
      name: 'Básico',
      description: 'Perfil público, reservas ilimitadas y recordatorios por email.',
      priceMonthly: 14990,
      priceYearly: 149900,
      isPublic: true,
      sortOrder: 2,
    },
  })

  await prisma.plan.create({
    data: {
      name: 'Pro',
      description: 'Todo lo del plan Básico más Mercado Pago integrado, WhatsApp recordatorios y reportes.',
      priceMonthly: 24990,
      priceYearly: 249900,
      isPublic: true,
      sortOrder: 3,
    },
  })

  const ownerUser = await prisma.user.create({
    data: {
      email: 'owner@mimosnails.com',
      name: 'Camila Morales',
    },
  })

  const thirtyDaysFromNow = new Date()
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30)
  const ninetyDaysFromNow = new Date()
  ninetyDaysFromNow.setDate(ninetyDaysFromNow.getDate() + 90)

  const business = await prisma.business.create({
    data: {
      name: 'Mimos Nails',
      slug: 'mimosnails',
      subdomain: 'mimosnails',
      ownerUserId: ownerUser.id,
      bio: 'Manicura rusa y esmaltado permanente en Santiago. Especialista en uñas esculpidas.',
      whatsapp: '+56912345678',
      instagram: '@mimosnails',
      addressText: 'Providencia, Santiago',
      city: 'Santiago',
      currency: 'CLP',
      timezone: 'America/Santiago',
      planId: betaFreePlan.id,
      subscriptionStatus: 'trialing',
      trialEndsAt: ninetyDaysFromNow,
    },
  })

  await prisma.businessSubscription.create({
    data: {
      businessId: business.id,
      planId: betaFreePlan.id,
      status: 'trialing',
      interval: 'monthly',
      currentPeriodStart: new Date(),
      currentPeriodEnd: ninetyDaysFromNow,
      trialStartAt: new Date(),
      trialEndAt: ninetyDaysFromNow,
    },
  })

  // Link user to business
  await prisma.businessUser.create({
    data: {
      businessId: business.id,
      userId: ownerUser.id,
      role: 'owner',
    },
  })

  // Create services
  await prisma.service.createMany({
    data: [
      {
        businessId: business.id,
        name: 'Manicura rusa',
        description: 'Limpieza profunda de cutícula, nivelación y esmaltado.',
        durationMinutes: 120,
        price: 28000,
        depositAmount: 10000,
        pastelColor: '#FFB3BA',
        sortOrder: 1,
      },
      {
        businessId: business.id,
        name: 'Esmaltado permanente',
        description: 'Esmaltado en gel con larga duración.',
        durationMinutes: 90,
        price: 22000,
        depositAmount: 8000,
        pastelColor: '#E2B3FF',
        sortOrder: 2,
      },
      {
        businessId: business.id,
        name: 'Kapping gel',
        description: 'Refuerzo de uña natural con gel.',
        durationMinutes: 90,
        price: 25000,
        depositAmount: 8000,
        pastelColor: '#A3D8FF',
        sortOrder: 3,
      },
    ],
  })

  // Create E2E test user (for Playwright E2E auth bypass)
  const e2eUser = await prisma.user.create({
    data: {
      email: 'e2e@test.agendita.com',
      name: 'E2E Test User',
    },
  })

  await prisma.businessUser.create({
    data: {
      businessId: business.id,
      userId: e2eUser.id,
      role: 'staff',
    },
  })

  // Create availability rules
  await prisma.availabilityRule.createMany({
    data: [
      { businessId: business.id, dayOfWeek: 1, startTime: '09:00', endTime: '18:00' },
      { businessId: business.id, dayOfWeek: 2, startTime: '09:00', endTime: '18:00' },
      { businessId: business.id, dayOfWeek: 3, startTime: '09:00', endTime: '18:00' },
      { businessId: business.id, dayOfWeek: 4, startTime: '09:00', endTime: '18:00' },
      { businessId: business.id, dayOfWeek: 5, startTime: '09:00', endTime: '18:00' },
      { businessId: business.id, dayOfWeek: 6, startTime: '10:00', endTime: '15:00' },
    ],
  })

  console.log('Seed completed successfully')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
