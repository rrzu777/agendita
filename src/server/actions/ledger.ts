'use server'

import { z } from 'zod'
import { prisma } from '@/lib/db'
import type { LedgerEntry } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { checkRateLimit } from '@/lib/rate-limit'
import { requireBusiness, requireBusinessRole, ForbiddenError } from '@/lib/auth/server'

const createLedgerEntrySchema = z.object({
  bookingId: z.string().min(1).nullable(),
  paymentId: z.string().min(1).nullable(),
  customerId: z.string().min(1).nullable(),
  type: z.string().min(1).max(50),
  direction: z.enum(['income', 'expense', 'neutral']),
  amount: z.number().positive(),
  currency: z.string().min(2).max(3),
  description: z.string().max(500).optional().nullable(),
  occurredAt: z.date(),
})

export async function getLedgerEntries() {
  const { businessId } = await requireBusiness()
  return prisma.ledgerEntry.findMany({
    where: { businessId },
    orderBy: { occurredAt: 'desc' },
    include: {
      booking: true,
      payment: true,
      packagePurchase: { include: { product: { select: { name: true } }, customer: { select: { name: true } } } },
    },
  })
}

export async function createLedgerEntry(data: Omit<LedgerEntry, 'id' | 'createdAt' | 'businessId' | 'createdByUserId'>) {
  const { businessId, user } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('create-ledger-entry', 30, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = createLedgerEntrySchema.safeParse(data)
  if (!parsed.success) {
    throw new Error('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  if (data.bookingId) {
    const booking = await prisma.booking.findFirst({
      where: { id: data.bookingId, businessId },
    })
    if (!booking) throw new ForbiddenError('Reserva no encontrada')
  }
  if (data.paymentId) {
    const payment = await prisma.payment.findFirst({
      where: { id: data.paymentId, businessId },
    })
    if (!payment) throw new ForbiddenError('Pago no encontrado')
  }
  if (data.customerId) {
    const customer = await prisma.customer.findFirst({
      where: { id: data.customerId, businessId },
    })
    if (!customer) throw new ForbiddenError('Cliente no encontrado')
  }

  const entry = await prisma.ledgerEntry.create({
    data: {
      ...data,
      businessId,
      createdByUserId: user.id,
    },
  })
  revalidatePath('/dashboard/payments')
  return entry
}

export async function getFinancialSummary() {
  const { businessId } = await requireBusiness()
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1)

  const baseWhere = { businessId }

  const [
    incomeToday,
    incomeMonth,
    totalDeposited,
    totalPending,
    totalRefunded,
    totalBookings,
    completedBookings,
    cancelledBookings,
    packageSaleToday,
    packageSaleMonth,
    packageRefundToday,
    packageRefundMonth,
  ] = await Promise.all([
    prisma.ledgerEntry.aggregate({
      where: {
        ...baseWhere,
        direction: 'income',
        packagePurchaseId: null,
        occurredAt: { gte: today },
      },
      _sum: { amount: true },
    }),
    prisma.ledgerEntry.aggregate({
      where: {
        ...baseWhere,
        direction: 'income',
        packagePurchaseId: null,
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
        packagePurchaseId: null,
      },
      _sum: { amount: true },
    }),
    prisma.booking.count({ where: baseWhere }),
    prisma.booking.count({ where: { ...baseWhere, status: 'completed' } }),
    prisma.booking.count({ where: { ...baseWhere, status: 'cancelled' } }),
    // Ventas de paquete (income) hoy/mes, netas de refunds — como getPackageSalesTotal
    // (SUM(package_sale) − SUM(refund_issued con packagePurchaseId)) pero acotado a la
    // ventana. OJO: sale y refund se ventanean por su propio occurredAt, así que un
    // refund de una venta de un período anterior no reconcilia dentro de esta ventana
    // (queda clampeado a 0 por el Math.max de abajo). Es un KPI de "ventas del período",
    // no un neto histórico; para el histórico exacto usar getPackageSalesTotal.
    prisma.ledgerEntry.aggregate({
      where: { ...baseWhere, type: 'package_sale', packagePurchaseId: { not: null }, occurredAt: { gte: today } },
      _sum: { amount: true },
    }),
    prisma.ledgerEntry.aggregate({
      where: { ...baseWhere, type: 'package_sale', packagePurchaseId: { not: null }, occurredAt: { gte: thisMonth } },
      _sum: { amount: true },
    }),
    prisma.ledgerEntry.aggregate({
      where: { ...baseWhere, type: 'refund_issued', packagePurchaseId: { not: null }, occurredAt: { gte: today } },
      _sum: { amount: true },
    }),
    prisma.ledgerEntry.aggregate({
      where: { ...baseWhere, type: 'refund_issued', packagePurchaseId: { not: null }, occurredAt: { gte: thisMonth } },
      _sum: { amount: true },
    }),
  ])

  return {
    // incomeToday/incomeMonth filtran packagePurchaseId: null (ver arriba), así que
    // packageIncomeToday/Month son ADITIVOS, no se solapan con estas cifras.
    incomeToday: incomeToday._sum.amount ?? 0,
    incomeMonth: incomeMonth._sum.amount ?? 0,
    totalDeposited: totalDeposited._sum.amount ?? 0,
    totalPending: totalPending._sum.remainingBalance ?? 0,
    totalRefunded: totalRefunded._sum.amount ?? 0,
    totalBookings,
    completedBookings,
    cancelledBookings,
    packageIncomeToday: Math.max(0, (packageSaleToday._sum.amount ?? 0) - (packageRefundToday._sum.amount ?? 0)),
    packageIncomeMonth: Math.max(0, (packageSaleMonth._sum.amount ?? 0) - (packageRefundMonth._sum.amount ?? 0)),
  }
}
