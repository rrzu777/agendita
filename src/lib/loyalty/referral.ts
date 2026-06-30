import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { isP2002 } from './credit'
import { referralKey } from './automatic-match'
import { emitAutomaticReward, type AutomaticRule, type EmitConfig, type EmittedReward } from './automatic'
import { describeReward } from './view'
import { sendRewardEmail } from './reward-email'

type Tx = Prisma.TransactionClient

/** Resultado liviano de `rewardReferralOnCompletion`: null si no premió, o las clientas
 *  beneficiadas + la recompensa emitida, para disparar el email post-commit. */
export type ReferralRewardResult = {
  referrerCustomerId: string
  referredCustomerId: string
  beneficiary: 'both' | 'referred' | 'referrer'
  reward: EmittedReward
  rewardType: AutomaticRule['rewardType']
  rewardValue: number
}

/** Estampa la atribución de referida al crear la reserva pública: resuelve a la referidora
 *  por su `referralToken` (mismo negocio), descarta self-referral, y crea el Referral(pending).
 *  Falla suave: cualquier inconsistencia => no-op (la reserva se crea igual). */
export async function captureReferral(tx: Tx, args: {
  businessId: string; referredCustomerId: string; referrerToken: string; referredPhone: string
}): Promise<void> {
  const referrer = await tx.customer.findFirst({
    where: { referralToken: args.referrerToken, businessId: args.businessId },
    select: { id: true, businessId: true, phone: true },
  })
  if (!referrer) return
  if (referrer.id === args.referredCustomerId) return
  if (referrer.phone === args.referredPhone) return // self-referral por teléfono
  try {
    await tx.referral.create({
      data: { businessId: args.businessId, referrerCustomerId: referrer.id,
        referredCustomerId: args.referredCustomerId, status: 'pending' },
    })
  } catch (e) {
    if (!isP2002(e)) throw e // ya referida (unique referredCustomerId): no-op
  }
}

type EmitFn = (tx: Tx, a: {
  rule: AutomaticRule; businessId: string; customerId: string; dedupeKey: string
  config: EmitConfig; triggeringBookingId?: string | null; now: Date
}) => Promise<EmittedReward>

/** Al completar la 1ª reserva de la referida: flip atómico pending->rewarded y emisión a
 *  referida y/o referidora según `beneficiary`. `emit` se inyecta para testear (default real). */
export async function rewardReferralOnCompletion(tx: Tx, args: {
  businessId: string; referredCustomerId: string; bookingId: string
  rule: AutomaticRule; config: EmitConfig; now: Date; emit?: EmitFn
}): Promise<ReferralRewardResult | null> {
  const emit = args.emit ?? emitAutomaticReward
  const flip = await tx.referral.updateMany({
    where: { businessId: args.businessId, referredCustomerId: args.referredCustomerId, status: 'pending' },
    data: { status: 'rewarded', rewardedAt: args.now, triggeringBookingId: args.bookingId },
  })
  if (flip.count === 0) return null // sin referral pendiente o ya premiado

  const ref = await tx.referral.findFirst({
    where: { businessId: args.businessId, referredCustomerId: args.referredCustomerId },
    select: { referrerCustomerId: true, referredCustomerId: true },
  })
  if (!ref) return null
  const beneficiary = ((args.rule.conditions as { beneficiary?: string } | null)?.beneficiary ?? 'both') as
    'both' | 'referred' | 'referrer'

  let reward: EmittedReward = null
  if (beneficiary === 'both' || beneficiary === 'referred') {
    reward = await emit(tx, { rule: args.rule, businessId: args.businessId, customerId: ref.referredCustomerId,
      dedupeKey: `${referralKey(ref.referredCustomerId)}:referred`, config: args.config,
      triggeringBookingId: args.bookingId, now: args.now }) ?? reward
  }
  if (beneficiary === 'both' || beneficiary === 'referrer') {
    reward = await emit(tx, { rule: args.rule, businessId: args.businessId, customerId: ref.referrerCustomerId,
      dedupeKey: `${referralKey(ref.referredCustomerId)}:referrer`, config: args.config,
      triggeringBookingId: args.bookingId, now: args.now }) ?? reward
  }

  return {
    referrerCustomerId: ref.referrerCustomerId,
    referredCustomerId: ref.referredCustomerId,
    beneficiary,
    reward,
    rewardType: args.rule.rewardType,
    rewardValue: args.rule.rewardValue,
  }
}

/** Dispara (best-effort, post-commit) el email de recompensa de referido a las clientas
 *  beneficiadas según `beneficiary`. No bloquea ni rompe nada si el email falla. */
export async function notifyReferralReward(
  result: ReferralRewardResult,
  businessId: string,
): Promise<void> {
  if (!result.reward) return

  const biz = await prisma.business.findUnique({
    where: { id: businessId },
    select: { name: true, currency: true,
      loyaltyConfig: { select: { isActive: true, pointsLabel: true } } },
  })
  if (!biz) return

  const label = describeReward(result.reward, result, biz.loyaltyConfig?.pointsLabel ?? 'puntos', biz.currency || 'CLP')
  if (!label) return

  const ids: string[] = []
  if (result.beneficiary === 'both' || result.beneficiary === 'referred') ids.push(result.referredCustomerId)
  if (result.beneficiary === 'both' || result.beneficiary === 'referrer') ids.push(result.referrerCustomerId)

  const customers = await prisma.customer.findMany({
    where: { id: { in: ids }, businessId },
    select: { id: true, name: true, email: true, loyaltyToken: true },
  })

  for (const c of customers) {
    if (!c.email) continue
    await sendRewardEmail({
      customer: { id: c.id, name: c.name, email: c.email, loyaltyToken: c.loyaltyToken },
      businessName: biz.name,
      config: biz.loyaltyConfig,
      rewardLabel: label,
      reason: 'referral',
    })
  }
}
