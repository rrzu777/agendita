/**
 * Emisiones automáticas de fidelización que dispara una reserva al completarse:
 * la regla de primera visita y la de referida.
 *
 * Vive fuera de `server/actions/bookings.ts` porque no forma parte de la
 * transición de estado: para cuando esto corre, la reserva YA está commiteada.
 * Cada emisión abre su propia transacción post-commit y falla sola —una regla
 * rota no puede tumbar el completar— y por eso mismo no tenía nada que hacer
 * adentro de una action.
 *
 * El caller decide SI corresponde emitir (status, config activa, pago no
 * revertido); acá se decide QUÉ se emite.
 */
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { emitAutomaticReward, loadAutomaticRules, type EmitConfig } from '@/lib/loyalty/automatic'
import { rewardReferralOnCompletion, notifyReferralReward } from '@/lib/loyalty/referral'
import { firstVisitKey, conditionKind } from '@/lib/loyalty/automatic-match'

export async function emitAutomaticRewardsOnCompletion(args: {
  businessId: string
  customerId: string
  bookingId: string
  config: EmitConfig
  isFirstVisit: boolean
}) {
  const { businessId, customerId, bookingId, config, isFirstVisit } = args
  const now = new Date()
  // Cargá las reglas automáticas UNA vez (fuera de tx); cada emisión abre su propia tx
  // post-commit solo si hay regla aplicable (evita transacciones vacías en el caso común).
  const autoRules = await loadAutomaticRules(prisma, businessId)
  const firstVisitRule = autoRules.find((r) => conditionKind(r.conditions) === 'first_visit')
  const referralRule = autoRules.find((r) => conditionKind(r.conditions) === 'referral')

  if (isFirstVisit && firstVisitRule) {
    try {
      await prisma.$transaction((tx) =>
        emitAutomaticReward(tx, {
          rule: firstVisitRule,
          businessId,
          customerId,
          dedupeKey: firstVisitKey(customerId),
          config,
          triggeringBookingId: bookingId,
          now,
        }))
    } catch (e) {
      logger.error('loyalty.first_visit_emit_failed', `first_visit emit falló booking=${bookingId}: ${String(e)}`)
    }
  }
  if (referralRule) {
    try {
      const referralResult = await prisma.$transaction((tx) =>
        rewardReferralOnCompletion(tx, {
          businessId,
          referredCustomerId: customerId,
          bookingId,
          rule: referralRule,
          config,
          now,
        }))
      // Email de recompensa de referido — best-effort, FUERA de la tx.
      if (referralResult) {
        await notifyReferralReward(referralResult, businessId)
      }
    } catch (e) {
      logger.error('loyalty.referral_emit_failed', `referral emit falló booking=${bookingId}: ${String(e)}`)
    }
  }
}
