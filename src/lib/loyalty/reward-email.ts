import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { buildLoyaltyCardLink } from './token'
import { getAppUrl } from '@/lib/business/urls'
import { sendNotificationSafely, sendLoyaltyRewardNotification } from '@/lib/notifications'

/** Envía (best-effort, post-commit) el email de recompensa automática a una clienta.
 *  Arma el link a "Mi tarjeta" y delega en `sendNotificationSafely`. Nunca rompe ni
 *  bloquea la emisión: cualquier fallo se loguea y se traga. */
export async function sendRewardEmail(args: {
  customer: { id: string; name: string; email: string; loyaltyToken: string | null }
  businessName: string
  config: { isActive: boolean } | null | undefined
  rewardLabel: string
  reason: 'birthday' | 'winback' | 'referral'
}): Promise<void> {
  const { customer, businessName, config, rewardLabel, reason } = args
  try {
    const loyaltyCardLink = await buildLoyaltyCardLink(prisma, customer, config, getAppUrl(''))
    await sendNotificationSafely('loyalty_reward', () =>
      sendLoyaltyRewardNotification({
        businessName,
        customerName: customer.name,
        customerEmail: customer.email,
        rewardLabel,
        reason,
        loyaltyCardLink: loyaltyCardLink ?? null,
      }))
  } catch (e) {
    logger.error('loyalty.reward_email_failed', `reward email falló customer=${customer.id}: ${String(e)}`)
  }
}
