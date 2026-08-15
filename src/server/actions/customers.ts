'use server'

import { z } from 'zod'
import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { requireBusiness, requireBusinessRole, ForbiddenError } from '@/lib/auth/server'
import { action, UserError } from '@/lib/actions/result'
import { checkRateLimit } from '@/lib/rate-limit'
import { PaymentStatus, BookingStatus, type Prisma } from '@prisma/client'
import { updateCustomerSchema, updateCustomerNotesSchema } from '@/lib/customers/schema'
import { normalizePhone } from '@/lib/customers/phone'
import { setMarketingOptOut } from '@/lib/campaigns/optout'
import { getVocabulary } from '@/lib/vocabulary'

export type CustomerListItem = {
  id: string
  name: string
  phone: string
  email: string | null
  notes: string | null
  birthDate: Date | null
  marketingOptOut: boolean
  bookingCount: number
  lastBookingAt: Date | null
  totalPaidApproved: number
  pendingBalance: number
  createdAt: Date
}

export type CustomerPage = {
  items: CustomerListItem[]
  nextCursor: string | null
}

export type CustomerListStats = {
  total: number
  withBookings: number
  withPendingBalance: number
}

const CUSTOMER_LIST_SELECT = {
  id: true,
  name: true,
  phone: true,
  email: true,
  notes: true,
  birthDate: true,
  marketingOptOutAt: true,
  createdAt: true,
} satisfies Prisma.CustomerSelect

type CustomerListBase = Prisma.CustomerGetPayload<{ select: typeof CUSTOMER_LIST_SELECT }>

async function enrichCustomerListItems(businessId: string, customers: CustomerListBase[]): Promise<CustomerListItem[]> {
  if (customers.length === 0) return []
  const customerIds = customers.map((customer) => customer.id)
  const [paymentAggregates, bookingStats, pendingBalanceAggregates] = await Promise.all([
    prisma.payment.groupBy({
      by: ['customerId'],
      where: { customerId: { in: customerIds }, businessId, status: PaymentStatus.approved, paymentType: { not: 'refund' } },
      _sum: { amount: true },
    }),
    prisma.booking.groupBy({
      by: ['customerId'],
      where: {
        customerId: { in: customerIds }, businessId,
        status: { notIn: [BookingStatus.cancelled, BookingStatus.no_show, BookingStatus.expired] },
      },
      _count: { id: true },
      _max: { startDateTime: true },
    }),
    prisma.booking.groupBy({
      by: ['customerId'],
      where: {
        customerId: { in: customerIds }, businessId, remainingBalance: { gt: 0 },
        status: { notIn: [BookingStatus.cancelled, BookingStatus.no_show, BookingStatus.expired] },
      },
      _sum: { remainingBalance: true },
    }),
  ])
  const paymentByCustomer = new Map(paymentAggregates.map((payment) => [payment.customerId, payment._sum.amount ?? 0]))
  const bookingStatsByCustomer = new Map(bookingStats.map((booking) => [booking.customerId, booking]))
  const pendingBalanceByCustomer = new Map(pendingBalanceAggregates.map((booking) => [booking.customerId, booking._sum.remainingBalance ?? 0]))

  return customers.map((customer) => {
    const bookingStat = bookingStatsByCustomer.get(customer.id)
    return {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      notes: customer.notes,
      birthDate: customer.birthDate,
      marketingOptOut: customer.marketingOptOutAt != null,
      bookingCount: bookingStat?._count.id ?? 0,
      lastBookingAt: bookingStat?._max.startDateTime ?? null,
      totalPaidApproved: paymentByCustomer.get(customer.id) ?? 0,
      pendingBalance: pendingBalanceByCustomer.get(customer.id) ?? 0,
      createdAt: customer.createdAt,
    }
  })
}

export async function getCustomers(): Promise<CustomerListItem[]> {
  const { businessId } = await requireBusiness()

  const customers = await prisma.customer.findMany({
    where: { businessId },
    select: CUSTOMER_LIST_SELECT,
    take: 500,
  })

  const merged = await enrichCustomerListItems(businessId, customers)

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

/** La tabla general carga una página acotada; las fichas individuales siguen
 * usando su historial completo. El cursor se valida en el tenant antes de usarlo. */
export async function getCustomersPage({
  cursor,
  limit = 50,
  query,
}: {
  cursor?: string
  limit?: number
  query?: string
} = {}): Promise<CustomerPage> {
  const { businessId } = await requireBusiness()
  const take = Math.min(Math.max(Math.floor(limit), 1), 100)
  const term = query?.trim().slice(0, 100)
  const where: Prisma.CustomerWhereInput = term
    ? {
        businessId,
        OR: [
          { name: { contains: term, mode: 'insensitive' } },
          { phone: { contains: term, mode: 'insensitive' } },
          { email: { contains: term, mode: 'insensitive' } },
        ],
      }
    : { businessId }
  if (cursor) {
    const ownedCursor = await prisma.customer.findFirst({
      where: { ...where, id: cursor },
      select: { id: true },
    })
    if (!ownedCursor) return { items: [], nextCursor: null }
  }
  const rows = await prisma.customer.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    take: take + 1,
    select: CUSTOMER_LIST_SELECT,
  })
  const visible = rows.length > take ? rows.slice(0, take) : rows
  return {
    items: await enrichCustomerListItems(businessId, visible),
    nextCursor: rows.length > take ? visible.at(-1)?.id ?? null : null,
  }
}

export async function getCustomerListStats(): Promise<CustomerListStats> {
  const { businessId } = await requireBusiness()
  const activeStatuses = [BookingStatus.cancelled, BookingStatus.no_show, BookingStatus.expired]
  const [total, withBookings, withPendingBalance] = await Promise.all([
    prisma.customer.count({ where: { businessId } }),
    prisma.customer.count({
      where: { businessId, bookings: { some: { businessId, status: { notIn: activeStatuses } } } },
    }),
    prisma.customer.count({
      where: {
        businessId,
        bookings: { some: { businessId, remainingBalance: { gt: 0 }, status: { notIn: activeStatuses } } },
      },
    }),
  ])
  return { total, withBookings, withPendingBalance }
}

export type CustomerDetail = {
  id: string
  name: string
  phone: string
  email: string | null
  notes: string | null
  birthDate: Date | null
  marketingOptOutAt: Date | null
  bookingCount: number
  lastBookingAt: Date | null
  totalPaidApproved: number
  pendingBalance: number
  createdAt: Date
  updatedAt: Date
  /**
   * Quién la atendió la última vez: la persona de la reserva COMPLETADA más
   * reciente (spec multi-profesional §Panel). Derivado del historial, sin
   * columna nueva. `null` = nunca vino, o su última visita fue sin persona
   * asignada — en ambos casos la ficha no muestra la fila.
   *
   * Requerido (no opcional) como todo `professionalName` del track: opcional,
   * el próximo caller lo olvida y el dato desaparece sin error de compilación.
   */
  lastAttendedBy: string | null
  bookings: {
    id: string
    bookingNumber: number | null
    serviceName: string
    startDateTime: Date
    status: string
    /** Requerido por el mismo motivo que `lastAttendedBy`. */
    professionalName: string | null
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
  const { businessId, business } = await requireBusiness()

  const customer = await prisma.customer.findFirst({
    where: { id: customerId, businessId },
  })

  if (!customer) {
    throw new ForbiddenError(getVocabulary(business.category).clientNotFound)
  }

  const [bookings, payments, paymentSum, bookingStats, pendingBalanceSum] = await Promise.all([
    prisma.booking.findMany({
      where: { customerId, businessId },
      orderBy: { startDateTime: 'desc' },
      select: {
        id: true,
        bookingNumber: true,
        startDateTime: true,
        status: true,
        totalPrice: true,
        remainingBalance: true,
        finalAmount: true,
        service: { select: { name: true } },
        professional: { select: { name: true } },
      },
    }),
    prisma.payment.findMany({
      where: {
        customerId,
        businessId,
        NOT: { paymentType: 'package_purchase', status: 'pending' },
      },
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
    birthDate: customer.birthDate,
    marketingOptOutAt: customer.marketingOptOutAt,
    bookingCount: bookingStats._count.id,
    lastBookingAt: bookingStats._max.startDateTime,
    totalPaidApproved: paymentSum._sum.amount ?? 0,
    pendingBalance: pendingBalanceSum._sum.remainingBalance ?? 0,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
    // La completada más reciente (la lista ya viene desc), tenga o no persona:
    // saltar a una completada más vieja CON persona diría "la atendió Raul"
    // cuando la última vez la atendió la dueña sin equipo.
    lastAttendedBy:
      bookings.find((b) => b.status === BookingStatus.completed)?.professional?.name ?? null,
    bookings: bookings.map((b) => ({
      id: b.id,
      bookingNumber: b.bookingNumber,
      serviceName: b.service.name,
      startDateTime: b.startDateTime,
      status: b.status,
      professionalName: b.professional?.name ?? null,
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

async function _updateCustomer(customerId: string, data: unknown) {
  const { businessId, business } = await requireBusinessRole(['owner', 'admin'])

  const limit = await checkRateLimit('update-customer', 20, 60000)
  if (!limit.success) {
    throw new UserError('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = updateCustomerSchema.safeParse(data)
  if (!parsed.success) {
    throw new UserError('Datos invalidos: ' + parsed.error.issues.map((i) => i.message).join(', '))
  }

  const existing = await prisma.customer.findFirst({
    where: { id: customerId, businessId },
  })
  if (!existing) {
    throw new ForbiddenError(getVocabulary(business.category).clientNotFound)
  }

  const emailClean = (parsed.data.email === '' || parsed.data.email === null) ? null : parsed.data.email
  // birthDate llega como 'YYYY-MM-DD' o null. Lo anclamos a medianoche UTC para
  // que la columna DATE no se corra de día por la zona horaria.
  const birthDateClean = parsed.data.birthDate ? new Date(`${parsed.data.birthDate}T00:00:00Z`) : null

  const updated = await prisma.customer.update({
    where: { id: customerId },
    data: {
      name: parsed.data.name,
      phone: parsed.data.phone,
      email: emailClean,
      birthDate: birthDateClean,
    },
  })

  revalidatePath('/dashboard/customers')
  revalidatePath(`/dashboard/customers/${customerId}`)
  return updated
}

export const updateCustomer = action(_updateCustomer)

async function _updateCustomerNotes(customerId: string, data: unknown) {
  const { businessId, business } = await requireBusinessRole(['owner', 'admin'])

  const limit = await checkRateLimit('update-customer-notes', 20, 60000)
  if (!limit.success) {
    throw new UserError('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = updateCustomerNotesSchema.safeParse(data)
  if (!parsed.success) {
    throw new UserError('Datos invalidos: ' + parsed.error.issues.map((i) => i.message).join(', '))
  }

  const existing = await prisma.customer.findFirst({
    where: { id: customerId, businessId },
  })
  if (!existing) {
    throw new ForbiddenError(getVocabulary(business.category).clientNotFound)
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

export const updateCustomerNotes = action(_updateCustomerNotes)

async function _setCustomerMarketingOptOut(customerId: string, optedOut: boolean) {
  const { businessId, business } = await requireBusinessRole(['owner', 'admin'])

  const limit = await checkRateLimit('update-customer', 20, 60000)
  if (!limit.success) {
    throw new UserError('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }
  if (typeof optedOut !== 'boolean') throw new UserError('Datos invalidos')

  const existing = await prisma.customer.findFirst({
    where: { id: customerId, businessId },
    select: { id: true },
  })
  if (!existing) {
    throw new ForbiddenError(getVocabulary(business.category).clientNotFound)
  }

  await setMarketingOptOut(prisma, customerId, optedOut)

  revalidatePath('/dashboard/customers')
  revalidatePath(`/dashboard/customers/${customerId}`)
}

export const setCustomerMarketingOptOut = action(_setCustomerMarketingOptOut)

const searchCustomersForBookingSchema = z.object({
  query: z.string().min(1).max(100),
})

export type CustomerSearchResult = {
  id: string
  name: string
  phone: string
  email: string | null
}

async function _searchCustomersForBooking(query: string): Promise<CustomerSearchResult[]> {
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

export const searchCustomersForBooking = action(_searchCustomersForBooking)
