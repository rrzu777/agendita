import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import {
  matchesBirthday, matchesAnniversary, isWinbackInactive,
  occasionKey, sortByPriorityDesc, conditionKind,
} from '@/lib/loyalty/automatic-match'
import { emitAutomaticReward, AUTOMATIC_RULE_SELECT, type AutomaticRule } from '@/lib/loyalty/automatic'
import { describeReward } from '@/lib/loyalty/view'
import { sendRewardEmail } from '@/lib/loyalty/reward-email'

export interface RunAutomaticLoyaltyResult { businesses: number; emitted: number; errors: number }

type TimedRule = AutomaticRule & { priority: number }
type Candidate = {
  id: string; birthDate: Date | null; firstCompletedAt: Date | null; lastCompletedAt: Date | null
  name: string; email: string | null; loyaltyToken: string | null; marketingOptOutAt: Date | null
}

const TIMED_KINDS = ['birthday', 'anniversary', 'winback'] as const

/** ¿La clienta matchea esta regla temporal hoy? */
function ruleMatches(rule: TimedRule, c: Candidate, now: Date, tz: string): boolean {
  const k = conditionKind(rule.conditions)
  const p = rule.conditions as { windowDays?: number; inactivityDays?: number }
  if (k === 'birthday') return matchesBirthday(c.birthDate, now, tz, p.windowDays ?? 0)
  if (k === 'anniversary') return matchesAnniversary(c.firstCompletedAt, now, tz, p.windowDays ?? 0)
  if (k === 'winback') return isWinbackInactive(c.lastCompletedAt, now, p.inactivityDays ?? 0)
  return false
}

/** Regla ganadora (mayor prioridad) entre las temporales que matchean a la clienta. Pura. */
export function selectTimedRuleForCustomer(rules: TimedRule[], c: Candidate, now: Date, tz: string): TimedRule | null {
  for (const rule of sortByPriorityDesc(rules)) {
    if (ruleMatches(rule, c, now, tz)) return rule
  }
  return null
}

/** Barrido diario (corre cada hora, idempotente por dedupeKey de ocasión). Emite a lo sumo
 *  una recompensa temporal por (clienta, día) — la de mayor prioridad. */
export async function runAutomaticLoyalty(now: Date = new Date()): Promise<RunAutomaticLoyaltyResult> {
  const businesses = await prisma.business.findMany({
    where: { loyaltyConfig: { isActive: true },
      promotions: { some: { triggerType: 'automatic', isActive: true } } },
    select: { id: true, name: true, timezone: true,
      loyaltyConfig: { select: { grantExpiryDays: true, forfeitGrantOnNoShow: true, isActive: true, pointsLabel: true } },
      currency: true },
  })

  let emitted = 0, errors = 0
  for (const biz of businesses) {
    const tz = biz.timezone || 'America/Santiago'
    const config = { grantExpiryDays: biz.loyaltyConfig?.grantExpiryDays ?? null,
      forfeitGrantOnNoShow: biz.loyaltyConfig?.forfeitGrantOnNoShow ?? false }

    const rules = (await prisma.promotion.findMany({
      where: { businessId: biz.id, triggerType: 'automatic', isActive: true },
      select: AUTOMATIC_RULE_SELECT,
    })).filter((r) => {
      const k = conditionKind(r.conditions)
      return k != null && TIMED_KINDS.includes(k as (typeof TIMED_KINDS)[number])
    }) as TimedRule[]
    if (rules.length === 0) continue

    // R-WINBACK: precargar emisiones win-back previas por clienta (ledger + grants), por COLUMNA.
    const winbackRule = rules.find((r) => conditionKind(r.conditions) === 'winback')
    const winbackEmittedAt = new Map<string, Date>()
    if (winbackRule) {
      const [ledgerHits, grantHits] = await Promise.all([
        prisma.loyaltyLedger.findMany({
          where: { businessId: biz.id, reason: 'bonus', sourcePromotionId: winbackRule.id },
          select: { customerId: true, createdAt: true },
        }),
        prisma.promotionGrant.findMany({
          where: { businessId: biz.id, promotionId: winbackRule.id },
          select: { customerId: true, createdAt: true },
        }),
      ])
      for (const h of [...ledgerHits, ...grantHits]) {
        if (!h.customerId) continue
        const prev = winbackEmittedAt.get(h.customerId)
        if (!prev || h.createdAt > prev) winbackEmittedAt.set(h.customerId, h.createdAt)
      }
    }

    // Candidatas: las que tienen alguna señal temporal.
    const customers = await prisma.customer.findMany({
      where: { businessId: biz.id,
        OR: [{ birthDate: { not: null } }, { firstCompletedAt: { not: null } }] },
      select: { id: true, birthDate: true, firstCompletedAt: true, lastCompletedAt: true,
        name: true, email: true, loyaltyToken: true, marketingOptOutAt: true },
    })

    for (const c of customers) {
      // R-WINBACK: excluir win-back si ya hubo emisión posterior a su última visita.
      const applicable = rules.filter((r) => {
        if (conditionKind(r.conditions) !== 'winback') return true
        const emittedAt = winbackEmittedAt.get(c.id)
        if (!emittedAt) return true
        // Re-elegible solo si volvió a visitar después de la última emisión win-back.
        return c.lastCompletedAt == null || emittedAt <= c.lastCompletedAt
      })
      const rule = selectTimedRuleForCustomer(applicable, c, now, tz)
      if (!rule) continue
      const dedupeKey = occasionKey(rule, c, now, tz)
      try {
        const out = await prisma.$transaction((tx) =>
          emitAutomaticReward(tx, { rule, businessId: biz.id, customerId: c.id, dedupeKey, config, now }))
        if (out) {
          emitted++
          // Email transaccional de recompensa — SOLO birthday/winback (anniversary queda mudo).
          // Best-effort: nunca rompe ni bloquea la emisión (sendRewardEmail traga errores).
          // Email de recompensa — sólo birthday/winback (anniversary queda mudo). La puerta
          // de opt-out vive ahora en sendRewardEmail; el grant se emitió igual (arriba).
          const kind = conditionKind(rule.conditions)
          if ((kind === 'birthday' || kind === 'winback') && c.email) {
            const rewardLabel = describeReward(
              out, rule, biz.loyaltyConfig?.pointsLabel ?? 'puntos', biz.currency || 'CLP',
            )
            if (rewardLabel) {
              await sendRewardEmail({
                businessId: biz.id,
                customer: {
                  id: c.id, name: c.name, email: c.email,
                  loyaltyToken: c.loyaltyToken, marketingOptOutAt: c.marketingOptOutAt,
                },
                businessName: biz.name,
                config: biz.loyaltyConfig,
                rewardLabel,
                reason: kind,
              })
            }
          }
        }
      } catch (e) {
        errors++
        logger.error('loyalty.automatic_emit_failed', `cron emit falló customer=${c.id} rule=${rule.id}: ${String(e)}`)
      }
    }
  }
  return { businesses: businesses.length, emitted, errors }
}
