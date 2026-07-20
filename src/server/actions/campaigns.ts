'use server'

import type { Prisma } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { checkRateLimit } from '@/lib/rate-limit'
import { requireBusinessRole, ForbiddenError } from '@/lib/auth/server'
import { action, UserError } from '@/lib/actions/result'
import { createCampaignSchema, type CampaignRewardInput } from '@/lib/campaigns/schema'
import { queryCampaignSegment } from '@/lib/campaigns/segments'
import { prepareCampaignSend, sendOneCampaignEmail } from '@/lib/campaigns/send'
import { buildWhatsappUrl } from '@/lib/notifications/whatsapp'
import { isWhatsappablePhone } from '@/lib/customers/phone'
import { getBusinessReplyToEmail } from '@/lib/notifications'

// NOTE: 'use server' — SOLO funciones async exportadas. Schemas/consts/tipos
// viven en src/lib/campaigns/.

/** Máximo de destinatarias por llamada de bulk: acota el trabajo por request para
 *  no pasar el timeout serverless por defecto (~10-15s) — la latencia de Resend
 *  (~2/s) hace que ~15 envíos secuenciales ronden los 5-7s. El cliente pagina. */
const BULK_EMAIL_MAX_PER_CALL = 15

/** Promos elegibles para campaña: todas las granted activas del negocio
 *  (catálogo de canje + creadas por campañas). */
export async function listCampaignPromotions() {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  return prisma.promotion.findMany({
    where: { businessId, triggerType: 'granted', isActive: true },
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true },
  })
}

/** Crea una promo granted inline para la campaña (pointsCost null = no canjeable
 *  por puntos; sólo minteable vía grant). Module-local, no exportada. Corre dentro
 *  de la tx de createCampaign para no dejar promos huérfanas si el create falla. */
async function createInlineGrantedPromotion(
  tx: Prisma.TransactionClient, businessId: string, userId: string, r: CampaignRewardInput,
): Promise<string> {
  if (r.serviceIds.length) {
    const count = await tx.service.count({ where: { id: { in: r.serviceIds }, businessId } })
    if (count !== r.serviceIds.length) throw new UserError('Servicio inválido')
  }
  const promo = await tx.promotion.create({
    data: {
      businessId, triggerType: 'granted', pointsCost: null,
      name: r.name, rewardType: r.rewardType, rewardValue: r.rewardValue, maxDiscount: r.maxDiscount,
      appliesToAll: r.appliesToAll, grantExpiryDays: r.grantExpiryDays, createdByUserId: userId,
      services: r.appliesToAll ? undefined : { connect: r.serviceIds.map((id) => ({ id })) },
    },
    select: { id: true },
  })
  return promo.id
}

async function _createCampaign(data: unknown): Promise<{ campaignId: string }> {
  const { businessId, user, business } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('create-campaign', 20, 60000, { userId: user.id, businessId })
  if (!limit.success) throw new UserError('Demasiadas solicitudes. Intenta más tarde.')

  const parsed = createCampaignSchema.safeParse(data)
  if (!parsed.success) throw new UserError('Datos inválidos: ' + parsed.error.issues.map((i) => i.message).join(', '))
  const d = parsed.data

  // Promo de catálogo: verificación (read) fuera de la tx. Ownership + que sea granted.
  let catalogPromotionId: string | null = null
  if (!d.newPromotion) {
    const existing = await prisma.promotion.findFirst({
      where: { id: d.promotionId!, businessId, triggerType: 'granted' }, select: { id: true },
    })
    if (!existing) throw new ForbiddenError('Promo no encontrada')
    catalogPromotionId = existing.id
  }

  const tz = business.timezone || 'America/Santiago'
  const segment = await queryCampaignSegment(prisma, businessId, d.segmentType, d.segmentParams ?? {}, new Date(), tz)

  // Promo inline + campaña en UNA tx: si el create de la campaña falla, no queda
  // una promo granted huérfana en el catálogo (patrón sellPackage en packages.ts).
  const campaign = await prisma.$transaction(async (tx) => {
    const promotionId = d.newPromotion
      ? await createInlineGrantedPromotion(tx, businessId, user.id, d.newPromotion)
      : catalogPromotionId!
    return tx.campaign.create({
      data: {
        businessId, name: d.name, segmentType: d.segmentType, segmentParams: d.segmentParams ?? undefined,
        promotionId, messageTemplate: d.messageTemplate, createdByUserId: user.id,
        recipients: { createMany: { data: segment.map((c) => ({ customerId: c.id })) } },
      },
      select: { id: true },
    })
  })
  revalidatePath('/dashboard/campanas')
  return { campaignId: campaign.id }
}

export const createCampaign = action(_createCampaign)

export async function getCampaigns() {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  return prisma.campaign.findMany({
    where: { businessId }, orderBy: { createdAt: 'desc' },
    select: {
      id: true, name: true, segmentType: true, createdAt: true,
      promotion: { select: { name: true } },
      _count: { select: { recipients: true } },
    },
  })
}

export async function getCampaignDetail(campaignId: string) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, businessId },
    select: {
      id: true, name: true, segmentType: true, promotionId: true, createdAt: true,
      promotion: { select: { name: true, rewardType: true, rewardValue: true } },
      recipients: {
        orderBy: { customer: { name: 'asc' } },
        select: {
          id: true, customerId: true, sentAt: true,
          customer: { select: { name: true, phone: true, email: true, marketingOptOutAt: true } },
          grant: { select: { status: true, expiresAt: true } },
        },
      },
    },
  })
  if (!campaign) throw new ForbiddenError('Campaña no encontrada')
  return campaign
}

async function _sendCampaignMessage(recipientId: string): Promise<{ waUrl: string | null }> {
  const { businessId, user } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('send-campaign', 120, 60000, { userId: user.id, businessId })
  if (!limit.success) throw new UserError('Demasiadas solicitudes. Intenta más tarde.')

  const { recipient, grant, message } = await prepareCampaignSend(prisma, businessId, recipientId, user.id)

  await prisma.campaignRecipient.update({
    where: { id: recipient.id },
    data: { grantId: grant.id, sentAt: recipient.sentAt ?? new Date() },
  })

  const waUrl = isWhatsappablePhone(recipient.customer.phone)
    ? buildWhatsappUrl(recipient.customer.phone, message)
    : null
  return { waUrl }
}

export const sendCampaignMessage = action(_sendCampaignMessage)

/** Envío de campaña por email (canal alternativo a WhatsApp). Mintea el grant vía
 *  el mismo core idempotente, envía server-side vía Resend, y marca sentAt SÓLO si el
 *  envío fue exitoso (a diferencia de WhatsApp, acá conocemos el resultado). El grant
 *  minteado persiste aunque el email falle; reintentar es idempotente. */
async function _sendCampaignEmail(recipientId: string): Promise<{ sent: boolean; error?: string }> {
  const { businessId, user } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('send-campaign-email', 30, 60000, { userId: user.id, businessId })
  if (!limit.success) throw new UserError('Demasiadas solicitudes. Intenta más tarde.')

  const replyTo = await getBusinessReplyToEmail(businessId)
  const outcome = await sendOneCampaignEmail(prisma, businessId, recipientId, user.id, replyTo)

  if (outcome.status === 'sent') return { sent: true }
  if (outcome.status === 'skipped') {
    return {
      sent: false,
      error: outcome.reason === 'no_email' ? 'La clienta no tiene un email válido.' : 'Ya se había enviado.',
    }
  }
  return { sent: false, error: outcome.error }
}

export const sendCampaignEmail = action(_sendCampaignEmail)

type BulkEmailResult = { recipientId: string; status: 'sent' | 'skipped' | 'failed'; error?: string }

/** Envío masivo de email por tandas. El cliente maneja la cola (desde los props del
 *  detalle) y pasa hasta BULK_EMAIL_MAX_PER_CALL ids por llamada. El server revalida
 *  ownership de la campaña y, por cada id, delega en sendOneCampaignEmail (claim +
 *  puertas). Itera SECUENCIAL (no Promise.all): cada envío abre una tx interactiva
 *  para mintear, y en paralelo bajo connection_limit=1 (pgbouncer) explota con P2028.
 *  Un ítem que falla (opt-out, promo pausada, borrada, Resend) NO aborta la tanda. */
async function _sendCampaignEmailBatch(
  campaignId: string,
  recipientIds: string[],
): Promise<{ results: BulkEmailResult[] }> {
  const { businessId, user } = await requireBusinessRole(['owner', 'admin'])
  if (recipientIds.length === 0) return { results: [] }
  if (recipientIds.length > BULK_EMAIL_MAX_PER_CALL) {
    throw new UserError(`Máximo ${BULK_EMAIL_MAX_PER_CALL} destinatarias por tanda`)
  }
  const limit = await checkRateLimit('send-campaign-bulk-email', 60, 60000, { userId: user.id, businessId })
  if (!limit.success) throw new UserError('Demasiadas solicitudes. Intenta más tarde.')

  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, businessId }, select: { id: true } })
  if (!campaign) throw new ForbiddenError('Campaña no encontrada')

  const replyTo = await getBusinessReplyToEmail(businessId)

  const results: BulkEmailResult[] = []
  for (const recipientId of recipientIds) {
    try {
      const outcome = await sendOneCampaignEmail(prisma, businessId, recipientId, user.id, replyTo)
      if (outcome.status === 'sent') results.push({ recipientId, status: 'sent' })
      else if (outcome.status === 'skipped') results.push({ recipientId, status: 'skipped', error: outcome.reason })
      else results.push({ recipientId, status: 'failed', error: outcome.error })
    } catch (e) {
      // Puerta 2 (opt-out), promo pausada, destinataria borrada → saltar, no abortar.
      // Sólo UserError es user-facing; cualquier otro throw (DB, etc.) se redacta —
      // este results[] cruza al cliente, mismo borde de seguridad que action().
      results.push({ recipientId, status: 'skipped', error: e instanceof UserError ? e.message : 'error' })
    }
  }
  return { results }
}

export const sendCampaignEmailBatch = action(_sendCampaignEmailBatch)
