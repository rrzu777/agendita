'use client'

import { useState } from 'react'
import Link from 'next/link'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TableActions } from '@/components/ui/table-actions'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { CancelBookingButton } from './cancel-booking-button'
import { ManualPaymentDialog } from './manual-payment-dialog'
import { isManualPaymentAllowed, manualPaymentBlockedReason, type ManualPaymentBooking } from './manual-payment-utils'
import { ReviveBookingButton } from './revive-booking-dialog'
import { getReviveReopenState } from './revive-utils'
import { BookingStatusButton } from './booking-status-button'

type RowBooking = ManualPaymentBooking & {
  startDateTime: Date | string
  paymentMethod: string | null
  customer: { name: string; email?: string | null } | null
}

export function BookingRowActions({
  booking,
  businessCurrency,
  contact,
  transferEnabled,
  now,
}: {
  booking: RowBooking
  businessCurrency: string
  contact?: React.ReactNode
  transferEnabled?: boolean
  /** El reloj del SERVIDOR de este render. Requerido: este componente es
   *  cliente y sale en el HTML de la tabla, así que con un reloj propio el
   *  botón de cobro y el de Revivir se deciden distinto en el servidor y al
   *  hidratar — React #418, que voltea la página. Ver `isManualPaymentAllowed`. */
  now: Date
}) {
  const [cancelOpen, setCancelOpen] = useState(false)
  const [payOpen, setPayOpen] = useState(false)

  const canPay = isManualPaymentAllowed(booking, now)
  const blockedReason = manualPaymentBlockedReason(booking, now)
  const isConfirmed = booking.status === 'confirmed'
  const isPending = booking.status === 'pending_payment'
  // Solicitud esperando el visto bueno del negocio (confirmación manual).
  const isRequest = booking.status === 'pending_confirmation'
  const isActionable = isConfirmed || isPending || isRequest
  const isExpired = booking.status === 'expired'
  // Recobro (spec FU-B4b-3 §6): una completed con saldo (post-chargeback o saldo
  // tras atender) debe poder cobrarse desde la tabla — solo "Cobrar", sin
  // cancelar/reprogramar.
  const isCompletedWithBalance = booking.status === 'completed' && canPay

  if (isExpired) {
    const { canReopen, reason } = getReviveReopenState(booking, !!transferEnabled, now)
    return (
      <div className="flex items-center justify-end gap-2">
        {contact}
        <ReviveBookingButton
          bookingId={booking.id}
          serviceName={booking.service?.name || 'Servicio'}
          customerName={booking.customer?.name}
          customerHasEmail={!!booking.customer?.email}
          canReopen={canReopen}
          reopenDisabledReason={reason}
          triggerSize="sm"
        />
      </div>
    )
  }

  if (!isActionable && !isCompletedWithBalance) {
    return contact ? <div className="flex justify-end">{contact}</div> : null
  }

  const primary = isRequest ? (
    // Sólida (no outline): aceptar es la acción que el negocio viene a hacer a
    // esta fila, y la solicitud ocupa el cupo hasta que responda.
    <BookingStatusButton
      bookingId={booking.id}
      status="confirmed"
      label="Aceptar"
      pendingLabel="Aceptando…"
      errorLabel="Error al aceptar"
      variant="default"
    />
  ) : isConfirmed ? (
    <BookingStatusButton
      bookingId={booking.id}
      status="completed"
      label="Completar"
      pendingLabel="Completando…"
      errorLabel="Error al completar"
    />
  ) : canPay ? (
    <Button type="button" size="sm" variant="outline" onClick={() => setPayOpen(true)}>
      Cobrar
    </Button>
  ) : blockedReason ? (
    // Deshabilitado y NO ausente: el server rechaza este cobro, pero si el botón
    // simplemente desaparece la dueña no distingue eso de una app rota. El
    // motivo va en el title —la fila no tiene lugar para un párrafo—; la card
    // móvil, que sí lo tiene, lo muestra escrito.
    <Button type="button" size="sm" variant="outline" disabled title={blockedReason}>
      Cobrar
    </Button>
  ) : null

  return (
    <>
      <TableActions primary={<>{contact}{primary}</>}>
        {isConfirmed && (
          <DropdownMenuItem asChild>
            <Link href={`/dashboard/bookings/${booking.id}/reschedule`}>
              <RefreshCw className="size-4" /> Reprogramar
            </Link>
          </DropdownMenuItem>
        )}
        {isConfirmed && canPay && (
          <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setPayOpen(true) }}>
            Registrar pago
          </DropdownMenuItem>
        )}
        {isActionable && (
          <DropdownMenuItem
            variant="destructive"
            onSelect={(e) => { e.preventDefault(); setCancelOpen(true) }}
          >
            {isRequest ? 'Rechazar' : 'Cancelar'}
          </DropdownMenuItem>
        )}
      </TableActions>

      <CancelBookingButton
        bookingId={booking.id}
        mode={isRequest ? 'reject' : 'cancel'}
        hideTrigger
        open={cancelOpen}
        onOpenChange={setCancelOpen}
      />
      {canPay && (
        <ManualPaymentDialog
          bookings={[booking]}
          now={now}
          businessCurrency={businessCurrency}
          defaultBookingId={booking.id}
          hideTrigger
          open={payOpen}
          onOpenChange={setPayOpen}
        />
      )}
    </>
  )
}
