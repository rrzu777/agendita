'use server'

import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requireBusinessRole } from '@/lib/auth/server'
import { action, UserError } from '@/lib/actions/result'
import { checkRateLimit } from '@/lib/rate-limit'
import { channelSchema, dimensionIdSchema } from '@/lib/analytics/contracts'
import { getAnalyticsCaptureConfig, reserveAnalyticsBudget } from '@/lib/analytics/budget'
import { hasAnalyticsRetentionBacklog } from '@/lib/analytics/public-context'
import { closeAnalyticsCollection, withAnalyticsWrite } from '@/server/analytics/repository'
import { getBookingFunnelUrl } from '@/lib/business/urls'
import { getOwnerAnalyticsReport as readOwnerAnalyticsReport } from '@/server/analytics/reports'
import { getOwnerAnalyticsOptions as readOwnerAnalyticsOptions } from '@/server/analytics/options'

export const getOwnerAnalyticsOptions = action(async (input: unknown) => {
  await requireBusinessRole(['owner', 'admin'])
  return readOwnerAnalyticsOptions(input)
})

export const getOwnerAnalyticsReport = action(async (input: unknown = {}) => {
  await requireBusinessRole(['owner', 'admin'])
  return readOwnerAnalyticsReport(input)
})

// Plain current label, not contact information. This is not universal PII detection.
const campaignNameSchema = z.string().trim().min(1).max(80).refine((value) => !/[<>@\p{Cc}]|https?:\/\/|\d{8,}/u.test(value))
const linkSchema = z.strictObject({
  channel: channelSchema,
  campaignName: campaignNameSchema,
  promotionId: dimensionIdSchema.optional(),
})

export const createAcquisitionLink = action(async (input: unknown) => {
  const { businessId, business } = await requireBusinessRole(['owner', 'admin'])
  if (!(await checkRateLimit('owner-analytics-manage', 30, 60000)).success) throw new UserError('Demasiadas solicitudes. Intenta más tarde.')
  const parsed = linkSchema.safeParse(input)
  if (!parsed.success) throw new UserError('Datos de enlace inválidos. Usa una etiqueta sin datos personales.')
  const data = parsed.data
  if (data.promotionId && !await prisma.promotion.findFirst({ where: { businessId, id: data.promotionId }, select: { id: true } })) throw new UserError('Promoción no disponible')
  const link = await prisma.acquisitionLink.create({ data: { businessId, token: randomBytes(16).toString('base64url'), channel: data.channel, campaignName: data.campaignName, promotionId: data.promotionId ?? null } })
  revalidatePath('/dashboard/metricas')
  return { id: link.id, channel: link.channel, campaignName: link.campaignName, promotionId: link.promotionId, createdAt: link.createdAt, archivedAt: link.archivedAt, url: getBookingFunnelUrl(business, new URLSearchParams({ acq: link.token }).toString()) }
})

const renameLinkSchema = z.strictObject({ id: dimensionIdSchema, campaignName: campaignNameSchema })
export const renameAcquisitionLink = action(async (input: unknown) => {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  if (!(await checkRateLimit('owner-analytics-manage', 30, 60000)).success) throw new UserError('Demasiadas solicitudes. Intenta más tarde.')
  const parsed = renameLinkSchema.safeParse(input)
  if (!parsed.success) throw new UserError('Etiqueta inválida. Usa entre 1 y 80 caracteres sin datos personales.')
  const changed = await prisma.acquisitionLink.updateMany({ where: { businessId, id: parsed.data.id }, data: { campaignName: parsed.data.campaignName } })
  if (!changed.count) throw new UserError('Enlace no disponible')
  revalidatePath('/dashboard/metricas')
  return { renamed: true }
})

export const archiveAcquisitionLink = action(async (id: string) => {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  if (!dimensionIdSchema.safeParse(id).success) throw new UserError('Enlace no disponible')
  if (!(await checkRateLimit('owner-analytics-manage', 30, 60000)).success) throw new UserError('Demasiadas solicitudes. Intenta más tarde.')
  const changed = await prisma.acquisitionLink.updateMany({ where: { businessId, id, archivedAt: null }, data: { archivedAt: new Date() } })
  if (!changed.count) throw new UserError('Enlace no disponible')
  revalidatePath('/dashboard/metricas')
  return { archived: true }
})

export const setAnalyticsCollectionEnabled = action(async (enabled: boolean) => {
  const { businessId, business } = await requireBusinessRole(['owner', 'admin'])
  if (typeof enabled !== 'boolean') throw new UserError('Configuración inválida')
  const now = new Date()
  // Disabling has no config, Redis, budget or rate-limit dependency.
  if (enabled && (!business.isActive || !getAnalyticsCaptureConfig(businessId) || await hasAnalyticsRetentionBacklog(now))) throw new UserError('La captura aún no cumple los requisitos de configuración, privacidad o piloto.')
  const result = await withAnalyticsWrite(businessId, async (tx) => {
    if (!enabled) {
      await closeAnalyticsCollection(tx, businessId, now, 'operator')
      return { enabled: false }
    }
    if (!await reserveAnalyticsBudget({ businessId, cost: 1, now })) throw new UserError('El limitador distribuido o el presupuesto de métricas no está disponible.')
    const existing = await tx.analyticsCollectionPeriod.findFirst({ where: { businessId, endedAt: null }, select: { id: true } })
    if (!existing) await tx.analyticsCollectionPeriod.create({ data: { businessId, definitionVersion: 1, consentVersion: 1, businessTimeZone: business.timezone, startedAt: now } })
    return { enabled: true }
  })
  revalidatePath('/dashboard/metricas')
  return result
})
