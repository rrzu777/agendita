'use server'

import { prisma } from '@/lib/db'
import { requireBusiness } from '@/lib/auth/server'

export async function saveOnboardingStep(businessId: string, step: number) {
  const { businessId: sessionBusinessId } = await requireBusiness()
  if (sessionBusinessId !== businessId) {
    throw new Error('No autorizado')
  }
  await prisma.business.update({
    where: { id: businessId },
    data: { onboardingStep: step },
  })
}

export async function completeOnboarding(businessId: string) {
  const { businessId: sessionBusinessId } = await requireBusiness()
  if (sessionBusinessId !== businessId) {
    throw new Error('No autorizado')
  }

  const [servicesCount, availabilityCount] = await Promise.all([
    prisma.service.count({ where: { businessId, isActive: true } }),
    prisma.availabilityRule.count({ where: { businessId, isActive: true } }),
  ])

  if (servicesCount === 0) {
    throw new Error('Debes agregar al menos un servicio antes de finalizar')
  }

  if (availabilityCount === 0) {
    throw new Error('Debes configurar al menos un día de atención antes de finalizar')
  }

  await prisma.business.update({
    where: { id: businessId },
    data: {
      onboardingCompletedAt: new Date(),
      onboardingStep: null,
    },
  })
}
