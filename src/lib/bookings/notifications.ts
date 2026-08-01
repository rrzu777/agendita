/**
 * Los dos avisos que salen cuando entra una reserva nueva: el "reserva recibida"
 * a la clienta y el "tenés una reserva" al negocio.
 *
 * Vive acá y no en `server/actions/bookings.ts` porque no es una action ni
 * necesita serlo: no pide sesión, no valida nada y no escribe en la DB — arma
 * dos emails con datos que el caller ya leyó y los dispara best-effort. Sacarla
 * de ese archivo también se llevó siete imports de notificaciones que sólo ella
 * usaba.
 *
 * Sin `'use server'` a propósito: es una función server-side común, no un
 * endpoint. El único caller es `createBooking`.
 */
import type { BusinessCategory, ServiceModality } from '@prisma/client'
import { BookingStatus } from '@prisma/client'
import { getVocabulary } from '@/lib/vocabulary'
import { getBookingConfirmationUrl } from '@/lib/business/urls'
import { BANK_TRANSFER_METHOD } from '@/lib/bank-transfer/declared'
import { type BankTransferPublicInfo } from '@/lib/bank-transfer/public-info'
import type { BookingEmailData } from '@/lib/notifications/types'
import {
  sendBookingReceivedToCustomer,
  sendNewBookingNotificationToBusiness,
  sendNotificationSafely,
  sendMultiNotificationSafely,
  getBusinessReplyToEmail,
} from '@/lib/notifications'

export async function fireBookingNotifications(
  business: {
    name: string
    timezone: string
    whatsapp: string | null
    addressText: string | null
    currency: string
    cancellationPolicy: string | null
    slug: string
    subdomain: string | null
    // El rubro decide el vocabulario del aviso al negocio.
    category: BusinessCategory
  },
  booking: {
    customer: { name: string; phone: string; email: string | null }
    totalPrice: number
    discountAmount: number
    finalAmount: number
    depositRequired: number
    depositPaid: number
    remainingBalance: number
    startDateTime: Date
    paymentMethod: string | null
    holdExpiresAt: Date | null
    status: BookingStatus
    modality: ServiceModality
    serviceAddress: string | null
    meetingUrl: string | null
  } & { id: string; businessId: string; bookingNumber: number | null },
  serviceName: string,
  // La cuenta ya la leyó createBooking antes de la tx; se pasa para no
  // re-consultar la misma fila (solo presente en reservas-transferencia).
  bankTransferAccount: BankTransferPublicInfo | null,
) {
  const customerEmail = booking.customer.email
  const businessTimezone = business.timezone || 'America/Santiago'
  const businessCurrency = business.currency || 'CLP'
  const vocabulary = getVocabulary(business.category)
  // Se deriva del status ya persistido, no del flag del negocio: si un descuento
  // movió la reserva a otro estado, el email tiene que contar lo que pasó de
  // verdad, no lo que la config decía al empezar.
  const awaitingApproval = booking.status === BookingStatus.pending_confirmation

  // Reserva con transferencia: el email de "reserva recibida" ES la fuente
  // durable de los datos bancarios (la pestaña del wizard es efímera).
  let bankTransfer: BookingEmailData['bankTransfer'] | undefined
  if (booking.paymentMethod === BANK_TRANSFER_METHOD && bankTransferAccount) {
    bankTransfer = {
      ...bankTransferAccount,
      deadline: booking.holdExpiresAt,
      confirmationUrl: getBookingConfirmationUrl({ slug: business.slug, subdomain: business.subdomain }, booking.id),
    }
  }

  const domain = process.env.NEXT_PUBLIC_APP_DOMAIN || process.env.APP_DOMAIN || 'localhost:3000'
  const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '')
  const protocol = cleanDomain.startsWith('localhost') || cleanDomain.endsWith('.localhost') || cleanDomain.startsWith('127.0.0.1') ? 'http' : 'https'
  const dashboardLink = `${protocol}://${cleanDomain}/dashboard/bookings`
  const businessReplyToEmail = await getBusinessReplyToEmail(booking.businessId)

  const promises: Promise<unknown>[] = []

  if (customerEmail) {
    promises.push(
      sendNotificationSafely('customer received', () =>
        sendBookingReceivedToCustomer({
          businessName: business.name,
          bookingId: booking.id,
          bookingNumber: booking.bookingNumber,
          businessReplyToEmail,
          businessWhatsapp: business.whatsapp,
          businessAddress: business.addressText,
          modality: booking.modality,
          serviceAddress: booking.serviceAddress,
          meetingUrl: booking.meetingUrl,
          businessTimezone,
          businessCurrency,
          businessCancellationPolicy: business.cancellationPolicy,
          customerName: booking.customer.name,
          customerEmail,
          customerPhone: booking.customer.phone,
          serviceName,
          startDateTime: booking.startDateTime,
          totalPrice: booking.totalPrice,
          discountAmount: booking.discountAmount,
          finalAmount: booking.finalAmount,
          depositRequired: booking.depositRequired,
          depositPaid: booking.depositPaid,
          remainingBalance: booking.remainingBalance,
          bankTransfer,
          awaitingApproval,
        }),
      ),
    )
  }

  promises.push(
    sendMultiNotificationSafely('business notification', () =>
      sendNewBookingNotificationToBusiness(booking.businessId, {
        businessName: business.name,
        businessCategory: business.category,
        bookingNumber: booking.bookingNumber,
        customerName: booking.customer.name,
        customerPhone: booking.customer.phone,
        customerEmail: customerEmail || null,
        serviceName,
        startDateTime: booking.startDateTime,
        businessTimezone,
        businessCurrency,
        // A domicilio la dueña necesita la dirección en el aviso: es a dónde
        // tiene que ir. Online, el link con el que se va a conectar.
        modality: booking.modality,
        serviceAddress: booking.serviceAddress,
        meetingUrl: booking.meetingUrl,
        depositRequired: booking.depositRequired,
        remainingBalance: booking.remainingBalance,
        dashboardLink,
        awaitingApproval,
        paymentNote: booking.paymentMethod === BANK_TRANSFER_METHOD
          ? `${vocabulary.TheClient} eligió pagar el abono por transferencia. Te va a llegar otro aviso cuando declare que transfirió.`
          : undefined,
      }),
    ),
  )

  await Promise.allSettled(promises)
}
