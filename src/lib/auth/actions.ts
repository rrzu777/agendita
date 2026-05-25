'use server'

import { createClient } from './middleware'
import { prisma } from '@/lib/db'
import { redirect } from 'next/navigation'
import { validateSubdomain, generateDefaultSubdomain } from '@/lib/business/subdomain'
import { RegistrationError } from './registration-error'
import { Prisma } from '@prisma/client'

export async function signIn(formData: FormData) {
  const email = formData.get('email') as string
  const password = formData.get('password') as string

  if (!email || !password) {
    throw new Error('Email y contraseña son requeridos')
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    throw new Error(error.message)
  }

  redirect('/dashboard')
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
  const acceptedTerms = formData.get('acceptedTerms') as string

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
}

async function createBusinessForUser({ userId, email, name, subdomain }: CreateBusinessInput) {
  const slug = subdomain || generateDefaultSubdomain(email)
  const finalSubdomain = subdomain || generateDefaultSubdomain(email)

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
        name: name ? `${name} Nails` : 'Mi Negocio',
        slug,
        subdomain: finalSubdomain,
        ownerUserId: userId,
        city: 'Santiago',
        currency: 'CLP',
        timezone: 'America/Santiago',
        planId: betaPlan.id,
        subscriptionStatus: 'trialing',
        trialEndsAt: thirtyDaysFromNow,
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

    await tx.service.createMany({
      data: [
        { businessId: business.id, name: 'Manicura rusa', description: 'Limpieza profunda de cutícula, nivelación y esmaltado.', durationMinutes: 120, price: 28000, depositAmount: 10000, pastelColor: '#FFB3BA', sortOrder: 1 },
        { businessId: business.id, name: 'Esmaltado permanente', description: 'Esmaltado en gel con larga duración.', durationMinutes: 90, price: 22000, depositAmount: 8000, pastelColor: '#E2B3FF', sortOrder: 2 },
        { businessId: business.id, name: 'Kapping gel', description: 'Refuerzo de uña natural con gel.', durationMinutes: 90, price: 25000, depositAmount: 8000, pastelColor: '#A3D8FF', sortOrder: 3 },
      ],
    })

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
