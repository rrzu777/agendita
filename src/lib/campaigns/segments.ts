import { Prisma, PrismaClient } from '@prisma/client'
import { formatInTimeZone } from 'date-fns-tz'
import type { CampaignSegmentType } from './schema'
import { DEFAULT_INACTIVE_DAYS, DEFAULT_FREQUENT_MIN } from './schema'

type Db = PrismaClient | Prisma.TransactionClient
export interface SegmentCustomer { id: string; name: string; phone: string; birthDate: Date | null }

const DAY_MS = 86_400_000
// Reservas "vivas" (no muertas) para saldo/actividad.
const DEAD = ['cancelled', 'no_show', 'expired'] as const

function hasValidPhone(phone: string): boolean {
  return phone.replace(/\D/g, '').length >= 8
}
function monthInTz(date: Date, tz: string): number {
  return Number(formatInTimeZone(date, tz, 'MM'))
}

export interface SegmentParams { inactiveDays?: number; frequentMin?: number }

export async function queryCampaignSegment(
  db: Db,
  businessId: string,
  segment: CampaignSegmentType,
  params: SegmentParams,
  now: Date,
  timeZone: string,
): Promise<SegmentCustomer[]> {
  const select = { id: true, name: true, phone: true, birthDate: true } as const

  if (segment === 'birthday_month') {
    // birthDate se guarda a 00:00Z (@db.Date) → su mes se lee en UTC; "ahora" en tz del negocio.
    const rows = await db.customer.findMany({ where: { businessId, birthDate: { not: null } }, select })
    const nowMonth = monthInTz(now, timeZone)
    return rows.filter((c) => c.birthDate && monthInTz(c.birthDate, 'UTC') === nowMonth && hasValidPhone(c.phone))
  }

  if (segment === 'inactive') {
    const days = params.inactiveDays ?? DEFAULT_INACTIVE_DAYS
    const cutoff = new Date(now.getTime() - days * DAY_MS)
    const rows = await db.customer.findMany({
      where: { businessId, lastCompletedAt: { not: null, lte: cutoff } },
      select,
    })
    return rows.filter((c) => hasValidPhone(c.phone))
  }

  if (segment === 'frequent') {
    const min = params.frequentMin ?? DEFAULT_FREQUENT_MIN
    const groups = await db.booking.groupBy({
      by: ['customerId'],
      where: { businessId, status: 'completed' },
      _count: { id: true },
    })
    const ids = groups.filter((g) => g._count.id >= min).map((g) => g.customerId)
    if (ids.length === 0) return []
    const rows = await db.customer.findMany({ where: { id: { in: ids }, businessId }, select })
    return rows.filter((c) => hasValidPhone(c.phone))
  }

  // pending_balance
  const groups = await db.booking.groupBy({
    by: ['customerId'],
    where: { businessId, remainingBalance: { gt: 0 }, status: { notIn: [...DEAD] } },
    _sum: { remainingBalance: true },
  })
  const ids = groups.filter((g) => (g._sum.remainingBalance ?? 0) > 0).map((g) => g.customerId)
  if (ids.length === 0) return []
  const rows = await db.customer.findMany({ where: { id: { in: ids }, businessId }, select })
  return rows.filter((c) => hasValidPhone(c.phone))
}
