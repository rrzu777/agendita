'use client'

import { Button } from '@/components/ui/button'
import { BookingData } from './wizard'
import Link from 'next/link'
import { CheckCircle2, Clock } from 'lucide-react'

export function StepConfirmation({ data, bookingId, mode }: { data: BookingData; bookingId: string | null; mode: 'paid' | 'pending' }) {
  const isPending = mode === 'pending'
  const isFree = data.servicePrice <= 0
  const noDeposit = data.serviceDeposit <= 0

  return (
    <div className="text-center">
      {isPending ? (
        <Clock className="mx-auto mb-4 size-12 text-amber-600" />
      ) : (
        <CheckCircle2 className="mx-auto mb-4 size-12 text-primary" />
      )}
      <h2 className="mb-2 text-3xl font-semibold tracking-normal text-primary">
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

      <div className="mb-6 space-y-3 rounded-xl bg-muted/55 p-5 text-left">
        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Servicio</span><span className="font-semibold text-primary">{data.serviceName}</span></div>
        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Fecha y hora</span><span className="font-semibold text-primary">{data.date?.toLocaleDateString('es-CL')} {data.timeSlot?.start.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}</span></div>
        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Precio total</span><span className="font-semibold text-primary">${data.servicePrice.toLocaleString('es-CL')}</span></div>
        {noDeposit && !isFree ? (
          <div className="flex justify-between gap-4 border-t border-border/60 pt-3">
            <span className="text-muted-foreground">Saldo pendiente</span>
            <span className="font-semibold text-primary">${data.servicePrice.toLocaleString('es-CL')}</span>
          </div>
        ) : !noDeposit ? (
          <>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">{isPending ? 'Abono requerido' : 'Abono pagado'}</span>
              <span className="font-semibold text-primary">${data.serviceDeposit.toLocaleString('es-CL')}</span>
            </div>
            <div className="flex justify-between gap-4 border-t border-border/60 pt-3">
              <span className="text-muted-foreground">{isPending ? 'Total por pagar' : 'Saldo pendiente'}</span>
              <span className="font-semibold text-primary">${isPending ? data.servicePrice.toLocaleString('es-CL') : (data.servicePrice - data.serviceDeposit).toLocaleString('es-CL')}</span>
            </div>
          </>
        ) : null}
      </div>

      <p className="mb-6 text-sm text-muted-foreground">Número de reserva: {bookingId}</p>

      <Link href="/">
        <Button className="h-12 px-6 text-base font-semibold">Volver al inicio</Button>
      </Link>
    </div>
  )
}
