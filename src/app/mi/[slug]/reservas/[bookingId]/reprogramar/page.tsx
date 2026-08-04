import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth/user'
import { canSelfManage, ownedManageableBookingWhere, selfServiceBlockedMessage } from '@/lib/bookings/self-service'
import { PageMessage } from '@/components/ui/page-message'
import { rescheduleBlockedReason } from '@/lib/bookings/hold'
import { ReprogramarForm } from './reprogramar-form'
import { formatInTimeZone } from 'date-fns-tz'

export default async function ReprogramarPage({
  params,
}: {
  params: Promise<{ slug: string; bookingId: string }>
}) {
  const { slug, bookingId } = await params
  const user = await getCurrentUser()
  if (!user) redirect('/ingresar?next=/mi')

  // Ownership EN el where (customer.userId === user.id): jamás confiar en ids del cliente.
  const booking = await prisma.booking.findFirst({
    where: { ...ownedManageableBookingWhere(bookingId, user.id), business: { slug } },
    select: {
      id: true,
      startDateTime: true,
      // Los tres del guard del plazo. Sin ellos esta página no podía ni
      // preguntarse si la reserva sigue viva.
      status: true,
      paymentStatus: true,
      holdExpiresAt: true,
      service: { select: { name: true } },
      business: { select: { slug: true, name: true, timezone: true, selfServiceCutoffHours: true } },
    },
  })
  if (!booking) notFound()

  const timezone = booking.business.timezone || 'America/Santiago'
  const cutoff = booking.business.selfServiceCutoffHours
  if (!canSelfManage(booking.startDateTime, cutoff)) {
    return (
      <PageMessage title="Ya no se puede reprogramar" message={selfServiceBlockedMessage(cutoff, 'reprogramar')} />
    )
  }

  // Después de la ventana, con el mismo orden que la lista de /mi: allá el
  // "faltan menos de N horas" también se lleva la fila entera. Acá se llega por
  // URL directa, por un marcador o con el botón Atrás; sin el corte la clienta
  // elegía un horario nuevo para que la action lo rechazara al final.
  const blockedRescheduleReason = rescheduleBlockedReason(booking, 'customer', new Date())
  if (blockedRescheduleReason) {
    return <PageMessage title="Ya no se puede reprogramar" message={blockedRescheduleReason} />
  }

  return (
    <main className="mx-auto max-w-md pb-10">
      <h1 className="pt-6 text-center text-xl font-semibold">Reprogramar reserva</h1>
      <ReprogramarForm
        bookingId={booking.id}
        slug={booking.business.slug}
        serviceName={booking.service.name}
        currentDate={formatInTimeZone(booking.startDateTime, timezone, 'yyyy-MM-dd')}
        currentTime={formatInTimeZone(booking.startDateTime, timezone, 'HH:mm')}
        timezone={timezone}
      />
    </main>
  )
}
