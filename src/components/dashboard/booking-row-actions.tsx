'use client'

import { useState, useTransition } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TableActions } from '@/components/ui/table-actions'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { CancelBookingButton } from './cancel-booking-button'
import { ManualPaymentDialog } from './manual-payment-dialog'
import { isManualPaymentAllowed, type ManualPaymentBooking } from './manual-payment-utils'
import { ReviveBookingDialog } from './revive-booking-dialog'
import { getReviveReopenState } from './revive-utils'
import { updateBookingStatus } from '@/server/actions/bookings'

type RowBooking = ManualPaymentBooking & {
  startDateTime: Date | string
  paymentMethod: string | null
  customer: { name: string; email?: string | null } | null
}

function CompleteBookingButton({ bookingId }: { bookingId: string }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="flex flex-col items-end">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => {
          setError(null)
          startTransition(async () => {
            try {
              await updateBookingStatus(bookingId, 'completed')
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Error al completar')
            }
          })
        }}
      >
        {pending ? 'Completando…' : 'Completar'}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  )
}

export function BookingRowActions({
  booking,
  businessCurrency,
  contact,
  transferEnabled,
}: {
  booking: RowBooking
  businessCurrency: string
  contact?: React.ReactNode
  transferEnabled?: boolean
}) {
  const [cancelOpen, setCancelOpen] = useState(false)
  const [payOpen, setPayOpen] = useState(false)
  const [reviveOpen, setReviveOpen] = useState(false)

  const canPay = isManualPaymentAllowed(booking)
  const isConfirmed = booking.status === 'confirmed'
  const isPending = booking.status === 'pending_payment'
  const isActionable = isConfirmed || isPending
  const isExpired = booking.status === 'expired'

  if (isExpired) {
    const { canReopen, reason } = getReviveReopenState(booking, !!transferEnabled)
    return (
      <div className="flex items-center justify-end gap-2">
        {contact}
        <Button type="button" size="sm" variant="outline" onClick={() => setReviveOpen(true)}>
          Revivir
        </Button>
        <ReviveBookingDialog
          bookingId={booking.id}
          serviceName={booking.service?.name || 'Servicio'}
          customerName={booking.customer?.name || 'Cliente'}
          customerHasEmail={!!booking.customer?.email}
          canReopen={canReopen}
          reopenDisabledReason={canReopen ? null : reason}
          open={reviveOpen}
          onOpenChange={setReviveOpen}
        />
      </div>
    )
  }

  if (!isActionable) {
    return contact ? <div className="flex justify-end">{contact}</div> : null
  }

  const primary = isConfirmed ? (
    <CompleteBookingButton bookingId={booking.id} />
  ) : (
    <Button type="button" size="sm" variant="outline" onClick={() => setPayOpen(true)}>
      Cobrar
    </Button>
  )

  return (
    <>
      <TableActions primary={<>{contact}{primary}</>}>
        {isConfirmed && (
          <DropdownMenuItem asChild>
            <a href={`/dashboard/bookings/${booking.id}/reschedule`}>
              <RefreshCw className="size-4" /> Reprogramar
            </a>
          </DropdownMenuItem>
        )}
        {isConfirmed && canPay && (
          <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setPayOpen(true) }}>
            Registrar pago
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          variant="destructive"
          onSelect={(e) => { e.preventDefault(); setCancelOpen(true) }}
        >
          Cancelar
        </DropdownMenuItem>
      </TableActions>

      <CancelBookingButton
        bookingId={booking.id}
        hideTrigger
        open={cancelOpen}
        onOpenChange={setCancelOpen}
      />
      {canPay && (
        <ManualPaymentDialog
          bookings={[booking]}
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
