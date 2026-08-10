'use client'

import { Button } from '@/components/ui/button'
import { BookingData } from './wizard'
import Link from 'next/link'
import { CheckCircle2, Clock } from 'lucide-react'
import { formatMoney } from '@/lib/money'
import { formatBookingNumber } from '@/lib/bookings/number'
import { formatBookingDateTime } from '@/lib/bookings/format-booking-datetime'
import { whereRows, type WhereFields } from '@/lib/services/modality'
import { buildBookingHelpWhatsappUrl } from '@/lib/notifications/whatsapp'
import { AccountCta } from './account-cta'
import { AddToCalendar } from './add-to-calendar'
import { WhatsappHelpLine, WhereRowValue } from './where-row-value'
import { cancellationWarningText } from '@/lib/bookings/cancellation-policy'

/** El negocio, en lo que la reserva no trae. La modalidad, la dirección de la
 *  clienta y el link de la videollamada NO van acá: los resuelve el servidor al
 *  crear la reserva y llegan con ella. */
export interface ConfirmationBusiness {
  name: string
  addressText: string | null
  whatsapp: string | null
}

export function StepConfirmation({ data, timezone, currency, bookingId, bookingNumber, mode, promo, sessionEmail, business, where, confirmed, professionalName, cancellationCutoffHours = 0, depositRequired, depositPaid = 0 }: { data: BookingData; timezone: string; currency: string; bookingId: string | null; bookingNumber: number | null; mode: 'paid' | 'pending'; promo?: { discountAmount: number; finalAmount: number } | null; sessionEmail: string | null; business: ConfirmationBusiness; where: WhereFields; confirmed: boolean; professionalName: string; cancellationCutoffHours?: number; depositRequired?: number; depositPaid?: number }) {
  const isPending = mode === 'pending'
  const isFree = data.servicePrice <= 0
  const noDeposit = data.serviceDeposit <= 0

  // Las mismas filas que manda el mail: el momento es el mismo (la clienta ya no
  // está en la página del negocio) y contestar distinto en cada lado sería peor
  // que no contestar. La modalidad y compañía salen de la reserva que devolvió el
  // servidor, no de lo que el wizard cree: `resolveBookingDraft` pisa la modalidad
  // pedida cuando el servicio tiene una sola, y en un reintento con la misma key
  // la reserva devuelta puede ser otra.
  const donde = whereRows({ ...where, businessAddress: business.addressText })

  const whatsappHref = business.whatsapp
    ? buildBookingHelpWhatsappUrl(business.whatsapp, {
        bookingRef: formatBookingNumber(bookingNumber, bookingId),
        businessName: business.name,
      })
    : null

  // Display-only: si la reserva trae un descuento, el precio efectivo para los
  // cálculos de "Total por pagar" / "Saldo" es el finalAmount persistido.
  // "Precio total" sigue mostrando el precio original (pre-descuento).
  const hasDiscount = promo != null && promo.discountAmount > 0
  const effectiveFinal = hasDiscount ? promo!.finalAmount : data.servicePrice
  // En producción llegan los montos persistidos con `BookingCreated`. El
  // fallback mantiene compatibles usos aislados del componente (stories/tests).
  const hasPersistedDeposit = (depositRequired ?? data.serviceDeposit) > 0 || depositPaid > 0
  const cancellationWarning = hasPersistedDeposit
    ? cancellationWarningText(cancellationCutoffHours)
    : null

  return (
    <div className="text-center">
      {isPending ? (
        <Clock className="mx-auto mb-4 size-12 text-amber-600" />
      ) : (
        <CheckCircle2 className="mx-auto mb-4 size-12 text-primary" />
      )}
      <h2 className="mb-2 font-heading text-3xl font-semibold tracking-tight text-primary sm:text-4xl">
        {isPending ? 'Reserva recibida' : 'Reserva confirmada'}
      </h2>
      <p className="mb-6 text-muted-foreground">
        {isPending
          ? 'Tu reserva quedó pendiente hasta que el negocio confirme el abono.'
          : !noDeposit
            ? 'Tu reserva ha sido confirmada.'
            : isFree
              ? 'Tu reserva gratuita ha sido confirmada.'
              : 'Tu reserva ha sido confirmada. El saldo se paga directamente al negocio.'}
      </p>

      <div className="mb-6 space-y-3 rounded-2xl bg-muted/55 p-5 text-left">
        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Servicio</span><span className="font-semibold text-primary">{data.serviceName}</span></div>
        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Fecha y hora</span><span className="font-semibold text-primary">{data.timeSlot ? formatBookingDateTime(data.timeSlot.start, timezone) : ''}</span></div>
        {/* Sale de la reserva que devolvió el servidor y NO del estado del wizard,
            por el mismo motivo que `donde`: con "Cualquiera disponible" el wizard no
            sabe a quién le tocó —lo eligió el servidor adentro de la transacción— y
            mostrar "Cualquiera disponible" en "Te atiende" no le sirve a nadie. */}
        {professionalName && (
          <div className="flex justify-between gap-4"><span className="text-muted-foreground">Te atiende</span><span className="font-semibold text-primary">{professionalName}</span></div>
        )}
        {donde.map((row) => (
          <div key={row.label} className="flex justify-between gap-4">
            <span className="text-muted-foreground">{row.label}</span>
            <WhereRowValue row={row} />
          </div>
        ))}
        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Precio total</span><span className="font-semibold text-primary">{formatMoney(data.servicePrice, currency)}</span></div>
        {hasDiscount && (
          <>
            <div className="flex justify-between gap-4"><span className="text-muted-foreground">Descuento</span><span className="font-semibold text-green-700">−{formatMoney(promo!.discountAmount, currency)}</span></div>
            <div className="flex justify-between gap-4"><span className="text-muted-foreground">Precio final</span><span className="font-semibold text-primary">{formatMoney(effectiveFinal, currency)}</span></div>
          </>
        )}
        {noDeposit && !isFree ? (
          <div className="flex justify-between gap-4 border-t border-border/60 pt-3">
            <span className="text-muted-foreground">Saldo pendiente</span>
            <span className="font-semibold text-primary">{formatMoney(effectiveFinal, currency)}</span>
          </div>
        ) : !noDeposit ? (
          <>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">{isPending ? 'Abono requerido' : 'Abono pagado'}</span>
              <span className="font-semibold text-primary">{formatMoney(data.serviceDeposit, currency)}</span>
            </div>
            <div className="flex justify-between gap-4 border-t border-border/60 pt-3">
              <span className="text-muted-foreground">{isPending ? 'Total por pagar' : 'Saldo pendiente'}</span>
              <span className="font-semibold text-primary">{formatMoney(isPending ? effectiveFinal : effectiveFinal - data.serviceDeposit, currency)}</span>
            </div>
          </>
        ) : null}
      </div>

      <p className="mb-6 text-sm text-muted-foreground">Número de reserva: {formatBookingNumber(bookingNumber, bookingId)}</p>

      {cancellationWarning && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-left text-sm text-amber-900">
          <p className="font-semibold">Importante sobre tu abono</p>
          <p className="mt-1">{cancellationWarning}</p>
        </div>
      )}

      {/* Sólo con la reserva confirmada: una cita que todavía puede caerse no va
          al calendario de nadie. Ver `loadBookingInvite`, que aplica el mismo
          criterio del lado del servidor. */}
      {confirmed && bookingId && <AddToCalendar bookingId={bookingId} className="mb-6" />}

      {whatsappHref && <WhatsappHelpLine href={whatsappHref} businessName={business.name} className="mb-6" />}

      <AccountCta sessionActive={sessionEmail !== null} customerEmail={data.customerEmail || null} className="mb-6" />

      <Link href="/">
        <Button className="h-12 rounded-full px-7 text-base font-semibold">Volver al inicio</Button>
      </Link>
    </div>
  )
}
