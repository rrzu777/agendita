'use server'

import { z } from 'zod'
import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { checkRateLimit } from '@/lib/rate-limit'

const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/

const updateAvailabilityRuleSchema = z.object({
  startTime: z.string().regex(timeRegex, 'Formato de hora inválido (HH:MM)'),
  endTime: z.string().regex(timeRegex, 'Formato de hora inválido (HH:MM)'),
  isActive: z.boolean(),
})

export async function getAvailabilityRules(businessId?: string) {
  return prisma.availabilityRule.findMany({
    where: businessId ? { businessId } : undefined,
    orderBy: { dayOfWeek: 'asc' },
  })
}

export async function updateAvailabilityRule(
  id: string,
  data: { startTime: string; endTime: string; isActive: boolean }
) {
  const limit = await checkRateLimit('update-availability', 30, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = updateAvailabilityRuleSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const updated = await prisma.availabilityRule.update({
    where: { id },
    data,
  })
  revalidatePath('/dashboard/availability')
  return updated
}
