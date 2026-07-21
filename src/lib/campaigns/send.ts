import type { Prisma, PrismaClient, PromotionGrant } from '@prisma/client'
import { formatInTimeZone } from 'date-fns-tz'
import { mintCampaignGrant } from './mint'
import { renderCampaignMessage } from './message'
import { isP2002 } from '@/lib/loyalty/credit'
import { ForbiddenError } from '@/lib/auth/server'
import { UserError } from '@/lib/actions/result'
import { isEmailable } from '@/lib/customers/email'
import { ensureLoyaltyToken } from '@/lib/loyalty/token'
import { sendNotificationSafely, sendCampaignPromoEmail } from '@/lib/notifications'

type Db = PrismaClient

export interface PreparedCampaignSend {
  recipient: {
    id: string
    sentAt: Date | null
    customer: {
      id: string; name: string; phone: string; email: string | null
      loyaltyToken: string | null; marketingOptOutAt: Date | null
    }
    campaign: {
      id: string; name: string
      business: { name: string; timezone: string | null }
    }
  }
  grant: PromotionGrant
  message: string
}

/** Núcleo compartido de envío de campaña (WhatsApp y email). Lee la destinataria,
 *  aplica la puerta 2 de opt-out (retroactiva), mintea el grant de forma perezosa e
 *  idempotente (por customerId+requestId) y renderiza el mensaje. NO marca sentAt:
 *  eso lo decide cada canal según su resultado. */
export async function prepareCampaignSend(
  db: Db,
  businessId: string,
  recipientId: string,
  createdByUserId: string,
): Promise<PreparedCampaignSend> {
  const [recipient, config] = await Promise.all([
    db.campaignRecipient.findFirst({
      where: { id: recipientId, campaign: { businessId } },
      select: {
        id: true, sentAt: true,
        customer: {
          select: {
            id: true, name: true, phone: true, email: true,
            loyaltyToken: true, marketingOptOutAt: true,
          },
        },
        campaign: {
          select: {
            id: true, name: true, messageTemplate: true,
            promotion: { select: { id: true, grantExpiryDays: true, isActive: true } },
            business: { select: { name: true, timezone: true } },
          },
        },
      },
    }),
    db.loyaltyConfig.findUnique({ where: { businessId }, select: { grantExpiryDays: true } }),
  ])
  if (!recipient) throw new ForbiddenError('Destinataria no encontrada')
  // Puerta 2 (retroactiva): la clienta pudo hacer opt-out DESPUÉS de materializar la lista.
  // UserError: mensaje user-facing — sendCampaignEmailBatch lo captura per-item (no
  // le importa el tipo), pero sendCampaignMessage/sendCampaignEmail lo propagan tal
  // cual hasta el action() wrapper, que sólo preserva el texto de UserError.
  if (recipient.customer.marketingOptOutAt) {
    throw new UserError('La clienta pidió no recibir campañas')
  }
  // Gate de promo activa: si la promo se archivó entre crear la campaña y enviar,
  // cortar (fail-fast) en vez de emitir beneficios contra una promo apagada.
  // Vive en el core → aplica también al single-send.
  if (!recipient.campaign.promotion.isActive) {
    throw new UserError('La promoción de esta campaña está pausada')
  }

  const tz = recipient.campaign.business.timezone || 'America/Santiago'
  const requestId = `campaign:${recipient.campaign.id}#${recipient.customer.id}`

  let grant: PromotionGrant | null = null
  try {
    grant = await db.$transaction((tx: Prisma.TransactionClient) =>
      mintCampaignGrant(tx, {
        businessId,
        promotion: {
          id: recipient.campaign.promotion.id,
          grantExpiryDays: recipient.campaign.promotion.grantExpiryDays,
        },
        customerId: recipient.customer.id,
        requestId,
        config: { grantExpiryDays: config?.grantExpiryDays ?? null },
        createdByUserId,
      }),
    )
  } catch (e) {
    if (isP2002(e)) {
      grant = await db.promotionGrant.findUnique({
        where: { customerId_requestId: { customerId: recipient.customer.id, requestId } },
      })
    }
    if (!grant) throw e
  }
  if (!grant) throw new UserError('No se pudo generar el beneficio')

  const firstName = recipient.customer.name?.split(' ')[0] || ''
  const vencimiento = grant.expiresAt ? formatInTimeZone(grant.expiresAt, tz, 'dd/MM/yyyy') : 'sin vencimiento'
  const message = renderCampaignMessage(recipient.campaign.messageTemplate, {
    nombre: firstName, codigo: grant.code, vencimiento, negocio: recipient.campaign.business.name,
  })

  return { recipient, grant, message }
}

export type SendEmailOutcome =
  | { status: 'sent' }
  | { status: 'skipped'; reason: 'already_sent' | 'no_email' }
  | { status: 'failed'; error: string }

/** Envía UNA campaña por email de forma idempotente y a prueba de doble-envío.
 *  Orden: prepare (mint + render + puertas) → CLAIM atómico de la fila
 *  (`updateMany where sentAt:null` fija sentAt+grantId) → Resend → release si falla.
 *  El claim garantiza que dos tandas solapadas no envíen dos veces (patrón
 *  send-reminders.ts). `prepareCampaignSend` puede lanzar (not-found / opt-out /
 *  promo pausada): el caller decide si lo captura. `replyTo` se iza afuera (una
 *  query por tanda, no por destinataria). */
export async function sendOneCampaignEmail(
  db: Db,
  businessId: string,
  recipientId: string,
  createdByUserId: string,
  replyTo: string | null,
): Promise<SendEmailOutcome> {
  const { recipient, grant, message } = await prepareCampaignSend(db, businessId, recipientId, createdByUserId)

  const email = recipient.customer.email
  if (!isEmailable(email)) return { status: 'skipped', reason: 'no_email' }

  // Claim: reserva sentAt + grantId de forma atómica ANTES de tocar Resend.
  const now = new Date()
  const claim = await db.campaignRecipient.updateMany({
    where: { id: recipient.id, sentAt: null },
    data: { sentAt: now, grantId: grant.id },
  })
  if (claim.count === 0) return { status: 'skipped', reason: 'already_sent' }

  const token = await ensureLoyaltyToken(db, recipient.customer)
  const result = await sendNotificationSafely('campaign_email', () =>
    sendCampaignPromoEmail({
      to: email!,
      businessName: recipient.campaign.business.name,
      businessReplyToEmail: replyTo,
      message,
      unsubscribeToken: token,
    }),
  )

  if (!result.success) {
    // Release: libera la fila para permitir reintento (el grant persiste, idempotente).
    await db.campaignRecipient.updateMany({
      where: { id: recipient.id, sentAt: now },
      data: { sentAt: null, grantId: null },
    })
    return { status: 'failed', error: result.error ?? result.skipped ?? 'No se pudo enviar el email' }
  }

  return { status: 'sent' }
}
