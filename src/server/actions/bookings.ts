'use server'

import { z } from 'zod'
import { prisma } from '@/lib/db'
import type { Booking } from '@prisma/client'
import { BookingStatus, BookingPaymentStatus, PaymentType } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { checkRateLimit } from '@/lib/rate-limit'
import { revalidateBusinessPublicPaths } from './revalidate-business'
import { requireBusiness, requireBusinessRole, ForbiddenError } from '@/lib/auth/server'
import { logger } from '@/lib/logger'

import { assertSlotIsAvailable } from '@/lib/availability/validation'
import { assertBusinessCanReceiveBookings } from '@/lib/subscriptions/enforcement'
import { normalizePhone } from '@/lib/customers/phone'
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
  acceptedTerms: z.boolean(),
})

const confirmPaymentSchema = z.object({
  bookingId: z.string().min(1),
  paymentId: z.string().min(1),
  amount: z.number().positive(),
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
  acceptedTerms: boolean
}, businessId: string) {
  const limit = await checkRateLimit('create-booking', 20, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = createBookingSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error('Datos de reserva inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  if (parsed.data.acceptedTerms !== true) {
    throw new Error('Debes aceptar los términos y condiciones y la política de cancelación')
  }

  // Validar que el negocio exista, esté activo y pueda recibir reservas
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
      subscriptionStatus: true,
    },
  })
  if (!business) {
    throw new Error('Negocio no válido')
  }

  assertBusinessCanReceiveBookings(business.subscriptionStatus)

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

      const noDepositRequired = depositRequired <= 0
      const isFreeService = finalAmount <= 0

      const status = noDepositRequired ? BookingStatus.confirmed : BookingStatus.pending_payment
      const holdExpiresAt = status === BookingStatus.pending_payment ? addMinutes(new Date(), 15) : null
      const bookingPaymentStatus = isFreeService ? BookingPaymentStatus.fully_paid : BookingPaymentStatus.unpaid

      return tx.booking.create({
        data: {
          businessId,
          serviceId: data.serviceId,
          customerId: customer.id,
          startDateTime: data.startDateTime,
          endDateTime,
          status,
          totalPrice,
          depositRequired,
          depositPaid: 0,
          remainingBalance: finalAmount,
          finalAmount,
          paymentStatus: bookingPaymentStatus,
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

    logger.booking.created(booking.id, businessId, booking.customer?.email ?? undefined)

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
    // Safe error handling: log internal error, return generic message
    const msg = e instanceof Error ? e.message : String(e)
    if (prismaError.code?.startsWith('P')) {
      logger.error('booking.error', `Database error in createBooking: ${msg}`, {
        businessId,
        metadata: { error: msg },
      })
      throw new Error('Error de base de datos. Por favor intenta nuevamente.')
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
  revalidatePath('/dashboard')
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

const createBookingFromDashboardSchema = z.object({
  serviceId: z.string().min(1),
  customerName: z.string().min(1).max(100),
  customerPhone: z.string().min(8).max(20),
  customerEmail: z.string().email().optional().or(z.literal('')),
  startDateTime: z.date(),
  internalNotes: z.string().max(500).optional(),
  markDepositPaid: z.boolean().optional().default(false),
  paymentMode: z.enum(['none', 'deposit_paid', 'full_paid']).optional(),
  paymentMethod: z.enum(['cash', 'transfer', 'external_card', 'other']).optional(),
  customerId: z.string().min(1).optional(),
})

const PAYMENT_METHOD_MAP: Record<string, string> = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
  external_card: 'Tarjeta externa',
  other: 'Otro',
}

export async function createBookingFromDashboard(data: {
  serviceId: string
  customerName: string
  customerPhone: string
  customerEmail?: string
  startDateTime: Date
  internalNotes?: string
  markDepositPaid?: boolean
  paymentMode?: 'none' | 'deposit_paid' | 'full_paid'
  paymentMethod?: string
  customerId?: string
}) {
  const { business, businessId } = await requireBusinessRole(['owner', 'admin'])

  const parsed = createBookingFromDashboardSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const service = await prisma.service.findFirst({
    where: { id: data.serviceId, businessId, isActive: true },
  })
  if (!service) {
    throw new Error('Servicio no disponible')
  }

  const totalPrice = service.price
  const depositRequired = service.depositAmount
  const finalAmount = service.price
  const endDateTime = addMinutes(data.startDateTime, service.durationMinutes)

  // Derive payment mode: new explicit mode takes precedence, fallback to legacy markDepositPaid
  const rawPaymentMode = data.paymentMode
  const markDepositPaid = data.markDepositPaid ?? false
  const paymentMode: 'none' | 'deposit_paid' | 'full_paid' =
    rawPaymentMode ?? (markDepositPaid ? 'deposit_paid' : 'none')

  const paymentMethod = data.paymentMethod ?? 'other'
  const displayMethod = PAYMENT_METHOD_MAP[paymentMethod] ?? paymentMethod

  // Validate paymentMethod when creating a payment
  if ((paymentMode === 'deposit_paid' || paymentMode === 'full_paid') && !data.paymentMethod) {
    throw new Error('Método de pago requerido')
  }

  // Reject deposit_paid when service has no required deposit
  if (paymentMode === 'deposit_paid' && depositRequired <= 0) {
    throw new Error('No se requiere abono para este servicio. Usa modo "Sin pago" o "Pago total".')
  }

  const noDepositNeeded = depositRequired <= 0
  const isFreeService = finalAmount <= 0

  // Payment mode determines if booking starts confirmed
  const shouldConfirm = paymentMode === 'full_paid' || paymentMode === 'deposit_paid' || noDepositNeeded

  const status = shouldConfirm ? BookingStatus.confirmed : BookingStatus.pending_payment

  const initialPaymentStatus = isFreeService
    ? BookingPaymentStatus.fully_paid
    : BookingPaymentStatus.unpaid

  const booking = await prisma.$transaction(async (tx) => {
    await assertSlotIsAvailable({
      tx,
      businessId,
      serviceId: data.serviceId,
      startDateTime: data.startDateTime,
      endDateTime,
      timezone: business.timezone || 'America/Santiago',
    })

    let customer: { id: string; name: string; phone: string; email: string | null }

    if (data.customerId) {
      const existing = await tx.customer.findFirst({
        where: { id: data.customerId, businessId },
      })
      if (!existing) {
        throw new Error('Cliente no encontrado')
      }
      customer = existing
    } else {
      const normalized = normalizePhone(data.customerPhone)

      const existingByPhone = await tx.customer.findFirst({
        where: { phone: normalized, businessId },
      })

      if (existingByPhone) {
        customer = existingByPhone
        if (data.customerEmail && !customer.email) {
          await tx.customer.update({
            where: { id: customer.id },
            data: { email: data.customerEmail },
          })
          customer.email = data.customerEmail
        }
      } else {
        customer = await tx.customer.create({
          data: {
            businessId,
            name: data.customerName,
            phone: normalized,
            email: data.customerEmail || null,
          },
        })
      }
    }

    const newBooking = await tx.booking.create({
      data: {
        businessId,
        serviceId: data.serviceId,
        customerId: customer.id,
        startDateTime: data.startDateTime,
        endDateTime,
        status,
        totalPrice,
        depositRequired,
        depositPaid: 0,
        remainingBalance: finalAmount,
        finalAmount,
        paymentStatus: initialPaymentStatus,
        internalNotes: data.internalNotes || null,
        holdExpiresAt: status === BookingStatus.pending_payment ? addMinutes(new Date(), 60) : null,
      },
      include: { service: true, customer: true },
    })

    if (paymentMode === 'deposit_paid' && depositRequired > 0) {
      const { applyApprovedPayment } = await import('@/server/services/finance')

      const payment = await tx.payment.create({
        data: {
          businessId,
          bookingId: newBooking.id,
          customerId: customer.id,
          paymentType: PaymentType.deposit,
          provider: 'manual',
          providerPaymentId: null,
          amount: depositRequired,
          currency: business.currency || 'CLP',
          status: 'pending',
          paymentMethod: displayMethod,
          paidAt: null,
        },
      })

      await applyApprovedPayment({
        tx,
        bookingId: newBooking.id,
        businessId,
        amount: depositRequired,
        currency: business.currency || 'CLP',
        provider: 'manual',
        providerPaymentId: null,
        paymentType: PaymentType.deposit,
        paymentMethod: displayMethod,
        paymentId: payment.id,
      })
    }

    if (paymentMode === 'full_paid' && finalAmount > 0) {
      const { applyApprovedPayment } = await import('@/server/services/finance')

      const payment = await tx.payment.create({
        data: {
          businessId,
          bookingId: newBooking.id,
          customerId: customer.id,
          paymentType: PaymentType.full_payment,
          provider: 'manual',
          providerPaymentId: null,
          amount: finalAmount,
          currency: business.currency || 'CLP',
          status: 'pending',
          paymentMethod: displayMethod,
          paidAt: null,
        },
      })

      await applyApprovedPayment({
        tx,
        bookingId: newBooking.id,
        businessId,
        amount: finalAmount,
        currency: business.currency || 'CLP',
        provider: 'manual',
        providerPaymentId: null,
        paymentType: PaymentType.full_payment,
        paymentMethod: displayMethod,
        paymentId: payment.id,
      })
    }

    return newBooking
  })

  revalidatePath('/dashboard/bookings')
  revalidatePath('/dashboard/calendar')
  revalidatePath('/dashboard')
  await revalidateBusinessPublicPaths(businessId)

  return booking
}

export async function cancelBooking(bookingId: string, reason?: string) {
  const { business, businessId } = await requireBusinessRole(['owner', 'admin'])

  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, businessId },
    include: { service: true, customer: true },
  })

  if (!booking) {
    throw new Error('Reserva no encontrada')
  }

  if (booking.status === 'completed') {
    throw new Error('No se puede cancelar una reserva ya completada')
  }

  if (booking.status === 'cancelled') {
    throw new Error('Esta reserva ya está cancelada')
  }

  await prisma.booking.update({
    where: { id: bookingId },
    data: {
      status: BookingStatus.cancelled,
      internalNotes: reason
        ? `${booking.internalNotes || ''}\n[CANCELADA: ${reason}]`.trim()
        : booking.internalNotes,
    },
  })

  if (booking.customer?.email) {
    await sendNotificationSafely('booking cancelled', () =>
      sendBookingCancelledNotification({
        businessName: business.name,
        customerName: booking.customer!.name,
        customerEmail: booking.customer!.email,
        serviceName: booking.service!.name,
        startDateTime: booking.startDateTime,
        businessTimezone: business.timezone || 'America/Santiago',
      }),
    )
  }

  revalidatePath('/dashboard/bookings')
  revalidatePath('/dashboard/calendar')
  await revalidateBusinessPublicPaths(businessId)

  return { cancelled: true }
}

export async function rescheduleBooking(bookingId: string, newStartDateTime: Date) {
  const { businessId, business } = await requireBusinessRole(['owner', 'admin'])

  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, businessId },
    include: { service: true },
  })

  if (!booking) {
    throw new Error('Reserva no encontrada')
  }

  if (['completed', 'cancelled', 'no_show', 'expired'].includes(booking.status)) {
    throw new Error('No se puede reprogramar una reserva en este estado')
  }

  const service = booking.service
  if (!service) {
    throw new Error('Servicio no encontrado')
  }

  const endDateTime = addMinutes(newStartDateTime, service.durationMinutes)
  const oldDate = booking.startDateTime.toLocaleString('es-CL')

  await prisma.$transaction(async (tx) => {
    await assertSlotIsAvailable({
      tx,
      businessId,
      serviceId: booking.serviceId,
      startDateTime: newStartDateTime,
      endDateTime,
      timezone: business.timezone || 'America/Santiago',
      excludeBookingId: bookingId,
    })

    const historyNote = `[REPROGRAMADA de ${oldDate}]`

    const updateResult = await tx.booking.updateMany({
      where: {
        id: bookingId,
        businessId,
        status: { notIn: [BookingStatus.completed, BookingStatus.cancelled, BookingStatus.no_show, BookingStatus.expired] },
      },
      data: {
        startDateTime: newStartDateTime,
        endDateTime,
        internalNotes: booking.internalNotes
          ? `${booking.internalNotes}\n${historyNote}`
          : historyNote,
      },
    })

    if (updateResult.count === 0) {
      throw new Error('No se puede reprogramar una reserva en este estado')
    }
  })

  revalidatePath('/dashboard/bookings')
  revalidatePath('/dashboard/calendar')
  await revalidateBusinessPublicPaths(businessId)

  return { rescheduled: true }
}
