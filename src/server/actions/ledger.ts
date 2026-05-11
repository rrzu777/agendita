'use server'

import { z } from 'zod'
import { prisma } from '@/lib/db'
import type { LedgerEntry } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { checkRateLimit } from '@/lib/rate-limit'

const createLedgerEntrySchema = z.object({
  businessId: z.string().min(1),
  bookingId: z.string().min(1).nullable(),
  paymentId: z.string().min(1).nullable(),
  customerId: z.string().min(1).nullable(),
  type: z.string().min(1).max(50),
  direction: z.enum(['income', 'expense', 'neutral']),
  amount: z.number().positive(),
  currency: z.string().min(2).max(3),
  description: z.string().max(500).optional().nullable(),
  occurredAt: z.date(),
  createdByUserId: z.string().min(1).nullable(),
})

export async function getLedgerEntries(businessId?: string) {
  return prisma.ledgerEntry.findMany({
    where: businessId ? { businessId } : undefined,
    orderBy: { occurredAt: 'desc' },
    include: {
      booking: true,
      payment: true,
    },
  })
}

export async function createLedgerEntry(data: Omit<LedgerEntry, 'id' | 'createdAt'>) {
  const limit = await checkRateLimit('create-ledger-entry', 30, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = createLedgerEntrySchema.safeParse(data)
  if (!parsed.success) {
    throw new Error('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const entry = await prisma.ledgerEntry.create({ data })
  revalidatePath('/dashboard/payments')
  return entry
}

export async function getFinancialSummary(businessId?: string) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1)

  const baseWhere = businessId ? { businessId } : {}

  const [incomeToday, incomeMonth, totalDeposited, totalPending, totalRefunded, totalBookings, completedBookings, cancelledBookings] = await Promise.all([
    prisma.ledgerEntry.aggregate({
      where: {
        ...baseWhere,
        direction: 'income',
        occurredAt: { gte: today },
      },
      _sum: { amount: true },
    }),
    prisma.ledgerEntry.aggregate({
      where: {
        ...baseWhere,
        direction: 'income',
        occurredAt: { gte: thisMonth },
      },
      _sum: { amount: true },
    }),
    prisma.payment.aggregate({
      where: {
        ...baseWhere,
        status: 'approved',
        paymentType: 'deposit',
      },
      _sum: { amount: true },
    }),
    prisma.booking.aggregate({
      where: {
        ...baseWhere,
        status: { notIn: ['cancelled', 'no_show'] },
      },
      _sum: { remainingBalance: true },
    }),
    prisma.ledgerEntry.aggregate({
      where: {
        ...baseWhere,
        type: 'refund_issued',
      },
      _sum: { amount: true },
    }),
    prisma.booking.count({ where: baseWhere }),
    prisma.booking.count({ where: { ...baseWhere, status: 'completed' } }),
    prisma.booking.count({ where: { ...baseWhere, status: 'cancelled' } }),
  ])

  return {
    incomeToday: incomeToday._sum.amount ?? 0,
    incomeMonth: incomeMonth._sum.amount ?? 0,
    totalDeposited: totalDeposited._sum.amount ?? 0,
    totalPending: totalPending._sum.remainingBalance ?? 0,
    totalRefunded: totalRefunded._sum.amount ?? 0,
    totalBookings,
    completedBookings,
    cancelledBookings,
  }
}
