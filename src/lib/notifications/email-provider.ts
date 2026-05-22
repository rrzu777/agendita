import { Resend } from 'resend'
import { prisma } from '@/lib/db'
import { BookingStatus } from '@prisma/client'
import type {
  EmailResult,
  BookingEmailData,
  CancellationEmailData,
  ReviewRequestEmailData,
  NewBookingBusinessEmailData,
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
    return { success: false, skipped: 'Clienta sin email' }
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
    return { success: false, skipped: 'Clienta sin email' }
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
      customer: { select: { name: true, phone: true, email: true } },
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
    return { success: false, skipped: 'Clienta sin email o booking no encontrado' }
  }

  const business = booking.business
  const tz = business.timezone || 'America/Santiago'
  const curr = business.currency || 'CLP'

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
  })
}

export async function sendBookingCancelledNotification(data: CancellationEmailData): Promise<EmailResult> {
  if (!data.customerEmail) {
    return { success: false, skipped: 'Clienta sin email' }
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
    return { success: false, skipped: 'Clienta sin email' }
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
