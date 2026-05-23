import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CheckCircle2, Clock, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { prisma } from '@/lib/db'
import { getTenantFromRequest } from '@/lib/tenant/resolver'
import { deriveConfirmationState } from '@/lib/payments/confirmation-state'

interface BookingConfirmationPageProps {
  searchParams: Promise<{ bookingId?: string }>
}

export default async function BookingConfirmationPage({ searchParams }: BookingConfirmationPageProps) {
  const { bookingId } = await searchParams

  if (!bookingId) {
    notFound()
  }

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      business: {
        select: {
          name: true,
          slug: true,
          subdomain: true,
        },
      },
      service: true,
      payments: {
        where: { provider: 'mercado_pago' },
        select: { status: true, provider: true },
      },
    },
  })

  if (!booking) {
    notFound()
  }

  const tenant = await getTenantFromRequest()

  if (tenant && tenant.businessId !== booking.businessId) {
    notFound()
  }

  const profileHref = tenant ? '/' : `/b/${booking.business.slug}`
  const bookHref = tenant ? '/book' : `/book/${booking.business.slug}`

  const state = deriveConfirmationState(booking)

  return (
    <main className="studio-shell min-h-screen px-4 py-12">
      <section className="studio-card mx-auto max-w-lg p-6 text-center">
        {state === 'confirmed' && (
          <>
            <CheckCircle2 className="mx-auto mb-4 size-12 text-primary" />
            <h1 className="mb-2 text-3xl font-semibold tracking-normal text-primary">Reserva confirmada</h1>
            <p className="mb-6 text-muted-foreground">{booking.business.name} recibió tu reserva.</p>
          </>
        )}

        {state === 'verifying' && (
          <>
            <Clock className="mx-auto mb-4 size-12 text-amber-500" />
            <h1 className="mb-2 text-3xl font-semibold tracking-normal text-primary">Estamos verificando tu pago</h1>
            <p className="mb-6 text-muted-foreground">
              Mercado Pago está procesando tu pago. Te confirmaremos cuando se apruebe.
            </p>
          </>
        )}

        {state === 'rejected' && (
          <>
            <XCircle className="mx-auto mb-4 size-12 text-destructive" />
            <h1 className="mb-2 text-3xl font-semibold tracking-normal text-primary">Pago no aprobado</h1>
            <p className="mb-6 text-muted-foreground">
              El pago no pudo ser procesado. Tu reserva está pendiente de pago.
            </p>
            <div className="mb-6 flex gap-3 justify-center">
              <Button asChild variant="outline">
                <Link href={profileHref}>Volver al perfil</Link>
              </Button>
              <Button asChild>
                <Link href={bookHref}>Intentar de nuevo</Link>
              </Button>
            </div>
          </>
        )}

        {state === 'pending' && (
          <>
            <Clock className="mx-auto mb-4 size-12 text-muted-foreground" />
            <h1 className="mb-2 text-3xl font-semibold tracking-normal text-primary">Reserva pendiente</h1>
            <p className="mb-6 text-muted-foreground">
              Tu reserva está pendiente de pago. Completa el pago para confirmarla.
            </p>
          </>
        )}

        <div className="mb-6 space-y-3 rounded-xl bg-muted/55 p-5 text-left">
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Servicio</span>
            <span className="font-semibold text-primary">{booking.service.name}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Fecha y hora</span>
            <span className="font-semibold text-primary">
              {booking.startDateTime.toLocaleDateString('es-CL')}{' '}
              {booking.startDateTime.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Estado</span>
            <span className="font-semibold text-primary">
              {state === 'confirmed'
                ? 'Confirmada'
                : state === 'verifying'
                  ? 'Pendiente de pago'
                  : state === 'rejected'
                    ? 'Pago rechazado'
                    : 'Pendiente'}
            </span>
          </div>
          <div className="flex justify-between gap-4 border-t border-border/60 pt-3">
            <span className="text-muted-foreground">Total</span>
            <span className="font-semibold text-primary">${booking.finalAmount.toLocaleString('es-CL')}</span>
          </div>
        </div>

        <p className="mb-6 text-sm text-muted-foreground">Número de reserva: {booking.id}</p>

        {state !== 'rejected' && (
          <Button asChild className="h-12 px-6 text-base font-semibold">
            <Link href={profileHref}>Volver al perfil</Link>
          </Button>
        )}
      </section>
    </main>
  )
}
