import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CheckCircle2, Clock, XCircle, Calendar, Check, AlertCircle, MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth/user'
import { getTenantFromRequest } from '@/lib/tenant/resolver'
import { deriveConfirmationState } from '@/lib/payments/confirmation-state'
import { deriveBalanceState } from '@/lib/payments/balance-confirmation-state'
import { formatBookingNumber } from '@/lib/bookings/number'
import { formatMoney } from '@/lib/money'
import { getBankTransferInfo } from '@/server/actions/bank-transfer-public'
import { BANK_TRANSFER_METHOD, BT_DECLARED_PREFIX } from '@/lib/bank-transfer/declared'
import { MANUAL_COORDINATION_METHOD } from '@/lib/bookings/hold'
import { getLocalDateStr } from '@/lib/availability/timezone'
import { TransferPanel } from './transfer-panel'
import { AccountCta } from '@/components/booking/account-cta'
import { AddToCalendar } from '@/components/booking/add-to-calendar'
import { deservesCalendarEvent } from '@/lib/calendar/booking-event'
import { formatConfirmationDateTime } from './format-datetime'
import { whereRows } from '@/lib/services/modality'
import { buildBookingHelpWhatsappUrl } from '@/lib/notifications/whatsapp'
import { WhatsappHelpLine, WhereRowValue } from '@/components/booking/where-row-value'

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
          timezone: true,
          currency: true,
          addressText: true,
          whatsapp: true,
        },
      },
      service: true,
      customer: { select: { email: true } },
      payments: {
        where: { provider: { in: ['mercado_pago', 'manual'] } },
        select: { status: true, provider: true, providerPaymentId: true, amount: true, proofKey: true },
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

  // Un solo `now` para el estado y el deadline: dos relojes distintos podrían
  // afirmar "expiró" y a la vez formatear una hora límite todavía viva.
  const now = new Date()
  const state = deriveConfirmationState(booking, now)

  // Hasta qué hora le guardamos el horario, para decírselo en vez de que lo
  // descubra cuando expire. Sólo con el hold vivo: vencido, `state` ya salió
  // 'expired' de deriveConfirmationState y el aviso no se muestra. Con la
  // ventana larga de coordinación manual el límite puede caer otro día:
  // "hasta las 14:30" a secas mentiría el día, así que lleva la fecha.
  const holdDeadline = (() => {
    if (!booking.holdExpiresAt || booking.holdExpiresAt <= now) return null
    const tz = booking.business.timezone
    const { date, time } = formatConfirmationDateTime(booking.holdExpiresAt, tz)
    const esHoy = getLocalDateStr(booking.holdExpiresAt, tz) === getLocalDateStr(now, tz)
    return esHoy ? `las ${time}` : `el ${date} a las ${time}`
  })()

  // Superficie activa: la clienta que eligió transferencia y cerró la pestaña
  // del wizard puede ver los datos y declarar desde acá (mientras el hold viva).
  const canDeclare =
    booking.paymentMethod === BANK_TRANSFER_METHOD && state === 'pending' && holdDeadline !== null
  const balance = deriveBalanceState(booking)
  // La clienta ya adjuntó el comprobante del ABONO (proofKey en R2): cerramos el
  // loop en la pantalla de verificación para que no vuelva a subirlo ni dude.
  const depositProofAttached = booking.payments.some(
    (p) => p.providerPaymentId?.startsWith(BT_DECLARED_PREFIX) && p.status === 'pending' && p.proofKey != null,
  )
  const [bankInfo, sessionUser] = await Promise.all([
    canDeclare || balance.canDeclare ? getBankTransferInfo(booking.businessId) : null,
    getCurrentUser(),
  ])
  const customerEmail = booking.customer?.email ?? null

  // Formatear en la TZ del negocio (no la del server UTC en Vercel): sin esto,
  // las reservas ≥20:00 hora local mostraban el día/hora equivocados.
  const { date: formattedDate, time: formattedTime } = formatConfirmationDateTime(
    new Date(booking.startDateTime),
    booking.business.timezone,
  )
  const remainingBalance = booking.finalAmount - booking.depositPaid
  const currency = booking.business.currency || 'CLP'

  // Las mismas filas que manda el mail de la reserva: es el momento en que la
  // clienta cierra la pestaña y necesita saber a dónde va.
  const donde = whereRows({
    modality: booking.modality,
    businessAddress: booking.business.addressText,
    serviceAddress: booking.serviceAddress,
    // El link de la reserva, no el del negocio: `resolveBookingDraft` lo copia al
    // crearla justamente para que cambiar de sala no reescriba las citas ya avisadas.
    // El mail manda éste; la pantalla tiene que decir lo mismo.
    meetingUrl: booking.meetingUrl,
  })
  const whatsappHref = booking.business.whatsapp
    ? buildBookingHelpWhatsappUrl(booking.business.whatsapp, {
        bookingRef: formatBookingNumber(booking.bookingNumber, booking.id),
        businessName: booking.business.name,
      })
    : null

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
      message: booking.paymentMethod === BANK_TRANSFER_METHOD
        ? 'Transferí el abono y avisanos con el botón de abajo para confirmar tu reserva.'
        // Coordinación manual: no hay checkout que "completar" — pedírselo la
        // mandaría a buscar un botón de pago que no existe.
        : booking.paymentMethod === MANUAL_COORDINATION_METHOD
          ? `${booking.business.name} coordina el abono directamente contigo y va a confirmar tu reserva.`
          : 'Completa el pago del abono para confirmar tu reserva.',
    },
    // La plata entró pero la reserva no quedó en pie (ver `paid_unconfirmed`): esta
    // pantalla es la URL de retorno de Mercado Pago, así que es lo primero que ve la
    // clienta. Antes decía "Reserva confirmada, te esperamos el {día} a las {hora}" y
    // la mandaba a un horario que ya era de otra persona.
    paid_unconfirmed: {
      icon: AlertCircle,
      iconColor: 'text-amber-600',
      iconBg: 'bg-amber-50',
      title: 'Recibimos tu pago, pero la reserva no quedó confirmada',
      message: `${booking.business.name} ya está al tanto y te va a contactar para reubicarte o devolverte ${formatMoney(booking.depositPaid, currency)}. Suele pasar cuando alguien toma el horario justo antes de que entre el pago.`,
    },
    verifying_transfer: {
      icon: Clock,
      iconColor: 'text-amber-500',
      iconBg: 'bg-amber-50',
      title: 'Verificando tu transferencia',
      message: `${booking.business.name} va a confirmar tu reserva cuando verifique el pago.`,
    },
    expired: {
      icon: XCircle,
      iconColor: 'text-muted-foreground',
      iconBg: 'bg-muted',
      title: 'Tu reserva expiró',
      // Manual: acá nadie podía "completar" un pago — el negocio no confirmó
      // el abono dentro de la ventana. Mismo motivo que el email del cron.
      message: booking.paymentMethod === MANUAL_COORDINATION_METHOD
        ? 'No se llegó a coordinar el abono a tiempo y el horario se liberó. Podés reservar de nuevo.'
        : 'No se completó el pago a tiempo y el horario se liberó. Podés reservar de nuevo.',
    },
    cancelled: {
      icon: XCircle,
      iconColor: 'text-muted-foreground',
      iconBg: 'bg-muted',
      title: 'Reserva cancelada',
      message: 'Esta reserva fue cancelada. Si transferiste y no fue reconocido, contactá al negocio.',
    },
  }

  // Reserva completed (spec §6): copy propio, no depende de deriveConfirmationState
  // (que ya la trata como 'confirmed' para el icono/estilo).
  const config = booking.status === 'completed'
    ? {
        ...stateConfig.confirmed,
        title: 'Gracias por tu visita',
        message: booking.remainingBalance > 0
          ? `Quedó un saldo pendiente de ${formatMoney(booking.remainingBalance, currency)}. Podés pagarlo por transferencia acá abajo.`
          : '¡Te esperamos la próxima!',
      }
    : stateConfig[state]
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
          {/* Los dos estados que piden plata dicen hasta cuándo hay tiempo. La
              transferencia no: su deadline lo muestra el TransferPanel con fecha
              completa, y dos relojes en la misma pantalla confunden. */}
          {holdDeadline && (state === 'rejected' || (state === 'pending' && booking.paymentMethod !== BANK_TRANSFER_METHOD)) && (
            <p className="mt-3 text-sm font-medium text-muted-foreground">
              Tu horario queda guardado hasta {holdDeadline}; después se libera.
            </p>
          )}
          {state === 'verifying_transfer' && depositProofAttached && (
            <p className="mt-3 text-sm font-medium text-green-700">Comprobante adjuntado ✓</p>
          )}
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

              {donde.map((row) => (
                <div key={row.label} className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3 text-muted-foreground">
                    <div className="flex size-10 items-center justify-center rounded-lg bg-secondary">
                      <MapPin className="size-5" />
                    </div>
                    <span className="text-sm font-medium">{row.label}</span>
                  </div>
                  <WhereRowValue row={row} />
                </div>
              ))}
            </div>

            <div className="mt-6 border-t border-border/50 pt-5">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Precio total</span>
                <span className="font-semibold text-primary">{formatMoney(booking.finalAmount, currency)}</span>
              </div>
              {booking.depositPaid > 0 && (
                <div className="mt-2 flex justify-between text-sm">
                  <span className="text-muted-foreground">Abono pagado</span>
                  <span className="font-semibold text-green-700">{formatMoney(booking.depositPaid, currency)}</span>
                </div>
              )}
              {remainingBalance > 0 && (
                <div className="mt-2 flex justify-between text-sm">
                  <span className="text-muted-foreground">Saldo pendiente</span>
                  <span className="font-semibold text-primary">{formatMoney(remainingBalance, currency)}</span>
                </div>
              )}
            </div>

            <div className="mt-5 rounded-lg bg-muted/50 px-4 py-3 text-center">
              <p className="text-sm text-muted-foreground">
                Tu código de reserva: <span className="font-mono font-semibold text-primary">{formatBookingNumber(booking.bookingNumber, booking.id)}</span>
              </p>
              {whatsappHref && <WhatsappHelpLine href={whatsappHref} businessName={booking.business.name} className="mt-2" />}
            </div>
          </div>
        </div>

        {/* El status de la reserva y no `state`: `deriveConfirmationState` trata
            a una reserva ya cumplida como confirmada, y el mismo predicado que
            usa el servidor deja afuera ese caso. Si acá y allá no dijeran lo
            mismo, la clienta vería el botón y el endpoint le contestaría 404. */}
        {deservesCalendarEvent(booking.status) && <AddToCalendar bookingId={booking.id} className="mb-8" />}

        {canDeclare && bankInfo && (
          <TransferPanel
            bank={bankInfo}
            amount={Math.min(booking.depositRequired, booking.remainingBalance)}
            currency={currency}
            deadline={booking.holdExpiresAt}
            timezone={booking.business.timezone}
            bookingId={booking.id}
          />
        )}

        {balance.rejected && balance.canDeclare && (
          <p className="mb-4 text-center text-sm text-muted-foreground">
            Tu último aviso no pudo verificarse. Podés volver a avisar cuando quieras.
          </p>
        )}

        {balance.canDeclare && bankInfo && (
          <TransferPanel
            bank={bankInfo}
            amount={booking.remainingBalance}
            currency={currency}
            deadline={null}
            timezone={booking.business.timezone}
            bookingId={booking.id}
            kind="balance"
          />
        )}

        {balance.verifying && balance.payment && (
          <div className="studio-card mb-8 p-5 text-center">
            <p className="text-sm font-medium text-primary">Saldo en verificación</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Avisaste una transferencia de {formatMoney(balance.payment.amount, currency)}. El negocio la va a revisar; si pasan varios días, escribile.
            </p>
            {balance.payment.hasProof && (
              <p className="mt-2 text-sm font-medium text-green-700">Comprobante adjuntado ✓</p>
            )}
          </div>
        )}

        {balance.partial && (
          <p className="mb-8 text-center text-sm text-muted-foreground">
            Tu transferencia fue registrada parcialmente. Escribile al negocio para coordinar el resto.
          </p>
        )}

        {(state === 'rejected' || state === 'expired') && (
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild variant="outline" className="h-12 flex-1 font-semibold">
              <Link href={profileHref}>Volver al perfil</Link>
            </Button>
            <Button asChild className="h-12 flex-1 font-semibold">
              <Link href={bookHref}>{state === 'expired' ? 'Reservar de nuevo' : 'Intentar de nuevo'}</Link>
            </Button>
          </div>
        )}

        {state !== 'rejected' && state !== 'expired' && (
          <div className="space-y-3">
            <Button asChild className="h-12 w-full text-base font-semibold">
              <Link href={profileHref}>Volver al perfil</Link>
            </Button>
            {booking.depositPaid === 0 && state === 'pending' && (
              <p className="text-center text-sm text-muted-foreground">
                {booking.paymentMethod === MANUAL_COORDINATION_METHOD
                  ? 'Cuando el negocio confirme el abono, te llega la confirmación.'
                  : 'Al completar el pago, recibirás una confirmación por WhatsApp.'}
              </p>
            )}
          </div>
        )}

        {/* El CTA de cuenta nunca compite con la acción de declarar transferencia. */}
        {!canDeclare && (
          <AccountCta sessionActive={sessionUser !== null} customerEmail={customerEmail} className="mt-4" />
        )}
      </section>
    </main>
  )
}
