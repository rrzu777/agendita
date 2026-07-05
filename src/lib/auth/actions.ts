'use server'

import { createClient } from './middleware'
import { prisma } from '@/lib/db'
import { redirect } from 'next/navigation'
import { validateSubdomain, generateDefaultSubdomain } from '@/lib/business/subdomain'
import { randomBookingNumberBase } from '@/lib/bookings/number'
import { RegistrationError } from './registration-error'
import { Prisma } from '@prisma/client'
import { getAppUrl } from '@/lib/business/urls'
import { sanitizeNext } from './sanitize-next'

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

function parseBusinessCategory(value: FormDataEntryValue | null): BusinessCategoryInput {
  return BUSINESS_CATEGORIES.includes(value as BusinessCategoryInput) ? value as BusinessCategoryInput : 'other'
}

export async function signIn(formData: FormData) {
  const email = formData.get('email') as string
  const password = formData.get('password') as string

  if (!email || !password) {
    return { error: 'Email y contraseña son requeridos' }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    return { error: 'Email o contraseña incorrectos' }
  }

  redirect('/dashboard')
}

export async function requestPasswordReset(formData: FormData) {
  const email = (formData.get('email') as string | null)?.trim()
  if (!email) {
    return { error: 'Ingresa tu email' }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: getAppUrl('/auth/callback?next=/reset-password'),
  })

  if (error) {
    return { error: 'No pudimos enviar el email de recuperación. Intenta de nuevo.' }
  }

  return { success: true }
}

export async function updatePassword(formData: FormData) {
  const password = (formData.get('password') as string | null) || ''
  if (password.length < 6) {
    return { error: 'La contraseña debe tener al menos 6 caracteres' }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ password })
  if (error) {
    return { error: 'No pudimos actualizar tu contraseña. Solicita un nuevo enlace.' }
  }

  return { success: true }
}

export async function checkSubdomainAvailability(subdomain: string) {
  const validation = validateSubdomain(subdomain)
  if (!validation.valid) {
    return { available: false, error: validation.error }
  }

  const existing = await prisma.business.findUnique({
    where: { subdomain: validation.sanitized! },
    select: { id: true },
  })

  return { available: !existing, error: existing ? 'Este subdominio ya está en uso' : undefined }
}

export async function signUp(formData: FormData) {
  const email = formData.get('email') as string
  const password = formData.get('password') as string
  const name = formData.get('name') as string
  const rawSubdomain = (formData.get('subdomain') as string) || undefined
  const category = parseBusinessCategory(formData.get('category'))
  const acceptedTerms = formData.get('acceptedTerms') as string
  const useServiceTemplate = formData.get('useServiceTemplate') === 'true'

  if (acceptedTerms !== 'true') {
    throw new RegistrationError('Debes aceptar los términos y condiciones y la política de privacidad', 'VALIDATION')
  }

  if (!email || !password) {
    throw new RegistrationError('Email y contraseña son requeridos', 'VALIDATION')
  }

  const subdomainInput = rawSubdomain
    ? validateSubdomain(rawSubdomain)
    : null

  if (rawSubdomain && subdomainInput && !subdomainInput.valid) {
    throw new RegistrationError(subdomainInput.error!, 'VALIDATION')
  }

  // ── RECONCILIATION NOTE ──────────────────────────────────────────────────
  // Supabase Auth creates the user BEFORE the Prisma transaction runs.
  // If the Prisma transaction fails after Supabase succeeds, the auth user
  // exists in Supabase but has no Business in our DB.
  //
  // This is an inherent design tradeoff: Supabase Auth (external service)
  // cannot be wrapped in a Prisma transaction. We mitigate it as follows:
  //
  // 1. The Prisma $transaction is the innermost unit — all DB writes are
  //    atomic (User, Business, BusinessUser, Subscription, Services).
  // 2. If Prisma fails AFTER Supabase succeeds, the user will see the
  //    Supabase confirmation email but no dashboard access. On next login,
  //    the `getCurrentUserWithBusiness` function will find the Supabase user
  //    but no BusinessUser record. In that case, the dashboard redirects to
  //    /login. A future reconciliation endpoint or admin tool can:
  //    a) Detect orphan Supabase users (auth exists, no BusinessUser).
  //    b) Re-run createBusinessForUser or offer a recovery path.
  // 3. The most common failure points (duplicate subdomain, DB connection)
  //    are caught early in the transaction and surface clear errors.
  // 4. If SUPABASE_SERVICE_ROLE_KEY is configured, a future improvement
  //    could call supabaseAdmin.deleteUser() on Prisma failure for cleanup.
  //
  // For the beta, the risk is low because registration failures are
  // extremely rare with proper subdomain validation and the transaction
  // design. Orphan users can be resolved manually via the admin panel or
  // a one-time reconciliation script.
  // ──────────────────────────────────────────────────────────────────────────

  const supabase = await createClient()
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { name },
    },
  })

  if (authError) {
    if (authError.message?.includes('already registered') || authError.message?.includes('already exists')) {
      throw new RegistrationError('Ya existe una cuenta con este email', 'EMAIL_TAKEN')
    }
    throw new RegistrationError('Error al crear la cuenta. Intenta de nuevo.', 'AUTH_ERROR')
  }

  if (!authData.user) {
    throw new RegistrationError('No se pudo crear el usuario. Intenta de nuevo.', 'AUTH_ERROR')
  }

  try {
    await createBusinessForUser({
      userId: authData.user.id,
      email,
      name: name || undefined,
      subdomain: subdomainInput?.sanitized,
      category,
      useServiceTemplate,
    })
  } catch (error) {
    if (error instanceof RegistrationError) {
      throw error
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        const target = (error.meta?.target as string[]) || []
        if (target.includes('subdomain') || target.includes('slug')) {
          throw new RegistrationError('Este subdominio ya está en uso. Elige otro.', 'SUBDOMAIN_TAKEN')
        }
      }
    }

    if (process.env.NODE_ENV !== 'production') {
      console.error('Registration DB error:', error)
    }
    throw new RegistrationError('Error al configurar tu cuenta. Intenta de nuevo o contacta soporte.', 'INTERNAL')
  }

  redirect('/dashboard')
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

    await tx.availabilityRule.createMany({
      data: [
        { businessId: business.id, dayOfWeek: 1, startTime: '09:00', endTime: '18:00' },
        { businessId: business.id, dayOfWeek: 2, startTime: '09:00', endTime: '18:00' },
        { businessId: business.id, dayOfWeek: 3, startTime: '09:00', endTime: '18:00' },
        { businessId: business.id, dayOfWeek: 4, startTime: '09:00', endTime: '18:00' },
        { businessId: business.id, dayOfWeek: 5, startTime: '09:00', endTime: '18:00' },
        { businessId: business.id, dayOfWeek: 6, startTime: '10:00', endTime: '15:00' },
      ],
    })
  })
}

export async function signOut() {
  const supabase = await createClient()
  const { error } = await supabase.auth.signOut()
  if (error) {
    throw new Error(error.message)
  }
  redirect('/')
}

/** Login de clienta (y de cualquier persona) con Google. Reusa el flujo PKCE:
 *  Supabase redirige a /auth/callback, el middleware intercambia el code y
 *  redirige a `next`. Requiere el provider Google habilitado en Supabase. */
export async function signInWithGoogle(next: string | null) {
  const supabase = await createClient()
  const safeNext = sanitizeNext(next, '/mi')
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: getAppUrl(`/auth/callback?next=${encodeURIComponent(safeNext)}`) },
  })
  if (error || !data?.url) {
    return { error: 'No se pudo iniciar sesión con Google. Intenta de nuevo.' }
  }
  redirect(data.url)
}
