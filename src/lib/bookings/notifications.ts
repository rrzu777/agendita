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
import { MANUAL_COORDINATION_METHOD, promisableHoldDeadline } from '@/lib/bookings/hold'
import { fmtDate } from '@/lib/notifications/templates'
import { bookingInvite } from '@/lib/calendar/booking-invite'
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
    // Los tres son para el evento de calendario: cuándo termina la cita y qué
    // versión del evento es (ver `sequenceOf`). `endDateTime` además es el techo
    // de cualquier plazo que este mail prometa (ver `promisableHoldDeadline`).
    endDateTime: Date
    createdAt: Date
    updatedAt: Date
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
    // Quién atiende: va en los dos emails y en el evento de calendario.
    professional: { name: string } | null
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

  // Un solo plazo para los tres textos que lo mencionan (datos bancarios,
  // coordinación manual y el aviso a la dueña). Topado con la cita: prometer
  // "te guardamos el horario hasta mañana" sobre una cita de hoy es una frase
  // sin sentido, y este mail es la copia durable de esa promesa.
  const promisedDeadline = promisableHoldDeadline(booking)

  // Reserva con transferencia: el email de "reserva recibida" ES la fuente
  // durable de los datos bancarios (la pestaña del wizard es efímera).
  let bankTransfer: BookingEmailData['bankTransfer'] | undefined
  if (booking.paymentMethod === BANK_TRANSFER_METHOD && bankTransferAccount) {
    bankTransfer = {
      ...bankTransferAccount,
      deadline: promisedDeadline,
      confirmationUrl: getBookingConfirmationUrl({ slug: business.slug, subdomain: business.subdomain }, booking.id),
    }
  }

  // Coordinación manual: el mismo email es la fuente durable de la promesa
  // ("el negocio te contacta") y del plazo — sin esto le insinuaba a la
  // clienta que ELLA debía pagar algo que no tiene cómo pagar.
  const manualCoordination =
    booking.paymentMethod === MANUAL_COORDINATION_METHOD
      ? { deadline: promisedDeadline }
      : undefined

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
          confirmed: booking.status === BookingStatus.confirmed,
          // La reserva recién escrita ya está acá: el evento no cuesta una
          // query, y el gate de `bookingInvite` decide si corresponde.
          calendar: bookingInvite({ ...booking, service: { name: serviceName }, business }),
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
          professionalName: booking.professional?.name ?? null,
          startDateTime: booking.startDateTime,
          totalPrice: booking.totalPrice,
          discountAmount: booking.discountAmount,
          finalAmount: booking.finalAmount,
          depositRequired: booking.depositRequired,
          depositPaid: booking.depositPaid,
          remainingBalance: booking.remainingBalance,
          bankTransfer,
          manualCoordination,
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
        professionalName: booking.professional?.name ?? null,
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
        // La reserva manual necesita que la dueña ACTÚE dentro de la ventana:
        // sin esta línea el aviso era idéntico al de un checkout MP que se
        // expira solo, y nadie le pedía que confirmara nada.
        paymentNote: booking.paymentMethod === BANK_TRANSFER_METHOD
          ? `${vocabulary.TheClient} eligió pagar el abono por transferencia. Te va a llegar otro aviso cuando declare que transfirió.`
          : booking.paymentMethod === MANUAL_COORDINATION_METHOD
            ? `No tenés pago online configurado, así que el abono lo coordinás directamente con ${vocabulary.theClient}. Confirmá la reserva antes de que venza${promisedDeadline ? ` (el horario queda guardado hasta el ${fmtDate(promisedDeadline, businessTimezone)})` : ''}, o expira sola.`
            : undefined,
      }),
    ),
  )

  await Promise.allSettled(promises)
}
