'use server'

// LANDMINE: módulo 'use server' — SOLO exports async. Nada de constantes/tipos exportados;
// cada export es un endpoint público invocable, así que cada uno hace su propio requireUser().
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/auth/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { canSelfManage, ownedManageableBookingWhere, selfServiceBlockedMessage } from '@/lib/bookings/self-service'
import { cancelBookingInTx, rescheduleBookingInTx } from '@/lib/bookings/mutate'
import { computeRescheduleSlots } from '@/lib/availability/reschedule-slots'
import {
  sendNotificationSafely,
  sendMultiNotificationSafely,
  sendBookingCancelledNotification,
  sendBookingRescheduledNotification,
  sendOwnerBookingChangedNotification,
  getBusinessReplyToEmail,
} from '@/lib/notifications'
import { revalidateBusinessPublicPaths } from '@/server/actions/revalidate-business'

export async function cancelMyBooking(bookingId: string) {
  const user = await requireUser()

  const limit = await checkRateLimit('self-service-booking', 10, 60_000, { userId: user.id })
  if (!limit.success) {
    throw new Error('Demasiados intentos. Espera un momento y vuelve a intentar.')
  }

  // Ownership EN el where (customer.userId === user.id): jamás confiar en ids del cliente.
  const booking = await prisma.booking.findFirst({
    where: ownedManageableBookingWhere(bookingId, user.id),
    include: {
      service: { select: { name: true } },
      customer: { select: { name: true, email: true } },
      business: {
        select: { id: true, name: true, slug: true, timezone: true, selfServiceCutoffHours: true },
      },
    },
  })
  if (!booking) {
    throw new Error('Reserva no encontrada')
  }

  const cutoff = booking.business.selfServiceCutoffHours
  if (!canSelfManage(booking.startDateTime, cutoff)) {
    throw new Error(selfServiceBlockedMessage(cutoff, 'cancelar'))
  }

  await prisma.$transaction(async (tx) => {
    await cancelBookingInTx(tx, booking, { reason: 'cancelada por la clienta desde /mi' })
  })

  await sendMultiNotificationSafely('self-service cancel (owner)', () =>
    sendOwnerBookingChangedNotification({
      businessId: booking.business.id,
      businessName: booking.business.name,
      businessTimezone: booking.business.timezone || 'America/Santiago',
      customerName: booking.customer.name,
      serviceName: booking.service.name,
      bookingNumber: booking.bookingNumber,
      change: { kind: 'cancelled' },
      startDateTime: booking.startDateTime,
    }),
  )

  if (booking.customer.email) {
    await sendNotificationSafely('self-service cancel (customer)', async () =>
      sendBookingCancelledNotification({
        businessName: booking.business.name,
        businessReplyToEmail: await getBusinessReplyToEmail(booking.business.id),
        customerName: booking.customer.name,
        customerEmail: booking.customer.email!,
        serviceName: booking.service.name,
        startDateTime: booking.startDateTime,
        businessTimezone: booking.business.timezone || 'America/Santiago',
      }),
    )
  }

  revalidatePath('/dashboard/bookings')
  revalidatePath('/dashboard/calendar')
  await revalidateBusinessPublicPaths(booking.business.id) // ALWAYS await — sin esto el proceso muere exit 128
  revalidatePath(`/mi/${booking.business.slug}`)

  return { cancelled: true }
}

export async function rescheduleMyBooking(bookingId: string, newStartDateTime: Date) {
  const user = await requireUser()

  const limit = await checkRateLimit('self-service-booking', 10, 60_000, { userId: user.id })
  if (!limit.success) {
    throw new Error('Demasiados intentos. Espera un momento y vuelve a intentar.')
  }

  // Ownership EN el where (customer.userId === user.id): jamás confiar en ids del cliente.
  const booking = await prisma.booking.findFirst({
    where: ownedManageableBookingWhere(bookingId, user.id),
    include: {
      service: { select: { name: true, durationMinutes: true } },
      customer: { select: { name: true, email: true, phone: true } },
      business: {
        select: {
          id: true,
          name: true,
          slug: true,
          timezone: true,
          isActive: true,
          selfServiceCutoffHours: true,
          whatsapp: true,
          addressText: true,
        },
      },
    },
  })
  if (!booking) {
    throw new Error('Reserva no encontrada')
  }

  // Guard de negocio suspendido: reprogramar crea un slot nuevo (spec §5).
  if (!booking.business.isActive) {
    throw new Error('El negocio no está aceptando reservas en este momento.')
  }

  const cutoff = booking.business.selfServiceCutoffHours
  if (!canSelfManage(booking.startDateTime, cutoff)) {
    throw new Error(selfServiceBlockedMessage(cutoff, 'reprogramar'))
  }

  // El slot NUEVO se rige por las reglas del funnel: lead time default (omitimos
  // leadTimeMinutes) y bookingWindowDays, ambos validados por assertSlotIsAvailable
  // dentro de rescheduleBookingInTx — misma mecánica que el path de la dueña.

  const previousStartDateTime = booking.startDateTime

  await prisma.$transaction(async (tx) => {
    await rescheduleBookingInTx(tx, {
      booking,
      newStartDateTime,
      durationMinutes: booking.service.durationMinutes,
      timezone: booking.business.timezone || 'America/Santiago',
      // sin leadTimeMinutes → default del funnel público
    })
  })

  await sendMultiNotificationSafely('self-service reschedule (owner)', () =>
    sendOwnerBookingChangedNotification({
      businessId: booking.business.id,
      businessName: booking.business.name,
      businessTimezone: booking.business.timezone || 'America/Santiago',
      customerName: booking.customer.name,
      serviceName: booking.service.name,
      bookingNumber: booking.bookingNumber,
      change: { kind: 'rescheduled', previousStartDateTime, newStartDateTime },
      startDateTime: previousStartDateTime,
    }),
  )

  if (booking.customer.email) {
    await sendNotificationSafely('self-service reschedule (customer)', async () =>
      sendBookingRescheduledNotification({
        businessName: booking.business.name,
        bookingNumber: booking.bookingNumber,
        businessReplyToEmail: await getBusinessReplyToEmail(booking.business.id),
        businessWhatsapp: booking.business.whatsapp,
        businessAddress: booking.business.addressText,
        businessTimezone: booking.business.timezone || 'America/Santiago',
        customerName: booking.customer.name,
        customerEmail: booking.customer.email!,
        customerPhone: booking.customer.phone,
        serviceName: booking.service.name,
        previousStartDateTime,
        newStartDateTime,
      }),
    )
  }

  revalidatePath('/dashboard/bookings')
  revalidatePath('/dashboard/calendar')
  await revalidateBusinessPublicPaths(booking.business.id) // ALWAYS await — sin esto el proceso muere exit 128
  revalidatePath(`/mi/${booking.business.slug}`)

  return { rescheduled: true }
}

export async function getMyRescheduleSlots(bookingId: string, date: Date) {
  const user = await requireUser()

  // Mismo config que la exploración de fechas en el funnel público: 60/min.
  const limit = await checkRateLimit('get-availability')
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  // Ownership EN el where (customer.userId === user.id): jamás confiar en ids del cliente.
  const booking = await prisma.booking.findFirst({
    where: ownedManageableBookingWhere(bookingId, user.id),
    include: {
      service: { select: { durationMinutes: true, isActive: true } },
      business: { select: { timezone: true, bookingWindowDays: true, slotStepMinutes: true } },
    },
  })
  if (!booking) {
    throw new Error('Reserva no encontrada')
  }
  if (!booking.service.isActive) {
    throw new Error('Servicio no disponible')
  }

  return computeRescheduleSlots(booking, date)
}
