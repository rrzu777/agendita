'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { requireBusinessRole } from '@/lib/auth/server'
import { action, UserError } from '@/lib/actions/result'

const preferenceSchema = z.strictObject({
  enabled: z.boolean(),
  aiNarrativeEnabled: z.boolean(),
  emailEnabled: z.boolean(),
  privacyVersion: z.union([z.literal(1), z.literal(2)]).nullable().optional(),
})

export async function readWeeklyInsights(input: { limit?: number } = {}) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = Math.min(Math.max(input.limit ?? 4, 1), 12)
  const now = new Date()
  const [rows, preference] = await Promise.all([
    prisma.analyticsWeeklyInsight.findMany({ where: { businessId, retentionExpiresAt: { gt: now } }, orderBy: { weekStart: 'desc' }, take: limit, select: { id: true, weekStart: true, weekEnd: true, businessTimeZone: true, sourceConsentVersion: true, status: true, generationStatus: true, facts: true, narrative: true, reasonCode: true, sourceExpiresAt: true, retentionExpiresAt: true } }),
    prisma.analyticsInsightPreference.findUnique({ where: { businessId }, select: { enabled: true, aiNarrativeEnabled: true, emailEnabled: true, privacyVersion: true } }),
  ])
  return { rows, preference }
}

export const getWeeklyInsights = action(async (input: unknown = {}) => {
  const parsed = z.strictObject({ limit: z.number().int().min(1).max(12).optional() }).safeParse(input)
  if (!parsed.success) throw new UserError('Filtros de insights inválidos.')
  return readWeeklyInsights(parsed.data)
})

export const setWeeklyInsightPreferences = action(async (input: unknown) => {
  const { businessId, user, role } = await requireBusinessRole(['owner', 'admin'])
  const parsed = preferenceSchema.safeParse(input)
  if (!parsed.success) throw new UserError('Configuración de insights inválida.')
  const data = parsed.data
  if (data.aiNarrativeEnabled && data.privacyVersion !== 2) throw new UserError('El análisis asistido requiere aceptar la versión vigente de privacidad.')
  if (data.emailEnabled && !user.email) throw new UserError('Tu cuenta no tiene un email para recibir el resumen.')
  if (role !== 'owner' && data.aiNarrativeEnabled) throw new UserError('Sólo la persona propietaria puede activar el análisis asistido.')
  const preference = await prisma.analyticsInsightPreference.upsert({ where: { businessId }, create: { businessId, recipientUserId: user.id, enabled: data.enabled, aiNarrativeEnabled: data.aiNarrativeEnabled, emailEnabled: data.emailEnabled, privacyVersion: data.privacyVersion ?? null, acceptedAt: data.privacyVersion === 2 ? new Date() : null }, update: { recipientUserId: user.id, enabled: data.enabled, aiNarrativeEnabled: data.aiNarrativeEnabled, emailEnabled: data.emailEnabled, privacyVersion: data.privacyVersion ?? null, acceptedAt: data.privacyVersion === 2 ? new Date() : null } })
  if (!data.emailEnabled) await prisma.analyticsEmailDelivery.updateMany({ where: { weeklyInsight: { businessId }, notificationKind: 'weekly_digest', status: 'pending' }, data: { status: 'cancelled' } })
  revalidatePath('/dashboard/metricas')
  return { enabled: preference.enabled, aiNarrativeEnabled: preference.aiNarrativeEnabled, emailEnabled: preference.emailEnabled, privacyVersion: preference.privacyVersion }
})
