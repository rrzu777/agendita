import { Prisma, PrismaClient } from '@prisma/client'
import { formatInTimeZone } from 'date-fns-tz'
import type { CampaignSegmentType } from './schema'
import { DEFAULT_INACTIVE_DAYS, DEFAULT_FREQUENT_MIN } from './schema'
import { isWhatsappablePhone } from '@/lib/customers/phone'
import { DAY_MS } from '@/lib/dates'

type Db = PrismaClient | Prisma.TransactionClient
export interface SegmentCustomer { id: string; name: string; phone: string; birthDate: Date | null }

// Reservas "vivas" para el segmento de saldo pendiente.
const DEAD = ['cancelled', 'no_show', 'expired'] as const

function monthInTz(date: Date, tz: string): number {
  return Number(formatInTimeZone(date, tz, 'MM'))
}

export interface SegmentParams { inactiveDays?: number; frequentMin?: number }

const select = { id: true, name: true, phone: true, birthDate: true } as const

export async function queryCampaignSegment(
  db: Db,
  businessId: string,
  segment: CampaignSegmentType,
  params: SegmentParams,
  now: Date,
  timeZone: string,
): Promise<SegmentCustomer[]> {
  const rows = await fetchSegmentRows(db, businessId, segment, params, now, timeZone)
  return rows.filter((c) => isWhatsappablePhone(c.phone))
}

async function fetchSegmentRows(
  db: Db,
  businessId: string,
  segment: CampaignSegmentType,
  params: SegmentParams,
  now: Date,
  timeZone: string,
): Promise<SegmentCustomer[]> {
  if (segment === 'birthday_month') {
    // birthDate se guarda a 00:00Z (@db.Date) → su mes se lee en UTC; "ahora" en tz del negocio.
    const rows = await db.customer.findMany({ where: { businessId, birthDate: { not: null } }, select })
    const nowMonth = monthInTz(now, timeZone)
    return rows.filter((c) => c.birthDate && monthInTz(c.birthDate, 'UTC') === nowMonth)
  }

  if (segment === 'inactive') {
    const days = params.inactiveDays ?? DEFAULT_INACTIVE_DAYS
    const cutoff = new Date(now.getTime() - days * DAY_MS)
    return db.customer.findMany({
      where: { businessId, lastCompletedAt: { not: null, lte: cutoff } },
      select,
    })
  }

  if (segment === 'frequent') {
    const min = params.frequentMin ?? DEFAULT_FREQUENT_MIN
    const groups = await db.booking.groupBy({
      by: ['customerId'],
      where: { businessId, status: 'completed' },
      having: { id: { _count: { gte: min } } },
    })
    return customersByIds(db, businessId, groups.map((g) => g.customerId))
  }

  // pending_balance — el where ya garantiza remainingBalance > 0 por reserva viva.
  const groups = await db.booking.groupBy({
    by: ['customerId'],
    where: { businessId, remainingBalance: { gt: 0 }, status: { notIn: [...DEAD] } },
  })
  return customersByIds(db, businessId, groups.map((g) => g.customerId))
}

function customersByIds(db: Db, businessId: string, ids: string[]): Promise<SegmentCustomer[]> {
  if (ids.length === 0) return Promise.resolve([])
  return db.customer.findMany({ where: { id: { in: ids }, businessId }, select })
}
