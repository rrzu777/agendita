import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { buildLoyaltyCardLink, ensureLoyaltyToken } from './token'
import { getAppUrl } from '@/lib/business/urls'
import { getBusinessReplyToEmail, sendNotificationSafely, sendLoyaltyRewardNotification } from '@/lib/notifications'

/** Envía (best-effort, post-commit) el email de recompensa automática a una clienta.
 *  birthday/winback son marketing: respetan opt-out y llevan footer/headers de baja.
 *  referral es agradecimiento (cuasi-transaccional): se envía siempre, sin footer de baja.
 *  Nunca rompe ni bloquea la emisión: cualquier fallo se loguea y se traga. */
export async function sendRewardEmail(args: {
  businessId: string
  customer: { id: string; name: string; email: string; loyaltyToken: string | null; marketingOptOutAt: Date | null }
  businessName: string
  config: { isActive: boolean } | null | undefined
  rewardLabel: string
  reason: 'birthday' | 'winback' | 'referral'
}): Promise<void> {
  const { businessId, customer, businessName, config, rewardLabel, reason } = args
  const isMarketing = reason === 'birthday' || reason === 'winback'

  // Puerta única de opt-out para email de marketing (antes vivía en el cron).
  if (isMarketing && customer.marketingOptOutAt) {
    logger.info('loyalty.reward_email.opted_out', `email de marketing omitido por opt-out customer=${customer.id} reason=${reason}`)
    return
  }

  try {
    const loyaltyCardLink = await buildLoyaltyCardLink(prisma, customer, config, getAppUrl(''))
    // Los emails de marketing necesitan token de baja garantizado (mint lazy).
    const unsubscribeToken = isMarketing ? await ensureLoyaltyToken(prisma, customer) : null
    await sendNotificationSafely('loyalty_reward', async () =>
      sendLoyaltyRewardNotification({
        businessName,
        businessReplyToEmail: await getBusinessReplyToEmail(businessId),
        customerName: customer.name,
        customerEmail: customer.email,
        rewardLabel,
        reason,
        loyaltyCardLink: loyaltyCardLink ?? null,
        unsubscribeToken,
      }))
  } catch (e) {
    logger.error('loyalty.reward_email_failed', `reward email falló customer=${customer.id}: ${String(e)}`)
  }
}
