'use server'

import { prisma } from '@/lib/db'
import { requireBusiness } from '@/lib/auth/server'
import { action, UserError } from '@/lib/actions/result'
import { businessScheduleWhere } from '@/lib/availability/scope'

async function _saveOnboardingStep(businessId: string, step: number) {
  const { businessId: sessionBusinessId } = await requireBusiness()
  if (sessionBusinessId !== businessId) {
    throw new UserError('No autorizado')
  }
  if (!Number.isInteger(step) || step < 0 || step > 4) {
    throw new UserError('Paso de configuración inválido')
  }
  // A delayed tab request must not restore onboardingStep after completion.
  await prisma.business.updateMany({
    where: { id: businessId, onboardingCompletedAt: null },
    data: { onboardingStep: step },
  })
}

export const saveOnboardingStep = action(_saveOnboardingStep)

async function _completeOnboarding(businessId: string) {
  const { businessId: sessionBusinessId } = await requireBusiness()
  if (sessionBusinessId !== businessId) {
    throw new UserError('No autorizado')
  }

  const current = await prisma.business.findUnique({
    where: { id: businessId },
    select: { onboardingCompletedAt: true },
  })
  if (!current) {
    throw new UserError('Negocio no encontrado')
  }
  // Completion is terminal and idempotent: a retry after a lost response is a
  // success, without re-running the mutation or reopening onboardingStep.
  if (current.onboardingCompletedAt) return

  const [servicesCount, availabilityCount] = await Promise.all([
    prisma.service.count({ where: { businessId, isActive: true } }),
    // Del salón, no del equipo: el requisito para terminar el onboarding es que el
    // NEGOCIO tenga al menos un día de atención. Sin el filtro, alguien del equipo con
    // horario propio alcanzaría para dar por cumplido un horario que el salón no tiene.
    prisma.availabilityRule.count({ where: { ...businessScheduleWhere(businessId), isActive: true } }),
  ])

  if (servicesCount === 0) {
    throw new UserError('Debes agregar al menos un servicio antes de finalizar')
  }

  if (availabilityCount === 0) {
    throw new UserError('Debes configurar al menos un día de atención antes de finalizar')
  }

  const completed = await prisma.business.updateMany({
    where: { id: businessId, onboardingCompletedAt: null },
    data: {
      onboardingCompletedAt: new Date(),
      onboardingStep: null,
    },
  })

  if (completed.count === 0) {
    const latest = await prisma.business.findUnique({
      where: { id: businessId },
      select: { onboardingCompletedAt: true },
    })
    if (latest?.onboardingCompletedAt) return
    throw new UserError('No pudimos finalizar la configuración. Intenta de nuevo.')
  }
}

export const completeOnboarding = action(_completeOnboarding)
