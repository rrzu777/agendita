'use server'

import { createClient } from '@/lib/auth/middleware'
import { prisma } from '@/lib/db'
import { generateDefaultSubdomain } from '@/lib/business/subdomain'
import { randomBookingNumberBase } from '@/lib/bookings/number'
import { Prisma } from '@prisma/client'

type RecoverBusinessResult =
  | { success: true; alreadyExists?: boolean; redirectTo: string }
  | { success: false; error: string; code?: string }

const DEBUG = process.env.AUTH_RECOVERY_DEBUG === 'true'

export async function recoverBusiness(): Promise<RecoverBusinessResult> {
  const supabase = await createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()

  if (userError || !user) {
    return { success: false, error: 'No se encontró sesión activa. Inicia sesión de nuevo.', code: 'NO_SESSION' }
  }

  const supabaseUserId = user.id
  const supabaseEmail = user.email

  if (!supabaseEmail) {
    return { success: false, error: 'Tu cuenta no tiene email asociado. Contacta soporte.', code: 'NO_EMAIL' }
  }

  if (DEBUG) {
    console.log('[recoverBusiness]', { supabaseUserId, supabaseEmail })
  }

  let prismaUser = await prisma.user.findUnique({ where: { id: supabaseUserId } })

  if (DEBUG) {
    console.log('[recoverBusiness] prismaUserExists:', !!prismaUser)
  }

  if (!prismaUser) {
    const userByEmail = await prisma.user.findUnique({ where: { email: supabaseEmail } })

    if (userByEmail && userByEmail.id !== supabaseUserId) {
      return {
        success: false,
        error: 'Ya existe una cuenta con este email asociada a otro usuario. Contacta soporte.',
        code: 'EMAIL_ID_CONFLICT',
      }
    }

    prismaUser = await prisma.user.create({
      data: {
        id: supabaseUserId,
        email: supabaseEmail,
        name: user.user_metadata?.name || null,
      },
    })
  }

  const existingBusinessUser = await prisma.businessUser.findFirst({
    where: { userId: supabaseUserId },
    include: { business: true },
  })

  if (DEBUG) {
    console.log('[recoverBusiness] businessUserExists:', !!existingBusinessUser)
  }

  if (existingBusinessUser) {
    return { success: true, alreadyExists: true, redirectTo: '/dashboard' }
  }

  const betaPlan = await prisma.plan.findFirst({ where: { name: 'Beta gratis' } })
  if (!betaPlan) {
    return {
      success: false,
      error: 'No se encontró el plan Beta gratis. Contacta soporte para configurar los planes.',
      code: 'MISSING_BETA_PLAN',
    }
  }

  const baseSubdomain = generateDefaultSubdomain(supabaseEmail)
  const thirtyDaysFromNow = new Date()
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30)

  try {
    await prisma.$transaction(async (tx) => {
      let candidateSubdomain = baseSubdomain
      let attempt = 0

      while (true) {
        const suffix = attempt === 0 ? '' : `-${attempt + 1}`
        const candidate = `${baseSubdomain}${suffix}`

        const existing = await tx.business.findFirst({
          where: {
            OR: [
              { subdomain: candidate },
              { slug: candidate },
            ],
          },
          select: { id: true },
        })

        if (!existing) {
          candidateSubdomain = candidate
          break
        }

        attempt++
        if (attempt > 20) {
          candidateSubdomain = `${baseSubdomain}-${Date.now().toString(36)}`
          break
        }
      }

      const business = await tx.business.create({
        data: {
          name: user.user_metadata?.name || 'Mi negocio',
          category: 'other',
          slug: candidateSubdomain,
          subdomain: candidateSubdomain,
          ownerUserId: supabaseUserId,
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
          userId: supabaseUserId,
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

    if (DEBUG) {
      console.log('[recoverBusiness] businessCreated: true')
    }

    return { success: true, redirectTo: '/dashboard/onboarding' }
  } catch (error) {
    if (DEBUG) {
      console.error('[recoverBusiness] error:', error)
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const existingBusinessUser = await prisma.businessUser.findFirst({
        where: { userId: supabaseUserId },
        include: { business: true },
      })

      if (existingBusinessUser) {
        return { success: true, alreadyExists: true, redirectTo: '/dashboard' }
      }

      return {
        success: false,
        error: 'Conflicto al crear tu negocio. Intenta de nuevo.',
        code: 'CREATE_FAILED',
      }
    }

    return {
      success: false,
      error: 'No pudimos crear tu negocio. Intenta de nuevo o contacta soporte.',
      code: 'CREATE_FAILED',
    }
  }
}
