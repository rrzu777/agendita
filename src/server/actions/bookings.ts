'use server'

import { z } from 'zod'
import { prisma } from '@/lib/db'
import type { Booking } from '@prisma/client'
import { BookingStatus, BookingPaymentStatus, PaymentProvider, PaymentType } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { checkRateLimit } from '@/lib/rate-limit'
import { revalidateBusinessPublicPaths } from './revalidate-business'
import { requireBusiness, requireBusinessRole, ForbiddenError } from '@/lib/auth/server'

import { assertSlotIsAvailable } from '@/lib/availability/validation'
import { addMinutes } from 'date-fns'
import {
  sendBookingReceivedToCustomer,
  sendNewBookingNotificationToBusiness,
  sendBookingCancelledNotification,
  sendBookingConfirmedNotification,
  sendNotificationSafely,
  sendMultiNotificationSafely,
} from '@/lib/notifications'

const createBookingSchema = z.object({
  serviceId: z.string().min(1),
  customerName: z.string().min(1).max(100),
  customerPhone: z.string().min(8).max(20),
  customerEmail: z.string().email().optional().or(z.literal('')),
  startDateTime: z.date(),
  idempotencyKey: z.string().min(1).max(64).optional(),
})

const confirmPaymentSchema = z.object({
  bookingId: z.string().min(1),
  paymentId: z.string().min(1),
  amount: z.number().positive(),
})

const registerManualPaymentSchema = z.object({
  bookingId: z.string().min(1),
  amount: z.number().positive(),
  paymentMethod: z.string().min(1).max(50),
})

const VALID_STATUS_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  pending_payment: ['confirmed', 'cancelled', 'expired'],
  confirmed: ['completed', 'cancelled', 'no_show'],
  completed: [],
  cancelled: [],
  no_show: [],
  expired: [],
}

async function fireBookingNotifications(
  business: {
    name: string
    timezone: string
    whatsapp: string | null
    addressText: string | null
    currency: string
    cancellationPolicy: string | null
    slug: string
    subdomain: string | null
  },
  booking: {
    customer: { name: string; phone: string; email: string | null }
    totalPrice: number
    depositRequired: number
    depositPaid: number
    remainingBalance: number
    startDateTime: Date
  } & { id: string; businessId: string },
  serviceName: string,
) {
  const customerEmail = booking.customer.email
  const businessTimezone = business.timezone || 'America/Santiago'
  const businessCurrency = business.currency || 'CLP'

  const domain = process.env.NEXT_PUBLIC_APP_DOMAIN || process.env.APP_DOMAIN || 'localhost:3000'
  const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '')
  const protocol = cleanDomain.startsWith('localhost') || cleanDomain.endsWith('.localhost') || cleanDomain.startsWith('127.0.0.1') ? 'http' : 'https'
  const dashboardLink = `${protocol}://${cleanDomain}/dashboard/bookings`

  const promises: Promise<unknown>[] = []

  if (customerEmail) {
    promises.push(
      sendNotificationSafely('customer received', () =>
        sendBookingReceivedToCustomer({
          businessName: business.name,
          businessWhatsapp: business.whatsapp,
          businessAddress: business.addressText,
          businessTimezone,
          businessCurrency,
          businessCancellationPolicy: business.cancellationPolicy,
          customerName: booking.customer.name,
          customerEmail,
          customerPhone: booking.customer.phone,
          serviceName,
          startDateTime: booking.startDateTime,
          totalPrice: booking.totalPrice,
          depositRequired: booking.depositRequired,
          depositPaid: booking.depositPaid,
          remainingBalance: booking.remainingBalance,
        }),
      ),
    )
  }

  promises.push(
    sendMultiNotificationSafely('business notification', () =>
      sendNewBookingNotificationToBusiness(booking.businessId, {
        businessName: business.name,
        customerName: booking.customer.name,
        customerPhone: booking.customer.phone,
        customerEmail: customerEmail || null,
        serviceName,
        startDateTime: booking.startDateTime,
        businessTimezone,
        businessCurrency,
        depositRequired: booking.depositRequired,
        remainingBalance: booking.remainingBalance,
        dashboardLink,
      }),
    ),
  )

  await Promise.allSettled(promises)
}

// sendBookingConfirmedNotification is now centralized in @/lib/notifications

export async function getBookings() {
  const { businessId } = await requireBusiness()
  return prisma.booking.findMany({
    where: { businessId },
    orderBy: { startDateTime: 'desc' },
    include: {
      service: true,
      customer: true,
    },
  })
}

export async function createBooking(data: {
  serviceId: string
  customerName: string
  customerPhone: string
  customerEmail?: string
  startDateTime: Date
  idempotencyKey?: string
}, businessId: string) {
  const limit = await checkRateLimit('create-booking', 20, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = createBookingSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error('Datos de reserva inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  // Validar que el negocio exista y esté activo
  const business = await prisma.business.findUnique({
    where: { id: businessId, isActive: true },
    select: {
      id: true,
      timezone: true,
      name: true,
      whatsapp: true,
      addressText: true,
      currency: true,
      cancellationPolicy: true,
      slug: true,
      subdomain: true,
    },
  })
  if (!business) {
    throw new Error('Negocio no válido')
  }

  // Validar que el servicio pertenezca al negocio
  const service = await prisma.service.findFirst({
    where: { id: data.serviceId, businessId, isActive: true },
  })
  if (!service) {
    throw new Error('Servicio no disponible')
  }

  // Recalcular precios y horario server-side
  const totalPrice = service.price
  const depositRequired = service.depositAmount
  const finalAmount = service.price
  const endDateTime = addMinutes(data.startDateTime, service.durationMinutes)

  // Idempotencia: si llega key, buscar booking existente fuera de tx (fast path).
  // El race final se maneja con el unique constraint de DB dentro de la tx.
  if (data.idempotencyKey) {
    const existing = await prisma.booking.findUnique({
      where: {
        businessId_idempotencyKey: {
          businessId,
          idempotencyKey: data.idempotencyKey,
        },
      },
      include: { service: true, customer: true },
    })
    if (existing) {
      return existing
    }
  }

  try {
    const booking = await prisma.$transaction(async (tx) => {
      // Validación transaccional de disponibilidad con lock
      await assertSlotIsAvailable({
        tx,
        businessId,
        serviceId: data.serviceId,
        startDateTime: data.startDateTime,
        endDateTime,
        timezone: business.timezone || 'America/Santiago',
      })

      // Buscar o crear cliente dentro de la transacción
      let customer = await tx.customer.findFirst({
        where: {
          phone: data.customerPhone,
          name: data.customerName,
          businessId,
        },
      })

      if (!customer) {
        customer = await tx.customer.create({
          data: {
            businessId,
            name: data.customerName,
            phone: data.customerPhone,
            email: data.customerEmail || null,
          },
        })
      }

      const holdExpiresAt = addMinutes(new Date(), 15)

      return tx.booking.create({
        data: {
          businessId,
          serviceId: data.serviceId,
          customerId: customer.id,
          startDateTime: data.startDateTime,
          endDateTime,
          status: BookingStatus.pending_payment,
          totalPrice,
          depositRequired,
          remainingBalance: finalAmount,
          finalAmount,
          paymentStatus: BookingPaymentStatus.unpaid,
          holdExpiresAt,
          idempotencyKey: data.idempotencyKey || null,
        },
        include: {
          service: true,
          customer: true,
        },
      })
    })

    const bookingForNotification = booking as Booking & {
      service: { name: string }
      customer: { name: string; phone: string; email: string | null }
    }

    await fireBookingNotifications(business, bookingForNotification, service.name)

    revalidatePath('/dashboard/bookings')
    await revalidateBusinessPublicPaths(businessId)
    return booking
  } catch (e: unknown) {
    // Race: otro request creó la misma idempotencyKey entre el findUnique y el create.
    // El unique constraint de DB lo detecta y devolvemos la reserva existente.
    const prismaError = e as { code?: string; meta?: { target?: string[] } }
    if (
      prismaError.code === 'P2002' &&
      data.idempotencyKey &&
      Array.isArray(prismaError.meta?.target) &&
      prismaError.meta.target.includes('businessId_idempotencyKey')
    ) {
      const existing = await prisma.booking.findUnique({
        where: {
          businessId_idempotencyKey: {
            businessId,
            idempotencyKey: data.idempotencyKey,
          },
        },
        include: { service: true, customer: true },
      })
      if (existing) return existing
    }
    throw e
  }
}

export async function updateBookingStatus(id: string, status: BookingStatus) {
  const { businessId } = await requireBusiness()
  const limit = await checkRateLimit('update-booking-status', 30, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const existing = await prisma.booking.findFirst({
    where: { id, businessId },
    include: {
      customer: { select: { name: true, email: true } },
      service: { select: { name: true } },
      business: { select: { name: true, timezone: true } },
    },
  })
  if (!existing) {
    throw new ForbiddenError('Reserva no encontrada')
  }

  if (!VALID_STATUS_TRANSITIONS[existing.status].includes(status)) {
    throw new ForbiddenError(`No se puede cambiar el estado de ${existing.status} a ${status}`)
  }

  const updateResult = await prisma.booking.updateMany({
    where: { id, businessId },
    data: { status },
  })
  if (updateResult.count === 0) {
    throw new ForbiddenError('Reserva no encontrada')
  }

  if (status === BookingStatus.cancelled && existing.customer.email) {
    await sendNotificationSafely('cancellation', () =>
      sendBookingCancelledNotification({
        businessName: existing.business.name,
        customerName: existing.customer.name,
        customerEmail: existing.customer.email,
        serviceName: existing.service.name,
        startDateTime: existing.startDateTime,
        businessTimezone: existing.business.timezone || 'America/Santiago',
      }),
    )
  }

  const updated = await prisma.booking.findUnique({ where: { id } })
  revalidatePath('/dashboard/bookings')
  revalidatePath('/dashboard/calendar')
  if (updated) {
    await revalidateBusinessPublicPaths(updated.businessId)
  }
  return updated
}

/**
 * Flujo privado (dashboard): confirma/aplica un pago ya existente a una reserva.
 * Requiere sesión y rol owner/admin. Delega toda la lógica financiera a
 * applyApprovedPayment para garantizar consistencia e idempotencia.
 */
export async function confirmPayment(bookingId: string, paymentId: string, amount: number) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('confirm-payment', 30, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = confirmPaymentSchema.safeParse({ bookingId, paymentId, amount })
  if (!parsed.success) {
    throw new Error('Datos de pago inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, businessId },
  })
  if (!booking) throw new ForbiddenError('Reserva no encontrada')

  const { assertBookingPayable } = await import('@/lib/booking-payments')
  try {
    assertBookingPayable(booking)
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : 'No se puede confirmar pago para esta reserva')
  }

  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, businessId },
  })
  if (!payment) throw new ForbiddenError('Pago no encontrado')
  if (payment.bookingId !== bookingId) throw new ForbiddenError('El pago no corresponde a esta reserva')
  if (payment.amount !== amount) throw new ForbiddenError('El monto no coincide con el pago registrado')

  let wasConfirmed = false

  const updated = await prisma.$transaction(async (tx) => {
    const { applyApprovedPayment } = await import('@/server/services/finance')
    const result = await applyApprovedPayment({
      tx,
      bookingId,
      businessId,
      amount: payment.amount,
      currency: payment.currency,
      provider: payment.provider,
      providerPaymentId: payment.providerPaymentId,
      paymentType: payment.paymentType,
      paymentMethod: payment.paymentMethod,
      paymentId: payment.id,
    })
    wasConfirmed = result.wasConfirmed
    return result.booking
  })

  if (updated && wasConfirmed) {
    await sendNotificationSafely('booking confirmed', () =>
      sendBookingConfirmedNotification(bookingId, businessId),
    )
  }

  revalidatePath('/dashboard/bookings')
  if (updated) {
    await revalidateBusinessPublicPaths(updated.businessId)
  }
  return updated
}

export async function getBookingsByRange(start: Date, end: Date) {
  const { businessId } = await requireBusiness()

  if (!(start instanceof Date) || isNaN(start.getTime()) || !(end instanceof Date) || isNaN(end.getTime())) {
    throw new Error('Rango de fechas inválido')
  }
  if (start > end) {
    throw new Error('La fecha de inicio debe ser anterior a la fecha de término')
  }

  return prisma.booking.findMany({
    where: {
      businessId,
      startDateTime: { gte: start, lte: end },
    },
    orderBy: { startDateTime: 'asc' },
    include: {
      service: true,
      customer: true,
    },
  })
}

export async function registerManualPayment(
  bookingId: string,
  amount: number,
  paymentMethod: string
) {
  const { businessId, business } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('register-manual-payment', 30, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = registerManualPaymentSchema.safeParse({
    bookingId,
    amount,
    paymentMethod,
  })
  if (!parsed.success) {
    throw new Error(
      'Datos inválidos: ' + parsed.error.issues.map((i) => i.message).join(', ')
    )
  }

  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, businessId },
  })
  if (!booking) throw new ForbiddenError('Reserva no encontrada')

  const { assertBookingPayable } = await import('@/lib/booking-payments')
  try {
    assertBookingPayable(booking)
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : 'No se puede registrar pago para esta reserva')
  }

  let wasConfirmed = false

  await prisma.$transaction(async (tx) => {
    const current = await tx.booking.findUnique({ where: { id: bookingId } })
    if (!current) throw new Error('Reserva no encontrada')
    if (current.remainingBalance <= 0) {
      throw new Error('La reserva ya está pagada')
    }
    if (amount > current.remainingBalance) {
      throw new Error('El monto excede el saldo pendiente')
    }

    const paymentType =
      current.depositPaid > 0 ? PaymentType.final_payment : PaymentType.full_payment

    const { applyApprovedPayment } = await import('@/server/services/finance')
    const result = await applyApprovedPayment({
      tx,
      bookingId,
      businessId,
      amount,
      currency: business.currency || 'CLP',
      provider: PaymentProvider.manual,
      providerPaymentId: null,
      paymentType,
      paymentMethod,
    })
    wasConfirmed = result.wasConfirmed
    return result.booking
  })

  revalidatePath('/dashboard/calendar')
  revalidatePath('/dashboard/bookings')
  await revalidateBusinessPublicPaths(businessId)

  const hydrated = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { service: true, customer: true },
  })

  if (hydrated && wasConfirmed) {
    await sendNotificationSafely('booking confirmed', () =>
      sendBookingConfirmedNotification(bookingId, businessId),
    )
  }

  return hydrated
}
