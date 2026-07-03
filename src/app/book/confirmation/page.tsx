import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CheckCircle2, Clock, XCircle, Calendar, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { prisma } from '@/lib/db'
import { getTenantFromRequest } from '@/lib/tenant/resolver'
import { deriveConfirmationState } from '@/lib/payments/confirmation-state'
import { formatBookingNumber } from '@/lib/bookings/number'

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
  const startDate = new Date(booking.startDateTime)
  const formattedDate = startDate.toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })
  const formattedTime = startDate.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
  const remainingBalance = booking.finalAmount - booking.depositPaid

  const stateConfig = {
    confirmed: {
      icon: CheckCircle2,
      iconColor: 'text-primary',
      iconBg: 'bg-primary/10',
      title: 'Reserva confirmada',
      message: `${booking.business.name} recibió tu reserva. Te esperamos el ${formattedDate} a las ${formattedTime}.`,
    },
    verifying: {
      icon: Clock,
      iconColor: 'text-amber-500',
      iconBg: 'bg-amber-50',
      title: 'Verificando tu pago',
      message: 'Mercado Pago está procesando el pago. Te confirmaremos por WhatsApp cuando se apruebe.',
    },
    rejected: {
      icon: XCircle,
      iconColor: 'text-destructive',
      iconBg: 'bg-destructive/10',
      title: 'Pago no aprobado',
      message: 'El pago no pudo ser procesado. Tu reserva quedó pendiente.',
    },
    pending: {
      icon: Clock,
      iconColor: 'text-muted-foreground',
      iconBg: 'bg-muted',
      title: 'Reserva pendiente de pago',
      message: 'Completa el pago del abono para confirmar tu reserva.',
    },
  }

  const config = stateConfig[state]
  const Icon = config.icon

  return (
    <main className="studio-shell min-h-screen px-4 py-8 md:py-12">
      <section className="mx-auto max-w-lg">
        <div className="mb-8 text-center">
          <div className={`mx-auto mb-6 flex size-16 items-center justify-center rounded-full ${config.iconBg}`}>
            <Icon className={`size-8 ${config.iconColor}`} />
          </div>
          <h1 className="mb-3 text-3xl font-semibold tracking-normal text-primary">{config.title}</h1>
          <p className="text-base leading-relaxed text-muted-foreground">{config.message}</p>
        </div>

        <div className="studio-card mb-8 overflow-hidden">
          <div className="border-b border-border/50 bg-muted/30 px-5 py-4">
            <h2 className="text-lg font-semibold text-primary">Resumen de la reserva</h2>
          </div>
          <div className="p-5">
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3 text-muted-foreground">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-secondary">
                    <Check className="size-5" />
                  </div>
                  <span className="text-sm font-medium">Servicio</span>
                </div>
                <span className="text-right font-semibold text-primary">{booking.service.name}</span>
              </div>

              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3 text-muted-foreground">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-secondary">
                    <Calendar className="size-5" />
                  </div>
                  <span className="text-sm font-medium">Fecha</span>
                </div>
                <span className="text-right font-semibold capitalize text-primary">{formattedDate}</span>
              </div>

              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3 text-muted-foreground">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-secondary">
                    <Clock className="size-5" />
                  </div>
                  <span className="text-sm font-medium">Hora</span>
                </div>
                <span className="text-right font-semibold text-primary">{formattedTime}</span>
              </div>
            </div>

            <div className="mt-6 border-t border-border/50 pt-5">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Precio total</span>
                <span className="font-semibold text-primary">${booking.finalAmount.toLocaleString('es-CL')}</span>
              </div>
              {booking.depositPaid > 0 && (
                <div className="mt-2 flex justify-between text-sm">
                  <span className="text-muted-foreground">Abono pagado</span>
                  <span className="font-semibold text-green-700">${booking.depositPaid.toLocaleString('es-CL')}</span>
                </div>
              )}
              {remainingBalance > 0 && (
                <div className="mt-2 flex justify-between text-sm">
                  <span className="text-muted-foreground">Saldo pendiente</span>
                  <span className="font-semibold text-primary">${remainingBalance.toLocaleString('es-CL')}</span>
                </div>
              )}
            </div>

            <div className="mt-5 rounded-lg bg-muted/50 px-4 py-3 text-center">
              <p className="text-sm text-muted-foreground">
                Tu código de reserva: <span className="font-mono font-semibold text-primary">{formatBookingNumber(booking.bookingNumber, booking.id)}</span>
              </p>
            </div>
          </div>
        </div>

        {state === 'rejected' && (
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild variant="outline" className="h-12 flex-1 font-semibold">
              <Link href={profileHref}>Volver al perfil</Link>
            </Button>
            <Button asChild className="h-12 flex-1 font-semibold">
              <Link href={bookHref}>Intentar de nuevo</Link>
            </Button>
          </div>
        )}

        {state !== 'rejected' && (
          <div className="space-y-3">
            <Button asChild className="h-12 w-full text-base font-semibold">
              <Link href={profileHref}>Volver al perfil</Link>
            </Button>
            {booking.depositPaid === 0 && state === 'pending' && (
              <p className="text-center text-sm text-muted-foreground">
                Al completar el pago, recibirás una confirmación por WhatsApp.
              </p>
            )}
          </div>
        )}
      </section>
    </main>
  )
}
