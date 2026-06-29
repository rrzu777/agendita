import { Resend } from 'resend'
import { prisma } from '@/lib/db'
import { BookingStatus } from '@prisma/client'
import { logger } from '@/lib/logger'
import { ensureLoyaltyToken } from '@/lib/loyalty/token'
import type {
  EmailResult,
  BookingEmailData,
  CancellationEmailData,
  ReviewRequestEmailData,
  NewBookingBusinessEmailData,
  ReminderEmailData,
} from './types'
import {
  bookingConfirmationCustomerHtml,
  bookingConfirmationCustomerText,
  bookingReceivedCustomerHtml,
  bookingReceivedCustomerText,
  newBookingBusinessHtml,
  newBookingBusinessText,
  bookingCancelledCustomerHtml,
  bookingCancelledCustomerText,
  reviewRequestHtml,
  reviewRequestText,
  bookingReminderHtml,
  bookingReminderText,
  paymentReceivedHtml,
  paymentReceivedText,
  BOOKING_CONFIRMED_TEMPLATE,
  BOOKING_REMINDER_TEMPLATE,
  BOOKING_CANCELLED_TEMPLATE,
  PAYMENT_RECEIVED_TEMPLATE,
} from './templates'

function getResend(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return null
  return new Resend(apiKey)
}

function getFromEmail(): string | null {
  return process.env.FROM_EMAIL || null
}

function getAppDomain(): string {
  const raw = process.env.NEXT_PUBLIC_APP_DOMAIN || process.env.APP_DOMAIN || 'localhost:3000'
  return raw.replace(/^https?:\/\//, '').replace(/\/$/, '')
}

async function sendEmail(to: string, subject: string, html: string, text: string): Promise<EmailResult> {
  const resend = getResend()
  const from = getFromEmail()

  if (!resend) {
    return { success: false, skipped: 'RESEND_API_KEY no configurada' }
  }

  if (!from) {
    return { success: false, skipped: 'FROM_EMAIL no configurado' }
  }

  try {
    const { data, error } = await resend.emails.send({
      from,
      to: [to],
      subject,
      html,
      text,
    })

    if (error) {
      console.error('[notifications] Resend error:', error)
      return { success: false, error: error.message }
    }

    return { success: true, messageId: data?.id }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Error desconocido al enviar email'
    console.error('[notifications] Error al enviar email:', message)
    return { success: false, error: message }
  }
}

async function getBusinessOwnerEmails(businessId: string): Promise<{ email: string; name: string | null }[]> {
  const users = await prisma.businessUser.findMany({
    where: {
      businessId,
      role: { in: ['owner', 'admin'] },
    },
    include: {
      user: { select: { email: true, name: true } },
    },
  })

  return users
    .filter((bu) => bu.user.email)
    .map((bu) => ({ email: bu.user.email, name: bu.user.name }))
}

function buildDashboardLink(): string {
  const domain = getAppDomain()
  const protocol = domain.startsWith('localhost') || domain.endsWith('.localhost') || domain.startsWith('127.0.0.1')
    ? 'http'
    : 'https'

  return `${protocol}://${domain}/dashboard/bookings`
}

export async function sendBookingConfirmationToCustomer(data: BookingEmailData): Promise<EmailResult> {
  if (!data.customerEmail) {
    return { success: false, skipped: 'Cliente sin email' }
  }

  const html = bookingConfirmationCustomerHtml(data)
  const text = bookingConfirmationCustomerText(data)

  return sendEmail(
    data.customerEmail,
    `Reserva confirmada - ${data.businessName}`,
    html,
    text,
  )
}

export async function sendBookingReceivedToCustomer(data: BookingEmailData): Promise<EmailResult> {
  if (!data.customerEmail) {
    return { success: false, skipped: 'Cliente sin email' }
  }

  const html = bookingReceivedCustomerHtml(data)
  const text = bookingReceivedCustomerText(data)

  return sendEmail(
    data.customerEmail,
    `Reserva recibida - ${data.businessName}`,
    html,
    text,
  )
}

export async function sendNewBookingNotificationToBusiness(
  businessId: string,
  data: NewBookingBusinessEmailData,
): Promise<EmailResult[]> {
  const ownerEmails = await getBusinessOwnerEmails(businessId)

  if (ownerEmails.length === 0) {
    return [{ success: false, skipped: 'No hay owners/admins con email para el negocio' }]
  }

  const html = newBookingBusinessHtml(data)
  const text = newBookingBusinessText(data)

  const results = await Promise.all(
    ownerEmails.map((owner) =>
      sendEmail(owner.email, `Nueva reserva - ${data.customerName}`, html, text),
    ),
  )

  return results
}

export async function sendBookingConfirmedNotification(bookingId: string, businessId: string): Promise<EmailResult> {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, businessId, status: BookingStatus.confirmed },
    include: {
      service: { select: { name: true } },
      customer: { select: { id: true, name: true, phone: true, email: true, loyaltyToken: true } },
      business: {
        select: {
          name: true,
          timezone: true,
          whatsapp: true,
          addressText: true,
          currency: true,
          cancellationPolicy: true,
        },
      },
    },
  })

  if (!booking || !booking.customer.email) {
    return { success: false, skipped: 'Cliente sin email o booking no encontrado' }
  }

  const business = booking.business
  const tz = business.timezone || 'America/Santiago'
  const curr = business.currency || 'CLP'

  // Link "Mi tarjeta" solo si el programa de fidelización está activo.
  const loyaltyConfig = await prisma.loyaltyConfig.findUnique({ where: { businessId } })
  let loyaltyCardLink: string | undefined
  if (loyaltyConfig?.isActive) {
    const domain = getAppDomain()
    const protocol = domain.startsWith('localhost') || domain.endsWith('.localhost') || domain.startsWith('127.0.0.1')
      ? 'http'
      : 'https'
    const token = await ensureLoyaltyToken(prisma, {
      id: booking.customer.id,
      loyaltyToken: booking.customer.loyaltyToken ?? null,
    })
    loyaltyCardLink = `${protocol}://${domain}/tarjeta/${token}`
  }

  return sendBookingConfirmationToCustomer({
    businessName: business.name,
    businessWhatsapp: business.whatsapp,
    businessAddress: business.addressText,
    businessTimezone: tz,
    businessCurrency: curr,
    businessCancellationPolicy: business.cancellationPolicy,
    customerName: booking.customer.name,
    customerEmail: booking.customer.email,
    customerPhone: booking.customer.phone,
    serviceName: booking.service.name,
    startDateTime: booking.startDateTime,
    totalPrice: booking.totalPrice,
    depositRequired: booking.depositRequired,
    depositPaid: booking.depositPaid,
    remainingBalance: booking.remainingBalance,
    loyaltyCardLink,
  })
}

export async function sendBookingCancelledNotification(data: CancellationEmailData): Promise<EmailResult> {
  if (!data.customerEmail) {
    return { success: false, skipped: 'Cliente sin email' }
  }

  const html = bookingCancelledCustomerHtml(data)
  const text = bookingCancelledCustomerText(data)

  return sendEmail(
    data.customerEmail,
    `Reserva cancelada - ${data.businessName}`,
    html,
    text,
  )
}

export async function sendReviewRequestNotification(data: ReviewRequestEmailData): Promise<EmailResult> {
  if (!data.customerEmail) {
    return { success: false, skipped: 'Cliente sin email' }
  }

  const html = reviewRequestHtml(data)
  const text = reviewRequestText(data)

  return sendEmail(
    data.customerEmail,
    `¿Cómo te fue? - ${data.businessName}`,
    html,
    text,
  )
}

export { buildDashboardLink }

/**
 * Wraps an async notification (email) call so it never throws.
 * Returns the EmailResult and logs errors.
 * Use this instead of bare .catch().
 */
export async function sendNotificationSafely(
  label: string,
  fn: () => Promise<EmailResult>,
): Promise<EmailResult> {
  try {
    return await fn()
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Error desconocido'
    console.error(`[notifications] ${label} failed:`, message)
    return { success: false, error: message }
  }
}

/**
 * Wraps a multi-recipient notification so it never throws.
 * Returns array of EmailResults and logs errors.
 */
export async function sendMultiNotificationSafely(
  label: string,
  fn: () => Promise<EmailResult[]>,
): Promise<EmailResult[]> {
  try {
    return await fn()
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Error desconocido'
    console.error(`[notifications] ${label} failed:`, message)
    return [{ success: false, error: message }]
  }
}

/**
 * Sends a booking confirmed notification by booking ID.
 * Uses BOOKING_CONFIRMED_TEMPLATE for subject/body.
 */
export async function sendBookingReminderNotification(
  bookingId: string,
  businessId: string,
): Promise<EmailResult> {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, businessId },
    include: {
      service: { select: { name: true } },
      customer: { select: { name: true, phone: true, email: true } },
      business: {
        select: {
          name: true,
          timezone: true,
          whatsapp: true,
          addressText: true,
          currency: true,
        },
      },
    },
  })

  if (!booking || !booking.customer.email) {
    logger.warn('sendBookingReminderNotification', 'Booking not found or customer has no email', {
      bookingId,
      businessId,
    })
    return { success: false, skipped: 'Booking not found or customer has no email' }
  }

  const business = booking.business
  const tz = business.timezone || 'America/Santiago'
  const curr = business.currency || 'CLP'

  return sendReminderEmail({
    businessName: business.name,
    businessWhatsapp: business.whatsapp,
    businessAddress: business.addressText,
    businessTimezone: tz,
    businessCurrency: curr,
    customerName: booking.customer.name,
    customerEmail: booking.customer.email,
    serviceName: booking.service.name,
    startDateTime: booking.startDateTime,
    totalPrice: booking.totalPrice,
    remainingBalance: booking.remainingBalance,
    depositPaid: booking.depositPaid,
  })
}

/**
 * Sends a booking cancelled notification by booking ID.
 * Uses BOOKING_CANCELLED_TEMPLATE for subject/body.
 */
export async function sendBookingCancelledNotificationById(
  bookingId: string,
  businessId: string,
): Promise<EmailResult> {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, businessId },
    include: {
      service: { select: { name: true } },
      customer: { select: { name: true, email: true } },
      business: {
        select: {
          name: true,
          timezone: true,
        },
      },
    },
  })

  if (!booking || !booking.customer.email) {
    logger.warn('sendBookingCancelledNotificationById', 'Booking not found or customer has no email', {
      bookingId,
      businessId,
    })
    return { success: false, skipped: 'Booking not found or customer has no email' }
  }

  return sendBookingCancelledNotification({
    businessName: booking.business.name,
    customerName: booking.customer.name,
    customerEmail: booking.customer.email,
    serviceName: booking.service.name,
    startDateTime: booking.startDateTime,
    businessTimezone: booking.business.timezone || 'America/Santiago',
  })
}

/**
 * Sends a payment received notification by payment ID.
 * Uses PAYMENT_RECEIVED_TEMPLATE for subject/body.
 */
export async function sendPaymentReceivedNotification(
  paymentId: string,
  businessId: string,
): Promise<EmailResult> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId, businessId },
    include: {
      booking: {
        include: {
          service: { select: { name: true } },
          customer: { select: { name: true, email: true } },
          business: { select: { name: true, timezone: true, currency: true } },
        },
      },
    },
  })

  if (!payment) {
    logger.warn('sendPaymentReceivedNotification', 'Payment not found', { paymentId, businessId })
    return { success: false, skipped: 'Payment not found' }
  }

  if (!payment.booking?.customer?.email) {
    logger.warn('sendPaymentReceivedNotification', 'Customer has no email', { paymentId, businessId })
    return { success: false, skipped: 'Customer has no email' }
  }

  const html = paymentReceivedHtml({
    businessName: payment.booking.business.name,
    customerName: payment.booking.customer.name,
    customerEmail: payment.booking.customer.email,
    serviceName: payment.booking.service.name,
    startDateTime: payment.booking.startDateTime,
    businessTimezone: payment.booking.business.timezone || 'America/Santiago',
    amountPaid: payment.amount,
    businessCurrency: payment.booking.business.currency || 'CLP',
  })

  const text = paymentReceivedText({
    businessName: payment.booking.business.name,
    customerName: payment.booking.customer.name,
    serviceName: payment.booking.service.name,
    startDateTime: payment.booking.startDateTime,
    businessTimezone: payment.booking.business.timezone || 'America/Santiago',
    amountPaid: payment.amount,
    businessCurrency: payment.booking.business.currency || 'CLP',
  })

  const business = payment.booking.business
  const subject = `Abono recibido — ${business.name}`

  return sendEmail(payment.booking.customer.email, subject, html, text)
}

export async function sendReminderEmail(data: ReminderEmailData): Promise<EmailResult> {
  const html = bookingReminderHtml(data)
  const text = bookingReminderText(data)
  return sendEmail(data.customerEmail, 'Recordatorio de tu cita - Agendita', html, text)
}
