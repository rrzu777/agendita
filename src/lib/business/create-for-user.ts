/**
 * Alta del negocio de una cuenta recién registrada, con sus plantillas de
 * servicios por rubro.
 *
 * Vive acá y NO en `lib/auth/actions.ts` por seguridad, no por prolijidad: ese
 * módulo empieza con `'use server'`, así que **todo** lo que exporta queda
 * publicado como server action invocable por cualquiera. Exportada desde allá,
 * `createBusinessForUser` recibía un `userId` y un `email` arbitrarios sin
 * ningún guard de sesión: un caller anónimo podía crear usuarios y negocios a
 * voluntad. Acá no hay directiva, así que es una función server-side común y
 * el único camino público sigue siendo `signUp`.
 *
 * A propósito SIN envolver en `action()`: sólo la llama `_signUp` (que traduce
 * sus `RegistrationError`) y los tests. Si algún día la invoca un componente
 * cliente, hay que envolverla — sus mensajes se redactan en prod.
 */
import { prisma } from '@/lib/db'
import { generateDefaultSubdomain } from '@/lib/business/subdomain'
import { randomBookingNumberBase } from '@/lib/bookings/number'
import { RegistrationError } from '@/lib/auth/registration-error'
import { DEFAULT_WEEKLY_SCHEDULE } from '@/lib/availability/weekly-schedule'

const BUSINESS_CATEGORIES = ['nails', 'barber', 'hair_salon', 'beauty', 'massage', 'therapy', 'other'] as const
type BusinessCategoryInput = typeof BUSINESS_CATEGORIES[number]

const SERVICE_TEMPLATES: Record<BusinessCategoryInput, Array<{ name: string; description: string; durationMinutes: number; price: number; depositAmount: number; pastelColor: string; sortOrder: number }>> = {
  nails: [
    { name: 'Manicura rusa', description: 'Limpieza profunda de cutícula, nivelación y esmaltado.', durationMinutes: 120, price: 28000, depositAmount: 10000, pastelColor: '#FFB3BA', sortOrder: 1 },
    { name: 'Esmaltado permanente', description: 'Esmaltado en gel con larga duración.', durationMinutes: 90, price: 22000, depositAmount: 8000, pastelColor: '#E2B3FF', sortOrder: 2 },
    { name: 'Kapping gel', description: 'Refuerzo de uña natural con gel.', durationMinutes: 90, price: 25000, depositAmount: 8000, pastelColor: '#A3D8FF', sortOrder: 3 },
  ],
  barber: [
    { name: 'Corte de cabello', description: 'Corte clásico o moderno con terminación.', durationMinutes: 45, price: 12000, depositAmount: 0, pastelColor: '#A3D8FF', sortOrder: 1 },
    { name: 'Perfilado de barba', description: 'Diseño y perfilado de barba.', durationMinutes: 30, price: 9000, depositAmount: 0, pastelColor: '#B8E0D2', sortOrder: 2 },
  ],
  hair_salon: [
    { name: 'Corte y brushing', description: 'Corte de cabello con brushing.', durationMinutes: 60, price: 18000, depositAmount: 0, pastelColor: '#FFDAC1', sortOrder: 1 },
    { name: 'Coloración', description: 'Coloración o retoque de raíz.', durationMinutes: 120, price: 35000, depositAmount: 10000, pastelColor: '#E2B3FF', sortOrder: 2 },
  ],
  beauty: [
    { name: 'Limpieza facial', description: 'Limpieza facial personalizada.', durationMinutes: 60, price: 25000, depositAmount: 8000, pastelColor: '#C7CEEA', sortOrder: 1 },
    { name: 'Perfilado de cejas', description: 'Diseño y perfilado de cejas.', durationMinutes: 30, price: 10000, depositAmount: 0, pastelColor: '#FFB3BA', sortOrder: 2 },
  ],
  massage: [
    { name: 'Masaje relajante', description: 'Sesión de masaje relajante.', durationMinutes: 60, price: 30000, depositAmount: 10000, pastelColor: '#B8E0D2', sortOrder: 1 },
    { name: 'Masaje descontracturante', description: 'Masaje focalizado en tensión muscular.', durationMinutes: 60, price: 35000, depositAmount: 10000, pastelColor: '#A3D8FF', sortOrder: 2 },
  ],
  therapy: [
    { name: 'Sesión individual', description: 'Atención terapéutica individual.', durationMinutes: 50, price: 30000, depositAmount: 0, pastelColor: '#C7CEEA', sortOrder: 1 },
  ],
  other: [],
}

export function parseBusinessCategory(value: FormDataEntryValue | null): BusinessCategoryInput {
  return BUSINESS_CATEGORIES.includes(value as BusinessCategoryInput) ? value as BusinessCategoryInput : 'other'
}

interface CreateBusinessInput {
  userId: string
  email: string
  name?: string
  subdomain?: string
  category?: BusinessCategoryInput
  useServiceTemplate?: boolean
}

export async function createBusinessForUser({ userId, email, name, subdomain, category = 'other', useServiceTemplate = false }: CreateBusinessInput) {
  const slug = subdomain || generateDefaultSubdomain(email)
  const finalSubdomain = subdomain || generateDefaultSubdomain(email)
  const businessCategory = BUSINESS_CATEGORIES.includes(category) ? category : 'other'

  const betaPlan = await prisma.plan.findFirst({
    where: { name: 'Beta gratis' },
  })

  if (!betaPlan) {
    throw new RegistrationError('Configuración de planes no encontrada. Contacta soporte.', 'INTERNAL')
  }

  const thirtyDaysFromNow = new Date()
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30)

  await prisma.$transaction(async (tx) => {
    await tx.user.create({
      data: {
        id: userId,
        email,
        name: name || null,
      },
    })

    const existingSubdomain = await tx.business.findUnique({
      where: { subdomain: finalSubdomain },
      select: { id: true },
    })
    if (existingSubdomain) {
      throw new RegistrationError('Este subdominio ya está en uso. Elige otro.', 'SUBDOMAIN_TAKEN')
    }

    const existingSlug = await tx.business.findUnique({
      where: { slug },
      select: { id: true },
    })
    if (existingSlug) {
      throw new RegistrationError('Error al crear tu negocio. Intenta con otro nombre.', 'SUBDOMAIN_TAKEN')
    }

    const business = await tx.business.create({
      data: {
        name: name || 'Mi negocio',
        category: businessCategory,
        slug,
        subdomain: finalSubdomain,
        ownerUserId: userId,
        city: 'Santiago',
        currency: 'CLP',
        timezone: 'America/Santiago',
        planId: betaPlan.id,
        subscriptionStatus: 'trialing',
        trialEndsAt: thirtyDaysFromNow,
        bookingNumberSeq: randomBookingNumberBase(),
      },
    })

    await tx.businessUser.create({
      data: {
        businessId: business.id,
        userId,
        role: 'owner',
      },
    })

    await tx.businessSubscription.create({
      data: {
        businessId: business.id,
        planId: betaPlan.id,
        status: 'trialing',
        interval: 'monthly',
        amount: betaPlan.priceMonthly,
        currentPeriodStart: new Date(),
        currentPeriodEnd: thirtyDaysFromNow,
        trialStartAt: new Date(),
        trialEndAt: thirtyDaysFromNow,
      },
    })

    if (useServiceTemplate && businessCategory !== 'other') {
      const serviceTemplate = SERVICE_TEMPLATES[businessCategory]
      if (serviceTemplate.length > 0) {
        await tx.service.createMany({
          data: serviceTemplate.map((service) => ({ ...service, businessId: business.id })),
        })
      }
    }

    // `professionalId: null` explícito aunque sea el default de la columna: es el
    // horario DEL SALÓN, el que hereda todo el equipo mientras no tenga uno propio.
    await tx.availabilityRule.createMany({
      data: DEFAULT_WEEKLY_SCHEDULE.map((day) => ({ ...day, businessId: business.id, professionalId: null })),
    })
  })
}
