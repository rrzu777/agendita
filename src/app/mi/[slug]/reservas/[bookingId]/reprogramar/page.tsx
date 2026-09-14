import { bookingServiceName } from '@/lib/bookings/service-lines'
import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth/user'
import { canSelfManage, ownedManageableBookingWhere, selfServiceBlockedMessage } from '@/lib/bookings/self-service'
import { PageMessage } from '@/components/ui/page-message'
import { rescheduleBlockedReason } from '@/lib/bookings/hold'
import { ReprogramarForm } from './reprogramar-form'
import { formatInTimeZone } from 'date-fns-tz'
import { resolveCancellationPolicy } from '@/lib/bookings/cancellation-policy'
import { ClientBusinessShell } from '@/components/client/client-shell'
import { getBookingFunnelUrl } from '@/lib/business/urls'
import type { ReactNode } from 'react'

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
      approvalExpiresAt: true,
      cancellationCutoffHours: true,
      cancellationPolicySnapshot: true,
      service: { select: { name: true } }, serviceLines: { select: { position: true, name: true } },
      business: { select: { slug: true, name: true, subdomain: true, logoUrl: true, category: true, brandColor: true, visualStyle: true, timezone: true, selfServiceCutoffHours: true, cancellationPolicy: true } },
    },
  })
  if (!booking) notFound()

  const timezone = booking.business.timezone || 'America/Santiago'
  const shell = (content: ReactNode) => (
    <ClientBusinessShell
      business={booking.business}
      bookingHref={getBookingFunnelUrl({ slug: booking.business.slug, subdomain: booking.business.subdomain })}
      sectionBaseHref={`/mi/${booking.business.slug}`}
    >
      {content}
    </ClientBusinessShell>
  )
  const { cutoffHours: cutoff } = resolveCancellationPolicy(booking, booking.business)
  if (!canSelfManage(booking.startDateTime, cutoff)) {
    return shell(
      <PageMessage title="Ya no se puede reprogramar" message={selfServiceBlockedMessage(cutoff, 'reprogramar')} />
    )
  }

  // Después de la ventana, con el mismo orden que la lista de /mi: allá el
  // "faltan menos de N horas" también se lleva la fila entera. Acá se llega por
  // URL directa, por un marcador o con el botón Atrás; sin el corte la clienta
  // elegía un horario nuevo para que la action lo rechazara al final.
  const blockedRescheduleReason = rescheduleBlockedReason(booking, 'customer', new Date())
  if (blockedRescheduleReason) {
    return shell(<PageMessage title="Ya no se puede reprogramar" message={blockedRescheduleReason} />)
  }

  return shell(
    <main className="mx-auto max-w-xl">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Cambio de horario</p>
      <h1 className="mt-2 font-heading text-3xl font-semibold tracking-tight text-primary">Reprogramar reserva</h1>
      <p className="mt-2 mb-6 text-sm text-muted-foreground">Tu reserva actual se mantiene hasta que confirmes un nuevo horario.</p>
      <ReprogramarForm
        bookingId={booking.id}
        slug={booking.business.slug}
        serviceName={bookingServiceName(booking)}
        currentDate={formatInTimeZone(booking.startDateTime, timezone, 'yyyy-MM-dd')}
        currentTime={formatInTimeZone(booking.startDateTime, timezone, 'HH:mm')}
        timezone={timezone}
      />
    </main>
  )
}
