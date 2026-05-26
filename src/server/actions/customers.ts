'use server'

import { z } from 'zod'
import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { requireBusiness, requireBusinessRole, ForbiddenError } from '@/lib/auth/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { PaymentStatus, BookingStatus } from '@prisma/client'
import { updateCustomerSchema, updateCustomerNotesSchema } from '@/lib/customers/schema'
import { normalizePhone } from '@/lib/customers/phone'

export type CustomerListItem = {
  id: string
  name: string
  phone: string
  email: string | null
  notes: string | null
  bookingCount: number
  lastBookingAt: Date | null
  totalPaidApproved: number
  pendingBalance: number
  createdAt: Date
}

export async function getCustomers(): Promise<CustomerListItem[]> {
  const { businessId } = await requireBusiness()

  const customers = await prisma.customer.findMany({
    where: { businessId },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      notes: true,
      createdAt: true,
    },
    take: 500,
  })

  if (customers.length === 0) return []

  const customerIds = customers.map((c) => c.id)

  const [paymentAggregates, bookingStats, pendingBalanceAggregates] = await Promise.all([
    prisma.payment.groupBy({
      by: ['customerId'],
      where: {
        customerId: { in: customerIds },
        businessId,
        status: PaymentStatus.approved,
        paymentType: { not: 'refund' },
      },
      _sum: { amount: true },
    }),
    prisma.booking.groupBy({
      by: ['customerId'],
      where: {
        customerId: { in: customerIds },
        businessId,
        status: { notIn: [BookingStatus.cancelled, BookingStatus.no_show, BookingStatus.expired] },
      },
      _count: { id: true },
      _max: { startDateTime: true },
    }),
    prisma.booking.groupBy({
      by: ['customerId'],
      where: {
        customerId: { in: customerIds },
        businessId,
        remainingBalance: { gt: 0 },
        status: { notIn: [BookingStatus.cancelled, BookingStatus.no_show, BookingStatus.expired] },
      },
      _sum: { remainingBalance: true },
    }),
  ])

  const paymentByCustomer = new Map(
    paymentAggregates.map((p) => [p.customerId, p._sum.amount ?? 0])
  )

  const bookingStatsByCustomer = new Map(
    bookingStats.map((b) => [b.customerId, b])
  )

  const pendingBalanceByCustomer = new Map(
    pendingBalanceAggregates.map((b) => [b.customerId, b._sum.remainingBalance ?? 0])
  )

  const merged = customers.map((c) => {
    const bookingStat = bookingStatsByCustomer.get(c.id)
    const bookingCount = bookingStat?._count.id ?? 0
    const lastBookingAt = bookingStat?._max.startDateTime ?? null
    const pendingBalance = pendingBalanceByCustomer.get(c.id) ?? 0
    const totalPaidApproved = paymentByCustomer.get(c.id) ?? 0

    return {
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      notes: c.notes,
      bookingCount,
      lastBookingAt,
      totalPaidApproved,
      pendingBalance,
      createdAt: c.createdAt,
    }
  })

  merged.sort((a, b) => {
    if (a.lastBookingAt && b.lastBookingAt) {
      return b.lastBookingAt.getTime() - a.lastBookingAt.getTime()
    }
    if (a.lastBookingAt) return -1
    if (b.lastBookingAt) return 1
    return b.createdAt.getTime() - a.createdAt.getTime()
  })

  return merged
}

export type CustomerDetail = {
  id: string
  name: string
  phone: string
  email: string | null
  notes: string | null
  bookingCount: number
  lastBookingAt: Date | null
  totalPaidApproved: number
  pendingBalance: number
  createdAt: Date
  updatedAt: Date
  bookings: {
    id: string
    serviceName: string
    startDateTime: Date
    status: string
    totalPrice: number
    remainingBalance: number
    finalAmount: number
  }[]
  payments: {
    id: string
    amount: number
    status: string
    paymentType: string
    paymentMethod: string | null
    paidAt: Date | null
    createdAt: Date
    provider: string
  }[]
}

export async function getCustomerDetail(customerId: string): Promise<CustomerDetail> {
  const { businessId } = await requireBusiness()

  const customer = await prisma.customer.findFirst({
    where: { id: customerId, businessId },
  })

  if (!customer) {
    throw new ForbiddenError('Clienta no encontrada')
  }

  const [bookings, payments, paymentSum, bookingStats, pendingBalanceSum] = await Promise.all([
    prisma.booking.findMany({
      where: { customerId, businessId },
      orderBy: { startDateTime: 'desc' },
      select: {
        id: true,
        startDateTime: true,
        status: true,
        totalPrice: true,
        remainingBalance: true,
        finalAmount: true,
        service: { select: { name: true } },
      },
    }),
    prisma.payment.findMany({
      where: { customerId, businessId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        amount: true,
        status: true,
        paymentType: true,
        paymentMethod: true,
        paidAt: true,
        createdAt: true,
        provider: true,
      },
    }),
    prisma.payment.aggregate({
      where: {
        customerId,
        businessId,
        status: PaymentStatus.approved,
        paymentType: { not: 'refund' },
      },
      _sum: { amount: true },
    }),
    prisma.booking.aggregate({
      where: {
        customerId,
        businessId,
        status: { notIn: [BookingStatus.cancelled, BookingStatus.no_show, BookingStatus.expired] },
      },
      _count: { id: true },
      _max: { startDateTime: true },
    }),
    prisma.booking.aggregate({
      where: {
        customerId,
        businessId,
        remainingBalance: { gt: 0 },
        status: { notIn: [BookingStatus.cancelled, BookingStatus.no_show, BookingStatus.expired] },
      },
      _sum: { remainingBalance: true },
    }),
  ])

  return {
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    notes: customer.notes,
    bookingCount: bookingStats._count.id,
    lastBookingAt: bookingStats._max.startDateTime,
    totalPaidApproved: paymentSum._sum.amount ?? 0,
    pendingBalance: pendingBalanceSum._sum.remainingBalance ?? 0,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
    bookings: bookings.map((b) => ({
      id: b.id,
      serviceName: b.service.name,
      startDateTime: b.startDateTime,
      status: b.status,
      totalPrice: b.totalPrice,
      remainingBalance: b.remainingBalance,
      finalAmount: b.finalAmount,
    })),
    payments: payments.map((p) => ({
      id: p.id,
      amount: p.amount,
      status: p.status,
      paymentType: p.paymentType,
      paymentMethod: p.paymentMethod,
      paidAt: p.paidAt,
      createdAt: p.createdAt,
      provider: p.provider,
    })),
  }
}

export async function updateCustomer(customerId: string, data: unknown) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])

  const limit = await checkRateLimit('update-customer', 20, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = updateCustomerSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error('Datos invalidos: ' + parsed.error.issues.map((i) => i.message).join(', '))
  }

  const existing = await prisma.customer.findFirst({
    where: { id: customerId, businessId },
  })
  if (!existing) {
    throw new ForbiddenError('Clienta no encontrada')
  }

  const emailClean = (parsed.data.email === '' || parsed.data.email === null) ? null : parsed.data.email

  const updated = await prisma.customer.update({
    where: { id: customerId },
    data: {
      name: parsed.data.name,
      phone: parsed.data.phone,
      email: emailClean,
    },
  })

  revalidatePath('/dashboard/customers')
  revalidatePath(`/dashboard/customers/${customerId}`)
  return updated
}

export async function updateCustomerNotes(customerId: string, data: unknown) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])

  const limit = await checkRateLimit('update-customer-notes', 20, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = updateCustomerNotesSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error('Datos invalidos: ' + parsed.error.issues.map((i) => i.message).join(', '))
  }

  const existing = await prisma.customer.findFirst({
    where: { id: customerId, businessId },
  })
  if (!existing) {
    throw new ForbiddenError('Clienta no encontrada')
  }

  const notesClean = parsed.data.notes === '' ? null : (parsed.data.notes ?? undefined)

  const updated = await prisma.customer.update({
    where: { id: customerId },
    data: { notes: notesClean },
  })

  revalidatePath('/dashboard/customers')
  revalidatePath(`/dashboard/customers/${customerId}`)
  return updated
}

const searchCustomersForBookingSchema = z.object({
  query: z.string().min(1).max(100),
})

export type CustomerSearchResult = {
  id: string
  name: string
  phone: string
  email: string | null
}

export async function searchCustomersForBooking(query: string): Promise<CustomerSearchResult[]> {
  const { businessId } = await requireBusiness()

  const parsed = searchCustomersForBookingSchema.safeParse({ query })
  if (!parsed.success) {
    return []
  }

  const normalized = normalizePhone(query)
  const digitsOnly = normalized.replace(/\D/g, '')

  const customers = await prisma.customer.findMany({
    where: {
      businessId,
      OR: [
        { name: { contains: parsed.data.query, mode: 'insensitive' } },
        ...(digitsOnly.length >= 8 ? [{ phone: { contains: digitsOnly } }] : []),
      ],
    },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  })

  return customers
}
