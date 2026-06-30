import type { Prisma } from '@prisma/client'
import { isP2002 } from './credit'
import { referralKey } from './automatic-match'
import { emitAutomaticReward, type AutomaticRule, type EmitConfig, type EmittedReward } from './automatic'

type Tx = Prisma.TransactionClient

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
}): Promise<void> {
  const emit = args.emit ?? emitAutomaticReward
  const flip = await tx.referral.updateMany({
    where: { referredCustomerId: args.referredCustomerId, status: 'pending' },
    data: { status: 'rewarded', rewardedAt: args.now, triggeringBookingId: args.bookingId },
  })
  if (flip.count === 0) return // sin referral pendiente o ya premiado

  const ref = await tx.referral.findUnique({
    where: { referredCustomerId: args.referredCustomerId },
    select: { referrerCustomerId: true, referredCustomerId: true },
  })
  if (!ref) return
  const beneficiary = (args.rule.conditions as { beneficiary?: string } | null)?.beneficiary ?? 'both'

  if (beneficiary === 'both' || beneficiary === 'referred') {
    await emit(tx, { rule: args.rule, businessId: args.businessId, customerId: ref.referredCustomerId,
      dedupeKey: `${referralKey(ref.referredCustomerId)}:referred`, config: args.config,
      triggeringBookingId: args.bookingId, now: args.now })
  }
  if (beneficiary === 'both' || beneficiary === 'referrer') {
    await emit(tx, { rule: args.rule, businessId: args.businessId, customerId: ref.referrerCustomerId,
      dedupeKey: `${referralKey(ref.referredCustomerId)}:referrer`, config: args.config,
      triggeringBookingId: args.bookingId, now: args.now })
  }
}
