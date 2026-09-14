'use client'

import { bookingServiceName } from '@/lib/bookings/service-lines'
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
import {
  BookingContactButtons,
  BookingContactFeedback,
  useBookingContactController,
  type BookingContactData,
} from './booking-contact-buttons'

type RowBooking = ManualPaymentBooking & {
  startDateTime: Date | string
  paymentMethod?: string | null
  customer: { name: string; email?: string | null } | null
}

export function BookingRowActions({
  booking,
  businessCurrency,
  contactData,
  transferEnabled,
  now,
}: {
  booking: RowBooking
  businessCurrency: string
  /** Datos estructurados: este componente decide una sola vez qué contacto es veraz. */
  contactData?: BookingContactData
  transferEnabled?: boolean
  /** El reloj del SERVIDOR de este render. Requerido: este componente es
   *  cliente y sale en el HTML de la tabla, así que con un reloj propio el
   *  botón de cobro y el de Revivir se deciden distinto en el servidor y al
   *  hidratar — React #418, que voltea la página. Ver `isManualPaymentAllowed`. */
  now: Date
}) {
  const [cancelOpen, setCancelOpen] = useState(false)
  const [payOpen, setPayOpen] = useState(false)
  const contactAvailability = {
    status: booking.status,
    paymentStatus: booking.paymentStatus,
    holdExpiresAt: booking.holdExpiresAt,
    now,
  }
  const contactController = useBookingContactController(contactData ?? null, contactAvailability)

  const canPay = isManualPaymentAllowed(booking, now)
  const blockedReason = manualPaymentBlockedReason(booking, now)
  const isConfirmed = booking.status === 'confirmed'
  const isPending = booking.status === 'pending_payment'
  const isRequest = booking.status === 'pending_confirmation'
  const isActionable = isConfirmed || isPending || isRequest
  const isExpired = booking.status === 'expired'
  // Recobro (spec FU-B4b-3 §6): completed con saldo puede cobrar, pero no
  // vuelve a adquirir acciones de ciclo de vida como cancelar/reprogramar.
  const isCompletedWithBalance = booking.status === 'completed' && canPay

  const primary = isExpired ? (() => {
    const { canReopen, reason } = getReviveReopenState(
      { startDateTime: booking.startDateTime, paymentMethod: booking.paymentMethod ?? null },
      !!transferEnabled,
      now,
    )
    return (
      <ReviveBookingButton
        bookingId={booking.id}
        serviceName={bookingServiceName(booking)}
        customerName={booking.customer?.name}
        customerHasEmail={!!booking.customer?.email}
        canReopen={canReopen}
        reopenDisabledReason={reason}
        triggerSize="sm"
        triggerClassName="min-h-11"
      />
    )
  })() : isRequest ? (
    <BookingStatusButton
      bookingId={booking.id}
      status="confirmed"
      label="Aceptar"
      pendingLabel="Aceptando…"
      errorLabel="Error al aceptar"
      variant="default"
      className="min-h-11"
    />
  ) : isConfirmed ? (
    <BookingStatusButton
      bookingId={booking.id}
      status="completed"
      label="Completar"
      pendingLabel="Completando…"
      errorLabel="Error al completar"
      className="min-h-11"
    />
  ) : (isPending || isCompletedWithBalance) && canPay ? (
    <Button type="button" size="sm" variant="outline" className="min-h-11" onClick={() => setPayOpen(true)}>
      Cobrar
    </Button>
  ) : null

  const hasMenu = !!contactData || isActionable
  if (!primary && !hasMenu) return null

  return (
    <div className="space-y-1">
      <TableActions
        data-tour-id="bookings-actions"
        className="flex items-center justify-end gap-1 [&_[data-slot=button]]:min-h-11 [&_[data-slot=button]]:min-w-11"
        triggerClassName="size-11"
        primary={primary}
      >
        {contactData && (
          <BookingContactButtons
            variant="menu"
            booking={contactData}
            availability={contactAvailability}
            controller={contactController}
          />
        )}
        {isConfirmed && (
          <DropdownMenuItem asChild className="min-h-11 cursor-pointer">
            <Link href={`/dashboard/bookings/${booking.id}/reschedule`} prefetch={false}>
              <RefreshCw className="size-4" /> Reprogramar
            </Link>
          </DropdownMenuItem>
        )}
        {isConfirmed && canPay && (
          <DropdownMenuItem className="min-h-11 cursor-pointer" onSelect={(event) => { event.preventDefault(); setPayOpen(true) }}>
            Registrar pago
          </DropdownMenuItem>
        )}
        {isActionable && (
          <DropdownMenuItem
            className="min-h-11 cursor-pointer"
            variant="destructive"
            onSelect={(event) => { event.preventDefault(); setCancelOpen(true) }}
          >
            {isRequest ? 'Rechazar' : 'Cancelar'}
          </DropdownMenuItem>
        )}
      </TableActions>

      {blockedReason && <p className="max-w-80 text-right text-xs text-muted-foreground">{blockedReason}</p>}
      <BookingContactFeedback controller={contactController} />

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
    </div>
  )
}
