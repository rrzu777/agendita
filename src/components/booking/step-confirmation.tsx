'use client'

import { Button } from '@/components/ui/button'
import { BookingData } from './wizard'
import Link from 'next/link'
import { CheckCircle2, Clock } from 'lucide-react'
import { formatMoney } from '@/lib/money'
import { formatBookingNumber } from '@/lib/bookings/number'
import { formatBookingDateTime } from '@/lib/booking/format-booking-datetime'
import { AccountCta } from './account-cta'

export function StepConfirmation({ data, timezone, bookingId, bookingNumber, mode, promo, sessionEmail }: { data: BookingData; timezone: string; bookingId: string | null; bookingNumber: number | null; mode: 'paid' | 'pending'; promo?: { discountAmount: number; finalAmount: number } | null; sessionEmail: string | null }) {
  const isPending = mode === 'pending'
  const isFree = data.servicePrice <= 0
  const noDeposit = data.serviceDeposit <= 0

  // Display-only: si la reserva trae un descuento, el precio efectivo para los
  // cálculos de "Total por pagar" / "Saldo" es el finalAmount persistido.
  // "Precio total" sigue mostrando el precio original (pre-descuento).
  const hasDiscount = promo != null && promo.discountAmount > 0
  const effectiveFinal = hasDiscount ? promo!.finalAmount : data.servicePrice

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
        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Precio total</span><span className="font-semibold text-primary">{formatMoney(data.servicePrice)}</span></div>
        {hasDiscount && (
          <>
            <div className="flex justify-between gap-4"><span className="text-muted-foreground">Descuento</span><span className="font-semibold text-green-700">−{formatMoney(promo!.discountAmount)}</span></div>
            <div className="flex justify-between gap-4"><span className="text-muted-foreground">Precio final</span><span className="font-semibold text-primary">{formatMoney(effectiveFinal)}</span></div>
          </>
        )}
        {noDeposit && !isFree ? (
          <div className="flex justify-between gap-4 border-t border-border/60 pt-3">
            <span className="text-muted-foreground">Saldo pendiente</span>
            <span className="font-semibold text-primary">{formatMoney(effectiveFinal)}</span>
          </div>
        ) : !noDeposit ? (
          <>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">{isPending ? 'Abono requerido' : 'Abono pagado'}</span>
              <span className="font-semibold text-primary">{formatMoney(data.serviceDeposit)}</span>
            </div>
            <div className="flex justify-between gap-4 border-t border-border/60 pt-3">
              <span className="text-muted-foreground">{isPending ? 'Total por pagar' : 'Saldo pendiente'}</span>
              <span className="font-semibold text-primary">{formatMoney(isPending ? effectiveFinal : effectiveFinal - data.serviceDeposit)}</span>
            </div>
          </>
        ) : null}
      </div>

      <p className="mb-6 text-sm text-muted-foreground">Número de reserva: {formatBookingNumber(bookingNumber, bookingId)}</p>

      <AccountCta sessionActive={sessionEmail !== null} customerEmail={data.customerEmail || null} className="mb-6" />

      <Link href="/">
        <Button className="h-12 rounded-full px-7 text-base font-semibold">Volver al inicio</Button>
      </Link>
    </div>
  )
}
