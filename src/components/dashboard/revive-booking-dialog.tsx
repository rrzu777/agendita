'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { reviveBooking } from '@/server/actions/revive-booking'

export function ReviveBookingDialog({
  bookingId,
  serviceName,
  customerName,
  customerHasEmail,
  canReopen,
  reopenDisabledReason,
  open,
  onOpenChange,
}: {
  bookingId: string
  serviceName: string
  customerName: string
  customerHasEmail: boolean
  /** true solo si turno futuro + paymentMethod bank_transfer + cuenta habilitada (el server re-valida igual). */
  canReopen: boolean
  reopenDisabledReason: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function run(mode: 'confirm' | 'reopen') {
    setError(null)
    startTransition(async () => {
      try {
        await reviveBooking(bookingId, mode)
        onOpenChange(false)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al revivir la reserva')
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-2xl font-heading font-semibold tracking-tight text-primary">
            Revivir reserva
          </DialogTitle>
          <DialogDescription>
            {serviceName} — {customerName}. Elegí cómo reactivarla; el horario se vuelve a chequear.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Button type="button" className="h-11 w-full font-semibold" disabled={isPending} onClick={() => run('confirm')}>
            <CheckCircle2 className="mr-2 size-4" />
            {isPending ? 'Procesando...' : 'Confirmar reserva'}
          </Button>
          <p className="text-xs text-muted-foreground">
            Queda confirmada con el saldo pendiente que tenga; el pago lo registrás después.
          </p>

          <Button
            type="button"
            variant="outline"
            className="h-11 w-full font-semibold"
            disabled={isPending || !canReopen}
            onClick={() => run('reopen')}
          >
            <Clock className="mr-2 size-4" />
            Dar nuevo plazo para pagar
          </Button>
          {canReopen ? (
            <p className="text-xs text-muted-foreground">
              Vuelve a pendiente de pago con un plazo nuevo para transferir y avisar.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">{reopenDisabledReason}</p>
          )}

          {!customerHasEmail && (
            <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
              Esta clienta no tiene email: avisale por WhatsApp que su reserva revivió.
            </p>
          )}
          {/* Desviación consciente de la spec §5 ("reusar BookingContactButtons"):
              el botón de contacto ya está visible en la fila/card al lado del
              trigger; duplicarlo dentro del diálogo no suma. Solo el aviso. */}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function ReviveBookingButton(
  props: Omit<Parameters<typeof ReviveBookingDialog>[0], 'open' | 'onOpenChange'> & { triggerClassName?: string },
) {
  const [open, setOpen] = useState(false)
  const { triggerClassName, ...dialogProps } = props
  return (
    <>
      <Button type="button" variant="outline" className={triggerClassName} onClick={() => setOpen(true)}>
        Revivir
      </Button>
      <ReviveBookingDialog {...dialogProps} open={open} onOpenChange={setOpen} />
    </>
  )
}
