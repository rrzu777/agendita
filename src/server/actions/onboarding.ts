'use server'

import { prisma } from '@/lib/db'
import { requireBusiness } from '@/lib/auth/server'
import { action, UserError } from '@/lib/actions/result'

async function _saveOnboardingStep(businessId: string, step: number) {
  const { businessId: sessionBusinessId } = await requireBusiness()
  if (sessionBusinessId !== businessId) {
    throw new UserError('No autorizado')
  }
  await prisma.business.update({
    where: { id: businessId },
    data: { onboardingStep: step },
  })
}

export const saveOnboardingStep = action(_saveOnboardingStep)

async function _completeOnboarding(businessId: string) {
  const { businessId: sessionBusinessId } = await requireBusiness()
  if (sessionBusinessId !== businessId) {
    throw new UserError('No autorizado')
  }

  const [servicesCount, availabilityCount] = await Promise.all([
    prisma.service.count({ where: { businessId, isActive: true } }),
    prisma.availabilityRule.count({ where: { businessId, isActive: true } }),
  ])

  if (servicesCount === 0) {
    throw new UserError('Debes agregar al menos un servicio antes de finalizar')
  }

  if (availabilityCount === 0) {
    throw new UserError('Debes configurar al menos un día de atención antes de finalizar')
  }

  await prisma.business.update({
    where: { id: businessId },
    data: {
      onboardingCompletedAt: new Date(),
      onboardingStep: null,
    },
  })
}

export const completeOnboarding = action(_completeOnboarding)
