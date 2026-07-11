'use server'

// LANDMINE: módulo 'use server' — SOLO exports async. Nada de constantes/tipos exportados;
// cada export es un endpoint público invocable, así que cada uno hace su propio requireUser().
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/auth/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { canSelfManage, SELF_MANAGEABLE_STATUSES } from '@/lib/bookings/self-service'
import { cancelBookingInTx } from '@/lib/bookings/mutate'
import {
  sendNotificationSafely,
  sendMultiNotificationSafely,
  sendBookingCancelledNotification,
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
    where: {
      id: bookingId,
      status: { in: [...SELF_MANAGEABLE_STATUSES] },
      customer: { userId: user.id },
    },
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
    throw new Error(
      cutoff === 0
        ? 'Esta reserva ya no se puede cancelar.'
        : `Las reservas se pueden cancelar hasta ${cutoff} horas antes. Contacta al negocio para cambios de último minuto.`,
    )
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
